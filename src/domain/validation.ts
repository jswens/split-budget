import type {
  Account,
  Allocation,
  Category,
  HouseholdMember,
  Id,
  Project,
  SettlementPool,
  Transaction,
} from "./types";
import { isAllocatableKind, validateAllocations } from "./allocation";
import { isIntegerCents } from "./money";

type Collection<T extends { id: Id }> = readonly T[] | Record<Id, T>;

export interface ValidationContext {
  members?: Collection<HouseholdMember>;
  accounts?: Collection<Account>;
  categories?: Collection<Category>;
  projects?: Collection<Project>;
  settlementPools?: Collection<SettlementPool>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Alias retained for callers that display domain diagnostics as messages. */
  messages: string[];
  warnings: string[];
}

function ids<T extends { id: Id }>(collection: Collection<T> | undefined): Set<Id> | undefined {
  if (!collection) return undefined;
  return new Set(Array.isArray(collection) ? collection.map((item) => item.id) : Object.keys(collection));
}

function requireReference(
  value: Id | undefined,
  label: string,
  collection: Set<Id> | undefined,
  errors: string[],
): void {
  if (value && collection && !collection.has(value)) errors.push(`${label} '${value}' does not exist`);
}

export function validateTransaction(transaction: Transaction, context: ValidationContext = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const memberIds = ids(context.members);
  const accountIds = ids(context.accounts);
  const categoryIds = ids(context.categories);
  const projectIds = ids(context.projects);
  const poolIds = ids(context.settlementPools);

  if (!transaction || typeof transaction !== "object") {
    errors.push("transaction is required");
    return { valid: false, errors, messages: [...errors], warnings };
  }
  if (!transaction.id) errors.push("transaction id is required");
  if (!transaction.description?.trim()) errors.push(`transaction ${transaction.id || "(unknown)"} description is required`);
  if (!transaction.settlementPoolId) errors.push(`transaction ${transaction.id} settlementPoolId is required`);
  if (!isIntegerCents(transaction.amountCents)) errors.push(`transaction ${transaction.id} amountCents must be an integer within the safe cents range`);
  else if (transaction.amountCents < 0 || (transaction.amountCents === 0 && transaction.kind !== "adjustment")) errors.push(`transaction ${transaction.id} amountCents must be a positive magnitude`);
  if (!transaction.economicDate) errors.push(`transaction ${transaction.id} economicDate is required`);
  if (!transaction.source?.type) errors.push(`transaction ${transaction.id} source is required`);

  requireReference(transaction.settlementPoolId, "settlement pool", poolIds, errors);
  requireReference(transaction.accountId, "account", accountIds, errors);
  requireReference(transaction.categoryId, "category", categoryIds, errors);
  requireReference(transaction.projectId, "project", projectIds, errors);

  const allocations = Array.isArray((transaction as { allocations?: unknown }).allocations)
    ? (transaction as { allocations: unknown[] }).allocations as Allocation[]
    : [];
  if ((transaction as { allocations?: unknown }).allocations !== undefined && !Array.isArray((transaction as { allocations?: unknown }).allocations)) {
    errors.push(`transaction ${transaction.id}: allocations must be an array`);
  }
  const allocatable = isAllocatableKind(transaction.kind, transaction.reimbursement?.treatment);
  const allocationCheck = validateAllocations(allocations, { required: allocatable });
  errors.push(...allocationCheck.errors.map((error) => `transaction ${transaction.id}: ${error}`));
  for (const allocation of allocations) {
    if (allocation && typeof allocation === "object") requireReference(allocation.memberId, "allocation member", memberIds, errors);
  }

  if ((transaction.kind === "expense" || transaction.kind === "refund") && !transaction.categoryId) {
    errors.push(`transaction ${transaction.id}: expense/refund requires a category`);
  }
  if (transaction.paymentSource?.type === "member") {
    if (!transaction.paymentSource.memberId) errors.push(`transaction ${transaction.id}: member payment source requires memberId`);
    requireReference(transaction.paymentSource.memberId, "payment member", memberIds, errors);
    requireReference(transaction.paymentSource.accountId, "payment account", accountIds, errors);
  } else if (transaction.paymentSource?.type === "joint") {
    requireReference(transaction.paymentSource.accountId, "payment account", accountIds, errors);
  }

  if (transaction.kind === "reimbursement") {
    const reimbursement = transaction.reimbursement;
    if (!reimbursement) errors.push(`transaction ${transaction.id}: reimbursement details are required`);
    else {
      if (reimbursement.treatment === "received_on_behalf_of_household") {
        if (!reimbursement.receivedByMemberId) errors.push(`transaction ${transaction.id}: received_on_behalf_of_household requires receivedByMemberId`);
        requireReference(reimbursement.receivedByMemberId, "reimbursement recipient", memberIds, errors);
        if (allocations.length > 0) errors.push(`transaction ${transaction.id}: recipient reimbursement should not carry allocations`);
      } else if (reimbursement.treatment !== "reduce_expense") {
        errors.push(`transaction ${transaction.id}: unknown reimbursement treatment`);
      }
    }
  } else if (transaction.reimbursement) errors.push(`transaction ${transaction.id}: reimbursement details only apply to reimbursement transactions`);

  if (transaction.kind === "transfer") {
    if (!transaction.transfer) errors.push(`transaction ${transaction.id}: transfer details are required`);
    else {
      requireReference(transaction.transfer.fromAccountId, "transfer source account", accountIds, errors);
      requireReference(transaction.transfer.toAccountId, "transfer destination account", accountIds, errors);
      if (transaction.transfer.fromAccountId === transaction.transfer.toAccountId) errors.push(`transaction ${transaction.id}: transfer accounts must differ`);
    }
    if (allocations.length > 0) errors.push(`transaction ${transaction.id}: transfers cannot have allocations`);
  } else if (transaction.transfer) errors.push(`transaction ${transaction.id}: transfer details only apply to transfer transactions`);

  if (transaction.kind === "adjustment") {
    const adjustment = transaction.adjustment;
    if (!adjustment) errors.push(`transaction ${transaction.id}: adjustment details are required`);
    else {
      if (!adjustment.reason?.trim()) errors.push(`transaction ${transaction.id}: adjustment reason is required`);
      if (!isIntegerCents(adjustment.effectCents)) errors.push(`transaction ${transaction.id}: adjustment effectCents must be an integer`);
      if (adjustment.memberId) {
        requireReference(adjustment.memberId, "adjustment member", memberIds, errors);
        if (allocations.length > 0) errors.push(`transaction ${transaction.id}: member adjustment cannot also have allocations`);
      } else if (allocations.length === 0 || !allocationCheck.valid) {
        errors.push(`transaction ${transaction.id}: adjustment needs a memberId or complete allocations`);
      }
    }
  } else if (transaction.adjustment) errors.push(`transaction ${transaction.id}: adjustment details only apply to adjustment transactions`);

  if (transaction.creditCardEvent) {
    if (transaction.creditCardEvent === "statement" || transaction.creditCardEvent === "purchase") {
      if (transaction.kind !== "expense") errors.push(`transaction ${transaction.id}: card ${transaction.creditCardEvent} must be an expense`);
      if (transaction.creditCardEvent === "statement" && allocations.length === 0) warnings.push(`transaction ${transaction.id}: statement uses no explicit allocations`);
    } else if (transaction.creditCardEvent === "payment" && transaction.kind !== "transfer") {
      errors.push(`transaction ${transaction.id}: card payment must be a transfer`);
    }
    if (transaction.creditCardEvent === "payment" && !transaction.transfer) errors.push(`transaction ${transaction.id}: card payment requires transfer details`);
  }

  const referencedAccounts = [transaction.accountId, transaction.paymentSource?.type === "joint" ? transaction.paymentSource.accountId : undefined, transaction.paymentSource?.type === "member" ? transaction.paymentSource.accountId : undefined, transaction.transfer?.fromAccountId, transaction.transfer?.toAccountId].filter(Boolean) as Id[];
  const accountMap = context.accounts && !Array.isArray(context.accounts) ? context.accounts : undefined;
  const accountValues = context.accounts && Array.isArray(context.accounts) ? context.accounts : accountMap ? Object.values(accountMap) : [];
  const cards = referencedAccounts.map((id) => accountValues.find((account) => account.id === id)).filter(Boolean) as Account[];
  const card = cards.find((account) => account.type === "credit_card");
  if (transaction.creditCardEvent && card) {
    if (!card.trackingMode) errors.push(`transaction ${transaction.id}: credit-card trackingMode is required`);
    else if (transaction.creditCardEvent === "statement" && card.trackingMode !== "statement") errors.push(`transaction ${transaction.id}: statement event conflicts with transaction-level card tracking`);
    else if ((transaction.creditCardEvent === "purchase" || transaction.creditCardEvent === "payment") && card.trackingMode !== "transactions") errors.push(`transaction ${transaction.id}: ${transaction.creditCardEvent} event conflicts with statement-level card tracking`);
  }
  if (transaction.kind === "expense" && transaction.transfer) errors.push(`transaction ${transaction.id}: a card payment posted as an expense is invalid; use kind='transfer'`);

  return { valid: errors.length === 0, errors, messages: [...errors], warnings };
}
