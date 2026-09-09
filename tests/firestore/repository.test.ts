import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, type Firestore } from "firebase/firestore";
import { readFile } from "node:fs/promises";
import { FirestoreBudgetRepository } from "../../src/repositories/firestore/FirestoreBudgetRepository";
import { BudgetService } from "../../src/services/BudgetService";
import type { Household, Transaction } from "../../src/domain/types";

let env: RulesTestEnvironment;
const householdId = "adapter-household";
const baseTime = "2026-01-01T00:00:00.000Z";
const household: Household = { id: householdId, name: "Adapter test", currency: "USD", timezone: "America/New_York", schemaVersion: 1, createdAt: baseTime, updatedAt: baseTime };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-split-budget", firestore: { host: "127.0.0.1", port: 8080, rules: await readFile("firestore.rules", "utf8") } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "households", householdId), household);
    for (const id of ["uid-member", "uid-other"]) await setDoc(doc(firestore, "households", householdId, "members", id), { id, authUid: id, displayName: id, role: "member", active: true, createdAt: baseTime, updatedAt: baseTime });
    await setDoc(doc(firestore, "households", householdId, "settlementPools", "household-operating"), { id: "household-operating", name: "Operating", active: true });
    await setDoc(doc(firestore, "households", householdId, "accounts", "joint"), { id: "joint", name: "Joint", ownerType: "joint", type: "checking", active: true, createdAt: baseTime, updatedAt: baseTime });
    await setDoc(doc(firestore, "households", householdId, "categories", "home"), { id: "home", name: "Home", type: "expense", active: true });
  });
});

function adapter() { return new FirestoreBudgetRepository(env.authenticatedContext("uid-member").firestore() as unknown as Firestore); }
function transaction(periodId: string, id: string, amountCents: number, economicDate: string): Transaction { return { id, economicDate, description: id, amountCents, kind: "expense", accountId: "joint", categoryId: "home", settlementPoolId: "household-operating", paymentSource: { type: "joint", accountId: "joint" }, allocations: [{ memberId: "uid-member", shareBasisPoints: 10000 }], importance: "normal", settlementPeriodId: periodId, source: { type: "manual" }, status: "posted", createdByUid: "uid-member", createdAt: baseTime, updatedByUid: "uid-member", updatedAt: baseTime }; }

describe("FirestoreBudgetRepository emulator integration", () => {
  it("round-trips and orders period transactions by economic date", async () => {
    const repository = adapter(); await repository.saveConfig(householdId, { id: "config-1", version: 1, defaultAllocations: [{ memberId: "uid-member", shareBasisPoints: 10000 }], monthlyContributions: { "uid-member": 0 }, defaultSettlementPoolId: "household-operating", effectiveFrom: baseTime, createdAt: baseTime, createdByUid: "uid-member" });
    await repository.saveSettlementPeriod(householdId, { id: "period-2026-09", name: "2026-09", startDate: "2026-09-01T00:00:00.000Z", endDate: "2026-09-30T23:59:59.999Z", status: "open", includedSettlementPoolIds: ["household-operating"], contributionConfig: { "uid-member": { amountCents: 0 } }, configVersionId: "config-1", createdAt: baseTime, createdByUid: "uid-member", updatedAt: baseTime, updatedByUid: "uid-member" });
    await repository.saveTransaction(householdId, transaction("period-2026-09", "late", 200, "2026-09-20T00:00:00.000Z")); await repository.saveTransaction(householdId, transaction("period-2026-09", "early", 100, "2026-09-02T00:00:00.000Z"));
    expect((await repository.listTransactionsForPeriod(householdId, "period-2026-09")).map((value) => value.id)).toEqual(["early", "late"]);
    expect((await repository.exportAll(householdId)).transactions.map((value) => value.id).sort()).toEqual(["early", "late"]);
  });

  it("atomically bootstraps, finalizes, and rejects finalized create/edit/move mutations", async () => {
    const repository = adapter(); await repository.saveConfig(householdId, { id: "config-1", version: 1, defaultAllocations: [{ memberId: "uid-member", shareBasisPoints: 10000 }], monthlyContributions: { "uid-member": 0 }, defaultSettlementPoolId: "household-operating", effectiveFrom: baseTime, createdAt: baseTime, createdByUid: "uid-member" });
    const service = new BudgetService(repository); const period = await service.ensureSettlementPeriodForMonth(householdId, "2026-09", "uid-member"); await service.saveTransaction(householdId, transaction(period.id, "rent", 1000, "2026-09-04T00:00:00.000Z")); await service.finalizePeriod(householdId, period.id, "uid-member");
    await expect(service.saveTransaction(householdId, transaction(period.id, "new", 100, "2026-09-05T00:00:00.000Z"))).rejects.toThrow("Finalized");
    await expect(service.saveTransaction(householdId, { ...(await repository.getTransaction(householdId, "rent")), amountCents: 2000 })).rejects.toThrow("Finalized");
    await expect(repository.saveSettlementPeriod(householdId, { ...period, updatedAt: "2026-09-02T00:00:00.000Z" }, period.updatedAt)).rejects.toThrow("Concurrency");
  });
});
