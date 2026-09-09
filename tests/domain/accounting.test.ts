import { describe, expect, it } from "vitest";
import type { Account, Allocation, HouseholdConfigVersion, SettlementPeriod, Transaction } from "../../src/domain/types";
import { calculateSettlement } from "../../src/domain/settlement";
import { calculateMonthlySpendingReport } from "../../src/domain/reporting";
import { validateTransaction } from "../../src/domain/validation";

const john = "john";
const blaire = "blaire";
const category = "shared";

function allocations(johnShare = 6000, blaireShare = 4000): Allocation[] {
  return [
    { memberId: john, shareBasisPoints: johnShare },
    { memberId: blaire, shareBasisPoints: blaireShare },
  ];
}

const config: HouseholdConfigVersion = {
  id: "config-1",
  version: 1,
  defaultAllocations: allocations(),
  monthlyContributions: { [john]: 200000, [blaire]: 120000 },
  defaultSettlementPoolId: "household-operating",
  effectiveFrom: "2026-01-01T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  createdByUid: "test",
};

const period: SettlementPeriod = {
  id: "period-1",
  name: "January 2026",
  startDate: "2026-01-01T00:00:00Z",
  endDate: "2026-01-31T23:59:59Z",
  status: "open",
  includedSettlementPoolIds: ["household-operating"],
  contributionConfig: { [john]: { amountCents: 200000 }, [blaire]: { amountCents: 120000 } },
  configVersionId: "config-1",
  createdAt: "2026-01-01T00:00:00Z",
  createdByUid: "test",
  updatedAt: "2026-01-01T00:00:00Z",
  updatedByUid: "test",
};

type TransactionOverrides = Omit<Partial<Transaction>, "id" | "description" | "amountCents" | "kind"> & Pick<Transaction, "id" | "description" | "amountCents" | "kind">;

function tx(overrides: TransactionOverrides): Transaction {
  const { id, description, amountCents, kind, ...optionalFields } = overrides;
  return {
    id,
    economicDate: "2026-01-15T12:00:00Z",
    description,
    amountCents,
    kind,
    categoryId: category,
    settlementPoolId: "household-operating",
    allocations: allocations(),
    importance: "normal",
    settlementPeriodId: period.id,
    source: { type: "manual" },
    status: "posted",
    createdByUid: "test",
    createdAt: "2026-01-15T12:00:00Z",
    updatedByUid: "test",
    updatedAt: "2026-01-15T12:00:00Z",
    ...optionalFields,
  };
}

function result(transactions: Transaction[], selectedPeriod = period) {
  return calculateSettlement(transactions, selectedPeriod, config);
}

describe("settlement accounting fixtures", () => {
  it("A: calculates a jointly paid 60/40 mortgage", () => {
    const output = result([tx({ id: "mortgage", description: "Mortgage", amountCents: 434700, kind: "expense", paymentSource: { type: "joint", accountId: "joint" } })]);
    expect(output.householdExpenseCents).toBe(434700);
    expect(output.members[john]).toMatchObject({ responsibilityCents: 260820, personalPaymentsCents: 0, amountToTransferCents: 60820 });
    expect(output.members[blaire]).toMatchObject({ responsibilityCents: 173880, personalPaymentsCents: 0, amountToTransferCents: 53880 });
  });

  it("B/C: gives the payer full generic personal-payment credit", () => {
    const output = result([
      tx({ id: "mortgage", description: "Mortgage", amountCents: 434700, kind: "expense", paymentSource: { type: "joint", accountId: "joint" } }),
      tx({ id: "costco", description: "Costco", amountCents: 80400, kind: "expense", paymentSource: { type: "member", memberId: john } }),
      tx({ id: "babysitter", description: "Babysitter", amountCents: 50000, kind: "expense", paymentSource: { type: "member", memberId: blaire } }),
    ]);
    expect(output.householdExpenseCents).toBe(565100);
    expect(output.members[john]).toMatchObject({ responsibilityCents: 339060, personalPaymentsCents: 80400, amountToTransferCents: 58660 });
    expect(output.members[blaire]).toMatchObject({ responsibilityCents: 226040, personalPaymentsCents: 50000, amountToTransferCents: 56040 });
  });

  it("D: records recipient reimbursements as explicit settlement debits", () => {
    const output = result([
      tx({ id: "expense", description: "Household expense", amountCents: 100000, kind: "expense" }),
      tx({ id: "mike", description: "Mike reimbursement", amountCents: 34100, kind: "reimbursement", reimbursement: { treatment: "received_on_behalf_of_household", receivedByMemberId: john } }),
      tx({ id: "other", description: "Other reimbursement", amountCents: 26600, kind: "reimbursement", reimbursement: { treatment: "received_on_behalf_of_household", receivedByMemberId: blaire } }),
    ]);
    expect(output.householdExpenseCents).toBe(100000);
    expect(output.members[john].reimbursementsCents).toBe(34100);
    expect(output.members[blaire].reimbursementsCents).toBe(26600);
  });

  it("E: reduces responsibility and expense for a merchant refund", () => {
    const output = result([
      tx({ id: "purchase", description: "Purchase", amountCents: 100000, kind: "expense" }),
      tx({ id: "refund", description: "Merchant refund", amountCents: 20000, kind: "reimbursement", reimbursement: { treatment: "reduce_expense" } }),
    ]);
    expect(output.householdExpenseCents).toBe(80000);
    expect(output.members[john].responsibilityCents).toBe(48000);
    expect(output.members[blaire].responsibilityCents).toBe(32000);
  });

  it("F: includes only the selected settlement pools", () => {
    const transactions = [
      tx({ id: "operating", description: "Operating", amountCents: 565100, kind: "expense" }),
      tx({ id: "renovation", description: "Renovation", amountCents: 150000, kind: "expense", settlementPoolId: "renovation" }),
    ];
    expect(result(transactions).householdExpenseCents).toBe(565100);
    expect(result(transactions, { ...period, includedSettlementPoolIds: ["household-operating", "renovation"] }).householdExpenseCents).toBe(715100);
  });

  it("G/H: counts a statement once and card payments as transfers", () => {
    const statementAccount: Account = { id: "card-statement", name: "Card", ownerType: "joint", type: "credit_card", trackingMode: "statement", active: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    const transactionAccount: Account = { ...statementAccount, id: "card-transactions", trackingMode: "transactions" };
    const statement = tx({ id: "statement", description: "Card statement", amountCents: 270900, kind: "expense", accountId: statementAccount.id, creditCardEvent: "statement" });
    const purchases = tx({ id: "purchases", description: "Card purchases", amountCents: 270900, kind: "expense", accountId: transactionAccount.id, creditCardEvent: "purchase" });
    const payment = tx({ id: "payment", description: "Card payment", amountCents: 270900, kind: "transfer", accountId: "checking", allocations: [], categoryId: undefined, creditCardEvent: "payment", transfer: { fromAccountId: "checking", toAccountId: transactionAccount.id } });
    expect(calculateSettlement([statement], period, config, { accounts: [statementAccount] }).householdExpenseCents).toBe(270900);
    expect(calculateSettlement([purchases, payment], period, config, { accounts: [transactionAccount, { ...statementAccount, id: "checking", type: "checking" }] }).householdExpenseCents).toBe(270900);
    expect(validateTransaction(tx({ id: "bad-payment", description: "bad card payment", amountCents: 270900, kind: "expense", accountId: transactionAccount.id, creditCardEvent: "payment" }), { accounts: [transactionAccount] }).valid).toBe(false);
  });

  it("I: uses settlementPeriodId rather than economic date for inclusion", () => {
    const januaryDateInFebruarySettlement = tx({ id: "late", description: "Late entry", amountCents: 10000, kind: "expense", economicDate: "2026-01-29T12:00:00Z", settlementPeriodId: period.id });
    expect(result([januaryDateInFebruarySettlement]).householdExpenseCents).toBe(10000);
    expect(result([{ ...januaryDateInFebruarySettlement, settlementPeriodId: "january" }]).householdExpenseCents).toBe(0);
  });

  it("J: supports custom and one-member allocations", () => {
    const shared = tx({ id: "half", description: "Half", amountCents: 10000, kind: "expense", allocations: [{ memberId: john, shareBasisPoints: 5000 }, { memberId: blaire, shareBasisPoints: 5000 }] });
    const johnOnly = tx({ id: "only", description: "John only", amountCents: 10000, kind: "expense", allocations: [{ memberId: john, shareBasisPoints: 10000 }] });
    const output = result([shared, johnOnly]);
    expect(output.members[john].responsibilityCents).toBe(15000);
    expect(output.members[blaire].responsibilityCents).toBe(5000);
  });

  it("K: rounds cents deterministically, including three members", () => {
    const one = result([tx({ id: "round", description: "Rounding", amountCents: 1001, kind: "expense" })]);
    expect(one.members[john].responsibilityCents + one.members[blaire].responsibilityCents).toBe(1001);
    const three = tx({ id: "three", description: "Three members", amountCents: 1001, kind: "expense", allocations: [{ memberId: "a", shareBasisPoints: 3333 }, { memberId: "b", shareBasisPoints: 3333 }, { memberId: "c", shareBasisPoints: 3334 }] });
    const first = result([three]);
    const second = result([{ ...three, allocations: [...three.allocations].reverse() }]);
    expect(first.members).toEqual(second.members);
    expect(Object.values(first.members).reduce((sum, person) => sum + person.responsibilityCents, 0)).toBe(1001);
  });

  it("L: uses the contribution snapshot stored on the period", () => {
    const output = result([tx({ id: "expense", description: "Expense", amountCents: 100000, kind: "expense" })], { ...period, contributionConfig: { [john]: { amountCents: 400000 }, [blaire]: { amountCents: 240000 } } });
    expect(output.members[john].regularContributionCents).toBe(400000);
    expect(output.members[blaire].regularContributionCents).toBe(240000);
  });

  it("R: reports all posted pools by economic month", () => {
    const transactions = [
      tx({ id: "operating", description: "Operating", amountCents: 565100, kind: "expense" }),
      tx({ id: "renovation", description: "Renovation", amountCents: 150000, kind: "expense", settlementPoolId: "renovation" }),
    ];
    const report = calculateMonthlySpendingReport(transactions, "2026-01");
    expect(report.totalCents).toBe(715100);
    expect(report.bySettlementPool).toEqual({ "household-operating": 565100, renovation: 150000 });
    expect(result(transactions).householdExpenseCents).toBe(565100);
  });
});

describe("transaction validation", () => {
  it("rejects incomplete allocations, missing reimbursement recipient, and invalid references", () => {
    const invalid = tx({ id: "invalid", description: "Invalid", amountCents: 10000, kind: "expense", allocations: [{ memberId: john, shareBasisPoints: 5000 }], accountId: "missing" });
    const validation = validateTransaction(invalid, { members: [{ id: john } as never], accounts: [] });
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toMatch(/allocations total|account/);
    const reimbursement = tx({ id: "missing-recipient", description: "Reimbursement", amountCents: 1000, kind: "reimbursement", reimbursement: { treatment: "received_on_behalf_of_household" } });
    expect(validateTransaction(reimbursement).valid).toBe(false);
  });

  it("rejects a transaction-mode card payment represented as an expense", () => {
    const card: Account = { id: "card", name: "Card", ownerType: "joint", type: "credit_card", trackingMode: "transactions", active: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    const invalid = tx({ id: "card-payment", description: "Card payment", amountCents: 1000, kind: "expense", accountId: card.id, creditCardEvent: "payment" });
    expect(validateTransaction(invalid, { accounts: [card] }).valid).toBe(false);
  });
});
