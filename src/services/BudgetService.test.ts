import { describe, expect, it } from "vitest";
import type { Account, Category, Household, HouseholdConfigVersion, HouseholdMember, SettlementPool, Transaction } from "../domain/types";
import { InMemoryBudgetRepository } from "../repositories/InMemoryBudgetRepository";
import { BudgetService } from "./BudgetService";

const household: Household = { id: "home", name: "Home", currency: "USD", timezone: "America/New_York", schemaVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const member = (id: string): HouseholdMember => ({ id, authUid: id, displayName: id, role: "member", active: true, createdAt: household.createdAt, updatedAt: household.updatedAt });
const pool: SettlementPool = { id: "household-operating", name: "Operating", active: true };
const account: Account = { id: "joint", name: "Joint", ownerType: "joint", type: "checking", active: true, createdAt: household.createdAt, updatedAt: household.updatedAt };
const category: Category = { id: "home", name: "Home", type: "expense", active: true };
const config = (id: string, version: number, effectiveFrom = "2026-01-01T00:00:00.000Z"): HouseholdConfigVersion => ({ id, version, defaultAllocations: [{ memberId: "john", shareBasisPoints: 6000 }, { memberId: "blaire", shareBasisPoints: 4000 }], monthlyContributions: { john: 200000, blaire: 120000 }, defaultSettlementPoolId: pool.id, effectiveFrom, createdAt: effectiveFrom, createdByUid: "john" });
const tx = (id: string, periodId: string, amountCents = 10000): Transaction => ({ id, economicDate: "2026-09-10T00:00:00.000Z", description: id, amountCents, kind: "expense", accountId: account.id, categoryId: category.id, settlementPoolId: pool.id, paymentSource: { type: "joint", accountId: account.id }, allocations: [{ memberId: "john", shareBasisPoints: 6000 }, { memberId: "blaire", shareBasisPoints: 4000 }], importance: "normal", settlementPeriodId: periodId, source: { type: "manual" }, status: "posted", createdByUid: "john", createdAt: household.createdAt, updatedByUid: "john", updatedAt: household.updatedAt });

async function fixture() {
  const repository = new InMemoryBudgetRepository();
  repository.seedHousehold(household); repository.seed("home", "members", [member("john"), member("blaire")]); repository.seed("home", "pools", [pool]); repository.seed("home", "accounts", [account]); repository.seed("home", "categories", [category]); await repository.saveConfig("home", config("config-1", 1));
  return { repository, service: new BudgetService(repository) };
}

describe("BudgetService lifecycle", () => {
  it("bootstraps a month atomically and is idempotent under concurrent access", async () => {
    const { repository, service } = await fixture();
    const [a, b] = await Promise.all([service.ensureSettlementPeriodForMonth("home", "2026-09", "john"), service.ensureSettlementPeriodForMonth("home", "2026-09", "blaire")]);
    expect(a.id).toBe("period-2026-09"); expect(b.id).toBe(a.id); expect((await repository.listSettlementPeriods("home"))).toHaveLength(1);
  });

  it("keeps generated drafts independent when the template changes", async () => {
    const { repository, service } = await fixture();
    await repository.saveRecurringTemplate("home", { id: "cleaners", name: "Cleaners", description: "Cleaners", estimatedAmountCents: 20000, settlementPoolId: pool.id, allocations: config("x", 1).defaultAllocations, importance: "normal", frequency: "monthly", active: true, createdAt: household.createdAt, updatedAt: household.updatedAt });
    await service.ensureSettlementPeriodForMonth("home", "2026-09", "john");
    await repository.saveRecurringTemplate("home", { id: "cleaners", name: "Cleaners", description: "Cleaners", estimatedAmountCents: 22500, settlementPoolId: pool.id, allocations: config("x", 1).defaultAllocations, importance: "normal", frequency: "monthly", active: true, createdAt: household.createdAt, updatedAt: household.updatedAt });
    await service.ensureSettlementPeriodForMonth("home", "2026-10", "john");
    expect((await repository.getTransaction("home", "recurring-2026-09-cleaners")).amountCents).toBe(20000); expect((await repository.getTransaction("home", "recurring-2026-10-cleaners")).amountCents).toBe(22500);
  });

  it("creates immutable versioned snapshots across reopen and refinalize", async () => {
    const { repository, service } = await fixture();
    const period = await service.ensureSettlementPeriodForMonth("home", "2026-09", "john"); await service.saveTransaction("home", tx("rent", period.id), undefined);
    const first = await service.finalizePeriod("home", period.id, "john"); await service.reopenPeriod("home", period.id, "john", true);
    const changed = { ...(await repository.getTransaction("home", "rent")), amountCents: 20000, updatedAt: "2026-09-11T00:00:00.000Z" }; await service.saveTransaction("home", changed);
    const second = await service.finalizePeriod("home", period.id, "john");
    expect(second.version).toBe(2); expect(second.supersedesSettlementId).toBe(first.id); expect(await repository.getSettlement("home", first.id)).toEqual(first); expect(second.householdExpenseCents).toBe(20000);
    expect((await repository.listAuditLog("home")).map((event) => event.eventType)).toEqual(["period finalized", "period reopened", "settlement recalculated after reopen"]);
  });

  it("rejects drafts and all finalized-period transaction mutations, including moves", async () => {
    const { repository, service } = await fixture(); const period = await service.ensureSettlementPeriodForMonth("home", "2026-09", "john");
    await service.saveTransaction("home", { ...tx("rent", period.id), status: "draft" }); await expect(service.finalizePeriod("home", period.id, "john")).rejects.toThrow("draft");
    await service.saveTransaction("home", tx("rent", period.id)); await service.finalizePeriod("home", period.id, "john");
    await expect(service.saveTransaction("home", { ...(await repository.getTransaction("home", "rent")), amountCents: 2 })).rejects.toThrow("Finalized");
    await expect(service.saveTransaction("home", { ...(await repository.getTransaction("home", "rent")), settlementPeriodId: "other" })).rejects.toThrow("Finalized");
    await expect(service.saveTransaction("home", tx("new", period.id))).rejects.toThrow("Finalized");
  });

  it("preflights restore and leaves the target untouched on invalid input, then round-trips valid state", async () => {
    const source = await fixture(); const period = await source.service.ensureSettlementPeriodForMonth("home", "2026-09", "john"); await source.service.saveTransaction("home", tx("rent", period.id));
    const backup = await source.repository.exportAll("home"); const invalid = JSON.parse(JSON.stringify(backup)); invalid.transactions[0].amountCents = 1.5;
    const target = new InMemoryBudgetRepository(); await expect(target.restoreAll("restored", invalid, "john")).rejects.toThrow(); await expect(target.getHousehold("restored")).rejects.toThrow();
    await target.restoreAll("restored", backup, "john"); const roundTrip = await target.exportAll("restored"); expect(roundTrip.transactions).toEqual(backup.transactions); expect(roundTrip.currentConfig).toEqual(backup.currentConfig);
  });

  it("selects the config effective for the bootstrapped month, including future versions", async () => {
    const { repository, service } = await fixture(); await repository.saveConfig("home", config("config-future", 2, "2026-10-01T00:00:00.000Z"));
    const september = await service.ensureSettlementPeriodForMonth("home", "2026-09", "john"); expect(september.configVersionId).toBe("config-1");
    const october = await service.ensureSettlementPeriodForMonth("home", "2026-10", "john"); expect(october.configVersionId).toBe("config-future");
  });

  it("detects a ledger write racing with finalization", async () => {
    const { repository, service } = await fixture(); const period = await service.ensureSettlementPeriodForMonth("home", "2026-09", "john"); await service.saveTransaction("home", tx("rent", period.id));
    const original = repository.listTransactionsForPeriod.bind(repository); let release!: () => void; const paused = new Promise<void>((resolve) => { release = resolve; });
    repository.listTransactionsForPeriod = async (...args) => { const values = await original(...args); await paused; return values; };
    const finalizing = service.finalizePeriod("home", period.id, "john"); await Promise.resolve();
    await service.saveTransaction("home", { ...(await repository.getTransaction("home", "rent")), amountCents: 20000, updatedAt: "2026-09-12T00:00:00.000Z" }); release();
    await expect(finalizing).rejects.toThrow("Concurrency");
  });

  it("does not allow audit records to be overwritten", async () => {
    const { repository } = await fixture(); const audit = { id: "audit-1", eventType: "test", entityType: "household", entityId: "home", performedByUid: "john", timestamp: "2026-09-01T00:00:00.000Z", summary: "first" };
    await repository.appendAuditEvent("home", audit); await expect(repository.appendAuditEvent("home", { ...audit, summary: "changed" })).rejects.toThrow("immutable");
  });
});
