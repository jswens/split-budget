import { describe, expect, it } from 'vitest';
import type { BudgetExportV1 } from './export';
import {
  assertValidBudgetExport,
  migrateExport,
  parseBudgetExport,
  serializeBudgetExport,
  settlementsToCsv,
  transactionsToCsv,
  validateBudgetExport,
} from './export';

const at = '2026-01-01T00:00:00.000Z';
const allocation = [
  { memberId: 'm-john', shareBasisPoints: 6000 },
  { memberId: 'm-blaire', shareBasisPoints: 4000 },
];

/** Fixture N: portable state with every persisted collection represented. */
function fixtureN(): BudgetExportV1 {
  const household = {
    id: 'h-1',
    name: 'Example household',
    currency: 'USD' as const,
    timezone: 'America/New_York',
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at,
  };
  const members = [
    {
      id: 'm-john',
      authUid: 'auth-john',
      displayName: 'John',
      role: 'owner' as const,
      active: true,
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'm-blaire',
      authUid: 'auth-blaire',
      displayName: 'Blaire',
      role: 'member' as const,
      active: true,
      createdAt: at,
      updatedAt: at,
    },
  ];
  const pools = [{ id: 'pool-operating', name: 'Operating', active: true }];
  const config = {
    id: 'config-1',
    version: 1,
    defaultAllocations: allocation.map((item) => ({ ...item })),
    monthlyContributions: { 'm-john': 200000, 'm-blaire': 120000 },
    defaultSettlementPoolId: 'pool-operating',
    effectiveFrom: at,
    createdAt: at,
    createdByUid: 'auth-john',
  };
  const transaction = {
    id: 'tx-mortgage',
    economicDate: at,
    description: 'Mortgage',
    amountCents: 434700,
    kind: 'expense' as const,
    accountId: 'account-joint',
    categoryId: 'category-housing',
    settlementPoolId: 'pool-operating',
    paymentSource: { type: 'joint' as const, accountId: 'account-joint' },
    allocations: allocation.map((item) => ({ ...item })),
    importance: 'major' as const,
    settlementPeriodId: 'period-jan',
    source: { type: 'manual' as const },
    status: 'posted' as const,
    createdByUid: 'auth-john',
    createdAt: at,
    updatedByUid: 'auth-john',
    updatedAt: at,
  };
  const period = {
    id: 'period-jan',
    name: 'January 2026',
    startDate: at,
    endDate: '2026-01-31T23:59:59.999Z',
    status: 'finalized' as const,
    includedSettlementPoolIds: ['pool-operating'],
    contributionConfig: { 'm-john': { amountCents: 200000 }, 'm-blaire': { amountCents: 120000 } },
    configVersionId: 'config-1',
    finalizedSettlementId: 'settlement-jan',
    createdAt: at,
    createdByUid: 'auth-john',
    updatedAt: at,
    updatedByUid: 'auth-john',
    finalizedAt: at,
  };
  const settlement = {
    id: 'settlement-jan',
    settlementPeriodId: 'period-jan',
    version: 1,
    configVersionId: 'config-1',
    transactionIds: ['tx-mortgage'],
    includedSettlementPoolIds: ['pool-operating'],
    householdExpenseCents: 434700,
    members: {
      'm-john': {
        responsibilityCents: 260820,
        regularContributionCents: 200000,
        personalPaymentsCents: 0,
        reimbursementsCents: 0,
        adjustmentsCents: 0,
        amountToTransferCents: 60820,
      },
      'm-blaire': {
        responsibilityCents: 173880,
        regularContributionCents: 120000,
        personalPaymentsCents: 0,
        reimbursementsCents: 0,
        adjustmentsCents: 0,
        amountToTransferCents: 53880,
      },
    },
    reconciliation: { valid: true, differenceCents: 0, messages: [] },
    engineVersion: '1',
    calculatedAt: at,
    finalizedAt: at,
    finalizedByUid: 'auth-john',
  };
  return {
    format: 'household-budget-export',
    schemaVersion: 1,
    exportedAt: at,
    appVersion: '0.1.0',
    household,
    members,
    accounts: [
      {
        id: 'account-joint',
        name: 'Joint checking',
        ownerType: 'joint',
        type: 'checking',
        active: true,
        createdAt: at,
        updatedAt: at,
      },
    ],
    categories: [{ id: 'category-housing', name: 'Housing', type: 'expense', active: true }],
    projects: [],
    settlementPools: pools,
    currentConfig: config,
    configHistory: [config],
    transactions: [transaction],
    settlementPeriods: [period],
    settlements: [settlement],
    recurringTemplates: [],
    auditLog: [],
  };
}

describe('portable budget export', () => {
  it('round trips fixture N without changing IDs or references', () => {
    const original = fixtureN();
    expect(validateBudgetExport(original).valid).toBe(true);
    const restored = parseBudgetExport(serializeBudgetExport(original));
    expect(restored).toEqual(original);
    expect(restored.transactions[0].settlementPeriodId).toBe('period-jan');
    expect(restored.settlements[0].transactionIds).toEqual(['tx-mortgage']);
  });

  it('rejects duplicate IDs, missing references, unsafe cents, and future versions', () => {
    const duplicate = fixtureN();
    duplicate.members = [...duplicate.members, duplicate.members[0]];
    expect(
      validateBudgetExport(duplicate).errors.some((error) => error.includes('duplicates')),
    ).toBe(true);
    const missing = fixtureN();
    missing.transactions[0].accountId = 'account-does-not-exist';
    expect(() => assertValidBudgetExport(missing)).toThrow(/unknown record/);
    const unsafe = fixtureN();
    unsafe.transactions[0].amountCents = Number.MAX_SAFE_INTEGER + 1;
    expect(() => assertValidBudgetExport(unsafe)).toThrow(/safe integer/);
    const future = { ...fixtureN(), schemaVersion: 2 };
    expect(() => migrateExport(future)).toThrow(/future schemaVersion/);
  });

  it('checks the shape and references of every typed entity', () => {
    const cases: Array<[string, (value: BudgetExportV1) => void, RegExp]> = [
      ['household currency', (value) => (value.household.currency = 'CAD' as never), /currency/],
      ['member active flag', (value) => (value.members[0].active = 'yes' as never), /active/],
      [
        'account owner reference',
        (value) => {
          value.accounts[0].ownerType = 'member';
          value.accounts[0].ownerMemberId = 'missing';
        },
        /ownerMemberId/,
      ],
      [
        'category parent reference',
        (value) => (value.categories[0].parentCategoryId = 'missing'),
        /parentCategoryId/,
      ],
      [
        'project pool reference',
        (value) =>
          value.projects.push({
            id: 'project-1',
            name: 'Project',
            status: 'active',
            defaultSettlementPoolId: 'missing',
            createdAt: at,
          }),
        /defaultSettlementPoolId/,
      ],
      ['pool active flag', (value) => (value.settlementPools[0].active = 'yes' as never), /active/],
      [
        'configuration allocation total',
        (value) => (value.currentConfig.defaultAllocations[0].shareBasisPoints = 5000),
        /10000/,
      ],
      [
        'transaction status',
        (value) => (value.transactions[0].status = 'unknown' as never),
        /status/,
      ],
      [
        'period config reference',
        (value) => (value.settlementPeriods[0].configVersionId = 'missing'),
        /configVersionId/,
      ],
      [
        'settlement reconciliation',
        (value) =>
          (value.settlements[0].reconciliation.differenceCents = Number.MAX_SAFE_INTEGER + 1),
        /safe integer/,
      ],
      [
        'recurring template shape',
        (value) => value.recurringTemplates.push({ id: 'template-1' } as never),
        /name/,
      ],
    ];
    for (const [, mutate, message] of cases) {
      const value = fixtureN();
      mutate(value);
      expect(() => assertValidBudgetExport(value)).toThrow(message);
    }
  });

  it('escapes formula cells in transaction and settlement CSV', () => {
    const value = fixtureN();
    value.transactions[0].description = '=HYPERLINK("https://example.invalid")';
    const transactionCsv = transactionsToCsv(value.transactions);
    expect(transactionCsv).toContain("'=HYPERLINK");
    const settlementCsv = settlementsToCsv(value.settlements);
    expect(settlementCsv).toContain('settlement-jan');
    expect(settlementCsv.endsWith('\r\n')).toBe(true);
  });

  it('round trips immutable predecessor and current settlement snapshots', () => {
    const value = fixtureN();
    const predecessor = value.settlements[0];
    const current = {
      ...predecessor,
      id: 'settlement-jan-v2',
      version: 2,
      supersedesSettlementId: predecessor.id,
    };
    value.settlementPeriods[0].finalizedSettlementId = current.id;
    value.settlements.push(current);
    expect(validateBudgetExport(value).valid).toBe(true);
    expect(parseBudgetExport(serializeBudgetExport(value)).settlements).toHaveLength(2);
  });
});
