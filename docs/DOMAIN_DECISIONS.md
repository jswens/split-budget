# Domain implementation decisions

These choices make the settlement contract executable while preserving the
canonical handoff types.

- Money is represented as a safe integer number of cents. Allocation math uses
  `bigint` internally and returns numbers only after checking the safe integer
  range.
- Allocation rounding floors each member's absolute share, then gives leftover
  cents in descending fractional remainder order, with `memberId` as the
  stable tie breaker. The same rule applies to negative refunds and signed
  adjustments.
- A transaction's explicit `allocations` are authoritative. The
  `allocationsForTransaction` helper can use config defaults for draft/import
  workflows, but settlement validation requires complete allocations on every
  allocatable posted transaction.
- `received_on_behalf_of_household` reimbursements do not affect household
  expense or responsibility; they increase the recipient's reimbursement
  component. `reduce_expense` reimbursements reduce both expense and
  responsibility.
- Adjustments never alter household expense. A member-targeted adjustment is
  applied in full to that member; an allocation-targeted adjustment is rounded
  using the normal allocation algorithm.
- Period inclusion is based only on posted status, matching `settlementPeriodId`,
  and an included settlement pool. Reporting independently uses the posted
  transaction's economic month and includes all pools.
- `creditCardEvent` is optional for backward compatibility. When present,
  `statement` and `purchase` are expenses and `payment` is a transfer; supplied
  account context checks the event against credit-card tracking mode.
- Validation reference checks are optional through a context object. This lets
  the pure engine run with portable records while allowing repository callers
  to require every member, account, category, project, and pool reference.
