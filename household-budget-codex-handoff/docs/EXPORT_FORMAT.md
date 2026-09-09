# Portable Export and Restore Format

## Goal

Firebase is the operational store, not the only durable representation of household financial data.

The canonical application backup must be readable without Firebase and capable of reconstructing the complete domain state.

## File

Suggested naming:

```text
household-budget-backup-YYYY-MM-DDTHH-mm-ssZ.json
```

## Envelope

```ts
interface BudgetExportV1 {
  format: "household-budget-export";
  schemaVersion: 1;
  exportedAt: string;
  appVersion: string;

  household: Household;
  members: HouseholdMember[];
  accounts: Account[];
  categories: Category[];
  projects: Project[];
  settlementPools: SettlementPool[];

  currentConfig: HouseholdConfigVersion;
  configHistory: HouseholdConfigVersion[];

  transactions: Transaction[];
  settlementPeriods: SettlementPeriod[];
  settlements: FinalizedSettlement[];

  recurringTemplates: unknown[];
  auditLog?: unknown[];
}
```

Imports/importRecords may be excluded from ordinary backups once canonical transactions exist, but this choice must be explicit and documented.

## Firebase independence

The export:
- uses ISO timestamps, not Firestore Timestamp objects;
- contains stable IDs;
- contains no DocumentReference objects;
- contains no Firebase metadata required for restore;
- contains integer cents and basis points exactly.

## Restore workflow

1. Parse JSON.
2. Verify `format`.
3. Verify supported `schemaVersion`.
4. Validate every entity and cross-reference in memory.
5. Reject invalid allocations, missing member/account references, duplicate IDs, malformed money, or unsupported schema.
6. Show restore summary.
7. Require explicit confirmation before destructive replacement.
8. Write records in dependency order.
9. Recalculate open periods.
10. Verify finalized settlement snapshots and report differences.
11. Write audit event.

Never partially restore a malformed backup.

## Schema migrations

Create a pure function chain:

```ts
migrateExport(input): BudgetExportCurrent
```

Each schema version migration is tested.

The application should remain able to import all prior released export versions.

## CSV

CSV is a convenience/interoperability export, not the canonical backup.

At minimum:
- transactions.csv
- settlements.csv

Transaction CSV fields should include:
- ID
- economic date
- settlement period
- description
- amount
- kind
- account
- payment source
- category
- project
- settlement pool
- allocations
- importance
- status
- notes

## Independent backup target

MVP requirement:
- one-click local JSON download.

Later:
- scheduled copy of the exact portable format to an independent destination.

Firestore managed backups may exist as an additional layer, but must not replace the portable application backup.
