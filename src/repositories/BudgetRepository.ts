import type {
  Account,
  Category,
  FinalizedSettlement,
  Household,
  HouseholdConfigVersion,
  HouseholdMember,
  Id,
  Project,
  RecurringTemplate,
  SettlementPeriod,
  SettlementPool,
  Transaction,
} from "../domain/types";

export interface AuditEvent {
  id: Id;
  eventType: string;
  entityType: string;
  entityId: Id;
  performedByUid: string;
  timestamp: string;
  summary: string;
  changes?: Record<string, { from?: unknown; to?: unknown }>;
}

export interface TransactionDateQuery {
  from?: string;
  to?: string;
}

/** Persistence boundary used by both the local emulator adapter and Firestore. */
export interface BudgetRepository {
  getHousehold(householdId: Id): Promise<Household>;
  saveHousehold(household: Id, value: Household): Promise<void>;
  getMembers(householdId: Id): Promise<HouseholdMember[]>;
  saveMember(householdId: Id, value: HouseholdMember): Promise<void>;
  getAccounts(householdId: Id): Promise<Account[]>;
  saveAccount(householdId: Id, value: Account): Promise<void>;
  getCategories(householdId: Id): Promise<Category[]>;
  saveCategory(householdId: Id, value: Category): Promise<void>;
  getProjects(householdId: Id): Promise<Project[]>;
  saveProject(householdId: Id, value: Project): Promise<void>;
  getSettlementPools(householdId: Id): Promise<SettlementPool[]>;
  saveSettlementPool(householdId: Id, value: SettlementPool): Promise<void>;

  getCurrentConfig(householdId: Id): Promise<HouseholdConfigVersion>;
  getConfigForDate?(householdId: Id, effectiveAt: string): Promise<HouseholdConfigVersion>;
  getConfigVersion(householdId: Id, versionId: Id): Promise<HouseholdConfigVersion>;
  saveConfig(householdId: Id, value: HouseholdConfigVersion, reason?: string): Promise<void>;
  listConfigHistory(householdId: Id): Promise<HouseholdConfigVersion[]>;

  getSettlementPeriod(householdId: Id, periodId: Id): Promise<SettlementPeriod>;
  listSettlementPeriods(householdId: Id): Promise<SettlementPeriod[]>;
  saveSettlementPeriod(householdId: Id, value: SettlementPeriod, expectedUpdatedAt?: string): Promise<void>;
  /** Optional atomic write used by month bootstrap/finalization adapters. */
  saveBootstrap?(householdId: Id, period: SettlementPeriod, transactions: Transaction[]): Promise<void>;
  commitFinalization?(householdId: Id, settlement: FinalizedSettlement, period: SettlementPeriod, audit: AuditEvent, expectedPeriodUpdatedAt: string): Promise<void>;

  listTransactionsForPeriod(householdId: Id, periodId: Id): Promise<Transaction[]>;
  getTransaction(householdId: Id, transactionId: Id): Promise<Transaction>;
  saveTransaction(householdId: Id, transaction: Transaction, expectedUpdatedAt?: string): Promise<void>;
  archiveTransaction(householdId: Id, transactionId: Id, actorUid: string, reason?: string): Promise<void>;
  listTransactionsByProject(householdId: Id, projectId: Id): Promise<Transaction[]>;
  listTransactionsByAccount(householdId: Id, accountId: Id, range?: TransactionDateQuery): Promise<Transaction[]>;
  listTransactionsByCategory(householdId: Id, categoryId: Id, range?: TransactionDateQuery): Promise<Transaction[]>;

  getFinalizedSettlementForPeriod(householdId: Id, periodId: Id): Promise<FinalizedSettlement | null>;
  saveSettlement(householdId: Id, value: FinalizedSettlement): Promise<void>;
  getSettlement(householdId: Id, settlementId: Id): Promise<FinalizedSettlement>;

  getRecurringTemplates(householdId: Id): Promise<RecurringTemplate[]>;
  saveRecurringTemplate(householdId: Id, value: RecurringTemplate): Promise<void>;
  listAuditLog(householdId: Id): Promise<AuditEvent[]>;
  appendAuditEvent(householdId: Id, value: AuditEvent): Promise<void>;

  /** Returns every portable household collection, with ISO strings only. */
  exportAll(householdId: Id): Promise<import("../services/export").BudgetExportV1>;
  /** Must validate all references before writing anything. */
  restoreAll(householdId: Id, value: import("../services/export").BudgetExportV1, actorUid: string): Promise<void>;
  restoreIntoProvisionedHousehold?(householdId: Id, value: import("../services/export").BudgetExportV1, actorUid: string): Promise<void>;
}
