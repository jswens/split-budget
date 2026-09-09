# Settlement Engine Contract

## Function

```ts
calculateSettlement(
  transactions: Transaction[],
  period: SettlementPeriod,
  config: HouseholdConfigVersion
): SettlementResult
```

The function must be deterministic and side-effect free.

## Inclusion rules

A transaction participates only when all are true:

1. `status === "posted"`;
2. `settlementPeriodId === period.id`;
3. `settlementPoolId` is included in `period.includedSettlementPoolIds`;
4. transaction kind is economically relevant to settlement.

`economicDate` does not determine period inclusion.

## Expense

For `kind === "expense"`:

- add `amountCents` to net household expense;
- allocate responsibility using the transaction's allocations;
- if paid by an individual member, credit that member with the full personally funded amount;
- if paid jointly, do not create an individual payment credit.

Example: $804 Costco, John paid personally, 60/40:
- household expense +80400
- John responsibility +48240
- Blaire responsibility +32160
- John personal payments +80400

## Refund

For `kind === "refund"`:

- subtract `amountCents` from household expense;
- subtract allocated responsibility using the transaction allocations;
- if the refund was received personally and that matters economically, model it as reimbursement instead of refund.

## Reimbursement: reduce_expense

For:

```ts
kind === "reimbursement"
reimbursement.treatment === "reduce_expense"
```

- reduce household expense by `amountCents`;
- reduce responsibility according to allocations;
- do not add recipient debit unless separately represented.

Typical example: merchant refund/credit that economically reverses household cost.

## Reimbursement: received_on_behalf_of_household

For:

```ts
kind === "reimbursement"
reimbursement.treatment === "received_on_behalf_of_household"
```

- do not erase the original expense;
- add `amountCents` to the recipient member's `reimbursementsCents`;
- `reimbursementsCents` increases the recipient's transfer obligation.

Example: Mike sends John $341 that economically belongs to the household.

## Transfer

For `kind === "transfer"`:
- household expense impact = 0;
- responsibility impact = 0;
- personal payment impact = 0.

Credit-card payment in transaction-level tracking mode must be a transfer.

## Adjustment

For `kind === "adjustment"`:
- do not alter household expense unless the adjustment is deliberately represented as a refund/expense instead;
- add signed `adjustment.effectCents` to either a specific member or according to explicit allocations;
- adjustments must include a human-readable reason.

## Contributions

For every member:

```text
regularContributionCents =
period.contributionConfig[memberId].amountCents
```

Do not read today's current contribution when calculating an old period.

## Final amount

For a member:

```text
amountToTransfer =
responsibility
- regularContribution
- personalPayments
+ reimbursements
+ adjustments
```

A negative amount means the member has over-funded the included settlement pool and is owed a credit/reimbursement under the UI's chosen settlement workflow.

## Reconciliation

At minimum validate:

1. every allocatable transaction allocation totals 10000 basis points;
2. sum(member responsibility) == net household expense, within exact cents;
3. settlement components recompute each displayed transfer exactly;
4. every member/account/category/project reference exists;
5. transfer records never enter expense totals;
6. a credit-card account in transaction mode never has its payment posted as an expense;
7. integer cents only.

Return reconciliation messages with enough context to locate the offending transaction.

## Rounding

Allocate integer cents deterministically.

Recommended algorithm:
1. compute each member's floor allocation;
2. calculate leftover cents;
3. distribute leftover cents deterministically by descending fractional remainder, then stable member ID as tiebreaker.

Never allow responsibility cents to differ from the transaction's economic amount because of rounding.

## Finalization

Finalization must:
1. load the period and posted transactions;
2. validate all references and invariants;
3. calculate settlement;
4. refuse finalization if reconciliation is invalid;
5. store a `FinalizedSettlement` snapshot including transaction IDs, config version, included pools, engine version, and results;
6. set the period status to finalized and reference the settlement;
7. create an audit-log event.

The snapshot is historical truth. Later engine versions may offer "recalculate and compare" but must not silently mutate finalized results.

## Reopen and re-finalize behavior

Reopening a finalized period:
1. requires explicit user confirmation in the UI;
2. changes the period back to an editable state;
3. preserves the existing finalized settlement snapshot;
4. creates an audit event referencing the prior settlement;
5. allows ledger edits;
6. on re-finalization, creates a new settlement snapshot with incremented version and a link to the previous snapshot.

No prior finalized settlement document is mutated to represent new economics.

## Recurring draft generation

Recurring templates never directly affect settlement.

When a new month is automatically bootstrapped:
- each applicable active recurring template creates one draft transaction;
- the generated transaction records the template ID in its source metadata;
- draft transactions are editable independently of the template;
- subsequent template changes do not modify already-generated transactions;
- generation must be idempotent.

## Reporting vs settlement

The settlement engine continues to use included settlement pools only.

The monthly-spending report is not the settlement engine and should default to all recorded posted expenses/refunds for the selected month, with pool breakdowns.
