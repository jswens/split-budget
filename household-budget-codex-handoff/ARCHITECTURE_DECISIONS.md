# Architecture Decision Record — Locked MVP Choices

This file is the compact reference for product decisions that should not be re-litigated during initial implementation.

| Area | Decision |
|---|---|
| Connectivity | Online-only |
| Devices | Desktop + phone responsive |
| Installability | PWA |
| Auth | Google Sign-In |
| Initial permissions | John and Blaire equal |
| Membership model | Support >2 members in domain |
| Finalization | Reopen allowed with warning + audit |
| Settlement history | Immutable versioned snapshots |
| Deletion | No hard delete |
| Settlement execution | Calculate transfer only |
| Joint balance | Not tracked |
| Budgeting | Future only; separate model |
| Recurring items | Auto-create editable drafts |
| New month | Auto-bootstrap |
| Credit cards | Statement-level MVP |
| Imports | Deferred pending Plaid/Monarch/bank-source decision |
| Attachments | None |
| Notes | Free text |
| Projects | Mini-ledger/summary |
| Settlement pools | User-creatable |
| Reporting | Monthly total recorded spending, pool breakdown |
| Backup | One-click plain JSON |
| Cloud environments | One production Firebase project + local emulators |
| Deploy | GitHub Actions |
| Notifications | None |
| Audit | Lightweight |
| Historical data | Migrate spreadsheet as-is |
| Schema evolution | Versioned migrations |
| Future bank sync | Preserve adapter path |
| UX priority | Visual polish |
