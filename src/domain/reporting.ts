import type { Id, MoneyCents, Transaction } from "./types";
import { addCents, isIntegerCents } from "./money";

export interface MonthlySpendingReport {
  month: string;
  totalCents: MoneyCents;
  bySettlementPool: Record<Id, MoneyCents>;
  byCategory: Record<Id, MoneyCents>;
  transactionIds: Id[];
}

/**
 * Report recorded spending by economic month across every settlement pool.
 * Settlement-period assignment is deliberately ignored here.
 */
export function calculateMonthlySpendingReport(
  transactions: readonly Transaction[],
  month: string,
): MonthlySpendingReport {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new RangeError("month must use YYYY-MM format");
  const bySettlementPool: Record<Id, MoneyCents> = {};
  const byCategory: Record<Id, MoneyCents> = {};
  const transactionIds: Id[] = [];
  let totalCents = 0;

  for (const transaction of transactions) {
    if (transaction.status !== "posted" || transaction.economicDate.slice(0, 7) !== month || !isIntegerCents(transaction.amountCents)) continue;
    let sign = 0;
    if (transaction.kind === "expense") sign = 1;
    else if (transaction.kind === "refund") sign = -1;
    else if (transaction.kind === "reimbursement" && transaction.reimbursement?.treatment === "reduce_expense") sign = -1;
    if (sign === 0) continue;
    const value = sign * transaction.amountCents;
    totalCents = addCents(totalCents, value);
    bySettlementPool[transaction.settlementPoolId] = addCents(bySettlementPool[transaction.settlementPoolId] ?? 0, value);
    if (transaction.categoryId) byCategory[transaction.categoryId] = addCents(byCategory[transaction.categoryId] ?? 0, value);
    transactionIds.push(transaction.id);
  }
  return { month, totalCents, bySettlementPool, byCategory, transactionIds };
}

export const calculateMonthlyReport = calculateMonthlySpendingReport;
