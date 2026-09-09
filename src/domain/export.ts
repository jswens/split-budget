import type {
  Account,
  Allocation,
  Category,
  FinalizedSettlement,
  Household,
  HouseholdConfigVersion,
  HouseholdMember,
  Id,
  IsoDateTime,
  MoneyCents,
  Project,
  RecurringTemplate,
  SettlementPeriod,
  SettlementPool,
  Transaction,
} from './types';

/** The on-disk backup format. Keep this envelope free of Firebase values. */
export interface BudgetExportV1 {
  format: 'household-budget-export';
  schemaVersion: 1;
  exportedAt: IsoDateTime;
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
  recurringTemplates: RecurringTemplate[];
  auditLog?: unknown[];
}

export type BudgetExportCurrent = BudgetExportV1;
export const CURRENT_EXPORT_SCHEMA_VERSION = 1 as const;

export interface ExportValidationResult {
  valid: boolean;
  errors: string[];
  /** Alias useful to callers that call validation failures “issues”. */
  issues: string[];
}

export class ExportValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Invalid household budget export: ${errors.join('; ')}`);
    this.name = 'ExportValidationError';
    this.errors = errors;
  }
}

type UnknownRecord = Record<string, unknown>;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const FORMULA_PREFIX = /^[=+\-@]/;

function record(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, path: string, errors: string[], allowEmpty = false): value is string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
}

function id(value: unknown, path: string, errors: string[]): value is Id {
  return text(value, path, errors);
}

function safeInteger(value: unknown, path: string, errors: string[]): value is number {
  if (!Number.isSafeInteger(value)) {
    errors.push(`${path} must be a safe integer`);
    return false;
  }
  return true;
}

function cents(
  value: unknown,
  path: string,
  errors: string[],
  signed = false,
): value is MoneyCents {
  if (!safeInteger(value, path, errors)) return false;
  if (!signed && (value as number) < 0) {
    errors.push(`${path} must be non-negative cents`);
    return false;
  }
  return true;
}

function basisPoints(value: unknown, path: string, errors: string[]): value is number {
  if (!safeInteger(value, path, errors)) return false;
  if ((value as number) < 0 || (value as number) > 10000) {
    errors.push(`${path} must be between 0 and 10000 basis points`);
    return false;
  }
  return true;
}

function isoDateTime(value: unknown, path: string, errors: string[]): value is IsoDateTime {
  if (!text(value, path, errors) || !ISO_DATE_TIME.test(value)) {
    errors.push(`${path} must be a UTC ISO-8601 date-time ending in Z`);
    return false;
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    errors.push(`${path} must be a valid ISO-8601 date-time`);
    return false;
  }
  return true;
}

function array(value: unknown, path: string, errors: string[]): value is unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return false;
  }
  return true;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
  errors: string[],
): value is T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    errors.push(`${path} must be one of ${values.join(', ')}`);
    return false;
  }
  return true;
}

function booleanValue(value: unknown, path: string, errors: string[]): value is boolean {
  if (typeof value !== 'boolean') {
    errors.push(`${path} must be boolean`);
    return false;
  }
  return true;
}

function duplicateIds(values: unknown[], path: string, errors: string[]): Set<string> {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (!record(value) || typeof value.id !== 'string') continue;
    if (seen.has(value.id)) errors.push(`${path}[${index}].id duplicates ${value.id}`);
    seen.add(value.id);
  }
  return seen;
}

function allocations(
  value: unknown,
  path: string,
  memberIds: Set<string>,
  errors: string[],
  requiredTotal = true,
): value is Allocation[] {
  if (!array(value, path, errors)) return false;
  const seen = new Set<string>();
  let total = 0;
  for (const [index, item] of value.entries()) {
    const p = `${path}[${index}]`;
    if (!record(item)) {
      errors.push(`${p} must be an object`);
      continue;
    }
    id(item.memberId, `${p}.memberId`, errors);
    if (typeof item.memberId === 'string') {
      if (!memberIds.has(item.memberId)) errors.push(`${p}.memberId references an unknown member`);
      if (seen.has(item.memberId)) errors.push(`${p}.memberId is duplicated`);
      seen.add(item.memberId);
    }
    if (basisPoints(item.shareBasisPoints, `${p}.shareBasisPoints`, errors))
      total += item.shareBasisPoints;
  }
  if (requiredTotal && total !== 10000)
    errors.push(`${path} must total 10000 basis points (got ${total})`);
  if (!requiredTotal && value.length > 0 && total !== 10000)
    errors.push(`${path} must total 10000 basis points when present`);
  return true;
}

function stringRecordOfCents(
  value: unknown,
  path: string,
  memberIds: Set<string>,
  errors: string[],
): value is Record<string, MoneyCents> {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  for (const [key, amount] of Object.entries(value)) {
    if (!memberIds.has(key)) errors.push(`${path}.${key} references an unknown member`);
    cents(amount, `${path}.${key}`, errors);
  }
  return true;
}

function validateHousehold(value: unknown, path: string, errors: string[]): value is Household {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  text(value.name, `${path}.name`, errors);
  if (value.currency !== 'USD') errors.push(`${path}.currency must be USD`);
  text(value.timezone, `${path}.timezone`, errors);
  safeInteger(value.schemaVersion, `${path}.schemaVersion`, errors);
  isoDateTime(value.createdAt, `${path}.createdAt`, errors);
  isoDateTime(value.updatedAt, `${path}.updatedAt`, errors);
  return true;
}

function validateMember(value: unknown, path: string, errors: string[]): value is HouseholdMember {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  text(value.authUid, `${path}.authUid`, errors);
  text(value.displayName, `${path}.displayName`, errors);
  enumValue(value.role, ['owner', 'member'] as const, `${path}.role`, errors);
  booleanValue(value.active, `${path}.active`, errors);
  isoDateTime(value.createdAt, `${path}.createdAt`, errors);
  isoDateTime(value.updatedAt, `${path}.updatedAt`, errors);
  return true;
}

function validateAccount(
  value: unknown,
  path: string,
  memberIds: Set<string>,
  errors: string[],
): value is Account {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  text(value.name, `${path}.name`, errors);
  enumValue(value.ownerType, ['member', 'joint'] as const, `${path}.ownerType`, errors);
  if (value.ownerType === 'member') {
    id(value.ownerMemberId, `${path}.ownerMemberId`, errors);
    if (typeof value.ownerMemberId === 'string' && !memberIds.has(value.ownerMemberId))
      errors.push(`${path}.ownerMemberId references an unknown member`);
  } else if (value.ownerMemberId !== undefined)
    errors.push(`${path}.ownerMemberId is only valid for member-owned accounts`);
  enumValue(
    value.type,
    ['checking', 'savings', 'credit_card', 'venmo', 'cash', 'other'] as const,
    `${path}.type`,
    errors,
  );
  if (value.trackingMode !== undefined)
    enumValue(
      value.trackingMode,
      ['statement', 'transactions'] as const,
      `${path}.trackingMode`,
      errors,
    );
  if (value.type !== 'credit_card' && value.trackingMode !== undefined)
    errors.push(`${path}.trackingMode is only valid for credit_card accounts`);
  if (value.institution !== undefined) text(value.institution, `${path}.institution`, errors, true);
  booleanValue(value.active, `${path}.active`, errors);
  if (value.notes !== undefined) text(value.notes, `${path}.notes`, errors, true);
  isoDateTime(value.createdAt, `${path}.createdAt`, errors);
  isoDateTime(value.updatedAt, `${path}.updatedAt`, errors);
  return true;
}

function validateCategory(
  value: unknown,
  path: string,
  categoryIds: Set<string>,
  errors: string[],
): value is Category {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  text(value.name, `${path}.name`, errors);
  if (value.parentCategoryId !== undefined) {
    id(value.parentCategoryId, `${path}.parentCategoryId`, errors);
    if (typeof value.parentCategoryId === 'string' && !categoryIds.has(value.parentCategoryId))
      errors.push(`${path}.parentCategoryId references an unknown category`);
  }
  enumValue(value.type, ['expense', 'income', 'transfer'] as const, `${path}.type`, errors);
  booleanValue(value.active, `${path}.active`, errors);
  if (value.sortOrder !== undefined) safeInteger(value.sortOrder, `${path}.sortOrder`, errors);
  return true;
}

function validateProject(
  value: unknown,
  path: string,
  poolIds: Set<string>,
  errors: string[],
): value is Project {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  text(value.name, `${path}.name`, errors);
  enumValue(value.status, ['active', 'completed', 'archived'] as const, `${path}.status`, errors);
  if (value.defaultSettlementPoolId !== undefined) {
    id(value.defaultSettlementPoolId, `${path}.defaultSettlementPoolId`, errors);
    if (
      typeof value.defaultSettlementPoolId === 'string' &&
      !poolIds.has(value.defaultSettlementPoolId)
    )
      errors.push(`${path}.defaultSettlementPoolId references an unknown pool`);
  }
  isoDateTime(value.createdAt, `${path}.createdAt`, errors);
  if (value.completedAt !== undefined)
    isoDateTime(value.completedAt, `${path}.completedAt`, errors);
  return true;
}

function validatePool(value: unknown, path: string, errors: string[]): value is SettlementPool {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  text(value.name, `${path}.name`, errors);
  booleanValue(value.active, `${path}.active`, errors);
  if (value.description !== undefined) text(value.description, `${path}.description`, errors, true);
  return true;
}

function validatePaymentSource(
  value: unknown,
  path: string,
  memberIds: Set<string>,
  accountIds: Set<string>,
  errors: string[],
): void {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (value.type === 'joint') {
    id(value.accountId, `${path}.accountId`, errors);
    if (typeof value.accountId === 'string' && !accountIds.has(value.accountId))
      errors.push(`${path}.accountId references an unknown account`);
  } else if (value.type === 'member') {
    id(value.memberId, `${path}.memberId`, errors);
    if (typeof value.memberId === 'string' && !memberIds.has(value.memberId))
      errors.push(`${path}.memberId references an unknown member`);
    if (value.accountId !== undefined) {
      id(value.accountId, `${path}.accountId`, errors);
      if (typeof value.accountId === 'string' && !accountIds.has(value.accountId))
        errors.push(`${path}.accountId references an unknown account`);
    }
  } else if (value.type !== 'third_party')
    errors.push(`${path}.type must be joint, member, or third_party`);
}

function validateConfig(
  value: unknown,
  path: string,
  memberIds: Set<string>,
  poolIds: Set<string>,
  errors: string[],
): value is HouseholdConfigVersion {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  safeInteger(value.version, `${path}.version`, errors);
  allocations(value.defaultAllocations, `${path}.defaultAllocations`, memberIds, errors);
  stringRecordOfCents(
    value.monthlyContributions,
    `${path}.monthlyContributions`,
    memberIds,
    errors,
  );
  id(value.defaultSettlementPoolId, `${path}.defaultSettlementPoolId`, errors);
  if (
    typeof value.defaultSettlementPoolId === 'string' &&
    !poolIds.has(value.defaultSettlementPoolId)
  )
    errors.push(`${path}.defaultSettlementPoolId references an unknown pool`);
  isoDateTime(value.effectiveFrom, `${path}.effectiveFrom`, errors);
  isoDateTime(value.createdAt, `${path}.createdAt`, errors);
  text(value.createdByUid, `${path}.createdByUid`, errors);
  if (value.reason !== undefined) text(value.reason, `${path}.reason`, errors, true);
  return true;
}

function validateRecurringTemplate(
  value: unknown,
  path: string,
  memberIds: Set<string>,
  accountIds: Set<string>,
  categoryIds: Set<string>,
  projectIds: Set<string>,
  poolIds: Set<string>,
  errors: string[],
): value is RecurringTemplate {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  text(value.name, `${path}.name`, errors);
  text(value.description, `${path}.description`, errors, true);
  if (value.estimatedAmountCents !== undefined)
    cents(value.estimatedAmountCents, `${path}.estimatedAmountCents`, errors);
  if (value.categoryId !== undefined) {
    id(value.categoryId, `${path}.categoryId`, errors);
    if (typeof value.categoryId === 'string' && !categoryIds.has(value.categoryId))
      errors.push(`${path}.categoryId references an unknown category`);
  }
  if (value.projectId !== undefined) {
    id(value.projectId, `${path}.projectId`, errors);
    if (typeof value.projectId === 'string' && !projectIds.has(value.projectId))
      errors.push(`${path}.projectId references an unknown project`);
  }
  id(value.settlementPoolId, `${path}.settlementPoolId`, errors);
  if (typeof value.settlementPoolId === 'string' && !poolIds.has(value.settlementPoolId))
    errors.push(`${path}.settlementPoolId references an unknown pool`);
  if (value.paymentSource !== undefined)
    validatePaymentSource(
      value.paymentSource,
      `${path}.paymentSource`,
      memberIds,
      accountIds,
      errors,
    );
  allocations(value.allocations, `${path}.allocations`, memberIds, errors);
  enumValue(value.importance, ['normal', 'major'] as const, `${path}.importance`, errors);
  enumValue(value.frequency, ['monthly'] as const, `${path}.frequency`, errors);
  booleanValue(value.active, `${path}.active`, errors);
  isoDateTime(value.createdAt, `${path}.createdAt`, errors);
  isoDateTime(value.updatedAt, `${path}.updatedAt`, errors);
  return true;
}

const TRANSACTION_KINDS = ['expense', 'refund', 'reimbursement', 'transfer', 'adjustment'] as const;

function validateTransaction(
  value: unknown,
  path: string,
  memberIds: Set<string>,
  accountIds: Set<string>,
  categoryIds: Set<string>,
  projectIds: Set<string>,
  poolIds: Set<string>,
  periodIds: Set<string>,
  transactionIds: Set<string>,
  errors: string[],
): value is Transaction {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  isoDateTime(value.economicDate, `${path}.economicDate`, errors);
  text(value.description, `${path}.description`, errors, true);
  cents(value.amountCents, `${path}.amountCents`, errors);
  enumValue(value.kind, TRANSACTION_KINDS, `${path}.kind`, errors);
  for (const [key, ids] of [
    ['accountId', accountIds],
    ['categoryId', categoryIds],
    ['projectId', projectIds],
  ] as const) {
    if (value[key] !== undefined) {
      id(value[key], `${path}.${key}`, errors);
      if (typeof value[key] === 'string' && !ids.has(value[key]))
        errors.push(`${path}.${key} references an unknown record`);
    }
  }
  id(value.settlementPoolId, `${path}.settlementPoolId`, errors);
  if (typeof value.settlementPoolId === 'string' && !poolIds.has(value.settlementPoolId))
    errors.push(`${path}.settlementPoolId references an unknown record`);
  if (value.paymentSource !== undefined)
    validatePaymentSource(
      value.paymentSource,
      `${path}.paymentSource`,
      memberIds,
      accountIds,
      errors,
    );
  const mustAllocate =
    value.kind === 'expense' || value.kind === 'refund' || value.kind === 'reimbursement';
  allocations(value.allocations, `${path}.allocations`, memberIds, errors, mustAllocate);
  enumValue(value.importance, ['normal', 'major'] as const, `${path}.importance`, errors);
  if (value.settlementPeriodId !== undefined) {
    id(value.settlementPeriodId, `${path}.settlementPeriodId`, errors);
    if (typeof value.settlementPeriodId === 'string' && !periodIds.has(value.settlementPeriodId))
      errors.push(`${path}.settlementPeriodId references an unknown period`);
  }
  if (value.reimbursement !== undefined) {
    if (value.kind !== 'reimbursement')
      errors.push(`${path}.reimbursement is only valid for reimbursement transactions`);
    if (!record(value.reimbursement)) errors.push(`${path}.reimbursement must be an object`);
    else {
      enumValue(
        value.reimbursement.treatment,
        ['reduce_expense', 'received_on_behalf_of_household'] as const,
        `${path}.reimbursement.treatment`,
        errors,
      );
      if (value.reimbursement.receivedByMemberId !== undefined) {
        id(
          value.reimbursement.receivedByMemberId,
          `${path}.reimbursement.receivedByMemberId`,
          errors,
        );
        if (
          typeof value.reimbursement.receivedByMemberId === 'string' &&
          !memberIds.has(value.reimbursement.receivedByMemberId)
        )
          errors.push(`${path}.reimbursement.receivedByMemberId references an unknown member`);
      }
      if (
        value.reimbursement.treatment === 'received_on_behalf_of_household' &&
        typeof value.reimbursement.receivedByMemberId !== 'string'
      )
        errors.push(
          `${path}.reimbursement.receivedByMemberId is required for received_on_behalf_of_household`,
        );
      if (value.reimbursement.relatedTransactionIds !== undefined) {
        if (
          array(
            value.reimbursement.relatedTransactionIds,
            `${path}.reimbursement.relatedTransactionIds`,
            errors,
          )
        )
          for (const [i, ref] of value.reimbursement.relatedTransactionIds.entries()) {
            id(ref, `${path}.reimbursement.relatedTransactionIds[${i}]`, errors);
            if (typeof ref === 'string' && !transactionIds.has(ref))
              errors.push(
                `${path}.reimbursement.relatedTransactionIds[${i}] references an unknown transaction`,
              );
          }
      }
      if (value.reimbursement.sourceDescription !== undefined)
        text(
          value.reimbursement.sourceDescription,
          `${path}.reimbursement.sourceDescription`,
          errors,
          true,
        );
    }
  } else if (value.kind === 'reimbursement')
    errors.push(`${path}.reimbursement is required for reimbursement transactions`);
  if (value.transfer !== undefined) {
    if (value.kind !== 'transfer') errors.push(`${path}.transfer is only valid for transfer transactions`);
    if (!record(value.transfer)) errors.push(`${path}.transfer must be an object`);
    else {
      for (const key of ['fromAccountId', 'toAccountId'] as const) {
        id(value.transfer[key], `${path}.transfer.${key}`, errors);
        if (typeof value.transfer[key] === 'string' && !accountIds.has(value.transfer[key]))
          errors.push(`${path}.transfer.${key} references an unknown account`);
      }
    }
  } else if (value.kind === 'transfer')
    errors.push(`${path}.transfer is required for transfer transactions`);
  if (value.adjustment !== undefined) {
    if (value.kind !== 'adjustment') errors.push(`${path}.adjustment is only valid for adjustment transactions`);
    if (!record(value.adjustment)) errors.push(`${path}.adjustment must be an object`);
    else {
      if (value.adjustment.memberId !== undefined) {
        id(value.adjustment.memberId, `${path}.adjustment.memberId`, errors);
        if (
          typeof value.adjustment.memberId === 'string' &&
          !memberIds.has(value.adjustment.memberId)
        )
          errors.push(`${path}.adjustment.memberId references an unknown member`);
      }
      text(value.adjustment.reason, `${path}.adjustment.reason`, errors);
      cents(value.adjustment.effectCents, `${path}.adjustment.effectCents`, errors, true);
    }
  } else if (value.kind === 'adjustment')
    errors.push(`${path}.adjustment is required for adjustment transactions`);
  if (value.creditCardEvent !== undefined) {
    enumValue(
      value.creditCardEvent,
      ['statement', 'purchase', 'payment'] as const,
      `${path}.creditCardEvent`,
      errors,
    );
    if (value.creditCardEvent === 'payment' && value.kind !== 'transfer')
      errors.push(`${path}.creditCardEvent=payment requires kind=transfer`);
    if (
      (value.creditCardEvent === 'statement' || value.creditCardEvent === 'purchase') &&
      value.kind !== 'expense' &&
      value.kind !== 'refund'
    )
      errors.push(`${path}.creditCardEvent=${value.creditCardEvent} requires kind=expense or refund`);
  }
  if (!record(value.source)) errors.push(`${path}.source must be an object`);
  else {
    enumValue(
      value.source.type,
      ['manual', 'csv_import', 'recurring_template', 'migration'] as const,
      `${path}.source.type`,
      errors,
    );
    if (value.source.importId !== undefined)
      id(value.source.importId, `${path}.source.importId`, errors);
    if (value.source.sourceTransactionId !== undefined)
      text(value.source.sourceTransactionId, `${path}.source.sourceTransactionId`, errors);
  }
  enumValue(value.status, ['draft', 'posted', 'excluded'] as const, `${path}.status`, errors);
  if (value.notes !== undefined) text(value.notes, `${path}.notes`, errors, true);
  text(value.createdByUid, `${path}.createdByUid`, errors);
  isoDateTime(value.createdAt, `${path}.createdAt`, errors);
  text(value.updatedByUid, `${path}.updatedByUid`, errors);
  isoDateTime(value.updatedAt, `${path}.updatedAt`, errors);
  return true;
}

function validatePeriod(
  value: unknown,
  path: string,
  memberIds: Set<string>,
  poolIds: Set<string>,
  configIds: Set<string>,
  settlementIds: Set<string>,
  errors: string[],
): value is SettlementPeriod {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  text(value.name, `${path}.name`, errors);
  isoDateTime(value.startDate, `${path}.startDate`, errors);
  isoDateTime(value.endDate, `${path}.endDate`, errors);
  enumValue(value.status, ['open', 'reviewed', 'finalized'] as const, `${path}.status`, errors);
  if (array(value.includedSettlementPoolIds, `${path}.includedSettlementPoolIds`, errors)) {
    const seen = new Set<string>();
    for (const [i, ref] of value.includedSettlementPoolIds.entries()) {
      id(ref, `${path}.includedSettlementPoolIds[${i}]`, errors);
      if (typeof ref === 'string' && !poolIds.has(ref))
        errors.push(`${path}.includedSettlementPoolIds[${i}] references an unknown pool`);
      if (typeof ref === 'string' && seen.has(ref))
        errors.push(`${path}.includedSettlementPoolIds contains duplicate ${ref}`);
      if (typeof ref === 'string') seen.add(ref);
    }
  }
  if (record(value.contributionConfig))
    for (const [memberId, item] of Object.entries(value.contributionConfig)) {
      if (!memberIds.has(memberId))
        errors.push(`${path}.contributionConfig.${memberId} references an unknown member`);
      if (!record(item)) errors.push(`${path}.contributionConfig.${memberId} must be an object`);
      else cents(item.amountCents, `${path}.contributionConfig.${memberId}.amountCents`, errors);
    }
  else errors.push(`${path}.contributionConfig must be an object`);
  id(value.configVersionId, `${path}.configVersionId`, errors);
  if (typeof value.configVersionId === 'string' && !configIds.has(value.configVersionId))
    errors.push(`${path}.configVersionId references an unknown config`);
  if (value.finalizedSettlementId !== undefined) {
    id(value.finalizedSettlementId, `${path}.finalizedSettlementId`, errors);
    if (
      typeof value.finalizedSettlementId === 'string' &&
      !settlementIds.has(value.finalizedSettlementId)
    )
      errors.push(`${path}.finalizedSettlementId references an unknown settlement`);
  }
  isoDateTime(value.createdAt, `${path}.createdAt`, errors);
  text(value.createdByUid, `${path}.createdByUid`, errors);
  isoDateTime(value.updatedAt, `${path}.updatedAt`, errors);
  text(value.updatedByUid, `${path}.updatedByUid`, errors);
  if (value.finalizedAt !== undefined)
    isoDateTime(value.finalizedAt, `${path}.finalizedAt`, errors);
  return true;
}

function validateFinalizedSettlement(
  value: unknown,
  path: string,
  memberIds: Set<string>,
  periodIds: Set<string>,
  configIds: Set<string>,
  poolIds: Set<string>,
  transactionIds: Set<string>,
  settlementIds: Set<string>,
  errors: string[],
): value is FinalizedSettlement {
  if (!record(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  id(value.id, `${path}.id`, errors);
  id(value.settlementPeriodId, `${path}.settlementPeriodId`, errors);
  if (typeof value.settlementPeriodId === 'string' && !periodIds.has(value.settlementPeriodId))
    errors.push(`${path}.settlementPeriodId references an unknown period`);
  safeInteger(value.version, `${path}.version`, errors);
  if (value.supersedesSettlementId !== undefined) {
    id(value.supersedesSettlementId, `${path}.supersedesSettlementId`, errors);
    if (
      typeof value.supersedesSettlementId === 'string' &&
      !settlementIds.has(value.supersedesSettlementId)
    )
      errors.push(`${path}.supersedesSettlementId references an unknown settlement`);
  }
  if (value.supersededBySettlementId !== undefined) {
    id(value.supersededBySettlementId, `${path}.supersededBySettlementId`, errors);
    if (
      typeof value.supersededBySettlementId === 'string' &&
      !settlementIds.has(value.supersededBySettlementId)
    )
      errors.push(`${path}.supersededBySettlementId references an unknown settlement`);
  }
  id(value.configVersionId, `${path}.configVersionId`, errors);
  if (typeof value.configVersionId === 'string' && !configIds.has(value.configVersionId))
    errors.push(`${path}.configVersionId references an unknown config`);
  cents(value.householdExpenseCents, `${path}.householdExpenseCents`, errors);
  if (record(value.members))
    for (const [memberId, item] of Object.entries(value.members)) {
      if (!memberIds.has(memberId))
        errors.push(`${path}.members.${memberId} references an unknown member`);
      if (!record(item)) {
        errors.push(`${path}.members.${memberId} must be an object`);
        continue;
      }
      for (const key of [
        'responsibilityCents',
        'regularContributionCents',
        'personalPaymentsCents',
        'reimbursementsCents',
        'adjustmentsCents',
        'amountToTransferCents',
      ] as const)
        cents(item[key], `${path}.members.${memberId}.${key}`, errors, key === 'adjustmentsCents');
    }
  else errors.push(`${path}.members must be an object`);
  if (array(value.transactionIds, `${path}.transactionIds`, errors))
    for (const [i, ref] of value.transactionIds.entries()) {
      id(ref, `${path}.transactionIds[${i}]`, errors);
      if (typeof ref === 'string' && !transactionIds.has(ref))
        errors.push(`${path}.transactionIds[${i}] references an unknown transaction`);
    }
  if (array(value.includedSettlementPoolIds, `${path}.includedSettlementPoolIds`, errors))
    for (const [i, ref] of value.includedSettlementPoolIds.entries()) {
      id(ref, `${path}.includedSettlementPoolIds[${i}]`, errors);
      if (typeof ref === 'string' && !poolIds.has(ref))
        errors.push(`${path}.includedSettlementPoolIds[${i}] references an unknown pool`);
    }
  safeInteger(
    value.reconciliation && record(value.reconciliation)
      ? value.reconciliation.differenceCents
      : undefined,
    `${path}.reconciliation.differenceCents`,
    errors,
  );
  if (!record(value.reconciliation)) errors.push(`${path}.reconciliation must be an object`);
  else {
    booleanValue(value.reconciliation.valid, `${path}.reconciliation.valid`, errors);
    if (array(value.reconciliation.messages, `${path}.reconciliation.messages`, errors))
      for (const [i, msg] of value.reconciliation.messages.entries())
        text(msg, `${path}.reconciliation.messages[${i}]`, errors, true);
  }
  text(value.engineVersion, `${path}.engineVersion`, errors);
  isoDateTime(value.calculatedAt, `${path}.calculatedAt`, errors);
  isoDateTime(value.finalizedAt, `${path}.finalizedAt`, errors);
  text(value.finalizedByUid, `${path}.finalizedByUid`, errors);
  return true;
}

/** Validate all records and all references in a backup without invoking Firebase. */
export function validateBudgetExport(input: unknown): ExportValidationResult {
  const errors: string[] = [];
  if (!record(input))
    return {
      valid: false,
      errors: ['export must be an object'],
      issues: ['export must be an object'],
    };
  if (input.format !== 'household-budget-export')
    errors.push('format must be household-budget-export');
  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  isoDateTime(input.exportedAt, 'exportedAt', errors);
  text(input.appVersion, 'appVersion', errors);
  validateHousehold(input.household, 'household', errors);
  const members = array(input.members, 'members', errors) ? input.members : [];
  const accounts = array(input.accounts, 'accounts', errors) ? input.accounts : [];
  const categories = array(input.categories, 'categories', errors) ? input.categories : [];
  const projects = array(input.projects, 'projects', errors) ? input.projects : [];
  const pools = array(input.settlementPools, 'settlementPools', errors)
    ? input.settlementPools
    : [];
  const configs = array(input.configHistory, 'configHistory', errors) ? input.configHistory : [];
  const transactions = array(input.transactions, 'transactions', errors) ? input.transactions : [];
  const periods = array(input.settlementPeriods, 'settlementPeriods', errors)
    ? input.settlementPeriods
    : [];
  const settlements = array(input.settlements, 'settlements', errors) ? input.settlements : [];
  const memberIds = duplicateIds(members, 'members', errors);
  const accountIds = duplicateIds(accounts, 'accounts', errors);
  const categoryIds = duplicateIds(categories, 'categories', errors);
  const projectIds = duplicateIds(projects, 'projects', errors);
  const poolIds = duplicateIds(pools, 'settlementPools', errors);
  const configIds = duplicateIds(configs, 'configHistory', errors);
  const transactionIds = duplicateIds(transactions, 'transactions', errors);
  const periodIds = duplicateIds(periods, 'settlementPeriods', errors);
  const settlementIds = duplicateIds(settlements, 'settlements', errors);
  members.forEach((v, i) => validateMember(v, `members[${i}]`, errors));
  accounts.forEach((v, i) => validateAccount(v, `accounts[${i}]`, memberIds, errors));
  categories.forEach((v, i) => validateCategory(v, `categories[${i}]`, categoryIds, errors));
  projects.forEach((v, i) => validateProject(v, `projects[${i}]`, poolIds, errors));
  pools.forEach((v, i) => validatePool(v, `settlementPools[${i}]`, errors));
  validateConfig(input.currentConfig, 'currentConfig', memberIds, poolIds, errors);
  configs.forEach((v, i) => validateConfig(v, `configHistory[${i}]`, memberIds, poolIds, errors));
  if (
    record(input.currentConfig) &&
    typeof input.currentConfig.id === 'string' &&
    !configIds.has(input.currentConfig.id)
  )
    errors.push('currentConfig.id must be present in configHistory');
  transactions.forEach((v, i) =>
    validateTransaction(
      v,
      `transactions[${i}]`,
      memberIds,
      accountIds,
      categoryIds,
      projectIds,
      poolIds,
      periodIds,
      transactionIds,
      errors,
    ),
  );
  periods.forEach((v, i) =>
    validatePeriod(
      v,
      `settlementPeriods[${i}]`,
      memberIds,
      poolIds,
      configIds,
      settlementIds,
      errors,
    ),
  );
  settlements.forEach((v, i) =>
    validateFinalizedSettlement(
      v,
      `settlements[${i}]`,
      memberIds,
      periodIds,
      configIds,
      poolIds,
      transactionIds,
      settlementIds,
      errors,
    ),
  );
  const templates = array(input.recurringTemplates, 'recurringTemplates', errors)
    ? input.recurringTemplates
    : [];
  duplicateIds(templates, 'recurringTemplates', errors);
  templates.forEach((v, i) =>
    validateRecurringTemplate(
      v,
      `recurringTemplates[${i}]`,
      memberIds,
      accountIds,
      categoryIds,
      projectIds,
      poolIds,
      errors,
    ),
  );
  if (input.auditLog !== undefined && !array(input.auditLog, 'auditLog', errors)) {
    /* error already recorded */
  }
  // Historical snapshots cannot be edited to add a forward link. Starting
  // at the period's current snapshot, walk supersedesSettlementId backwards
  // and require every snapshot for that period to be in that immutable chain.
  for (const rawPeriod of periods)
    if (record(rawPeriod) && typeof rawPeriod.finalizedSettlementId === 'string') {
      const current = settlements.find(
        (s) => record(s) && s.id === rawPeriod.finalizedSettlementId,
      ) as UnknownRecord | undefined;
      const visited = new Set<string>();
      let cursor = current;
      while (cursor && typeof cursor.id === 'string' && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        if (cursor.supersedesSettlementId === undefined) break;
        if (typeof cursor.supersedesSettlementId !== 'string') break;
        cursor = settlements.find((s) => record(s) && s.id === cursor?.supersedesSettlementId) as
          UnknownRecord | undefined;
        if (!cursor)
          errors.push(
            `settlement chain for period ${rawPeriod.id} references a missing predecessor`,
          );
      }
      for (const rawSettlement of settlements)
        if (
          record(rawSettlement) &&
          rawSettlement.settlementPeriodId === rawPeriod.id &&
          typeof rawSettlement.id === 'string' &&
          !visited.has(rawSettlement.id)
        )
          errors.push(
            `settlement ${rawSettlement.id} is outside the period's current immutable history chain`,
          );
    }
  return { valid: errors.length === 0, errors, issues: errors };
}

export function assertValidBudgetExport(input: unknown): asserts input is BudgetExportV1 {
  const result = validateBudgetExport(input);
  if (!result.valid) throw new ExportValidationError(result.errors);
}

/** Serialize only validated domain values; JSON.stringify cannot carry Firebase objects. */
export function serializeBudgetExport(value: BudgetExportV1, space: number | string = 2): string {
  assertValidBudgetExport(value);
  return JSON.stringify(value, null, space);
}

export function parseBudgetExport(serialized: string): BudgetExportCurrent {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new ExportValidationError([
      `JSON parse failed: ${error instanceof Error ? error.message : 'invalid JSON'}`,
    ]);
  }
  return migrateExport(value);
}

/** Migrations are deliberately explicit. Unknown and future versions never silently downgrade. */
export function migrateExport(input: unknown): BudgetExportCurrent {
  if (!record(input)) throw new ExportValidationError(['export must be an object']);
  if (input.schemaVersion !== CURRENT_EXPORT_SCHEMA_VERSION) {
    if (
      typeof input.schemaVersion === 'number' &&
      input.schemaVersion > CURRENT_EXPORT_SCHEMA_VERSION
    )
      throw new ExportValidationError([`unsupported future schemaVersion ${input.schemaVersion}`]);
    throw new ExportValidationError([`unsupported schemaVersion ${String(input.schemaVersion)}`]);
  }
  assertValidBudgetExport(input);
  return input;
}

function csvCell(value: unknown): string {
  const raw =
    value === undefined || value === null ? '' : typeof value === 'string' ? value : String(value);
  const protectedValue = FORMULA_PREFIX.test(raw.trimStart()) ? `'${raw}` : raw;
  return /[",\r\n]/.test(protectedValue)
    ? `"${protectedValue.replaceAll('"', '""')}"`
    : protectedValue;
}

export function escapeSpreadsheetCell(value: unknown): string {
  return csvCell(value);
}

function csv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function transactionsToCsv(transactions: readonly Transaction[]): string {
  const header = [
    'ID',
    'Economic date',
    'Settlement period',
    'Description',
    'Amount cents',
    'Kind',
    'Account',
    'Payment source',
    'Category',
    'Project',
    'Settlement pool',
    'Allocations',
    'Importance',
    'Status',
    'Notes',
  ];
  const rows = transactions.map((tx) => [
    tx.id,
    tx.economicDate,
    tx.settlementPeriodId,
    tx.description,
    tx.amountCents,
    tx.kind,
    tx.accountId,
    JSON.stringify(tx.paymentSource ?? ''),
    tx.categoryId,
    tx.projectId,
    tx.settlementPoolId,
    JSON.stringify(tx.allocations),
    tx.importance,
    tx.status,
    tx.notes,
  ]);
  return csv([header, ...rows]);
}

export function settlementsToCsv(settlements: readonly FinalizedSettlement[]): string {
  const header = [
    'Settlement ID',
    'Period ID',
    'Version',
    'Config version',
    'Finalized at',
    'Household expense cents',
    'Member ID',
    'Responsibility cents',
    'Regular contribution cents',
    'Personal payments cents',
    'Reimbursements cents',
    'Adjustments cents',
    'Amount to transfer cents',
    'Settlement pools',
    'Transaction IDs',
  ];
  const rows: unknown[][] = [];
  for (const settlement of settlements)
    for (const [memberId, member] of Object.entries(settlement.members))
      rows.push([
        settlement.id,
        settlement.settlementPeriodId,
        settlement.version,
        settlement.configVersionId,
        settlement.finalizedAt,
        settlement.householdExpenseCents,
        memberId,
        member.responsibilityCents,
        member.regularContributionCents,
        member.personalPaymentsCents,
        member.reimbursementsCents,
        member.adjustmentsCents,
        member.amountToTransferCents,
        JSON.stringify(settlement.includedSettlementPoolIds),
        JSON.stringify(settlement.transactionIds),
      ]);
  return csv([header, ...rows]);
}

// Friendly aliases for callers that use “export” as the verb.
export const exportTransactionsCsv = transactionsToCsv;
export const exportSettlementsCsv = settlementsToCsv;
