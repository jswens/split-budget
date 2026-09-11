# Split Budget

A private household ledger and monthly settlement app. React + TypeScript runs on Firebase Hosting, with Google Sign-In and household-scoped Firestore persistence. Settlement math is pure TypeScript and uses integer cents and basis points.

The original project materials remain in `household-budget-codex-handoff/`. Follow [MASTER_CHECKLIST.md](MASTER_CHECKLIST.md) for implementation and release status.

## Run locally

Requires Node 24 and npm. Java 21 is also required for Firestore emulator tests.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Without Firebase configuration, the app offers an explicitly labeled synthetic preview. Preview edits are held in memory and reset when the page reloads. Real household records are never bundled into the client.

For Firebase, copy `.env.example` to `.env.local`, supply the web app configuration, and follow [Firebase setup](docs/FIREBASE_SETUP.md). `VITE_HOUSEHOLD_ID` is optional for new households; after Google sign-in, the app offers create-or-join onboarding. Existing members can copy their household code from Settings, and requests require approval before access is granted.

## Verify

```sh
npm run lint
npm test
npm run test:rules
npm run build
```

`npm test` runs pure accounting, portability and lifecycle checks. `test:rules` starts a disposable local Firestore emulator under `demo-split-budget`; it does not connect to production. Use `npm run emulators` for interactive local development. Financial fixture data belongs in ignored `private-data/`, never in tracked files or browser assets.

## Accounting rules

Transactions explicitly identify economic date, settlement period, pool, allocation and payment source. Personally funding an expense credits that member for the full advance. Refunds/reducing reimbursements reduce household expense; funds received personally on behalf of the household add to the recipient's obligation. Transfers never count as expenses. Periods snapshot contributions and configuration.

Finalization produces an immutable versioned settlement. Reopening preserves the prior version and records an audit event. Exclusion preserves canonical transaction history. New months generate independent, editable recurring drafts. Monthly spending reporting uses economic dates and includes every pool; settlement uses explicit period assignments and selected pools.

## Backup and migration

Use Export all data to download plain versioned JSON. CSV files are supplemental exports. Restore performs a complete validation pass before writes and requires an empty, authorized target. Existing household data is never silently replaced. See [Portability](docs/PORTABILITY.md) for format and migration details.

Historical spreadsheet migration is separate from deferred bank/CSV imports. Preserve source totals, formula notes and ambiguities. Reconcile representative months and approve the report before replacing the spreadsheet.

## Deploy

The production branch is `master`. The `Checks` workflow validates pull requests, and the production workflow builds the Vite app before deploying Hosting, Firestore rules, and Firestore indexes.

Create a GitHub `production` environment. Set variables `FIREBASE_PROJECT_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, and `VITE_FIREBASE_APP_ID`; `VITE_HOUSEHOLD_ID` remains useful as a default for an existing household but is optional for first-time onboarding. The storage, messaging sender, and measurement ID variables are optional because the client has project defaults. Set secrets `VITE_FIREBASE_API_KEY` and `FIREBASE_SERVICE_ACCOUNT_SPLIT_BUDGET_69C92` (a Firebase deployment service account JSON credential). Grant only the roles needed for Hosting and Firestore rules/index deployment. Enable Google auth, then push to `master`. Use a single production Firebase project; local tests use emulators.

There is no server runtime, bank integration, offline mutation queue, joint-account balance tracker or settlement-payment tracker. The PWA requires connectivity for real data entry. Before production launch, complete the unchecked external acceptance gates in the master checklist.
