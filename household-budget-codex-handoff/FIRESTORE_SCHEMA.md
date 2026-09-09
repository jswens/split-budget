# Firestore Schema Contract

## Scope

This document defines the initial Firestore persistence contract for the Household Budget & Settlement App.

Firestore is a persistence adapter. The domain model and settlement engine must not depend on Firebase SDK types.

## Conventions

- All financial values are integer cents.
- Percentages are integer basis points.
- Firestore timestamps are converted to ISO strings at the repository/domain boundary.
- Document IDs are stable identifiers and are included in exports.
- Never use user-facing names as relational identifiers.
- Every household-owned document is stored under `households/{householdId}`.
- Deletion should generally be soft/archive where historical references may exist.
- Finalized settlements are immutable unless the period is explicitly reopened.

## Root household

Path:

```text
households/{householdId}
```

Required fields:

```ts
{
  name: string;
  currency: "USD";
  timezone: string;
  schemaVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## members

Path:

```text
households/{householdId}/members/{memberId}
```

```ts
{
  authUid: string;
  displayName: string;
  role: "owner" | "member";
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Rules:
- `authUid` must be unique within the household.
- `memberId` is stable and may be referenced by transactions/config/history.
- Do not delete members with historical references; set `active=false`.

## accounts

```ts
{
  name: string;
  ownerType: "member" | "joint";
  ownerMemberId?: string;
  type: "checking" | "savings" | "credit_card" | "venmo" | "cash" | "other";
  institution?: string;
  trackingMode?: "statement" | "transactions";
  active: boolean;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Rules:
- `ownerMemberId` is required when `ownerType === "member"`.
- `trackingMode` is only meaningful for credit cards.
- Credit-card import logic must prevent statement/payment double counting.

## categories

```ts
{
  name: string;
  parentCategoryId?: string;
  type: "expense" | "income" | "transfer";
  active: boolean;
  sortOrder?: number;
}
```

Categories classify records only; categories must not implicitly change settlement math.

## projects

```ts
{
  name: string;
  status: "active" | "completed" | "archived";
  defaultSettlementPoolId?: string;
  createdAt: Timestamp;
  completedAt?: Timestamp;
}
```

## settlementPools

```ts
{
  name: string;
  active: boolean;
  description?: string;
}
```

Initial IDs:
- `household-operating`
- `renovation`
- `excluded`

The pool determines eligibility for a settlement period, not the category.

## config/current

```ts
{
  versionId: string;
  defaultAllocations: Array<{
    memberId: string;
    shareBasisPoints: number;
  }>;
  monthlyContributions: Record<string, number>;
  defaultSettlementPoolId: string;
  effectiveFrom: Timestamp;
  updatedAt: Timestamp;
}
```

Validation:
- default allocation basis points total 10000.
- contribution values are integer cents.
- corresponding immutable record exists in `configHistory/{versionId}`.

## configHistory/{versionId}

Same economic configuration fields as current config plus:

```ts
{
  version: number;
  createdAt: Timestamp;
  createdByUid: string;
  reason?: string;
}
```

Historical config records are immutable.

## transactions

Path:

```text
households/{householdId}/transactions/{transactionId}
```

Core shape:

```ts
{
  economicDate: Timestamp;
  description: string;
  amountCents: number;

  kind: "expense" | "refund" | "reimbursement" | "transfer" | "adjustment";

  accountId?: string;
  categoryId?: string;
  projectId?: string;
  settlementPoolId: string;

  paymentSource?: {
    type: "joint" | "member" | "third_party";
    memberId?: string;
    accountId?: string;
  };

  allocations: Array<{
    memberId: string;
    shareBasisPoints: number;
  }>;

  importance: "normal" | "major";

  settlementPeriodId?: string;

  reimbursement?: {
    receivedByMemberId?: string;
    treatment: "reduce_expense" | "received_on_behalf_of_household";
    relatedTransactionIds?: string[];
    sourceDescription?: string;
  };

  transfer?: {
    fromAccountId: string;
    toAccountId: string;
  };

  adjustment?: {
    memberId?: string;
    reason: string;
  };

  source: {
    type: "manual" | "csv_import" | "recurring_template" | "migration";
    importId?: string;
    sourceTransactionId?: string;
  };

  status: "draft" | "posted" | "excluded";

  notes?: string;

  createdByUid: string;
  createdAt: Timestamp;
  updatedByUid: string;
  updatedAt: Timestamp;
}
```

Domain invariants:
- `amountCents` is an integer.
- Allocations total 10000 for allocatable expense/refund records.
- Member payment source requires `memberId`.
- Transfer requires `transfer` object and does not contribute to expense totals.
- Reimbursement requires `reimbursement` object.
- `received_on_behalf_of_household` requires `receivedByMemberId`.
- Expense/refund records normally require a category.
- `settlementPoolId="excluded"` or `status="excluded"` prevents ordinary settlement inclusion.
- `economicDate` and `settlementPeriodId` are intentionally independent.
- A transaction referenced by a finalized settlement cannot be silently edited; reopening or corrective workflow is required.

### Sign convention

Use positive `amountCents` for the magnitude of events and use `kind` to determine economic effect.

Recommended:
- expense: increases household expense
- refund: reduces household expense
- reimbursement/reduce_expense: reduces household expense
- reimbursement/received_on_behalf_of_household: does not erase the original event; creates recipient settlement debit
- adjustment: applies signed effect via a separate `effectCents` field if needed in implementation
- transfer: no household expense effect

If Codex needs signed adjustments, add `adjustment.effectCents` rather than overloading `amountCents`.

## settlementPeriods

```ts
{
  name: string;
  startDate: Timestamp;
  endDate: Timestamp;
  status: "open" | "reviewed" | "finalized";

  includedSettlementPoolIds: string[];

  contributionConfig: Record<string, {
    amountCents: number;
  }>;

  configVersionId: string;

  finalizedSettlementId?: string;

  createdAt: Timestamp;
  createdByUid: string;
  updatedAt: Timestamp;
  updatedByUid: string;
  finalizedAt?: Timestamp;
}
```

Rules:
- Period date bounds do not automatically determine membership; `settlementPeriodId` on transaction does.
- Contribution config is snapshotted per period.
- Finalization freezes the settlement inputs by process, not by relying on current config.

## settlements

Finalized calculation snapshot:

```ts
{
  settlementPeriodId: string;
  configVersionId: string;
  transactionIds: string[];

  includedSettlementPoolIds: string[];

  householdExpenseCents: number;

  members: Record<string, {
    responsibilityCents: number;
    regularContributionCents: number;
    personalPaymentsCents: number;
    reimbursementsCents: number;
    adjustmentsCents: number;
    amountToTransferCents: number;
  }>;

  reconciliation: {
    valid: boolean;
    differenceCents: number;
    messages: string[];
  };

  engineVersion: string;
  calculatedAt: Timestamp;
  finalizedAt: Timestamp;
  finalizedByUid: string;
}
```

Settlements are immutable snapshots.

## recurringTemplates

Template structure mirrors the reusable subset of a transaction:

```ts
{
  name: string;
  description: string;
  estimatedAmountCents?: number;
  categoryId?: string;
  projectId?: string;
  settlementPoolId: string;
  paymentSource?: object;
  allocations: Array<{ memberId: string; shareBasisPoints: number }>;
  importance: "normal" | "major";
  frequency: "monthly";
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Templates generate draft/posted transactions. The settlement engine never reads templates.

## imports

```ts
{
  sourceType: "csv";
  sourceAccountId?: string;
  fileName: string;
  status: "staging" | "reviewed" | "committed" | "failed";
  createdAt: Timestamp;
  createdByUid: string;
  committedAt?: Timestamp;
  stats?: {
    totalRows: number;
    postedRows: number;
    ignoredRows: number;
    duplicateRows: number;
  };
}
```

## importRecords

```ts
{
  importId: string;
  sourceRowId?: string;
  raw: Record<string, unknown>;
  normalized?: object;
  status: "pending" | "matched" | "ignored" | "posted" | "duplicate";
  transactionId?: string;
  duplicateOfTransactionId?: string;
}
```

Import records do not affect settlement until posted as canonical transactions.

## auditLog

```ts
{
  eventType: string;
  entityType: string;
  entityId: string;
  performedByUid: string;
  timestamp: Timestamp;
  summary: string;
  changes?: Record<string, {
    from?: unknown;
    to?: unknown;
  }>;
}
```

Minimum audited events:
- period finalized
- period reopened
- settlement recalculated after reopen
- transaction deleted/excluded after having been posted
- configuration changed
- import committed
- backup restored

## Repository queries required by MVP

1. List settlement periods newest first.
2. List transactions by `settlementPeriodId`, ordered by economic date.
3. List transactions by project.
4. List transactions by account over a date range.
5. List transactions by category over a date range.
6. List active accounts/categories/projects/templates.
7. Fetch finalized settlement by period.
8. Fetch current config + referenced config history.
9. Export every household collection.

## Firestore-specific notes

- Keep transactions as household-level collection documents.
- Do not embed growing transaction arrays inside settlement-period documents.
- Security rules are authorization and lightweight validation, not the settlement engine.
- Full cross-document reconciliation happens in TypeScript.

## Additional locked behavior

### Automatic month bootstrap

The application should expose a service such as:

```ts
ensureSettlementPeriodForMonth(yearMonth: string): Promise<SettlementPeriod>
```

If the month does not exist, it must atomically/logically:
1. create the settlement period;
2. snapshot current contribution/config values;
3. attach the current config version ID;
4. generate draft transactions from active recurring templates;
5. mark generated transactions with `source.type = "recurring_template"` and `source.sourceTransactionId = templateId`;
6. avoid duplicates if the bootstrap operation is retried.

A deterministic generation key is recommended, for example:

```text
{periodId}:{templateId}
```

stored on the generated transaction or in generation metadata.

### Settlement version history

A reopened period does not overwrite the prior finalized settlement.

Recommended settlement fields:

```ts
{
  version: number;
  supersedesSettlementId?: string;
  supersededBySettlementId?: string;
}
```

A period may point to the latest finalized settlement via `finalizedSettlementId`, while prior settlement snapshots remain immutable.

### Soft deletion / archive

Canonical records should use lifecycle fields rather than hard deletion where applicable:

```ts
{
  active?: boolean;
  archivedAt?: Timestamp;
  archivedByUid?: string;
}
```

Transactions should normally use `status: "excluded"` for settlement exclusion and may optionally include archival metadata for UI hiding.

### Future category budgets

Do not add budget fields to category documents.

Reserve a future collection:

```text
households/{householdId}/categoryBudgets/{budgetId}
```

Possible future shape:

```ts
{
  categoryId: string;
  periodType: "monthly" | "annual";
  effectiveFrom: Timestamp;
  amountCents: number;
}
```

This collection is not required for MVP and should not be created unless budgeting is implemented.

### Project summary queries

The project mini-ledger requires:
- transactions filtered by `projectId`, ordered by economic date;
- total recorded spending for the project;
- breakdown by settlement pool and category where useful;
- no separate project accounting engine.

### Monthly spending report

Monthly spending reporting should default to all recorded spending for the selected month, across settlement pools.

Reporting inclusion is separate from settlement inclusion:
- reporting may show all posted recorded spending;
- settlement calculation only uses the period's included settlement pools.

### Import boundary

No import collections need to be surfaced in the MVP UI. They may remain in the schema as a future extension point.

Future Plaid/Monarch/CSV adapters must normalize external data into staged records and then canonical `Transaction` records; the settlement engine must never depend on provider-specific objects.
