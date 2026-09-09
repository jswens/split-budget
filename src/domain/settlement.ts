import type {
  HouseholdConfigVersion,
  Id,
  PersonSettlement,
  SettlementPeriod,
  SettlementResult,
  Transaction,
} from "./types";
import { allocateCents, addCents, isIntegerCents } from "./money";
import { allocationTotalBasisPoints, validateAllocations } from "./allocation";
import { validateTransaction, type ValidationContext } from "./validation";

export type SettlementContext = ValidationContext;

const EMPTY_PERSON = (): PersonSettlement => ({
  responsibilityCents: 0,
  regularContributionCents: 0,
  personalPaymentsCents: 0,
  reimbursementsCents: 0,
  adjustmentsCents: 0,
  amountToTransferCents: 0,
});

function collectionValues<T>(collection: readonly T[] | Record<Id, T> | undefined): T[] {
  if (!collection) return [];
  return Array.isArray(collection) ? [...collection] : Object.values(collection);
}

function ensureMember(members: Record<Id, PersonSettlement>, memberId: Id): PersonSettlement {
  if (!members[memberId]) members[memberId] = EMPTY_PERSON();
  return members[memberId];
}

/**
 * Calculate a settlement using only posted transactions explicitly assigned to
 * the supplied period and one of its included settlement pools.
 */
export function calculateSettlement(
  transactions: readonly Transaction[],
  period: SettlementPeriod,
  config: HouseholdConfigVersion,
  context: SettlementContext = {},
): SettlementResult {
  const members: Record<Id, PersonSettlement> = {};
  for (const member of collectionValues(context.members)) ensureMember(members, member.id);
  for (const allocation of config.defaultAllocations ?? []) ensureMember(members, allocation.memberId);
  for (const memberId of Object.keys(period.contributionConfig ?? {})) ensureMember(members, memberId);

  const messages: string[] = [];
  const includedPools = new Set(period.includedSettlementPoolIds ?? []);
  let householdExpenseCents = 0;
  let responsibilityTotalCents = 0;

  if (!period.id) messages.push("settlement period id is required");
  if (!config.id) messages.push("configuration id is required");
  if (config.id !== period.configVersionId) messages.push(`period configVersionId '${period.configVersionId}' does not match supplied config '${config.id}'`);
  const configAllocations = validateAllocations(config.defaultAllocations ?? [], { required: true });
  messages.push(...configAllocations.errors.map((error) => `configuration: ${error}`));
  if (!Array.isArray(period.includedSettlementPoolIds) || includedPools.size !== period.includedSettlementPoolIds.length) messages.push("period includedSettlementPoolIds must be unique");

  for (const memberId of Object.keys(period.contributionConfig ?? {})) {
    const amount = period.contributionConfig[memberId]?.amountCents;
    if (!isIntegerCents(amount) || amount < 0) messages.push(`member ${memberId}: contribution must be a non-negative integer in cents`);
  }

  const postedForPeriod = transactions.filter((transaction) => transaction.status === "posted" && transaction.settlementPeriodId === period.id && includedPools.has(transaction.settlementPoolId));
  for (const transaction of postedForPeriod) {
    const validation = validateTransaction(transaction, context);
    if (!validation.valid) messages.push(...validation.errors);

    const amount = transaction.amountCents;
    if (!isIntegerCents(amount) || amount < 0) continue;
    if (transaction.kind === "transfer") continue;

    const allocatable = transaction.kind === "expense" || transaction.kind === "refund" || (transaction.kind === "reimbursement" && transaction.reimbursement?.treatment === "reduce_expense");
    let sign = 0;
    if (transaction.kind === "expense") sign = 1;
    else if (transaction.kind === "refund") sign = -1;
    else if (transaction.kind === "reimbursement" && transaction.reimbursement?.treatment === "reduce_expense") sign = -1;
    if (sign !== 0) {
      householdExpenseCents = addCents(householdExpenseCents, sign * amount);
      if (allocatable) {
        try {
          const shares = allocateCents(sign * amount, transaction.allocations);
          for (const [memberId, share] of Object.entries(shares)) {
            ensureMember(members, memberId).responsibilityCents = addCents(ensureMember(members, memberId).responsibilityCents, share);
            responsibilityTotalCents = addCents(responsibilityTotalCents, share);
          }
        } catch (error) {
          messages.push(`transaction ${transaction.id}: cannot allocate responsibility (${error instanceof Error ? error.message : String(error)})`);
        }
      }
    }

    if (transaction.kind === "expense" && transaction.paymentSource?.type === "member" && transaction.paymentSource.memberId) {
      const person = ensureMember(members, transaction.paymentSource.memberId);
      person.personalPaymentsCents = addCents(person.personalPaymentsCents, amount);
    }
    if (transaction.kind === "reimbursement" && transaction.reimbursement?.treatment === "received_on_behalf_of_household" && transaction.reimbursement.receivedByMemberId) {
      const person = ensureMember(members, transaction.reimbursement.receivedByMemberId);
      person.reimbursementsCents = addCents(person.reimbursementsCents, amount);
    }
    if (transaction.kind === "adjustment" && transaction.adjustment && isIntegerCents(transaction.adjustment.effectCents)) {
      if (transaction.adjustment.memberId) {
        const person = ensureMember(members, transaction.adjustment.memberId);
        person.adjustmentsCents = addCents(person.adjustmentsCents, transaction.adjustment.effectCents);
      } else {
        try {
          const shares = allocateCents(transaction.adjustment.effectCents, transaction.allocations);
          for (const [memberId, share] of Object.entries(shares)) {
            const person = ensureMember(members, memberId);
            person.adjustmentsCents = addCents(person.adjustmentsCents, share);
          }
        } catch (error) {
          messages.push(`transaction ${transaction.id}: cannot allocate adjustment (${error instanceof Error ? error.message : String(error)})`);
        }
      }
    }
  }

  for (const memberId of Object.keys(members)) {
    const person = members[memberId];
    const contribution = period.contributionConfig?.[memberId]?.amountCents ?? 0;
    if (isIntegerCents(contribution)) person.regularContributionCents = contribution;
    person.amountToTransferCents = person.responsibilityCents - person.regularContributionCents - person.personalPaymentsCents + person.reimbursementsCents + person.adjustmentsCents;
    if (!isIntegerCents(person.amountToTransferCents)) messages.push(`member ${memberId}: transfer exceeds safe integer cents range`);
    const recomputed = person.responsibilityCents - person.regularContributionCents - person.personalPaymentsCents + person.reimbursementsCents + person.adjustmentsCents;
    if (person.amountToTransferCents !== recomputed) messages.push(`member ${memberId}: displayed transfer does not reconcile to its components`);
  }

  const differenceCents = responsibilityTotalCents - householdExpenseCents;
  if (differenceCents !== 0) messages.push(`responsibility does not reconcile to household expense: difference ${differenceCents} cents`);
  return {
    householdExpenseCents,
    members,
    reconciliation: { valid: messages.length === 0, differenceCents, messages },
  };
}

export { allocationTotalBasisPoints };
