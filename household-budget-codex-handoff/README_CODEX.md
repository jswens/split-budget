# Codex Handoff — Household Budget App

Start with these files in order:

1. `PROJECT_SPEC.md`
2. `FIRESTORE_SCHEMA.md`
3. `src/domain/types.ts`
4. `src/domain/settlement-contract.md`
5. `TEST_CASES.md`
6. `EXPORT_FORMAT.md`
7. `IMPLEMENTATION_PLAN.md`
8. `firestore.rules`
9. `firestore.indexes.json`

## Architecture decisions already made

- React + TypeScript static client.
- Firebase Hosting.
- Firebase Authentication.
- Cloud Firestore primary operational datastore.
- Pure TypeScript settlement engine independent of Firebase.
- Household-level flat transaction ledger.
- Integer cents and integer basis points.
- Default allocation: John 60%, Blaire 40%.
- Default monthly contributions: John $2,000, Blaire $1,200.
- Payment source is independent from allocation.
- Settlement pools handle operating vs renovation/excluded spending.
- Economic date is independent from settlement period.
- Reimbursements have explicit treatment semantics.
- Credit-card accounts support statement mode or transaction mode.
- In transaction mode, card payments are transfers, never expenses.
- Finalized settlements are immutable snapshots.
- Portable versioned JSON is the canonical application backup.
- CSV is supplemental.
- No Firebase server runtime required for MVP.

## Codex instruction

Implement incrementally according to `IMPLEMENTATION_PLAN.md`.

Do not "simplify" the domain by:
- deriving payer from account owner;
- deriving settlement period from transaction date;
- deriving settlement behavior from category;
- using floating-point dollars;
- embedding transactions inside period documents;
- counting card payments and purchases simultaneously;
- replacing reimbursements with unexplained settlement arithmetic.

When ambiguity is discovered, preserve ledger transparency and document the decision before changing the schema.

## Final product choices

- Online-only.
- Responsive desktop + mobile.
- Installable PWA.
- Google Sign-In only.
- Equal permissions for the two initial users.
- Finalized periods may be reopened with warning/audit trail.
- Re-finalization creates a new immutable settlement version.
- No hard deletion of canonical financial history.
- Calculate transfer amounts only; do not track payment completion.
- No joint-account balance tracking.
- Future budgeting supported architecturally but not implemented.
- Recurring templates automatically generate editable monthly drafts.
- Months are automatically bootstrapped on first access.
- MVP remains statement-level for credit cards.
- Imports/Plaid/Monarch are deferred.
- No attachments or notifications.
- Projects have mini-ledger screens.
- Settlement pools are user-creatable.
- Monthly report defaults to total recorded spending across pools.
- One-click plain JSON backup.
- One production Firebase project + local emulators.
- GitHub Actions automatic deployment.
- Historical spreadsheet migration at existing source granularity.
- Preserve support for more than two household members.
- Prioritize visual polish.
