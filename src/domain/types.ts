// Canonical domain types for the first implementation.
// This module intentionally contains no Firebase, React, or browser imports.

export type Id = string;
export type IsoDateTime = string;
export type MoneyCents = number;
export type BasisPoints = number;

export type MemberRole = "owner" | "member";
export type OwnerType = "member" | "joint";
export type AccountType =
  | "checking"
  | "savings"
  | "credit_card"
  | "venmo"
  | "cash"
  | "other";

export type CreditCardTrackingMode = "statement" | "transactions";

export interface Allocation {
  memberId: Id;
  shareBasisPoints: BasisPoints;
}

export interface Household {
  id: Id;
  name: string;
  currency: "USD";
  timezone: string;
  schemaVersion: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface HouseholdMember {
  id: Id;
  authUid: string;
  displayName: string;
  role: MemberRole;
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Account {
  id: Id;
  name: string;
  ownerType: OwnerType;
  ownerMemberId?: Id;
  type: AccountType;
  institution?: string;
  trackingMode?: CreditCardTrackingMode;
  active: boolean;
  notes?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Category {
  id: Id;
  name: string;
  parentCategoryId?: Id;
  type: "expense" | "income" | "transfer";
  active: boolean;
  sortOrder?: number;
}

export interface Project {
  id: Id;
  name: string;
  status: "active" | "completed" | "archived";
  defaultSettlementPoolId?: Id;
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime;
}

export interface SettlementPool {
  id: Id;
  name: string;
  active: boolean;
  description?: string;
}

export interface HouseholdConfigVersion {
  id: Id;
  version: number;
  defaultAllocations: Allocation[];
  monthlyContributions: Record<Id, MoneyCents>;
  defaultSettlementPoolId: Id;
  effectiveFrom: IsoDateTime;
  createdAt: IsoDateTime;
  createdByUid: string;
  reason?: string;
}

export type TransactionKind =
  | "expense"
  | "refund"
  | "reimbursement"
  | "transfer"
  | "adjustment";

export type TransactionStatus = "draft" | "posted" | "excluded";

export type PaymentSource =
  | { type: "joint"; accountId: Id }
  | { type: "member"; memberId: Id; accountId?: Id }
  | { type: "third_party" };

export type CreditCardEvent = "statement" | "purchase" | "payment";

export interface ReimbursementDetails {
  receivedByMemberId?: Id;
  treatment: "reduce_expense" | "received_on_behalf_of_household";
  relatedTransactionIds?: Id[];
  sourceDescription?: string;
}

export interface TransferDetails {
  fromAccountId: Id;
  toAccountId: Id;
}

export interface AdjustmentDetails {
  memberId?: Id;
  reason: string;
  effectCents: MoneyCents; // signed: positive adds obligation, negative reduces it
}

export interface TransactionSource {
  type: "manual" | "csv_import" | "recurring_template" | "migration";
  importId?: Id;
  sourceTransactionId?: string;
}

export interface Transaction {
  id: Id;
  economicDate: IsoDateTime;
  description: string;
  amountCents: MoneyCents; // positive magnitude; kind determines economic sign
  kind: TransactionKind;

  accountId?: Id;
  categoryId?: Id;
  projectId?: Id;
  settlementPoolId: Id;

  paymentSource?: PaymentSource;
  allocations: Allocation[];

  importance: "normal" | "major";
  settlementPeriodId?: Id;

  reimbursement?: ReimbursementDetails;
  transfer?: TransferDetails;
  adjustment?: AdjustmentDetails;

  // Optional discriminator used when a credit-card account can represent a
  // statement, purchase, or payment. It is optional for old imported data.
  creditCardEvent?: CreditCardEvent;

  source: TransactionSource;
  status: TransactionStatus;
  notes?: string;

  createdByUid: string;
  createdAt: IsoDateTime;
  updatedByUid: string;
  updatedAt: IsoDateTime;
}

export interface SettlementPeriod {
  id: Id;
  name: string;
  startDate: IsoDateTime;
  endDate: IsoDateTime;
  status: "open" | "reviewed" | "finalized";
  includedSettlementPoolIds: Id[];
  contributionConfig: Record<Id, { amountCents: MoneyCents }>;
  configVersionId: Id;
  finalizedSettlementId?: Id;
  createdAt: IsoDateTime;
  createdByUid: string;
  updatedAt: IsoDateTime;
  updatedByUid: string;
  finalizedAt?: IsoDateTime;
}

export interface PersonSettlement {
  responsibilityCents: MoneyCents;
  regularContributionCents: MoneyCents;
  personalPaymentsCents: MoneyCents;
  reimbursementsCents: MoneyCents;
  adjustmentsCents: MoneyCents;
  amountToTransferCents: MoneyCents;
}

export interface SettlementResult {
  householdExpenseCents: MoneyCents;
  members: Record<Id, PersonSettlement>;
  reconciliation: {
    valid: boolean;
    differenceCents: MoneyCents;
    messages: string[];
  };
}

export interface FinalizedSettlement extends SettlementResult {
  id: Id;
  settlementPeriodId: Id;
  version: number;
  supersedesSettlementId?: Id;
  supersededBySettlementId?: Id;
  configVersionId: Id;
  transactionIds: Id[];
  includedSettlementPoolIds: Id[];
  engineVersion: string;
  calculatedAt: IsoDateTime;
  finalizedAt: IsoDateTime;
  finalizedByUid: string;
}

export interface RecurringTemplate {
  id: Id;
  name: string;
  description: string;
  estimatedAmountCents?: MoneyCents;
  categoryId?: Id;
  projectId?: Id;
  settlementPoolId: Id;
  paymentSource?: PaymentSource;
  allocations: Allocation[];
  importance: "normal" | "major";
  frequency: "monthly";
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface RecurringGenerationSource {
  templateId: Id;
  settlementPeriodId: Id;
  generationKey: string;
}

export interface BudgetRepository {
  getHousehold(householdId: Id): Promise<Household>;
  getMembers(householdId: Id): Promise<HouseholdMember[]>;
  getAccounts(householdId: Id): Promise<Account[]>;
  getCategories(householdId: Id): Promise<Category[]>;
  getProjects(householdId: Id): Promise<Project[]>;
  getSettlementPools(householdId: Id): Promise<SettlementPool[]>;
  getCurrentConfig(householdId: Id): Promise<HouseholdConfigVersion>;
  getConfigVersion(householdId: Id, versionId: Id): Promise<HouseholdConfigVersion>;
  getSettlementPeriod(householdId: Id, periodId: Id): Promise<SettlementPeriod>;
  listSettlementPeriods(householdId: Id): Promise<SettlementPeriod[]>;
  listTransactionsForPeriod(householdId: Id, periodId: Id): Promise<Transaction[]>;
  getTransaction(householdId: Id, transactionId: Id): Promise<Transaction>;
  saveTransaction(householdId: Id, transaction: Transaction): Promise<void>;
  getFinalizedSettlementForPeriod(householdId: Id, periodId: Id): Promise<FinalizedSettlement | null>;
}
