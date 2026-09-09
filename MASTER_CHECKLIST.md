# Split Budget — master implementation checklist

Updated: 2026-09-09. Status: implementation in progress.

This is the working checklist for the complete MVP. Checkboxes mean implemented **and verified**; pending external acceptance stays unchecked. Execution uses Luna (`gpt-5.6-luna`) subagents at high reasoning effort, with root integration/review.

## Authority and scope

- [x] Read the handoff specification, schema, accounting contract, fixtures A–T, export format, implementation plan, rules, indexes, and locked decisions.
- [x] Verify the root updated specification and both handoff specification copies are identical.
- [x] Resolve older-plan conflicts in favor of the locked final decisions: bank/CSV imports deferred; historical spreadsheet migration retained; immutable snapshots even after reopening; equal member permissions; online-only PWA.
- [x] Preserve `household-budget-codex-handoff/` as reference; implement the application at the repository root.
- [ ] Record implementation-specific accounting/security decisions alongside the code.

## 0. Application foundation — root

- [ ] Vite + React + TypeScript application; strict type checking, lint, formatting, Vitest.
- [ ] Firebase SDK, hosting/index/rules config and local Emulator Suite scripts.
- [ ] Environment variable documentation and ignored local secrets/data.
- [ ] Responsive app shell, accessible controls and explicit sample-data preview.
- [ ] PWA manifest, install icons, online-only behavior.
- [ ] Production build and local launch verified.

## 1. Pure accounting domain — Luna/high: domain

- [ ] Canonical infrastructure-independent types and safe integer-cent money helpers.
- [ ] Integer basis-point allocation with largest-remainder deterministic rounding.
- [ ] Runtime transaction and reference validation; actionable reconciliation messages.
- [ ] Settlement: posted status, explicit period and included pools only.
- [ ] Generic personal payment credits independent of account ownership.
- [ ] Refunds, both reimbursement treatments, signed named adjustments, transfers.
- [ ] Explicit statement/purchase/payment distinction; prevent credit-card double counting.
- [ ] Snapshotted contributions, custom allocations and more than two members.
- [ ] Separate all-pool monthly reporting with pool breakdown.
- [ ] Fixtures A–L and R; negative/reconciliation cases pass without Firebase imports.

## 2. Portable data and migration — Luna/high: portability

- [ ] Full versioned JSON envelope, ISO strings, stable IDs and exact integer values.
- [ ] Deep runtime validation of every entity and cross-reference; reject duplicate IDs, malformed money and unsupported versions.
- [ ] Pure migration entrypoint for supported export versions.
- [ ] CSV transactions and settlements with safe escaping.
- [ ] Export/restore round-trip fixture N preserves calculations and snapshots.
- [ ] Historical adapter preserves supplied bill/statement granularity and migration provenance.
- [ ] Migration reconciliation report flags ambiguity and discrepancies.
- [ ] Actual January, April, June and July 2026 source fixtures verified (requires source spreadsheet).
- [ ] Actual household data migrated and accepted before spreadsheet replacement (requires source data).

## 3. Persistence and lifecycle — Luna/high: repository

- [ ] Swappable in-memory and Firestore repositories; explicit domain boundary and timestamp converters.
- [ ] Household-scoped schema and required period/project/account/category queries.
- [ ] Automatic month bootstrap snapshots config/contributions.
- [ ] Recurring monthly drafts with deterministic keys; concurrent/retry-safe generation.
- [ ] Future template changes preserve generated historical drafts (O, P).
- [ ] Finalize validates, records immutable versioned snapshot, updates period and audits atomically.
- [ ] Reopen requires UI confirmation and audit; re-finalize preserves previous snapshots (M, Q).
- [ ] Reject financial hard deletion; exclusion preserves history/audit (S).
- [ ] Restore validates before writes, avoids duplicate replacement, and records audit.
- [ ] Repository lifecycle and emulator integration tests pass.

## 4. Authentication and authorization — Luna/high: repository

- [ ] Google Sign-In only; explicit sign-out and useful access errors.
- [ ] Initial household provisioning and allow-list/member setup documented.
- [ ] UID-keyed membership lookup; equal permissions for approved members.
- [ ] Rules deny unauthorized users, membership escalation and canonical deletion.
- [ ] Rules protect finalized periods/transactions, immutable config history, snapshots and audit records.
- [ ] Emulator rules tests include adversarial authorization and history mutation checks.
- [ ] Real approved Google accounts provisioned and tested (requires Firebase project/account details).

## 5. Monthly ledger and settlement UI — root, then Luna/high follow-up

- [ ] Month navigation with automatic bootstrap.
- [ ] Desktop ledger table and mobile list; posted/draft/excluded states visible.
- [ ] Add/edit expense, refund, reimbursement, transfer and adjustment with validation.
- [ ] Account, category, project, settlement pool, payment source and custom allocation selectors.
- [ ] Economic date separate from settlement period; notes and importance.
- [ ] All-pool spending total and pool breakdown; settlement pool selection.
- [ ] Live member transfer results and transaction-level explanation.
- [ ] Reconciliation issues and unresolved drafts visible before finalization.
- [ ] Finalization, confirmed reopen and historical version display.
- [ ] Project mini-ledgers with pool/category summaries.
- [ ] Settings for accounts, categories, projects, custom pools, allocations/contributions and recurring templates.
- [ ] One-click JSON backup, both CSV exports, preflight restore summary and explicit confirmation.
- [ ] Browser checks at desktop/mobile sizes and representative complete-month workflow.

## 6. Release and operations — root

- [ ] GitHub Actions checks and production-branch Firebase deployment workflow.
- [ ] Setup, testing, backup/restore and deployment documentation.
- [ ] Domain, repository, rules tests, lint and production build pass.
- [ ] Clean emulator restoration reproduces exported economic state.
- [ ] Production Firebase project, Google provider and GitHub deployment credentials configured (external setup).
- [ ] Production deployment and two-user smoke test (external setup).
- [ ] Historical regression and reconciliation sign-off (source spreadsheet required).

## Deferred by explicit product decision

Bank/CSV transaction imports, Plaid/Monarch, automatic classification, category budgets, attachments, notifications, joint-account balance tracking, settlement-payment tracking, offline editing/sync, automated external backups, paid Firebase backup dependencies, server settlement runtime.

## Verification log

Append commands/results and remaining limitations here as milestones are completed. No completed fixture or production claim should be inferred from a scaffold alone.
