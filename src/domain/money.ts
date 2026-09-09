import type { Allocation, Id, MoneyCents } from "./types";

/** The largest integer that can be represented exactly by a JavaScript number. */
export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export function isIntegerCents(value: unknown): value is MoneyCents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertIntegerCents(value: unknown, label = "amountCents"): asserts value is MoneyCents {
  if (!isIntegerCents(value)) {
    throw new RangeError(`${label} must be an integer within the safe cents range`);
  }
}

export function addCents(...values: MoneyCents[]): MoneyCents {
  let result = 0;
  for (const value of values) {
    assertIntegerCents(value);
    result += value;
    assertIntegerCents(result, "cents result");
  }
  return result;
}

export function subtractCents(left: MoneyCents, right: MoneyCents): MoneyCents {
  assertIntegerCents(left, "left cents");
  assertIntegerCents(right, "right cents");
  const result = left - right;
  assertIntegerCents(result, "cents result");
  return result;
}

/**
 * Allocate a signed cent amount using basis points. Floors each share and
 * gives leftover cents to the largest fractional remainders. Member IDs are
 * the stable tie breaker, so the result does not depend on input order.
 */
export function allocateCents(
  amountCents: MoneyCents,
  allocations: readonly Allocation[],
): Record<Id, MoneyCents> {
  assertIntegerCents(amountCents);
  if (allocations.length === 0) {
    if (amountCents !== 0) throw new RangeError("allocations are required for a non-zero amount");
    return {};
  }

  const seen = new Set<Id>();
  let basisPointTotal = 0;
  for (const allocation of allocations) {
    if (!allocation.memberId || seen.has(allocation.memberId)) {
      throw new RangeError("allocations must contain unique, non-empty member IDs");
    }
    seen.add(allocation.memberId);
    if (!Number.isSafeInteger(allocation.shareBasisPoints) || allocation.shareBasisPoints < 0) {
      throw new RangeError(`invalid basis points for ${allocation.memberId}`);
    }
    basisPointTotal += allocation.shareBasisPoints;
  }
  if (basisPointTotal !== 10000) {
    throw new RangeError(`allocations must total 10000 basis points; received ${basisPointTotal}`);
  }

  const sign = amountCents < 0 ? -1 : 1;
  const magnitude = BigInt(Math.abs(amountCents));
  const denominator = 10000n;
  const floors = new Map<Id, bigint>();
  const remainders: Array<{ memberId: Id; remainder: bigint }> = [];
  let floorTotal = 0n;

  for (const allocation of allocations) {
    const numerator = magnitude * BigInt(allocation.shareBasisPoints);
    const floor = numerator / denominator;
    floors.set(allocation.memberId, floor);
    floorTotal += floor;
    remainders.push({ memberId: allocation.memberId, remainder: numerator % denominator });
  }

  const leftover = Number(magnitude - floorTotal);
  remainders.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;
  });

  const result: Record<Id, MoneyCents> = {};
  for (const allocation of allocations) {
    const rank = remainders.findIndex((item) => item.memberId === allocation.memberId);
    const extra = rank >= 0 && rank < leftover ? 1n : 0n;
    const share = BigInt(sign) * ((floors.get(allocation.memberId) ?? 0n) + extra);
    const numericShare = Number(share);
    assertIntegerCents(numericShare, "allocated cents");
    result[allocation.memberId] = numericShare;
  }
  return result;
}

export function sumCents(values: Iterable<MoneyCents>): MoneyCents {
  let total = 0;
  for (const value of values) total = addCents(total, value);
  return total;
}
