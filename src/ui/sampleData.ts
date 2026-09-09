import type { BudgetExportV1 } from '../domain/export';
import type { Transaction } from '../domain/types';

/** Synthetic demonstration data only. Actual household data never ships in the client. */
export function createSampleData(month: string): BudgetExportV1 {
  const timestamp = new Date().toISOString();
  const allocations = [{ memberId: 'demo-john', shareBasisPoints: 6000 }, { memberId: 'demo-blaire', shareBasisPoints: 4000 }];
  const config = {
    id: 'config-v1', version: 1, defaultAllocations: allocations,
    monthlyContributions: { 'demo-john': 200000, 'demo-blaire': 120000 },
    defaultSettlementPoolId: 'household-operating', effectiveFrom: '2020-01-01T00:00:00.000Z',
    createdAt: timestamp, createdByUid: 'demo-john',
  };
  const periodId = `period-${month}`;
  const transaction = (id: string, description: string, amountCents: number, day: number, extra: Partial<Transaction> = {}): Transaction => ({
    id, description, amountCents, economicDate: `${month}-${String(day).padStart(2, '0')}T12:00:00.000Z`,
    kind: 'expense', categoryId: 'household', settlementPoolId: 'household-operating',
    paymentSource: { type: 'joint', accountId: 'joint-checking' }, allocations,
    importance: 'normal', settlementPeriodId: periodId, source: { type: 'manual' }, status: 'posted',
    createdByUid: 'demo-john', updatedByUid: 'demo-john', createdAt: timestamp, updatedAt: timestamp, ...extra,
  });
  return {
    format: 'household-budget-export', schemaVersion: 1, exportedAt: timestamp, appVersion: '0.1.0',
    household: { id: 'demo-household', name: 'Our household', currency: 'USD', timezone: 'America/New_York', schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp },
    members: [
      { id: 'demo-john', authUid: 'demo-john', displayName: 'John', role: 'member', active: true, createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-blaire', authUid: 'demo-blaire', displayName: 'Blaire', role: 'member', active: true, createdAt: timestamp, updatedAt: timestamp },
    ],
    accounts: [
      { id: 'joint-checking', name: 'Joint checking', ownerType: 'joint', type: 'checking', active: true, createdAt: timestamp, updatedAt: timestamp },
      { id: 'john-checking', name: 'John checking', ownerType: 'member', ownerMemberId: 'demo-john', type: 'checking', active: true, createdAt: timestamp, updatedAt: timestamp },
      { id: 'blaire-venmo', name: 'Blaire Venmo', ownerType: 'member', ownerMemberId: 'demo-blaire', type: 'venmo', active: true, createdAt: timestamp, updatedAt: timestamp },
      { id: 'household-card', name: 'Household card', ownerType: 'joint', type: 'credit_card', trackingMode: 'statement', active: true, createdAt: timestamp, updatedAt: timestamp },
    ],
    categories: [{ id: 'household', name: 'Household', type: 'expense', active: true }, { id: 'childcare', name: 'Childcare', type: 'expense', active: true }, { id: 'utilities', name: 'Utilities', type: 'expense', active: true }],
    projects: [{ id: 'garden', name: 'Garden refresh', status: 'active', defaultSettlementPoolId: 'renovation', createdAt: timestamp }],
    settlementPools: [
      { id: 'household-operating', name: 'Household operating', active: true },
      { id: 'renovation', name: 'Renovation', active: true },
      { id: 'excluded', name: 'Excluded', active: true },
    ],
    currentConfig: config, configHistory: [config],
    settlementPeriods: [{ id: periodId, name: month, startDate: `${month}-01T00:00:00.000Z`, endDate: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0, 23, 59, 59, 999)).toISOString(), status: 'open', includedSettlementPoolIds: ['household-operating'], contributionConfig: { 'demo-john': { amountCents: 200000 }, 'demo-blaire': { amountCents: 120000 } }, configVersionId: config.id, createdAt: timestamp, updatedAt: timestamp, createdByUid: 'demo-john', updatedByUid: 'demo-john' }],
    transactions: [
      transaction('sample-home', 'Monthly home payment', 320000, 1),
      transaction('sample-groceries', 'Shared groceries', 72000, 3, { paymentSource: { type: 'member', memberId: 'demo-john', accountId: 'john-checking' } }),
      transaction('sample-childcare', 'After-school care', 48000, 4, { categoryId: 'childcare', paymentSource: { type: 'member', memberId: 'demo-blaire', accountId: 'blaire-venmo' } }),
      transaction('sample-power', 'Electricity', 18650, 5, { categoryId: 'utilities' }),
      transaction('sample-garden', 'Garden materials', 62500, 6, { projectId: 'garden', settlementPoolId: 'renovation', importance: 'major' }),
      transaction('sample-cleaners', 'Cleaners', 20000, 8, { status: 'draft', source: { type: 'recurring_template', sourceTransactionId: 'cleaners-template' } }),
    ],
    settlements: [],
    recurringTemplates: [{ id: 'cleaners-template', name: 'Cleaners', description: 'Cleaners', estimatedAmountCents: 20000, categoryId: 'household', settlementPoolId: 'household-operating', paymentSource: { type: 'joint', accountId: 'joint-checking' }, allocations, importance: 'normal', frequency: 'monthly', active: true, createdAt: timestamp, updatedAt: timestamp }],
    auditLog: [],
  };
}
