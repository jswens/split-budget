# Household Budget & Settlement App --- Project Specification

**Status:** Draft v1\
**Date:** 2026-09-09\
**Source:** Existing household Google Sheets budget workflow\
**Primary users:** John and Blaire

## 1. Purpose

Build a small, private household-finance web application that replaces
the current monthly spreadsheet settlement workflow while preserving its
flexibility.

The application is not intended to replace a bank, credit-card portal,
or full personal-finance platform. Its primary job is to answer,
reliably and transparently:

1.  What were the household's shared expenses for a settlement period?
2.  How much of those expenses is John responsible for and how much is
    Blaire responsible for?
3.  Which shared expenses has either person already paid from a personal
    account?
4.  How much has each person already contributed automatically to the
    joint account?
5.  After refunds, reimbursements, credits, and adjustments, how much
    additional money should each person transfer?
6.  Can every number in that result be traced back to an understandable
    transaction?

The default household allocation is **60% John / 40% Blaire**. Normal
automatic monthly contributions are **\$2,000 John / \$1,200 Blaire**.

## 2. Design Principles

### 2.1 Ledger first

Every financial event should be represented as a transaction or explicit
adjustment. Settlement formulas should not contain unexplained one-off
arithmetic.

### 2.2 Separate responsibility from payment

"Who owes this expense?" and "Who actually paid this expense?" are
separate concepts.

A \$1,000 shared Costco expense paid personally by John remains a
\$1,000 household expense. Under a 60/40 allocation John is responsible
for \$600 and Blaire for \$400, but John receives credit for having
already advanced the full \$1,000.

### 2.3 Explainable calculations

Every settlement result must be expandable into the transactions and
rules that produced it.

### 2.4 Configuration instead of hard-coded household rules

The current 60/40 split and \$2,000/\$1,200 recurring contributions
should be configuration values, not embedded constants throughout the UI
or calculation code.

### 2.5 Portable data

Firebase may be the operational datastore, but Firebase must not be the
only durable representation of the household's financial records.

The system must support complete, documented, versioned exports that can
reconstruct the application data without Firebase.

### 2.6 Accounting logic independent of infrastructure

The settlement engine must be a pure TypeScript domain module with no
Firebase, React, browser, or UI dependencies.

## 3. Existing Workflow to Preserve

The current spreadsheet repeats monthly blocks containing shared bills,
personally paid items, other expenses, major/project expenses, household
totals, 60/40 responsibility, and final transfer calculations.

The application must preserve the useful behavior of this workflow while
replacing cell-position-specific formulas.

Typical recurring items include mortgage, credit cards, Costco,
utilities, Verizon, cleaners, childcare, insurance, and other household
costs.

## 4. Required Financial Scenarios

Version 1 must explicitly support the following scenarios already
encountered in the spreadsheet.

### 4.1 Shared expense paid from joint funds

Example: mortgage or a household credit-card payment.

The expense enters the shared household pool and is allocated according
to the applicable split.

### 4.2 Shared expense paid personally by John

Example: Costco card paid from John's personal account.

The expense enters the shared household pool, while John's personal
payment reduces his remaining settlement obligation.

### 4.3 Shared expense paid personally by Blaire

Example: babysitter/childcare or another household expense paid through
Blaire's personal account or Venmo.

The expense enters the shared pool, while Blaire receives settlement
credit for the personal payment.

### 4.4 Refund or credit

Refunds and credits reduce the relevant household cost and must remain
traceable.

### 4.5 Third-party reimbursement

Example: another person reimburses John or Blaire for money associated
with a household transaction.

The reimbursement must record who received it and affect settlement
appropriately without manual arithmetic in the final settlement formula.

### 4.6 Major one-time expense

Examples include renovations, pool costs, insurance, travel, or another
major purchase.

Major/minor classification is primarily reporting metadata and should
not inherently alter settlement behavior.

### 4.7 Normal/minor miscellaneous expense

Examples include cleaners, utilities, medical costs, childcare, and
other ordinary household expenses.

### 4.8 Corrected or combined amount

The current spreadsheet sometimes derives an entered total from multiple
figures. The new system should prefer separate source transactions or an
explicit adjustment with notes rather than hidden arithmetic.

### 4.9 Multi-month settlement

The system must support settlement periods where more than one month's
recurring contributions apply.

### 4.10 Custom allocation

Although the default is 60/40, a transaction may be: - 60/40 shared -
50/50 - John only - Blaire only - custom percentage allocation

### 4.11 Project-specific expense

Transactions may optionally belong to a project such as Renovations,
Travel, or another major initiative while still participating in normal
settlement calculations unless explicitly excluded.

### 4.12 Adjustment

Rare exceptions must be represented as named, auditable adjustments
rather than arbitrary additions/subtractions embedded in formulas.

## 5. Domain Model

### 5.1 Person

Initial people: - John - Blaire

The schema should not fundamentally assume exactly two people, although
the MVP UI and settlement model may.

### 5.2 Account

Suggested fields:

``` typescript
interface Account {
  id: string;
  name: string;
  owner: "john" | "blaire" | "joint";
  type: "checking" | "credit_card" | "venmo" | "cash" | "other";
  active: boolean;
  notes?: string;
}
```

Examples: - Joint Checking - John Checking - Blaire Checking - Costco
Visa - Venture - Chase - Blaire Venmo - John Venmo

### 5.3 Transaction

``` typescript
type Party = "john" | "blaire" | "joint" | "third_party";

type TransactionType =
  | "expense"
  | "refund"
  | "reimbursement"
  | "adjustment";

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: TransactionType;

  categoryId: string;
  projectId?: string;

  accountId?: string;
  paidBy: Party;

  johnShare: number;
  blaireShare: number;

  importance: "normal" | "major";

  notes?: string;

  createdAt: string;
  updatedAt: string;
}
```

The implementation should establish one unambiguous sign convention and
enforce it throughout the domain layer.

### 5.4 Household configuration

``` typescript
interface HouseholdConfig {
  defaultSplit: {
    john: number;   // 0.60
    blaire: number; // 0.40
  };

  monthlyContribution: {
    john: number;   // 2000
    blaire: number; // 1200
  };
}
```

Configuration changes should be effective-dated so historical
settlements do not change when future household rules change.

### 5.5 Settlement period

A settlement period should have: - ID - start date - end date - display
name - number/amount of scheduled contributions applicable to each
person - status: open / reviewed / finalized - calculated settlement
snapshot - finalized timestamp - optional notes

Finalized periods should retain enough information to reproduce the
result even if configuration changes later.

## 6. Settlement Engine

Implement settlement calculation as a pure function:

``` typescript
calculateSettlement(
  transactions,
  householdConfig,
  settlementPeriod
): SettlementResult
```

Conceptually, for each person:

``` text
remaining obligation
=
allocated household responsibility
- qualifying recurring contributions
- shared household costs already paid personally
+/- reimbursements and explicit adjustments
```

The precise sign treatment should be formalized once in the domain model
and covered exhaustively by tests.

The result should expose components rather than only a final number:

``` typescript
interface PersonSettlement {
  responsibility: number;
  regularContributions: number;
  personalSharedPayments: number;
  reimbursements: number;
  adjustments: number;
  amountToTransfer: number;
}
```

## 7. Reconciliation and Validation

The application must validate: - allocation percentages sum to 100%
where required; - allocated household responsibility reconciles to net
allocatable household expense; - settlement components reconcile to the
displayed transfer; - finalized periods contain no invalid/unclassified
transactions; - references to accounts/categories/projects are valid; -
currency values use decimal-safe arithmetic rather than floating-point
approximations.

Money should be represented internally in integer cents or a
decimal-money library, not ordinary binary floating point.

## 8. User Experience

### 8.1 Primary monthly screen

The primary interface should feel closer to a good spreadsheet than a
traditional budgeting dashboard.

Suggested transaction columns: - Date - Description - Amount - Account -
Paid By - Category - Project - Split - Major/Normal - Notes

### 8.2 Settlement summary

Keep a settlement panel visible or immediately accessible showing:

``` text
Household net expenses

John
  Responsibility
  Automatic contributions
  Personal shared payments
  Reimbursements
  Adjustments
  ----------------
  Additional transfer / credit

Blaire
  Responsibility
  Automatic contributions
  Personal shared payments
  Reimbursements
  Adjustments
  ----------------
  Additional transfer / credit
```

Every component should be clickable/filterable to reveal contributing
transactions.

### 8.3 Recurring templates

Allow recurring expected entries such as mortgage, utilities, cleaners,
and other predictable bills to populate a new month.

Templates create editable transactions; they should not silently assume
that an expected amount actually occurred.

### 8.4 Finalization

An open period can be edited.

Finalizing should: 1. run validation; 2. calculate the settlement; 3.
save a settlement snapshot; 4. record the applicable configuration; 5.
make accidental edits harder; 6. allow deliberate reopening with an
audit record.

## 9. Import Roadmap

Import is not required for the first accounting-engine milestone.

Later versions should support CSV imports from banks/cards/services such
as Chase, Capital One, Citi/Costco, Venmo, and checking accounts.

Imported records should first enter a staging/reconciliation workflow.

Rules may eventually recognize patterns such as: - Costco-card household
transaction → Costco category / John-associated payment workflow - known
babysitter Venmo recipient → Childcare / Blaire-paid shared expense

Automatic rules should be reviewable and reversible.

## 10. Proposed Application Architecture

### 10.1 Frontend

-   React
-   TypeScript
-   Vite or another static-build-oriented toolchain
-   Firebase Hosting

Prefer conventional Firebase Hosting over Firebase App Hosting for this
small client-heavy application so the application can remain primarily
static and inexpensive.

### 10.2 Authentication

Firebase Authentication.

MVP access is restricted to authorized household users.

Authorization must be enforced by Firestore Security Rules, not merely
by hiding UI.

### 10.3 Operational datastore

Cloud Firestore.

Firestore stores application records but is treated as an implementation
of the repository layer rather than as the domain model itself.

### 10.4 Domain package

Create a framework-independent package/module containing: - money
utilities - transaction validation - allocation rules - settlement
calculation - reconciliation - import/export schema definitions - schema
migration logic where appropriate

This package must run in unit tests without Firebase.

### 10.5 Repository boundary

UI/domain code should interact with an interface such as:

``` typescript
interface BudgetRepository {
  getTransactions(periodId: string): Promise<Transaction[]>;
  saveTransaction(transaction: Transaction): Promise<void>;
  getHouseholdConfig(): Promise<HouseholdConfig>;
  getSettlementPeriod(id: string): Promise<SettlementPeriod>;
  // ...
}
```

Firestore is one adapter.

This keeps a future SQLite, Postgres, local-file, or other backend
migration feasible.

## 11. Firebase Cost Strategy

The application should initially target Firebase's no-cost Spark plan.

A two-user household ledger should be extremely small relative to normal
Firestore quotas if queries are designed sensibly.

Avoid architecture that requires: - Cloud Functions for routine
calculations; - server-side rendering; - frequent polling; - unnecessary
document reads; - managed Firestore backup/export as an MVP dependency.

Settlement calculations can run deterministically in the client/domain
layer.

The application should monitor usage and document the consequences of
exceeding Spark quotas.

## 12. Backup, Export, and Disaster Recovery

These are separate requirements.

### 12.1 User export

The application must provide a one-click **Export All Data** function.

Canonical export format: versioned JSON.

Example envelope:

``` json
{
  "format": "household-budget-export",
  "schemaVersion": 1,
  "exportedAt": "...",
  "household": {},
  "accounts": [],
  "categories": [],
  "projects": [],
  "transactions": [],
  "settlementPeriods": [],
  "settlements": [],
  "configurationHistory": []
}
```

The JSON export must contain enough information to recreate the
application's financial state without access to the original Firebase
project.

### 12.2 CSV export

Provide human-readable CSV exports for: - transactions; - monthly
settlements; - accounts/categories where useful.

CSV is for interoperability and inspection. JSON is the authoritative
portable application export.

### 12.3 Restore

The application must eventually support restoring/importing its own
versioned JSON export.

Restore should validate the entire file before committing changes and
should protect against accidental duplication.

### 12.4 Independent backup

The backup strategy must support storing a copy outside the
application's primary Firestore database.

Initial low-complexity option: - user-triggered JSON export downloaded
to the user's device and placed in the user's chosen backup system.

Preferred later option: - scheduled generation of the same portable
export format to an independent destination.

The independent destination should not be tightly coupled to Firestore's
proprietary managed-export representation.

### 12.5 Firebase managed export

Firestore's managed export/import system may be added as an additional
disaster-recovery layer, but it is not the application's portable backup
format.

Managed exports require billing to be enabled and therefore should not
be a requirement for the initial Spark/no-cost architecture.

### 12.6 Backup rule

At maturity, target a simple 3-copy concept: 1. live Firestore data; 2.
portable versioned application backup; 3. another copy controlled
independently by the household.

## 13. Security and Privacy

Financial records are sensitive.

Requirements: - authenticated access only; - allow-list household
membership; - Firestore Security Rules scoped by household/user; - no
secrets committed to source control; - least-privilege access; - no
public transaction collections; - exports explicitly initiated or
securely automated; - audit important destructive operations; - protect
finalized settlement periods from accidental modification.

Do not store bank passwords or financial-institution credentials.

## 14. Testing Strategy

The settlement engine requires unit tests derived from real spreadsheet
scenarios.

Minimum test suite: 1. standard 60/40 month; 2. Costco/shared expense
paid by John; 3. shared expense paid by Blaire; 4. refund; 5.
reimbursement received by John; 6. reimbursement received by Blaire; 7.
major one-off expense; 8. negative adjustment; 9. multi-month
contribution period; 10. 50/50 custom transaction; 11. John-only
expense; 12. Blaire-only expense; 13. mixed payment sources; 14.
rounding to cents; 15. reconciliation failure detection; 16.
configuration change without changing historical finalized settlement;
17. export → import → identical settlement result.

Use anonymized/copied historical examples from the existing spreadsheet
as fixtures.

## 15. Implementation Phases

### Phase 1 --- Domain and accounting engine

Build: - TypeScript domain types; - integer-cent money handling; -
settlement engine; - validation/reconciliation; - comprehensive unit
tests.

**Exit criterion:** historical test scenarios calculate correctly
without Firebase or UI.

### Phase 2 --- Firebase foundation

Build: - Firebase project; - Firebase Hosting; - Authentication; -
Firestore; - Security Rules; - repository adapter; - local Firebase
Emulator development workflow.

**Exit criterion:** authenticated household users can securely
read/write test ledger data.

### Phase 3 --- Monthly ledger UI

Build: - settlement-period navigation; - spreadsheet-like transaction
editor; - account/category/project selectors; - settlement summary; -
validation display; - finalization workflow.

**Exit criterion:** a complete month can be entered and settled without
using the old spreadsheet.

### Phase 4 --- Portability and backup

Build: - full versioned JSON export; - CSV transaction/settlement
export; - JSON restore/import; - round-trip tests; - backup
documentation.

**Exit criterion:** export a household, delete a test datastore, restore
it, and reproduce the same settlement results.

### Phase 5 --- Recurring templates and usability

Build: - recurring entries; - account defaults; - category defaults; -
faster data entry; - audit history for important changes.

### Phase 6 --- Statement import

Build: - CSV ingestion; - staging/reconciliation; - duplicate
detection; - import mappings.

### Phase 7 --- Automation

Potential later work: - transaction classification rules; - scheduled
independent backups; - optional integrations; - reporting/trends.

## 16. MVP Scope

The first usable release should:

-   authenticate John and Blaire;
-   create/open settlement periods;
-   record shared transactions;
-   record who paid;
-   support 60/40 and custom allocation;
-   apply \$2,000/\$1,200 recurring contributions;
-   handle refunds, reimbursements, and adjustments;
-   calculate additional transfers;
-   explain every settlement component;
-   validate/reconcile the month;
-   export all data to portable JSON;
-   export transactions to CSV;
-   run on Firebase Hosting + Firestore.

Explicitly out of MVP: - Plaid/open-banking integration; - automatic
bank synchronization; - sophisticated dashboards; - AI categorization; -
server-side settlement calculation; - mandatory paid Firebase services.

## 17. Acceptance Criteria

The MVP is successful when:

1.  A historical month can be recreated using ledger entries rather than
    bespoke formulas.
2.  Its settlement matches the intended spreadsheet result.
3.  Costco-style personally paid shared expenses require no special-case
    code.
4.  Blaire-paid/Venmo shared expenses use the same generic mechanism.
5.  Reimbursements are explicit records rather than hidden formula
    constants.
6.  Every final transfer can be explained from underlying records.
7.  The household can export a complete portable JSON backup.
8.  A clean installation can restore that export and reproduce the same
    finalized settlements.
9.  Firebase can be replaced at the repository layer without rewriting
    the settlement engine.
10. Routine two-user operation is designed to fit comfortably within
    Firebase's no-cost usage quotas.

## 18. Key Architecture Decisions Still to Finalize

Before implementation, make explicit decisions on:

1.  exact Firestore collection/document layout;
2.  whether transactions are immutable ledger entries plus corrections
    or directly editable while a period is open;
3.  audit-log depth;
4.  precise reimbursement semantics;
5.  export encryption;
6.  independent scheduled-backup destination;
7.  offline/PWA behavior;
8.  deployment environments (dev/test/prod);
9.  household membership/invitation flow;
10. whether source-statement attachments are ever stored.

These should be resolved in the architecture-design phase before Codex
builds the persistence layer.

## 19. Locked Firestore Data Model

The initial implementation will use a household-scoped Firestore hierarchy:

```text
households/{householdId}
  members/{memberId}
  accounts/{accountId}
  categories/{categoryId}
  projects/{projectId}
  settlementPools/{poolId}
  config/current
  configHistory/{versionId}
  transactions/{transactionId}
  settlementPeriods/{periodId}
  settlements/{settlementId}
  recurringTemplates/{templateId}
  imports/{importId}
  importRecords/{recordId}
  auditLog/{eventId}
```

Transactions remain in one household-level ledger rather than being nested under settlement periods. Each transaction may independently identify its economic date and `settlementPeriodId`.

### 19.1 Locked accounting distinctions

The implementation must preserve these distinctions:

- **responsibility**: who economically owes an expense;
- **payment source**: who actually funded it;
- **settlement pool**: which settlement calculation the event belongs to;
- **economic date**: when the underlying event occurred;
- **settlement period**: when the household chooses to reconcile it.

### 19.2 Credit cards

Credit-card accounts have `trackingMode: "statement" | "transactions"`.

In statement mode, the statement-level obligation may be treated as the expense for settlement purposes.

In transaction mode, individual card purchases are expenses and the card payment is a transfer. The system must never count both individual purchases and the card payment as household expenses.

### 19.3 Reimbursements

Reimbursements are explicit ledger events and have one of two treatments:

- `reduce_expense`: economically reduces household expense;
- `received_on_behalf_of_household`: money received personally by a member that increases that member's settlement obligation because the funds economically belong to the household.

Reimbursements may link to one or more related transactions.

### 19.4 Settlement pools

Transactions belong to a `settlementPoolId`. The initial pools should include:

- `household-operating`
- `renovation`
- `excluded`

A settlement period explicitly declares which pools it includes.

### 19.5 Money and percentages

All money is stored as integer cents.

Allocations use integer basis points:
- 10000 = 100%
- 6000 = 60%
- 4000 = 40%

No financial calculation may use binary floating-point currency values.

## 20. Codex Source-of-Truth Files

The implementation handoff package contains:

- `PROJECT_SPEC.md` — product and accounting requirements.
- `FIRESTORE_SCHEMA.md` — collection-by-collection Firestore contract.
- `src/domain/types.ts` — initial TypeScript domain interfaces.
- `src/domain/settlement-contract.md` — required calculation semantics.
- `firestore.rules` — initial household-scoped rule design.
- `firestore.indexes.json` — expected composite indexes.
- `TEST_CASES.md` — required accounting fixtures and acceptance expectations.
- `IMPLEMENTATION_PLAN.md` — ordered build plan and completion gates.
- `EXPORT_FORMAT.md` — portable backup format and restore requirements.

Codex should treat these files as authoritative unless a later architecture decision explicitly supersedes them.

## 21. Final Product and Architecture Decisions

The following decisions are locked for the initial implementation.

### 21.1 Connectivity and clients
- The app is online-only; offline transaction editing/sync is not required.
- The UI must be responsive and polished on both desktop browsers and phones.
- The web app should be installable as a PWA with a home-screen icon and standalone display mode.
- Visual polish is the leading UX priority after accounting correctness.

### 21.2 Household users and permissions
- John and Blaire have equal permissions.
- Google Sign-In is the only authentication method required for MVP.
- Initial access may be implemented with an allow-list of the two approved Google accounts.
- The domain model must continue to support more than two household members even though the initial UI is optimized for two.
- Future member addition/invitation flows are not required for MVP.

### 21.3 Finalization, reopening, and deletion
- Finalized settlement periods may be reopened.
- Reopening requires an explicit warning and creates an audit-log event.
- A prior finalized settlement snapshot is never overwritten.
- Re-finalizing after a reopen creates a new finalized settlement version/snapshot.
- No canonical financial record is hard-deleted through normal application workflows.
- “Delete” behavior should archive/exclude records while preserving history.

### 21.4 Settlement scope
- The app calculates the amount each member should transfer.
- The app does not track whether those transfers were actually paid.
- The app does not track or reconcile the actual joint-account balance.

### 21.5 Budgeting
- MVP is a settlement/reconciliation app, not a category-budgeting app.
- Stable category IDs must be preserved so budgeting can be added later.
- Future category budgets should live in a separate collection/model rather than adding settlement behavior to category documents.
- No budget UI or budget calculations are required for MVP.

### 21.6 Recurring expenses
- Recurring templates are supported.
- When a new settlement month is created, applicable recurring templates automatically create **draft** transactions.
- Drafts are editable before posting/finalization.
- Changing a recurring rule affects future generated drafts only and must not silently rewrite historical transactions.

### 21.7 Settlement month creation
- The current/new month should be automatically created when the user first enters a month that does not yet exist.
- Month creation snapshots the current contribution/config version and generates applicable recurring draft transactions.
- The system should avoid creating duplicate periods or duplicate template-generated drafts.

### 21.8 Credit cards and imports
- MVP remains statement-level for credit-card accounting.
- Do not design the first UI around individual imported card transactions.
- Importing is explicitly deferred until a separate architecture decision is made regarding Monarch, Plaid, direct bank/card CSVs, or another source.
- The repository/domain boundaries must preserve a future path to Plaid or similar bank integrations.
- No Plaid, Monarch, or transaction-import implementation is part of MVP.

### 21.9 Attachments and notes
- Transaction attachments are out of scope.
- Free-text notes are sufficient for MVP.
- Do not add receipt/PDF/image storage architecture unless requirements change.

### 21.10 Projects and settlement pools
- Projects have their own mini-ledger/summary screen.
- Users may create custom settlement pools.
- The system should not assume only `household-operating`, `renovation`, and `excluded` exist.
- The default initial pools remain useful seed data, but pool IDs and labels are user-managed domain data.

### 21.11 Reporting
- Initial reporting is intentionally small.
- The primary report is monthly total recorded spending.
- Monthly spending should include all recorded pools by default, with pool breakdown/filtering so operating, renovation, and other pools remain visible.
- Settlement calculations remain pool-selective even though the monthly spending report defaults to total recorded spending.

### 21.12 Backups
- MVP backup is a one-click local download.
- Canonical backup is plain, readable, versioned JSON.
- No encryption/password protection is required.
- Automated external backup destinations are not required for MVP.
- The user will decide where to store downloaded backups.

### 21.13 Firebase environment and deployment
- Use one production Firebase project plus local Emulator Suite for development/testing.
- Separate cloud dev/test Firebase projects are not required initially.
- GitHub Actions should automatically deploy the production app to Firebase from the chosen production branch.
- Financial data and Firebase secrets must never be committed to source control.

### 21.14 Historical migration
- Historical data should be migrated from the existing spreadsheet at the same granularity it currently contains.
- Do not invent detailed underlying transactions that are not present in the spreadsheet.
- Preserve historical monthly statement/bill totals, explicit adjustments, reimbursements, and settlement outcomes as faithfully as practical.
- Historical migration should be treated as `source.type = "migration"` and tested against representative 2026 months.

### 21.15 Audit depth
- Audit history is lightweight.
- It must capture important state transitions such as finalize, reopen, config change, migration, exclusion/archive, and restore.
- Exhaustive field-by-field forensic history for every edit is not required.

