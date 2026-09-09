# Codex Implementation Plan

## Guiding rule

Build the accounting engine before building Firebase UI.

Do not encode settlement logic in React components, Firestore queries, Security Rules, or Cloud Functions.

## Recommended stack

- TypeScript
- React
- Vite
- Firebase Hosting
- Firebase Authentication
- Cloud Firestore
- Firebase Emulator Suite for local development
- Vitest for unit tests
- Zod (or equivalent) for runtime/domain schema validation

Avoid server-side runtime dependencies for MVP.

## Repository layout

```text
/
  docs/
    PROJECT_SPEC.md
    FIRESTORE_SCHEMA.md
    TEST_CASES.md
    EXPORT_FORMAT.md

  src/
    domain/
      types.ts
      money.ts
      validation.ts
      allocation.ts
      settlement.ts
      export.ts

    repositories/
      BudgetRepository.ts
      firestore/
        FirestoreBudgetRepository.ts
        converters.ts

    firebase/
      app.ts
      auth.ts

    features/
      ledger/
      settlement/
      settings/
      export/

  firestore.rules
  firestore.indexes.json
  firebase.json
```

## Milestone 0 — Bootstrap

- Create Vite React TypeScript app.
- Add formatting/linting/test tooling.
- Add Firebase client SDK.
- Configure Emulator Suite.
- Commit rules/index files.
- Document environment variables.
- No real financial data in source control.

Exit:
- app launches;
- tests run;
- Firebase emulators run.

## Milestone 1 — Pure domain

Implement:
- canonical types;
- integer-cent helpers;
- basis-point allocation;
- deterministic cent rounding;
- transaction validation;
- settlement engine;
- reconciliation.

Use `TEST_CASES.md`.

Exit:
- Fixtures A–M pass without Firebase imports anywhere in `src/domain`.

## Milestone 2 — Export/import domain

Implement:
- `BudgetExportV1`;
- runtime validation;
- JSON serialization;
- migration framework;
- import validation;
- round-trip fixture N.

Exit:
- in-memory export/import preserves calculations exactly.

## Milestone 3 — Firestore repository

Implement:
- Firestore converters;
- repository adapter;
- collection paths exactly as schema;
- queries required by `FIRESTORE_SCHEMA.md`;
- emulator integration tests.

Exit:
- domain tests unchanged;
- repository can swap between in-memory and Firestore implementation.

## Milestone 4 — Authentication and authorization

Implement:
- Firebase Auth;
- household membership;
- household bootstrap flow;
- Firestore Security Rules;
- rules tests using emulator.

Important:
The draft rules in this package use auth UID as member document key for cheap rule lookup. Codex should either:
A. adopt UID as membership document ID while maintaining a separate domain `memberKey` if desired, or
B. implement an equally cheap explicit UID mapping.

Do not ship a rule scheme requiring unrestricted collection scans.

Exit:
- unauthorized account cannot read/write household data;
- member can perform intended CRUD;
- immutable history/snapshot docs cannot be edited.

## Milestone 5 — Monthly ledger UI

Implement:
- settlement-period selector;
- table-like transaction editor;
- new/edit transaction;
- account/category/project/pool selectors;
- custom allocations;
- personal/joint payment source;
- reimbursement UI;
- validation errors.

Exit:
- recreate a historical month manually.

## Milestone 6 — Settlement UI and finalization

Implement:
- live settlement panel;
- explanation drill-down;
- reconciliation warnings;
- finalize;
- reopen with audit event;
- immutable settlement snapshot.

Exit:
- historical regression fixtures match spreadsheet intent.

## Milestone 7 — Backup UX

Implement:
- Export All Data JSON;
- CSV transactions;
- restore flow with preflight validation;
- confirmation;
- audit event.

Exit:
- empty emulator database can be reconstructed from export.

## Milestone 8 — Recurring templates

Implement:
- templates;
- generate month drafts;
- edit actual values.

## Milestone 9 — Import staging

Only after ledger is stable:
- CSV parser adapters;
- staged rows;
- duplicate detection;
- commit to canonical transactions;
- credit-card statement/transaction-mode guardrails.

## Non-goals until later

- Plaid
- bank credential storage
- Cloud Functions for settlement math
- SSR
- AI categorization
- dashboards beyond useful ledger/settlement reporting
- automatic paid Firebase backup dependency

## Definition of done for MVP

- Two authorized users can use app.
- Monthly ledger reproduces intended spreadsheet settlement.
- Costco and Blaire-personally-paid cases use generic payment-source mechanics.
- Reimbursements are explicit and auditable.
- Renovation can be excluded through settlement pool.
- Card transaction mode cannot double count card payment.
- Finalized settlements are stable snapshots.
- Full data export/restore works without Firebase-specific representations.
- Domain logic has comprehensive tests.
- Firestore rules have emulator tests.

## Locked UX / product constraints

- Online-only; do not implement offline mutation/sync workflows.
- Responsive desktop + mobile design.
- PWA installability required.
- Google Sign-In only.
- Two initial users have equal permissions.
- Use an allow-list/bootstrap mechanism for initial access.
- Visual polish is a primary product goal.
- No attachments.
- No notifications.
- No joint-account balance tracking.
- No settlement-payment tracking.
- No category-budget UI in MVP.
- No transaction imports in MVP.
- Historical spreadsheet migration is required.

## Additional milestone — Automatic month bootstrap

Implement before recurring templates are considered complete:

- opening a missing month automatically creates its period;
- snapshot contributions/config;
- generate one editable draft per active monthly recurring template;
- use idempotent generation keys;
- ensure retries never duplicate drafts.

## Additional milestone — Historical migration

After the core ledger/settlement UI is stable:

1. Create a migration adapter for the existing spreadsheet.
2. Preserve the spreadsheet's existing granularity.
3. Use `source.type = "migration"`.
4. Reproduce representative January, April, June, and July 2026 outcomes.
5. Record ambiguous source formulas as notes rather than fabricating transaction detail.
6. Produce a migration reconciliation report before switching away from the spreadsheet.

## UI priorities

The first polished surfaces should be:

1. Monthly settlement dashboard
   - total recorded spending
   - operating vs other pool breakdown
   - John/Blaire transfer result
   - prominent reconciliation state

2. Monthly ledger
   - desktop table experience
   - mobile card/list experience
   - fast add/edit flows
   - recurring drafts visually distinct until reviewed/posted

3. Project mini-ledger
   - project total
   - transaction list
   - pool/category summary

4. Settings
   - members
   - allocations/contributions
   - accounts
   - categories
   - settlement pools
   - recurring templates

5. Backup/export

## Deployment

- One Firebase production project.
- Local Firebase Emulator Suite for development/tests.
- GitHub Actions deploy from the production branch.
- Use GitHub/Firebase secrets for deployment credentials.
- Do not commit production Firebase secrets or household financial data.
