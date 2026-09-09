import { afterAll, beforeAll, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

let testEnv: RulesTestEnvironment;
const householdId = "household-test";

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-split-budget",
    firestore: { host: "127.0.0.1", port: 8080, rules: await (await import("node:fs/promises")).readFile("firestore.rules", "utf8") },
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "households", householdId), { name: "Test", currency: "USD" });
    await setDoc(doc(db, "households", householdId, "members", "uid-member"), { authUid: "uid-member", active: true, role: "member" });
    await setDoc(doc(db, "households", householdId, "settlementPeriods", "finalized"), { status: "finalized", updatedAt: "2026-01-01T00:00:00.000Z", finalizedSettlementId: "snapshot-1" });
    await setDoc(doc(db, "households", householdId, "settlements", "snapshot-1"), { id: "snapshot-1", settlementPeriodId: "finalized", version: 1 });
    await setDoc(doc(db, "households", householdId, "transactions", "posted"), { id: "posted", description: "posted", amountCents: 100, settlementPoolId: "household-operating", status: "posted", settlementPeriodId: "finalized" });
    await setDoc(doc(db, "households", householdId, "configHistory", "config-1"), { id: "config-1", version: 1 });
    await setDoc(doc(db, "households", householdId, "auditLog", "audit-1"), { id: "audit-1", eventType: "test" });
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

describe("household Firestore rules", () => {
  it("allows an allowlisted member to read and write ordinary data", async () => {
    const db = testEnv.authenticatedContext("uid-member").firestore();
    await assertSucceeds(getDoc(doc(db, "households", householdId)));
    await assertSucceeds(setDoc(doc(db, "households", householdId, "accounts", "checking"), { name: "Checking", active: true }));
  });

  it("denies nonmembers and client self enrollment", async () => {
    const db = testEnv.authenticatedContext("uid-stranger").firestore();
    await assertFails(getDoc(doc(db, "households", householdId)));
    await assertFails(setDoc(doc(db, "households", householdId, "members", "uid-stranger"), { authUid: "uid-stranger", active: true, role: "owner" }));
  });

  it("denies member deletion and household creation", async () => {
    const db = testEnv.authenticatedContext("uid-member").firestore();
    await assertFails(setDoc(doc(db, "households", "new-household"), { name: "Nope" }));
    await assertFails(setDoc(doc(db, "households", householdId, "members", "uid-member"), { authUid: "uid-member", active: false }));
  });

  it("denies every core collection to a nonmember", async () => {
    const db = testEnv.authenticatedContext("uid-stranger").firestore();
    const paths = ["accounts/a", "categories/c", "projects/p", "settlementPools/s", "config/current", "configHistory/c", "transactions/t", "settlementPeriods/p", "settlements/s", "recurringTemplates/t", "imports/i", "importRecords/r", "auditLog/a"];
    for (const path of paths) {
      const [collectionName, id] = path.split("/");
      await assertFails(getDoc(doc(db, "households", householdId, collectionName, id)));
      await assertFails(setDoc(doc(db, "households", householdId, collectionName, id), { id, value: "attempt" }));
    }
  });

  it("rejects member metadata impersonation and protected history mutation", async () => {
    const db = testEnv.authenticatedContext("uid-member").firestore();
    await assertFails(setDoc(doc(db, "households", householdId, "members", "uid-member"), { authUid: "uid-other", active: true, role: "owner" }));
    await assertFails(setDoc(doc(db, "households", householdId, "configHistory", "config-1"), { id: "config-1", version: 2 }));
    await assertFails(setDoc(doc(db, "households", householdId, "settlements", "snapshot-1"), { id: "snapshot-1", version: 2 }));
    await assertFails(setDoc(doc(db, "households", householdId, "auditLog", "audit-1"), { id: "audit-1", eventType: "changed" }));
  });

  it("blocks finalized transaction create, edit, move, and delete", async () => {
    const db = testEnv.authenticatedContext("uid-member").firestore();
    await assertFails(setDoc(doc(db, "households", householdId, "transactions", "new-finalized"), { description: "new", amountCents: 1, settlementPoolId: "household-operating", status: "posted", settlementPeriodId: "finalized" }));
    await assertFails(setDoc(doc(db, "households", householdId, "transactions", "posted"), { description: "changed", amountCents: 2, settlementPoolId: "household-operating", status: "posted", settlementPeriodId: "finalized" }));
    await assertFails(setDoc(doc(db, "households", householdId, "transactions", "posted"), { description: "moved", amountCents: 2, settlementPoolId: "household-operating", status: "posted", settlementPeriodId: "open" }));
    await assertFails(setDoc(doc(db, "households", householdId, "transactions", "posted"), { description: "deleted", amountCents: 2, settlementPoolId: "household-operating", status: "excluded", settlementPeriodId: "finalized" }));
  });

  it("allows only an explicit finalized to open transition and validates money", async () => {
    const db = testEnv.authenticatedContext("uid-member").firestore();
    await assertFails(setDoc(doc(db, "households", householdId, "settlementPeriods", "finalized"), { status: "reviewed", updatedAt: "2026-01-01T00:00:00.000Z" }));
    await assertFails(setDoc(doc(db, "households", householdId, "settlementPeriods", "finalized"), { status: "finalized", updatedAt: "2026-01-01T00:00:00.000Z", finalizedSettlementId: "other" }));
    await assertSucceeds(setDoc(doc(db, "households", householdId, "settlementPeriods", "finalized"), { status: "open", updatedAt: "2026-01-02T00:00:00.000Z" }));
    await assertFails(setDoc(doc(db, "households", householdId, "transactions", "bad-money"), { description: "bad", amountCents: "1", settlementPoolId: "household-operating", status: "posted" }));
  });
});
