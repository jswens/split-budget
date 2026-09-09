import type {
  Allocation,
  HouseholdConfigVersion,
  MoneyCents,
  Transaction,
  TransactionKind,
} from "./types";
import { allocateCents } from "./money";

export const ALLOCATION_TOTAL_BASIS_POINTS = 10000;

export function isAllocatableKind(
  kind: TransactionKind,
  reimbursementTreatment?: "reduce_expense" | "received_on_behalf_of_household",
): boolean {
  return kind === "expense" || kind === "refund" ||
    (kind === "reimbursement" && reimbursementTreatment === "reduce_expense") ||
    false;
}

export function allocationTotalBasisPoints(allocations: readonly Allocation[]): number {
  return allocations.reduce(
    (total, allocation) => total + (allocation && typeof allocation.shareBasisPoints === "number" ? allocation.shareBasisPoints : Number.NaN),
    0,
  );
}

export interface AllocationValidation {
  valid: boolean;
  errors: string[];
}

export function validateAllocations(
  allocations: readonly Allocation[],
  options: { required?: boolean } = {},
): AllocationValidation {
  const required = options.required ?? true;
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const allocation of allocations) {
    if (!allocation || typeof allocation !== "object") {
      errors.push("allocation must be an object");
      continue;
    }
    if (!allocation.memberId) errors.push("allocation memberId is required");
    if (seen.has(allocation.memberId)) errors.push(`duplicate allocation for member ${allocation.memberId}`);
    seen.add(allocation.memberId);
    if (!Number.isSafeInteger(allocation.shareBasisPoints) || allocation.shareBasisPoints < 0 || allocation.shareBasisPoints > ALLOCATION_TOTAL_BASIS_POINTS) {
      errors.push(`allocation for ${allocation.memberId} must be an integer from 0 through 10000 basis points`);
    }
  }
  const total = allocationTotalBasisPoints(allocations);
  if (required && total !== ALLOCATION_TOTAL_BASIS_POINTS) {
    errors.push(`allocations total ${total} basis points; expected ${ALLOCATION_TOTAL_BASIS_POINTS}`);
  }
  if (!required && allocations.length > 0 && total !== ALLOCATION_TOTAL_BASIS_POINTS) {
    errors.push(`provided allocations total ${total} basis points; expected ${ALLOCATION_TOTAL_BASIS_POINTS}`);
  }
  return { valid: errors.length === 0, errors };
}

/** Use transaction-level shares, with the historical config as an explicit fallback. */
export function allocationsForTransaction(
  transaction: Pick<Transaction, "allocations">,
  config?: Pick<HouseholdConfigVersion, "defaultAllocations">,
): readonly Allocation[] {
  if (transaction.allocations.length > 0) return transaction.allocations;
  return config?.defaultAllocations ?? [];
}

export function allocateTransactionCents(
  amountCents: MoneyCents,
  transaction: Pick<Transaction, "allocations">,
  config?: Pick<HouseholdConfigVersion, "defaultAllocations">,
): Record<string, MoneyCents> {
  return allocateCents(amountCents, allocationsForTransaction(transaction, config));
}
