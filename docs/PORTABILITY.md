# Portable backups and historical migration

The canonical backup is a plain JSON document with the `household-budget-export`
format and schema version `1`. It contains stable IDs, integer cents, integer
basis points, and UTC ISO-8601 strings. It does not contain Firestore
timestamps, document references, or Firebase metadata. JSON is the restore
format; CSV is an inspection and interoperability format.

`src/domain/export.ts` is intentionally a pure domain module. The main APIs
are:

- `serializeBudgetExport` and `parseBudgetExport` for validated JSON;
- `migrateExport` for the explicit version chain (currently v1 only);
- `validateBudgetExport` and `assertValidBudgetExport` for complete shape and
  cross-reference checks;
- `transactionsToCsv` and `settlementsToCsv` for human-readable exports.

Validation rejects malformed ISO timestamps, unsafe or negative money values,
out-of-range basis points, duplicate entity IDs, missing references, invalid
allocation totals, invalid transaction detail objects, and inconsistent
period/finalized-settlement links. Future schema versions are rejected rather
than silently downgraded. A restore caller should validate the complete
document before writing any record and should perform its explicit destructive
replacement confirmation at the application boundary.

CSV cells beginning with a spreadsheet formula character (`=`, `+`, `-`, or
`@`, after leading whitespace) receive a leading apostrophe before normal CSV
quoting. This prevents descriptions, notes, and IDs from being interpreted as
formulas when opened in spreadsheet software. CSV exports never act as import
adapters and are not authoritative backups.

## Historical spreadsheet migration

`src/domain/migration.ts` accepts only normalized rows supplied by an upstream
human or adapter. It does not parse bank CSV files, infer merchants, split
statements into purchases, or create deferred import records. Each supplied
row becomes exactly one canonical transaction, preserving statement and bill
granularity. Migrated transactions carry `source.type = "migration"`, the
migration ID in `source.importId`, and the original normalized row ID in
`source.sourceTransactionId`.

The result includes a reconciliation report with source and migrated row
counts, integer-cents totals, the difference, warnings, and source row IDs.
The migration function fails before returning transactions if normalized rows
or options are invalid or the totals do not reconcile. It does not finalize a
settlement or replace existing records.

The 2026 source workbook is retained outside committed fixtures under the
ignored `private-data/` directory. The reusable
`scripts/migrate-private-source.mjs` utility reads that grid dump and writes
ignored `migration-candidates-2026.json` and `migration-report-2026.json` files
without embedding source values in application code. The generated candidate
set covers January through July 2026 at source granularity. Its report is
pending user signoff before any repository commit for January, April, June, or
July. The June candidate preserves both the `$341` and `$266` expense
reductions and the corresponding received-on-behalf-of-household entries.
January contains a renovation subtraction of `$547.14` without underlying
detail; that row remains explicitly ambiguous until its intended source
semantics are approved. Any sub-cent spreadsheet aggregate differences must be
reported as reconciliation differences rather than silently rounded away. No
historical fixture is auto-finalized and no detail is fabricated.

The committed tests use anonymized structure-only rows and the public round
trip fixture. Real financial values remain in ignored private data.
