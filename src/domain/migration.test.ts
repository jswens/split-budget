import { describe, expect, it } from 'vitest';
import {
  MigrationValidationError,
  migrateSpreadsheetRows,
  type NormalizedSpreadsheetRow,
  type SpreadsheetMigrationOptions,
} from './migration';

const at = '2026-06-01T00:00:00.000Z';
const allocations = [
  { memberId: 'm-john', shareBasisPoints: 6000 },
  { memberId: 'm-blaire', shareBasisPoints: 4000 },
];
const options: SpreadsheetMigrationOptions = {
  migrationId: 'migration-2026-june',
  createdByUid: 'auth-john',
  migratedAt: at,
  defaultSettlementPoolId: 'pool-operating',
  defaultAllocations: allocations,
  defaultSettlementPeriodId: 'period-june',
};

describe('normalized spreadsheet migration', () => {
  it('preserves each supplied statement row at source granularity', () => {
    const rows: NormalizedSpreadsheetRow[] = [
      {
        rowId: 'june-card-statement',
        economicDate: at,
        description: 'Card statement',
        amountCents: 270900,
      },
      {
        rowId: 'june-john-reimbursement',
        economicDate: at,
        description: 'John reimbursement',
        amountCents: 34100,
        kind: 'reimbursement',
      },
      {
        rowId: 'june-blaire-reimbursement',
        economicDate: at,
        description: 'Blaire reimbursement',
        amountCents: 26600,
        kind: 'reimbursement',
      },
    ];
    const result = migrateSpreadsheetRows(rows, options);
    expect(result.reconciliation.valid).toBe(true);
    expect(result.reconciliation.sourceTotalCents).toBe(270900 + 34100 + 26600);
    expect(result.reconciliation.migratedTransactionCount).toBe(3);
    expect(result.reconciliation.preservedSourceGranularity).toBe(true);
    expect(result.transactions.map((transaction) => transaction.source)).toEqual([
      {
        type: 'migration',
        importId: 'migration-2026-june',
        sourceTransactionId: 'june-card-statement',
      },
      {
        type: 'migration',
        importId: 'migration-2026-june',
        sourceTransactionId: 'june-john-reimbursement',
      },
      {
        type: 'migration',
        importId: 'migration-2026-june',
        sourceTransactionId: 'june-blaire-reimbursement',
      },
    ]);
    expect(
      result.transactions.filter((transaction) => transaction.kind === 'reimbursement'),
    ).toHaveLength(2);
    expect(result.transactions[0].settlementPeriodId).toBe('period-june');
  });

  it('rejects duplicate rows and does not return a partial migration', () => {
    const row: NormalizedSpreadsheetRow = {
      rowId: 'same-row',
      economicDate: at,
      description: 'Bill',
      amountCents: 100,
    };
    expect(() => migrateSpreadsheetRows([row, row], options)).toThrow(MigrationValidationError);
    try {
      migrateSpreadsheetRows([row, row], options);
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationValidationError);
      expect((error as MigrationValidationError).reconciliation.migratedTransactionCount).toBe(1);
    }
  });

  it('keeps aggregate mismatches visible when a caller supplies an invalid row', () => {
    const invalid: NormalizedSpreadsheetRow = {
      rowId: 'invalid',
      economicDate: at,
      description: 'Missing allocation',
      amountCents: 100,
      allocations: [],
    };
    expect(() => migrateSpreadsheetRows([invalid], options)).toThrow(/allocations/);
  });
});
