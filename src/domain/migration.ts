import type {
  Allocation,
  Id,
  IsoDateTime,
  MoneyCents,
  PaymentSource,
  ReimbursementDetails,
  Transaction,
  TransactionKind,
} from './types';

/**
 * A row that has already been normalized by a human or an upstream adapter.
 * This is intentionally not a bank/CSV parser. One row becomes one canonical
 * transaction, preserving statement and bill granularity.
 */
export interface NormalizedSpreadsheetRow {
  rowId: string;
  economicDate: IsoDateTime;
  description: string;
  amountCents: MoneyCents;
  kind?: TransactionKind;
  accountId?: Id;
  categoryId?: Id;
  projectId?: Id;
  settlementPoolId?: Id;
  settlementPeriodId?: Id;
  paymentSource?: PaymentSource;
  allocations?: Allocation[];
  reimbursement?: ReimbursementDetails;
  importance?: 'normal' | 'major';
  status?: 'draft' | 'posted' | 'excluded';
  notes?: string;
  /** Optional explicit source label, retained for reconciliation output. */
  sourceDescription?: string;
}

export interface SpreadsheetMigrationOptions {
  migrationId: Id;
  createdByUid: string;
  migratedAt: IsoDateTime;
  defaultSettlementPoolId: Id;
  defaultAllocations: Allocation[];
  defaultSettlementPeriodId?: Id;
  defaultImportance?: 'normal' | 'major';
  defaultStatus?: 'draft' | 'posted' | 'excluded';
  /** Supply this when IDs must match IDs from an existing repository. */
  transactionIdForRow?: (row: NormalizedSpreadsheetRow, index: number) => Id;
}

export interface MigrationReconciliationReport {
  migrationId: Id;
  valid: boolean;
  sourceRowCount: number;
  migratedTransactionCount: number;
  sourceTotalCents: MoneyCents;
  migratedTotalCents: MoneyCents;
  differenceCents: MoneyCents;
  sourceRowIds: string[];
  warnings: string[];
  errors: string[];
  preservedSourceGranularity: true;
}

export interface SpreadsheetMigrationResult {
  transactions: Transaction[];
  reconciliation: MigrationReconciliationReport;
}

export class MigrationValidationError extends Error {
  readonly errors: string[];
  readonly reconciliation: MigrationReconciliationReport;

  constructor(errors: string[], reconciliation: MigrationReconciliationReport) {
    super(`Invalid normalized spreadsheet migration: ${errors.join('; ')}`);
    this.name = 'MigrationValidationError';
    this.errors = errors;
    this.reconciliation = reconciliation;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function validIso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function validCents(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function sumAllocations(value: readonly Allocation[]): number {
  return value.reduce((sum, allocation) => sum + allocation.shareBasisPoints, 0);
}

function validateRow(
  row: unknown,
  index: number,
  options: SpreadsheetMigrationOptions,
  seenRows: Set<string>,
  errors: string[],
): row is NormalizedSpreadsheetRow {
  const path = `rows[${index}]`;
  if (!isObject(row)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  if (!validId(row.rowId)) errors.push(`${path}.rowId must be a non-empty string`);
  else if (seenRows.has(row.rowId)) errors.push(`${path}.rowId duplicates ${row.rowId}`);
  else seenRows.add(row.rowId);
  if (!validIso(row.economicDate)) errors.push(`${path}.economicDate must be a UTC ISO date-time`);
  if (typeof row.description !== 'string') errors.push(`${path}.description must be a string`);
  if (!validCents(row.amountCents))
    errors.push(`${path}.amountCents must be a non-negative safe integer`);
  if (
    row.kind !== undefined &&
    !['expense', 'refund', 'reimbursement', 'transfer', 'adjustment'].includes(row.kind as string)
  )
    errors.push(`${path}.kind is invalid`);
  for (const key of [
    'accountId',
    'categoryId',
    'projectId',
    'settlementPoolId',
    'settlementPeriodId',
  ] as const)
    if (row[key] !== undefined && !validId(row[key]))
      errors.push(`${path}.${key} must be a non-empty string`);
  if (row.importance !== undefined && row.importance !== 'normal' && row.importance !== 'major')
    errors.push(`${path}.importance is invalid`);
  if (row.status !== undefined && !['draft', 'posted', 'excluded'].includes(row.status as string))
    errors.push(`${path}.status is invalid`);
  if (row.reimbursement !== undefined) {
    if (row.kind !== undefined && row.kind !== 'reimbursement') errors.push(`${path}.reimbursement requires kind=reimbursement`);
    if (!isObject(row.reimbursement)) errors.push(`${path}.reimbursement must be an object`);
    else {
      if (
        !['reduce_expense', 'received_on_behalf_of_household'].includes(
          row.reimbursement.treatment as string,
        )
      )
        errors.push(`${path}.reimbursement.treatment is invalid`);
      if (
        row.reimbursement.treatment === 'received_on_behalf_of_household' &&
        !validId(row.reimbursement.receivedByMemberId)
      )
        errors.push(`${path}.reimbursement.receivedByMemberId is required`);
    }
  }
  const allocationsValue = row.allocations ?? options.defaultAllocations;
  if (!Array.isArray(allocationsValue) || allocationsValue.length === 0)
    errors.push(`${path}.allocations must contain at least one allocation`);
  else {
    const members = new Set<string>();
    let total = 0;
    allocationsValue.forEach((allocation, allocationIndex) => {
      const candidate = allocation as unknown as Record<string, unknown>;
      const memberId = candidate.memberId;
      const share = candidate.shareBasisPoints;
      if (
        !isObject(allocation) ||
        !validId(memberId) ||
        !Number.isSafeInteger(share) ||
        (share as number) < 0 ||
        (share as number) > 10000
      )
        errors.push(`${path}.allocations[${allocationIndex}] is invalid`);
      else {
        if (members.has(memberId))
          errors.push(`${path}.allocations contains duplicate member ${memberId}`);
        members.add(memberId);
        total += share as number;
      }
    });
    if (total !== 10000) errors.push(`${path}.allocations must total 10000 basis points`);
  }
  if (!validId(options.migrationId)) errors.push('options.migrationId must be a non-empty string');
  if (!validId(options.createdByUid))
    errors.push('options.createdByUid must be a non-empty string');
  if (!validIso(options.migratedAt)) errors.push('options.migratedAt must be a UTC ISO date-time');
  if (!validId(options.defaultSettlementPoolId))
    errors.push('options.defaultSettlementPoolId must be a non-empty string');
  return errors.length === 0;
}

function report(
  options: SpreadsheetMigrationOptions,
  rows: readonly NormalizedSpreadsheetRow[],
  transactions: readonly Transaction[],
  errors: string[],
  warnings: string[],
): MigrationReconciliationReport {
  const sourceTotalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  const migratedTotalCents = transactions.reduce(
    (sum, transaction) => sum + transaction.amountCents,
    0,
  );
  return {
    migrationId: options.migrationId,
    valid:
      errors.length === 0 &&
      sourceTotalCents === migratedTotalCents &&
      rows.length === transactions.length,
    sourceRowCount: rows.length,
    migratedTransactionCount: transactions.length,
    sourceTotalCents,
    migratedTotalCents,
    differenceCents: sourceTotalCents - migratedTotalCents,
    sourceRowIds: rows.map((row) => row.rowId),
    warnings,
    errors,
    preservedSourceGranularity: true,
  };
}

/** Convert normalized rows to canonical transactions, without inventing detail. */
export function migrateSpreadsheetRows(
  rows: readonly NormalizedSpreadsheetRow[],
  options: SpreadsheetMigrationOptions,
): SpreadsheetMigrationResult {
  const errors: string[] = [];
  if (!Array.isArray(rows)) errors.push('rows must be an array');
  const seenRows = new Set<string>();
  const validRows: NormalizedSpreadsheetRow[] = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    if (validateRow(row, index, options, seenRows, errors)) validRows.push(row);
  });
  if (
    !Array.isArray(options.defaultAllocations) ||
    sumAllocations(options.defaultAllocations) !== 10000
  )
    errors.push('options.defaultAllocations must total 10000 basis points');
  const seenTransactionIds = new Set<string>();
  const transactions: Transaction[] = [];
  validRows.forEach((row, index) => {
    const transactionId =
      options.transactionIdForRow?.(row, index) ?? `migration:${options.migrationId}:${row.rowId}`;
    if (!validId(transactionId)) {
      errors.push(`rows[${index}] generated an invalid transaction ID`);
      return;
    }
    if (seenTransactionIds.has(transactionId)) {
      errors.push(`generated transaction ID duplicates ${transactionId}`);
      return;
    }
    seenTransactionIds.add(transactionId);
    const kind = row.kind ?? 'expense';
    transactions.push({
      id: transactionId,
      economicDate: row.economicDate,
      description: row.description,
      amountCents: row.amountCents,
      kind,
      ...(row.accountId === undefined ? {} : { accountId: row.accountId }),
      ...(row.categoryId === undefined ? {} : { categoryId: row.categoryId }),
      ...(row.projectId === undefined ? {} : { projectId: row.projectId }),
      settlementPoolId: row.settlementPoolId ?? options.defaultSettlementPoolId,
      ...(row.paymentSource === undefined ? {} : { paymentSource: row.paymentSource }),
      allocations: row.allocations ?? options.defaultAllocations,
      importance: row.importance ?? options.defaultImportance ?? 'normal',
      ...((row.settlementPeriodId ?? options.defaultSettlementPeriodId)
        ? { settlementPeriodId: row.settlementPeriodId ?? options.defaultSettlementPeriodId }
        : {}),
      ...(kind === 'reimbursement'
        ? {
            reimbursement: row.reimbursement ?? {
              treatment: 'reduce_expense' as const,
              sourceDescription: row.sourceDescription ?? row.description,
            },
          }
        : {}),
      source: { type: 'migration', importId: options.migrationId, sourceTransactionId: row.rowId },
      status: row.status ?? options.defaultStatus ?? 'posted',
      ...(row.notes === undefined ? {} : { notes: row.notes }),
      createdByUid: options.createdByUid,
      createdAt: options.migratedAt,
      updatedByUid: options.createdByUid,
      updatedAt: options.migratedAt,
    } as Transaction);
  });
  const warnings = [
    'Rows were migrated at their supplied statement/bill granularity; no underlying purchases were created.',
  ];
  const reconciliation = report(options, validRows, transactions, errors, warnings);
  if (!reconciliation.valid)
    throw new MigrationValidationError(
      errors.length ? errors : ['migration totals did not reconcile'],
      reconciliation,
    );
  return { transactions, reconciliation };
}

export const migrateNormalizedSpreadsheetRows = migrateSpreadsheetRows;
