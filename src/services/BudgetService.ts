import type { BudgetRepository, AuditEvent } from "../repositories/BudgetRepository";
import type { HouseholdConfigVersion, Id, SettlementPeriod, FinalizedSettlement, Transaction } from "../domain/types";
import type { BudgetExportV1 } from "../domain/export";
import { calculateSettlement } from "../domain/settlement";

const iso = (date: Date) => date.toISOString();
const monthBounds = (yearMonth: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) throw new Error("Month must use YYYY-MM format");
  const [year, month] = yearMonth.split("-").map(Number);
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)) };
};
const event = (id: string, eventType: string, entityType: string, entityId: Id, uid: string, summary: string): AuditEvent => ({ id, eventType, entityType, entityId, performedByUid: uid, timestamp: new Date().toISOString(), summary });

export class BudgetService {
  constructor(private readonly repository: BudgetRepository, private readonly engineVersion = "settlement-v1") {}

  async exportAll(householdId: Id): Promise<BudgetExportV1> { return this.repository.exportAll(householdId); }
  async saveTransaction(householdId: Id, transaction: Transaction, expectedUpdatedAt?: string): Promise<void> { return this.repository.saveTransaction(householdId, transaction, expectedUpdatedAt); }
  async restore(householdId: Id, backup: BudgetExportV1, actorUid: string, confirmed = false): Promise<void> {
    if (!confirmed) throw new Error("Restoring a backup requires explicit confirmation");
    if (this.repository.restoreIntoProvisionedHousehold) return this.repository.restoreIntoProvisionedHousehold(householdId, backup, actorUid);
    return this.repository.restoreAll(householdId, backup, actorUid);
  }

  /** Creates a period and one independent draft per active monthly template. IDs make retries idempotent. */
  async ensureSettlementPeriodForMonth(householdId: Id, yearMonth: string, actorUid: string): Promise<SettlementPeriod> {
    const bounds = monthBounds(yearMonth);
    const periodId = `period-${yearMonth}`;
    try { return await this.repository.getSettlementPeriod(householdId, periodId); } catch { /* first access */ }
    const config = this.repository.getConfigForDate
      ? await this.repository.getConfigForDate(householdId, iso(bounds.start))
      : await this.repository.getCurrentConfig(householdId);
    const pools = await this.repository.getSettlementPools(householdId);
    const period: SettlementPeriod = {
      id: periodId, name: yearMonth, startDate: iso(bounds.start), endDate: iso(bounds.end), status: "open",
      includedSettlementPoolIds: [config.defaultSettlementPoolId],
      contributionConfig: Object.fromEntries(Object.entries(config.monthlyContributions).map(([memberId, amountCents]) => [memberId, { amountCents }])),
      configVersionId: config.id, createdAt: new Date().toISOString(), createdByUid: actorUid, updatedAt: new Date().toISOString(), updatedByUid: actorUid,
    };
    if (!period.includedSettlementPoolIds.every((id) => pools.some((p) => p.id === id))) throw new Error("Current config references a missing settlement pool");
    const templates = (await this.repository.getRecurringTemplates(householdId)).filter((t) => t.active && t.frequency === "monthly");
    const generated: Transaction[] = [];
    for (const template of templates) {
      const txId = `recurring-${yearMonth}-${template.id}`;
      const source = { type: "recurring_template" as const, sourceTransactionId: template.id, generationKey: `${periodId}:${template.id}` };
      try { await this.repository.getTransaction(householdId, txId); continue; } catch { /* generated below */ }
      const timestamp = new Date().toISOString();
      const transaction: Transaction = {
        id: txId, economicDate: iso(bounds.start), description: template.description || template.name, amountCents: template.estimatedAmountCents ?? 0,
        kind: "expense", categoryId: template.categoryId, projectId: template.projectId, settlementPoolId: template.settlementPoolId,
        paymentSource: template.paymentSource, allocations: template.allocations, importance: template.importance, settlementPeriodId: periodId,
        source, status: "draft", createdByUid: actorUid, createdAt: timestamp, updatedByUid: actorUid, updatedAt: timestamp,
      };
      generated.push(transaction);
    }
    if (this.repository.saveBootstrap) {
      try { await this.repository.saveBootstrap(householdId, period, generated); }
      catch (error) { if (String(error).includes("already bootstrapped")) return this.repository.getSettlementPeriod(householdId, periodId); throw error; }
    } else {
      await this.repository.saveSettlementPeriod(householdId, period);
      for (const transaction of generated) await this.repository.saveTransaction(householdId, transaction);
    }
    return period;
  }

  async finalizePeriod(householdId: Id, periodId: Id, actorUid: string): Promise<FinalizedSettlement> {
    const period = await this.repository.getSettlementPeriod(householdId, periodId);
    if (period.status === "finalized") throw new Error("Period is already finalized");
    const transactions = await this.repository.listTransactionsForPeriod(householdId, periodId);
    if (transactions.some((tx) => tx.status === "draft")) throw new Error("Cannot finalize while draft transactions remain");
    const config = await this.repository.getConfigVersion(householdId, period.configVersionId);
    const result = calculateSettlement(transactions, period, config);
    if (!result.reconciliation.valid) throw new Error(`Cannot finalize: ${result.reconciliation.messages.join("; ")}`);
    const prior = await this.repository.getFinalizedSettlementForPeriod(householdId, periodId);
    const version = (prior?.version ?? 0) + 1;
    const timestamp = new Date().toISOString();
    const settlement: FinalizedSettlement = {
      ...result, id: `${periodId}-settlement-v${version}`, settlementPeriodId: periodId, version,
      ...(prior ? { supersedesSettlementId: prior.id } : {}), configVersionId: period.configVersionId,
      transactionIds: transactions.filter((tx) => tx.status === "posted" && tx.settlementPeriodId === periodId && period.includedSettlementPoolIds.includes(tx.settlementPoolId)).map((tx) => tx.id),
      includedSettlementPoolIds: [...period.includedSettlementPoolIds], engineVersion: this.engineVersion, calculatedAt: timestamp, finalizedAt: timestamp, finalizedByUid: actorUid,
    };
    const updated: SettlementPeriod = { ...period, status: "finalized", finalizedSettlementId: settlement.id, finalizedAt: timestamp, updatedAt: timestamp, updatedByUid: actorUid };
    const audit = event(`audit-finalize-${settlement.id}`, prior ? "settlement recalculated after reopen" : "period finalized", "settlement", settlement.id, actorUid, `Finalized ${period.name} settlement version ${version}`);
    if (this.repository.commitFinalization) await this.repository.commitFinalization(householdId, settlement, updated, audit, period.updatedAt);
    else { await this.repository.saveSettlement(householdId, settlement); await this.repository.saveSettlementPeriod(householdId, updated, period.updatedAt); await this.repository.appendAuditEvent(householdId, audit); }
    return settlement;
  }

  async reopenPeriod(householdId: Id, periodId: Id, actorUid: string, confirmation = false): Promise<SettlementPeriod> {
    if (!confirmation) throw new Error("Reopening a finalized period requires explicit confirmation");
    const period = await this.repository.getSettlementPeriod(householdId, periodId);
    if (period.status !== "finalized") return period;
    const priorId = period.finalizedSettlementId;
    const timestamp = new Date().toISOString();
    const reopened: SettlementPeriod = { ...period, status: "open", updatedAt: timestamp, updatedByUid: actorUid };
    await this.repository.saveSettlementPeriod(householdId, reopened, period.updatedAt);
    await this.repository.appendAuditEvent(householdId, event(`audit-reopen-${periodId}-${Date.now()}`, "period reopened", "settlementPeriod", periodId, actorUid, `Reopened ${period.name}${priorId ? ` from ${priorId}` : ""}`));
    return reopened;
  }

  async saveSettings(householdId: Id, config: HouseholdConfigVersion, actorUid: string, reason?: string): Promise<void> {
    await this.repository.saveConfig(householdId, { ...config, createdByUid: config.createdByUid || actorUid }, reason);
    await this.repository.appendAuditEvent(householdId, event(`audit-config-${config.id}`, "configuration changed", "config", config.id, actorUid, reason ?? `Saved configuration version ${config.version}`));
  }
}

export async function ensureSettlementPeriodForMonth(repository: BudgetRepository, householdId: Id, yearMonth: string, actorUid: string): Promise<SettlementPeriod> {
  return new BudgetService(repository).ensureSettlementPeriodForMonth(householdId, yearMonth, actorUid);
}
