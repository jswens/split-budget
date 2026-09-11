import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Archive, BarChart3, BookOpen, CalendarDays, Check, ChevronDown, CircleAlert, Download, FileUp, FolderKanban, Plus, RotateCcw, Save, Settings2, ShieldCheck, Sparkles, WalletCards, X } from "lucide-react";
import type { User } from "firebase/auth";
import type { BudgetExportV1 } from "./domain/export";
import { assertValidBudgetExport, exportSettlementsCsv, exportTransactionsCsv, parseBudgetExport } from "./domain/export";
import { calculateMonthlySpendingReport } from "./domain/reporting";
import { calculateSettlement } from "./domain/settlement";
import type { Account, Category, FinalizedSettlement, HouseholdConfigVersion, HouseholdMember, Project, RecurringTemplate, SettlementPeriod, SettlementPool, Transaction, TransactionKind } from "./domain/types";
import { BudgetService } from "./services/BudgetService";
import { FirestoreBudgetRepository } from "./repositories/firestore/FirestoreBudgetRepository";
import type { BudgetRepository } from "./repositories/BudgetRepository";
import { InMemoryBudgetRepository } from "./repositories/InMemoryBudgetRepository";
import { db } from "./firebase/app";
import { observeAuth, signInWithGoogle, signOutGoogle } from "./firebase/auth";
import { getStoredHouseholdId, listPendingJoinRequests, rememberHouseholdId, type JoinRequest } from "./firebase/households";
import { createSampleData } from "./ui/sampleData";
import { download, inputMoney, money, monthLabel, parseMoney } from "./ui/format";
import { HouseholdOnboarding, JoinRequestInbox } from "./ui/HouseholdOnboarding";

type View = "ledger" | "projects" | "settings";
type SetupState = "loading" | "ready" | "auth" | "household" | "error";

interface AppData {
  household: { id: string; name: string; timezone: string };
  members: HouseholdMember[];
  accounts: Account[];
  categories: Category[];
  projects: Project[];
  pools: SettlementPool[];
  config: HouseholdConfigVersion;
  period: SettlementPeriod;
  periods: SettlementPeriod[];
  transactions: Transaction[];
  allTransactions: Transaction[];
  templates: RecurringTemplate[];
  settlement: FinalizedSettlement | null;
  settlements: FinalizedSettlement[];
}

const configured = Boolean(import.meta.env.VITE_FIREBASE_PROJECT_ID && import.meta.env.VITE_FIREBASE_API_KEY);
const defaultHouseholdId = import.meta.env.VITE_HOUSEHOLD_ID ?? "";
const previewHouseholdId = "demo-household";
const actorFallback = import.meta.env.VITE_FIREBASE_ACTOR_UID ?? "demo-john";

function currentMonth(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function readData(repository: BudgetRepository, service: BudgetService, targetHouseholdId: string, month: string, actorUid: string): Promise<AppData> {
  await service.ensureSettlementPeriodForMonth(targetHouseholdId, month, actorUid);
  const [household, members, accounts, categories, projects, pools, periods, period, transactions, templates, exported] = await Promise.all([
    repository.getHousehold(targetHouseholdId), repository.getMembers(targetHouseholdId), repository.getAccounts(targetHouseholdId), repository.getCategories(targetHouseholdId),
    repository.getProjects(targetHouseholdId), repository.getSettlementPools(targetHouseholdId), repository.listSettlementPeriods(targetHouseholdId),
    repository.getSettlementPeriod(targetHouseholdId, `period-${month}`), repository.listTransactionsForPeriod(targetHouseholdId, `period-${month}`), repository.getRecurringTemplates(targetHouseholdId), repository.exportAll(targetHouseholdId),
  ]);
  const config = await repository.getConfigVersion(targetHouseholdId, period.configVersionId);
  const settlements = exported.settlements.filter((settlement) => settlement.settlementPeriodId === period.id);
  return { household, members, accounts, categories, projects, pools, config, period, periods, transactions, allTransactions: exported.transactions, templates, settlement: settlements.sort((a, b) => b.version - a.version)[0] ?? null, settlements };
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function parseBasisPoints(input: string): number {
  const cents = parseMoney(input);
  if (cents < 0 || cents > 10000) throw new Error("Shares must be between 0% and 100%.");
  return cents;
}

function initials(name: string): string {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function poolName(pools: SettlementPool[], id: string): string {
  return pools.find((pool) => pool.id === id)?.name ?? id;
}

interface TransactionFormProps {
  transaction?: Transaction;
  data: AppData;
  actorUid: string;
  onSave: (transaction: Transaction) => Promise<void>;
  onClose: () => void;
}

function TransactionForm({ transaction, data, actorUid, onSave, onClose }: TransactionFormProps) {
  const firstTwo = data.members.slice(0, 2);
  const defaultJointAccount = data.accounts.find((account) => account.ownerType === "joint") ?? data.accounts[0];
  const dialogRef = useRef<HTMLElement>(null);
  const [kind, setKind] = useState<TransactionKind>(transaction?.kind ?? "expense");
  const [description, setDescription] = useState(transaction?.description ?? "");
  const [amount, setAmount] = useState(transaction ? inputMoney(transaction.amountCents) : "");
  const [date, setDate] = useState(transaction?.economicDate.slice(0, 10) ?? data.period.startDate.slice(0, 10));
  const [settlementPeriodId, setSettlementPeriodId] = useState(transaction?.settlementPeriodId ?? data.period.id);
  const [poolId, setPoolId] = useState(transaction?.settlementPoolId ?? data.period.includedSettlementPoolIds[0] ?? data.pools[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? data.categories[0]?.id ?? "");
  const [projectId, setProjectId] = useState(transaction?.projectId ?? "");
  const [accountId, setAccountId] = useState(transaction?.accountId ?? defaultJointAccount?.id ?? "");
  const [fundingAccountId, setFundingAccountId] = useState(transaction?.paymentSource?.type === "member" || transaction?.paymentSource?.type === "joint" ? transaction.paymentSource.accountId ?? defaultJointAccount?.id ?? "" : defaultJointAccount?.id ?? "");
  const [payer, setPayer] = useState(transaction?.paymentSource?.type === "member" ? transaction.paymentSource.memberId : transaction?.paymentSource?.type ?? "joint");
  const [treatment, setTreatment] = useState(transaction?.reimbursement?.treatment ?? "reduce_expense");
  const [recipient, setRecipient] = useState(transaction?.reimbursement?.receivedByMemberId ?? firstTwo[0]?.id ?? "");
  const [adjustmentMember, setAdjustmentMember] = useState(transaction?.adjustment?.memberId ?? "");
  const [effect, setEffect] = useState(transaction?.adjustment ? inputMoney(transaction.adjustment.effectCents) : "");
  const [reason, setReason] = useState(transaction?.adjustment?.reason ?? "");
  const [fromAccount, setFromAccount] = useState(transaction?.transfer?.fromAccountId ?? data.accounts[0]?.id ?? "");
  const [toAccount, setToAccount] = useState(transaction?.transfer?.toAccountId ?? data.accounts[1]?.id ?? data.accounts[0]?.id ?? "");
  const [major, setMajor] = useState(transaction?.importance === "major");
  const [notes, setNotes] = useState(transaction?.notes ?? "");
  const [status, setStatus] = useState<"draft" | "posted">(transaction?.status === "draft" ? "draft" : "posted");
  const [relatedTransactionIds, setRelatedTransactionIds] = useState(transaction?.reimbursement?.relatedTransactionIds?.join(", ") ?? "");
  const [sourceDescription, setSourceDescription] = useState(transaction?.reimbursement?.sourceDescription ?? "");
  const [creditCardEvent, setCreditCardEvent] = useState<"statement" | "purchase" | "payment" | "">(transaction?.creditCardEvent ?? "");
  const [shares, setShares] = useState<Record<string, string>>(() => Object.fromEntries(data.members.map((member) => [member.id, String((transaction?.allocations.find((allocation) => allocation.memberId === member.id)?.shareBasisPoints ?? data.config.defaultAllocations.find((allocation) => allocation.memberId === member.id)?.shareBasisPoints ?? 0) / 100)])));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    dialogRef.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setSaving(true);
      const amountCents = parseMoney(amount);
      const timestamp = new Date().toISOString();
      const allocations = data.members.map((member) => ({ memberId: member.id, shareBasisPoints: parseBasisPoints(shares[member.id] || "0") })).filter((allocation) => allocation.shareBasisPoints > 0);
      const base: Transaction = {
        id: transaction?.id ?? newId("tx"), economicDate: `${date}T12:00:00.000Z`, description: description.trim(), amountCents, kind,
        settlementPoolId: poolId, categoryId: kind === "transfer" ? undefined : categoryId || undefined, projectId: projectId || undefined, accountId: accountId || undefined,
        allocations: kind === "transfer" || (kind === "reimbursement" && treatment === "received_on_behalf_of_household") ? [] : allocations,
        importance: major ? "major" : "normal", settlementPeriodId, source: transaction?.source ?? { type: "manual" }, status,
        notes: notes.trim() || undefined, createdByUid: transaction?.createdByUid ?? actorUid, createdAt: transaction?.createdAt ?? timestamp, updatedByUid: actorUid, updatedAt: timestamp,
      };
      if (payer === "joint") base.paymentSource = fundingAccountId ? { type: "joint", accountId: fundingAccountId } : undefined;
      else if (payer === "third_party") base.paymentSource = { type: "third_party" };
      else base.paymentSource = { type: "member", memberId: payer, accountId: fundingAccountId || undefined };
      if (kind === "reimbursement") base.reimbursement = { treatment, receivedByMemberId: treatment === "received_on_behalf_of_household" ? recipient : undefined, relatedTransactionIds: relatedTransactionIds.split(",").map((id) => id.trim()).filter(Boolean), sourceDescription: sourceDescription.trim() || undefined };
      if (kind === "adjustment") base.adjustment = { memberId: adjustmentMember || undefined, effectCents: parseMoney(effect), reason: reason.trim() };
      if (kind === "transfer") base.transfer = { fromAccountId: fromAccount, toAccountId: toAccount };
      if (creditCardEvent) base.creditCardEvent = creditCardEvent;
      await onSave(base);
      onClose();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Check the transaction fields."); } finally { setSaving(false); }
  }

  const cardAccount = data.accounts.find((account) => account.id === accountId && account.type === "credit_card") ?? data.accounts.find((account) => account.id === fundingAccountId && account.type === "credit_card");
  const selectedSettlementPeriod = data.periods.find((item) => item.id === settlementPeriodId) ?? data.period;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="transaction-title">
    <div className="modal-head"><div><p className="eyebrow">Ledger entry</p><h2 id="transaction-title">{transaction ? "Edit transaction" : "Add transaction"}</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
    <form onSubmit={submit} className="form-grid">
      <label className="field span-2"><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} required placeholder="e.g. Electric bill" /></label>
      <label className="field"><span>Amount</span><div className="input-prefix"><b>$</b><input value={amount} onChange={(event) => setAmount(event.target.value)} required inputMode="decimal" placeholder="0.00" /></div></label>
      <label className="field"><span>Economic date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} onInput={(event) => setDate((event.target as HTMLInputElement).value)} required /></label>
      <label className="field"><span>Settlement month</span><select value={settlementPeriodId} onChange={(event) => setSettlementPeriodId(event.target.value)}>{data.periods.map((item) => <option key={item.id} value={item.id}>{monthLabel(item.name)}</option>)}{!data.periods.some((item) => item.id === selectedSettlementPeriod.id) && <option value={selectedSettlementPeriod.id}>{monthLabel(selectedSettlementPeriod.name)}</option>}</select></label>
      <label className="field"><span>Type</span><select value={kind} onChange={(event) => setKind(event.target.value as TransactionKind)}><option value="expense">Expense</option><option value="refund">Refund</option><option value="reimbursement">Reimbursement</option><option value="transfer">Transfer</option><option value="adjustment">Adjustment</option></select></label>
      <label className="field"><span>Settlement pool</span><select value={poolId} onChange={(event) => setPoolId(event.target.value)}>{data.pools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
      <label className="field"><span>Entry status</span><select value={status} onChange={(event) => setStatus(event.target.value as "draft" | "posted")}><option value="posted">Posted</option><option value="draft">Draft</option></select></label>
      {kind !== "transfer" && <><label className="field"><span>Category</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Choose category</option>{data.categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="field"><span>Project</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">No project</option>{data.projects.filter((project) => project.status !== "archived").map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></>}
      {kind !== "adjustment" && kind !== "transfer" && <><label className="field"><span>Recorded account</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">No account</option>{data.accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label className="field"><span>Paid by</span><select value={payer} onChange={(event) => setPayer(event.target.value)}><option value="joint">Joint funds</option>{data.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}<option value="third_party">Third party</option></select></label><label className="field"><span>Funding account</span><select value={fundingAccountId} onChange={(event) => setFundingAccountId(event.target.value)}><option value="">No funding account</option>{data.accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></>}
      {cardAccount && <label className="field"><span>Card event</span><select value={creditCardEvent} onChange={(event) => setCreditCardEvent(event.target.value as typeof creditCardEvent)}><option value="">Choose event</option><option value="statement">Statement</option><option value="purchase">Purchase</option><option value="payment">Payment</option></select></label>}
      {kind === "reimbursement" && <div className="subform span-2"><label className="field"><span>Treatment</span><select value={treatment} onChange={(event) => setTreatment(event.target.value as typeof treatment)}><option value="reduce_expense">Reduce household expense</option><option value="received_on_behalf_of_household">Received on behalf of household</option></select></label>{treatment === "received_on_behalf_of_household" && <label className="field"><span>Received by</span><select value={recipient} onChange={(event) => setRecipient(event.target.value)}>{data.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>}<label className="field"><span>Related entries</span><input value={relatedTransactionIds} onChange={(event) => setRelatedTransactionIds(event.target.value)} placeholder="IDs separated by commas" /></label><label className="field"><span>Source description</span><input value={sourceDescription} onChange={(event) => setSourceDescription(event.target.value)} placeholder="Who or what sent it" /></label></div>}
      {kind === "transfer" && <div className="subform span-2"><label className="field"><span>From account</span><select value={fromAccount} onChange={(event) => setFromAccount(event.target.value)}>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label className="field"><span>To account</span><select value={toAccount} onChange={(event) => setToAccount(event.target.value)}>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>}
      {kind === "adjustment" && <div className="subform span-2"><label className="field"><span>Member</span><select value={adjustmentMember} onChange={(event) => setAdjustmentMember(event.target.value)}><option value="">Split by allocation</option>{data.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><label className="field"><span>Signed effect</span><input value={effect} onChange={(event) => setEffect(event.target.value)} placeholder="e.g. -25.00" required /></label><label className="field span-2"><span>Reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Explain this adjustment" /></label></div>}
      {kind !== "transfer" && !(kind === "reimbursement" && treatment === "received_on_behalf_of_household") && kind !== "adjustment" && <fieldset className="allocation-box span-2"><legend>Responsibility split</legend><div className="allocation-head"><span>Member</span><span>Share</span></div>{data.members.map((member) => <label className="allocation-row" key={member.id}><span><i className="avatar tiny">{initials(member.displayName)}</i>{member.displayName}</span><span className="percent-input"><input value={shares[member.id] ?? "0"} onChange={(event) => setShares({ ...shares, [member.id]: event.target.value })} inputMode="decimal" /><b>%</b></span></label>)}<small>Shares must add up to 100%.</small></fieldset>}
      <label className="field span-2"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Optional context for your future self" /></label>
      <label className="checkline span-2"><input type="checkbox" checked={major} onChange={(event) => setMajor(event.target.checked)} /><span>Mark as major expense</span></label>
      {error && <div className="form-error span-2"><CircleAlert size={16} />{error}</div>}
      <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? "Saving…" : <><Save size={16} />Save transaction</>}</button></div>
    </form>
  </section></div>;
}

function SettlementPanel({ data, onPoolToggle, onFinalize, onReopen, onSelectTransaction }: { data: AppData; onPoolToggle: (poolId: string) => void; onFinalize: () => void; onReopen: () => void; onSelectTransaction: (id: string) => void }) {
  const [versionId, setVersionId] = useState(data.settlement?.id ?? "current");
  const savedSnapshot = data.period.status === "finalized" ? data.settlements.find((settlement) => settlement.id === versionId) ?? data.settlement : null;
  const result = useMemo(() => savedSnapshot ?? calculateSettlement(data.transactions, data.period, data.config, { members: data.members, accounts: data.accounts, categories: data.categories, projects: data.projects, settlementPools: data.pools }), [data, savedSnapshot]);
  const activeMembers = data.members.filter((member) => member.active);
  const drafts = data.transactions.filter((transaction) => transaction.status === "draft");
  const canFinalize = result.reconciliation.valid && drafts.length === 0;
  return <aside className="settlement-panel"><div className="settlement-top"><div><p className="eyebrow">{savedSnapshot ? `Saved snapshot · version ${savedSnapshot.version}` : "The worksheet"}</p><h2>Settle the month</h2></div><span className={`status-pill ${drafts.length ? "draft" : result.reconciliation.valid ? "good" : "bad"}`}>{drafts.length ? <><CircleAlert size={13} />Awaiting review</> : result.reconciliation.valid ? <><Check size={13} />Balanced</> : <><CircleAlert size={13} />Needs review</>}</span></div>
    {data.settlements.length > 0 && <label className="snapshot-select"><span>Settlement history</span><select value={versionId} onChange={(event) => setVersionId(event.target.value)}>{data.settlements.sort((a, b) => b.version - a.version).map((settlement) => <option key={settlement.id} value={settlement.id}>Version {settlement.version} · {new Date(settlement.finalizedAt).toLocaleDateString()}</option>)}</select></label>}
    <div className="pool-selector"><div className="section-label">Included pools</div>{data.pools.filter((pool) => pool.active).map((pool) => <label key={pool.id} className="pool-check"><input type="checkbox" disabled={data.period.status === "finalized"} checked={data.period.includedSettlementPoolIds.includes(pool.id)} onChange={() => onPoolToggle(pool.id)} /><span>{pool.name}</span></label>)}</div>
    <div className="settlement-rows">{activeMembers.map((member) => { const person = result.members[member.id] ?? { responsibilityCents: 0, regularContributionCents: 0, personalPaymentsCents: 0, reimbursementsCents: 0, adjustmentsCents: 0, amountToTransferCents: 0 }; return <div className="member-sheet" key={member.id}><div className="member-name"><span className="avatar">{initials(member.displayName)}</span><strong>{member.displayName}</strong><span className={`transfer-chip ${person.amountToTransferCents < 0 ? "credit" : ""}`}>{person.amountToTransferCents < 0 ? "Credit " : "Transfer "}{money(Math.abs(person.amountToTransferCents))}</span></div><div className="sheet-line"><span>Responsibility</span><b>{money(person.responsibilityCents)}</b></div><div className="sheet-line"><span>Regular contribution</span><b className="muted-number">− {money(person.regularContributionCents)}</b></div><div className="sheet-line"><span>Personal payments</span><b className="muted-number">− {money(person.personalPaymentsCents)}</b></div>{person.reimbursementsCents !== 0 && <div className="sheet-line"><span>Reimbursements</span><b>{person.reimbursementsCents > 0 ? "+" : "−"} {money(Math.abs(person.reimbursementsCents))}</b></div>}{person.adjustmentsCents !== 0 && <div className="sheet-line"><span>Adjustments</span><b>{person.adjustmentsCents > 0 ? "+" : "−"} {money(Math.abs(person.adjustmentsCents))}</b></div>}<div className="sheet-total"><span>Amount to transfer</span><strong>{person.amountToTransferCents < 0 ? "Credit " : ""}{money(Math.abs(person.amountToTransferCents))}</strong></div></div>; })}</div>
    {!result.reconciliation.valid && <div className="reconciliation"><strong>Review before finalizing</strong>{result.reconciliation.messages.slice(0, 4).map((message) => <p key={message}><CircleAlert size={14} />{message}</p>)}</div>}
    {drafts.length > 0 && <div className="draft-notice"><CircleAlert size={14} /><span>{drafts.length} draft {drafts.length === 1 ? "entry is" : "entries are"} awaiting review before finalization.</span></div>}
    <div className="settlement-actions">{data.period.status === "finalized" ? <button className="button outline full" onClick={onReopen}><RotateCcw size={16} />Reopen period</button> : <button className="button primary full" disabled={!canFinalize} onClick={onFinalize}><ShieldCheck size={16} />Finalize settlement</button>}</div>
    {data.settlement && <div className="history-note"><Check size={14} /><span>Version {data.settlement.version} finalized {new Date(data.settlement.finalizedAt).toLocaleDateString()}</span></div>}
    <div className="explanation"><div className="section-label">Included entries</div>{data.transactions.filter((transaction) => transaction.status === "posted" && data.period.includedSettlementPoolIds.includes(transaction.settlementPoolId)).slice(0, 6).map((transaction) => <button className="explain-row" key={transaction.id} onClick={() => onSelectTransaction(transaction.id)}><span className={`kind-dot ${transaction.kind}`}></span><span>{transaction.description}</span><b>{transaction.kind === "refund" || transaction.kind === "reimbursement" && transaction.reimbursement?.treatment === "reduce_expense" ? "−" : ""}{money(transaction.amountCents)}</b></button>)}<p className="microcopy">Select an entry to see it in the ledger.</p></div>
  </aside>;
}

function Ledger({ data, onAdd, onEdit, onExclude, selectedId, onSelected }: { data: AppData; onAdd: () => void; onEdit: (transaction: Transaction) => void; onExclude: (transaction: Transaction) => void; selectedId?: string; onSelected: (id?: string) => void }) {
  const [filter, setFilter] = useState<"all" | "posted" | "draft" | "excluded">("all");
  const filtered = data.transactions.filter((transaction) => filter === "all" || transaction.status === filter);
  return <section className="ledger-section"><div className="section-heading"><div><p className="eyebrow">{data.transactions.filter((transaction) => transaction.status === "posted").length} entries</p><h2>Monthly ledger</h2></div><div className="ledger-tools"><div className="segmented">{(["all", "posted", "draft", "excluded"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div><button className="button primary" onClick={onAdd}><Plus size={16} />Add entry</button></div></div>
    <div className="ledger-table"><div className="ledger-header"><span>Date</span><span>Description</span><span>Pool</span><span>Paid by</span><span>Amount</span><span>Status</span><span></span></div>{filtered.map((transaction) => { const payment = transaction.paymentSource; const payer = payment?.type === "member" ? data.members.find((member) => member.id === payment.memberId)?.displayName : payment?.type === "joint" ? "Joint funds" : payment?.type === "third_party" ? "Third party" : "—"; return <div className={`ledger-row ${selectedId === transaction.id ? "selected" : ""}`} key={transaction.id} onClick={() => onSelected(transaction.id)}><span className="ledger-date">{new Date(transaction.economicDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><span className="description-cell"><span className={`kind-dot ${transaction.kind}`}></span><span><strong>{transaction.description}</strong><small>{transaction.categoryId ? data.categories.find((category) => category.id === transaction.categoryId)?.name : transaction.kind}</small></span></span><span className="pool-cell">{poolName(data.pools, transaction.settlementPoolId)}</span><span>{payer}</span><span className={`amount-cell ${transaction.kind === "refund" || transaction.kind === "reimbursement" && transaction.reimbursement?.treatment === "reduce_expense" ? "negative" : ""}`}>{transaction.kind === "refund" || transaction.kind === "reimbursement" && transaction.reimbursement?.treatment === "reduce_expense" ? "−" : ""}{money(transaction.amountCents)}</span><span><span className={`status-pill ${transaction.status}`}>{transaction.status}</span></span><span className="row-actions"><button className="icon-btn" onClick={(event) => { event.stopPropagation(); onEdit(transaction); }} aria-label={`Edit ${transaction.description}`}><ChevronDown size={16} /></button>{transaction.status === "posted" && <button className="icon-btn danger" onClick={(event) => { event.stopPropagation(); onExclude(transaction); }} aria-label={`Exclude ${transaction.description}`}><Archive size={15} /></button>}</span></div>; })}</div>
    <div className="mobile-ledger">{filtered.map((transaction) => <button className={`mobile-entry ${selectedId === transaction.id ? "selected" : ""}`} key={transaction.id} onClick={() => onEdit(transaction)}><span className={`kind-dot ${transaction.kind}`}></span><span className="mobile-entry-main"><strong>{transaction.description}</strong><small>{new Date(transaction.economicDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {poolName(data.pools, transaction.settlementPoolId)}</small></span><span className="mobile-entry-amount">{money(transaction.amountCents)}<small className={`status-text ${transaction.status}`}>{transaction.status}</small></span></button>)}</div>
  </section>;
}

function ProjectsView({ data }: { data: AppData }) {
  return <section className="projects-view"><div className="section-heading"><div><p className="eyebrow">Mini-ledgers</p><h2>Projects</h2></div></div>{data.projects.length === 0 ? <div className="empty-state"><FolderKanban size={28} /><h3>No projects yet</h3><p>Create a project in Settings to track a one-time initiative.</p></div> : <div className="project-grid">{data.projects.map((project) => { const entries = data.allTransactions.filter((transaction) => transaction.projectId === project.id && transaction.status === "posted"); const total = entries.reduce((sum, transaction) => sum + (transaction.kind === "refund" || transaction.kind === "reimbursement" && transaction.reimbursement?.treatment === "reduce_expense" ? -transaction.amountCents : transaction.kind === "expense" ? transaction.amountCents : 0), 0); return <article className="project-card" key={project.id}><div className="project-card-top"><span className="project-mark"><FolderKanban size={18} /></span><span className={`status-pill ${project.status}`}>{project.status}</span></div><h3>{project.name}</h3><p>{entries.length} recorded {entries.length === 1 ? "entry" : "entries"} across all periods</p><div className="project-total">{money(total)}</div><div className="pool-breakdown">{Object.entries(entries.reduce<Record<string, number>>((summary, transaction) => { const value = transaction.kind === "refund" || transaction.kind === "reimbursement" && transaction.reimbursement?.treatment === "reduce_expense" ? -transaction.amountCents : transaction.kind === "expense" ? transaction.amountCents : 0; summary[transaction.settlementPoolId] = (summary[transaction.settlementPoolId] ?? 0) + value; return summary; }, {})).map(([pool, value]) => <span key={pool}>{poolName(data.pools, pool)} <b>{money(value)}</b></span>)}</div></article>; })}</div>}</section>;
}

function SettingsView({ data, repository, householdId, actorUid, onRefresh }: { data: AppData; repository: BudgetRepository; householdId: string; actorUid: string; onRefresh: () => Promise<void> }) {
  const [kind, setKind] = useState<"account" | "category" | "pool" | "project" | "template" | "rules">("account");
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [ruleShares, setRuleShares] = useState<Record<string, string>>(() => Object.fromEntries(data.members.map((member) => [member.id, String((data.config.defaultAllocations.find((allocation) => allocation.memberId === member.id)?.shareBasisPoints ?? 0) / 100)])));
  const [ruleContributions, setRuleContributions] = useState<Record<string, string>>(() => Object.fromEntries(data.members.map((member) => [member.id, inputMoney(data.config.monthlyContributions[member.id] ?? 0)])));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copyHouseholdCode() {
    try {
      await navigator.clipboard.writeText(householdId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy the household code. Select it manually instead.");
    }
  }
  async function save(event: FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { const timestamp = new Date().toISOString(); if (kind === "rules") { const allocations = data.members.map((member) => ({ memberId: member.id, shareBasisPoints: parseBasisPoints(ruleShares[member.id] || "0") })).filter((allocation) => allocation.shareBasisPoints > 0); if (allocations.reduce((sum, allocation) => sum + allocation.shareBasisPoints, 0) !== 10000) throw new Error("Split shares must add up to 100%."); const monthlyContributions = Object.fromEntries(data.members.map((member) => [member.id, parseMoney(ruleContributions[member.id] || "0")])); const nextVersion = data.config.version + 1; await repository.saveConfig(householdId, { ...data.config, id: newId("config-v"), version: nextVersion, defaultAllocations: allocations, monthlyContributions, effectiveFrom: timestamp, createdAt: timestamp, createdByUid: actorUid, reason: "Updated in Settings" }, "Updated in Settings"); } else { if (!name.trim()) throw new Error("Name is required."); if (editingId) { if (kind === "account") await repository.saveAccount(householdId, { ...(data.accounts.find((item) => item.id === editingId) as Account), name: name.trim(), notes: detail || undefined, updatedAt: timestamp }); else if (kind === "category") await repository.saveCategory(householdId, { ...(data.categories.find((item) => item.id === editingId) as Category), name: name.trim() }); else if (kind === "pool") await repository.saveSettlementPool(householdId, { ...(data.pools.find((item) => item.id === editingId) as SettlementPool), name: name.trim(), description: detail || undefined }); else if (kind === "project") await repository.saveProject(householdId, { ...(data.projects.find((item) => item.id === editingId) as Project), name: name.trim() }); else await repository.saveRecurringTemplate(householdId, { ...(data.templates.find((item) => item.id === editingId) as RecurringTemplate), name: name.trim(), description: detail || name.trim(), updatedAt: timestamp }); } else if (kind === "account") await repository.saveAccount(householdId, { id: newId("account"), name: name.trim(), ownerType: "joint", type: "checking", active: true, notes: detail || undefined, createdAt: timestamp, updatedAt: timestamp }); else if (kind === "category") await repository.saveCategory(householdId, { id: newId("category"), name: name.trim(), type: "expense", active: true }); else if (kind === "pool") await repository.saveSettlementPool(householdId, { id: newId("pool"), name: name.trim(), active: true, description: detail || undefined }); else if (kind === "project") await repository.saveProject(householdId, { id: newId("project"), name: name.trim(), status: "active", createdAt: timestamp }); else await repository.saveRecurringTemplate(householdId, { id: newId("template"), name: name.trim(), description: detail || name.trim(), estimatedAmountCents: 0, settlementPoolId: data.config.defaultSettlementPoolId, allocations: data.config.defaultAllocations, importance: "normal", frequency: "monthly", active: true, createdAt: timestamp, updatedAt: timestamp }); setName(""); setDetail(""); setEditingId(undefined); } await onRefresh(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save."); } finally { setSaving(false); } }
  return <section className="settings-view"><div className="section-heading"><div><p className="eyebrow">Household setup</p><h2>Settings</h2></div><span className="settings-lock"><Settings2 size={15} /> Changes apply to future entries</span></div><div className="household-code-card"><div><p className="eyebrow">Invite a member</p><h3>Share this household code</h3><p>Give it to someone you trust. They can request access from the sign-in screen.</p></div><code>{householdId}</code><button className="button outline compact" onClick={() => void copyHouseholdCode()}>{copied ? "Copied" : "Copy code"}</button></div><div className="settings-grid"><form className="settings-form" onSubmit={save}><div className="settings-tabs">{(["account", "category", "pool", "project", "template", "rules"] as const).map((item) => <button type="button" key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>{item === "template" ? "Recurring" : item === "rules" ? "Split & rules" : item[0].toUpperCase() + item.slice(1)}{item === "rules" ? <Settings2 size={14} /> : <Plus size={14} />}</button>)}</div>{kind === "rules" ? <><h3>Split & contributions</h3><p className="muted">Versioned rules apply to new settlement periods. Existing periods keep their snapshot.</p><div className="rule-list">{data.members.map((member) => <div className="rule-row" key={member.id}><span>{member.displayName}</span><label><input value={ruleShares[member.id] ?? "0"} onChange={(event) => setRuleShares({ ...ruleShares, [member.id]: event.target.value })} inputMode="decimal" /><small>%</small></label><label><b>$</b><input value={ruleContributions[member.id] ?? "0.00"} onChange={(event) => setRuleContributions({ ...ruleContributions, [member.id]: event.target.value })} inputMode="decimal" /></label></div>)}</div></> : <><h3>Add {kind === "template" ? "recurring item" : kind}</h3><p className="muted">Keep the ledger vocabulary clear for everyone sharing it.</p><label className="field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "pool" ? "e.g. Renovation" : "Name for this item"} required /></label><label className="field"><span>{kind === "template" ? "Description" : "Notes"}</span><textarea value={detail} onChange={(event) => setDetail(event.target.value)} rows={2} placeholder="Optional details" /></label></>}{error && <div className="form-error"><CircleAlert size={16} />{error}</div>}<button className="button primary" disabled={saving}>{saving ? "Saving…" : <><Save size={16} />Save {kind === "rules" ? "rules" : kind}</>}</button></form><div className="settings-lists"><SettingsList title="Accounts" items={data.accounts.map((account) => `${account.name} · ${account.type}`)} action={data.accounts.filter((account) => account.active).length ? <span className="list-count">{data.accounts.filter((account) => account.active).length} active</span> : undefined} /><SettingsList title="Categories" items={data.categories.map((category) => category.name)} /><SettingsList title="Settlement pools" items={data.pools.map((pool) => pool.name)} /><SettingsList title="Recurring templates" items={data.templates.map((template) => template.name)} /></div></div><div className="settings-footnote"><WalletCards size={17} /><span>Use statement mode for a card bill. In transaction mode, record purchases and the card payment as a transfer.</span></div></section>;
}

function SettingsList({ title, items, action }: { title: string; items: string[]; action?: ReactNode }) { return <div className="settings-list"><div className="settings-list-head"><strong>{title}</strong>{action}</div>{items.length ? items.map((item) => <div className="settings-item" key={item}><span>{item}</span><span className="list-dot"></span></div>) : <p className="muted">Nothing added yet.</p>}</div>; }

function App() {
  const [view, setView] = useState<View>("ledger");
  const [month, setMonth] = useState(currentMonth());
  const [repository, setRepository] = useState<BudgetRepository | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [setup, setSetup] = useState<SetupState>("loading");
  const [error, setError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [modal, setModal] = useState<"transaction" | "restore" | null>(null);
  const [editing, setEditing] = useState<Transaction | undefined>();
  const [selectedId, setSelectedId] = useState<string>();
  const [toast, setToast] = useState("");
  const [activeHouseholdId, setActiveHouseholdId] = useState(() => getStoredHouseholdId() || defaultHouseholdId);
  const [pendingRequests, setPendingRequests] = useState<JoinRequest[]>([]);

  const actorUid = user?.uid ?? actorFallback;
  const service = useMemo(() => repository ? new BudgetService(repository) : null, [repository]);

  const load = useCallback(async (targetRepository: BudgetRepository, targetHouseholdId: string, targetMonth: string, targetActor: string) => {
    const targetService = new BudgetService(targetRepository);
    const next = await readData(targetRepository, targetService, targetHouseholdId, targetMonth, targetActor);
    setData(next); setSetup("ready"); setError("");
  }, []);

  const resetPreview = useCallback(async (targetMonth = month) => {
    const nextRepository = new InMemoryBudgetRepository();
    await nextRepository.restoreAll(previewHouseholdId, createSampleData(targetMonth), actorFallback);
    setRepository(nextRepository); await load(nextRepository, previewHouseholdId, targetMonth, actorFallback);
  }, [load, month]);

  const openHousehold = useCallback((nextHouseholdId: string) => {
    rememberHouseholdId(nextHouseholdId);
    setActiveHouseholdId(nextHouseholdId);
    setData(null);
    setSetup("loading");
    setError("");
  }, []);

  useEffect(() => {
    if (!configured) {
      void resetPreview();
      return;
    }
    const stop = observeAuth((nextUser) => {
      setUser(nextUser);
      setData(null);
      setPendingRequests([]);
      if (!nextUser) {
        setSetup("auth");
        return;
      }
      if (!activeHouseholdId) {
        setSetup("household");
        return;
      }
      const nextRepository = new FirestoreBudgetRepository(db);
      setRepository(nextRepository);
      void load(nextRepository, activeHouseholdId, month, nextUser.uid).catch((loadError) => {
        setSetup("household");
        setError(loadError instanceof Error ? loadError.message : "Choose or create a household to continue.");
      });
    });
    return stop;
  }, [activeHouseholdId, load, month, resetPreview]);

  useEffect(() => {
    if (!configured || setup !== "ready" || !activeHouseholdId) return;
    void listPendingJoinRequests(activeHouseholdId).then(setPendingRequests).catch(() => setPendingRequests([]));
  }, [activeHouseholdId, setup]);

  async function changeMonth(nextMonth: string) { if (!repository || !activeHouseholdId) return; setSetup("loading"); try { await load(repository, activeHouseholdId, nextMonth, actorUid); setMonth(nextMonth); } catch (loadError) { setSetup("error"); setError(loadError instanceof Error ? loadError.message : "Could not load this month."); } }
  async function refresh() { if (repository && activeHouseholdId) await load(repository, activeHouseholdId, month, actorUid); }
  async function saveTransaction(transaction: Transaction) { if (!repository || !activeHouseholdId) return; await repository.saveTransaction(activeHouseholdId, transaction); await refresh(); setToast(transaction.status === "draft" ? "Draft saved" : "Entry saved"); }
  async function excludeTransaction(transaction: Transaction) { if (!repository || !activeHouseholdId) return; if (!window.confirm(`Exclude “${transaction.description}” from settlement? It will remain in history.`)) return; await repository.archiveTransaction(activeHouseholdId, transaction.id, actorUid, "Excluded from settlement"); await refresh(); setToast("Entry excluded"); }
  async function togglePool(poolId: string) { if (!repository || !data || !activeHouseholdId) return; const included = data.period.includedSettlementPoolIds.includes(poolId); const nextPeriod = { ...data.period, includedSettlementPoolIds: included ? data.period.includedSettlementPoolIds.filter((id) => id !== poolId) : [...data.period.includedSettlementPoolIds, poolId], updatedAt: new Date().toISOString(), updatedByUid: actorUid }; await repository.saveSettlementPeriod(activeHouseholdId, nextPeriod, data.period.updatedAt); await refresh(); }
  async function finalize() { if (!service || !data || !activeHouseholdId) return; try { await service.finalizePeriod(activeHouseholdId, data.period.id, actorUid); await refresh(); setToast("Settlement finalized"); } catch (finalizeError) { setToast(finalizeError instanceof Error ? finalizeError.message : "Could not finalize"); } }
  async function reopen() { if (!service || !data || !activeHouseholdId || !window.confirm("Reopen this period? The existing settlement snapshot stays in history.")) return; try { await service.reopenPeriod(activeHouseholdId, data.period.id, actorUid, true); await refresh(); setToast("Period reopened"); } catch (reopenError) { setToast(reopenError instanceof Error ? reopenError.message : "Could not reopen"); } }
  async function exportJson() { if (!repository || !activeHouseholdId) return; const value = await repository.exportAll(activeHouseholdId); download(`household-budget-${month}.json`, JSON.stringify(value, null, 2), "application/json"); setToast("JSON backup downloaded"); }
  async function exportTransactions() { if (!repository || !activeHouseholdId) return; const value = await repository.exportAll(activeHouseholdId); download(`household-transactions-${month}.csv`, exportTransactionsCsv(value.transactions), "text/csv;charset=utf-8"); setToast("Transactions CSV downloaded"); }
  async function exportSettlements() { if (!repository || !activeHouseholdId) return; const value = await repository.exportAll(activeHouseholdId); download(`household-settlements-${month}.csv`, exportSettlementsCsv(value.settlements), "text/csv;charset=utf-8"); setToast("Settlements CSV downloaded"); }
  async function restoreFile(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; try { const raw = parseBudgetExport(await file.text()); assertValidBudgetExport(raw); setModal("restore"); (window as typeof window & { __pendingBudgetRestore?: BudgetExportV1 }).__pendingBudgetRestore = raw; } catch (restoreError) { setToast(restoreError instanceof Error ? restoreError.message : "Backup is not valid"); } event.target.value = ""; }
  async function confirmRestore() { const pending = (window as typeof window & { __pendingBudgetRestore?: BudgetExportV1 }).__pendingBudgetRestore; if (!pending) return; if (configured) { setToast("Restore requires an empty household target; use the repository restore workflow."); setModal(null); return; } const nextRepository = new InMemoryBudgetRepository(); try { await nextRepository.restoreAll(previewHouseholdId, pending, actorFallback); setRepository(nextRepository); const restoredMonth = pending.settlementPeriods[0]?.name.match(/^\d{4}-\d{2}$/)?.[0] ?? month; setMonth(restoredMonth); await load(nextRepository, previewHouseholdId, restoredMonth, actorFallback); setModal(null); setToast("Backup restored into preview"); } catch (restoreError) { setToast(restoreError instanceof Error ? restoreError.message : "Could not restore backup"); } }

  if (setup === "loading") return <div className="loading-screen"><div className="brand-mark"><Sparkles size={18} /></div><p>Opening your household worksheet…</p></div>;
  if (configured && setup === "auth") return <div className="setup-screen"><div className="setup-card"><div className="brand-mark large"><Sparkles size={22} /></div><p className="eyebrow">Private household workspace</p><h1>Make the month easy to close.</h1><p>Sign in with an approved Google account to open your shared ledger.</p><button className="button primary full" onClick={() => void signInWithGoogle()}>Continue with Google</button><small>Only household members can access this workspace.</small></div></div>;
  if (configured && setup === "household" && user) return <HouseholdOnboarding user={user} initialHouseholdId={defaultHouseholdId} error={error} onHouseholdReady={openHousehold} />;
  if (setup === "error" || !data || !repository) return <div className="setup-screen"><div className="setup-card"><div className="brand-mark large"><CircleAlert size={22} /></div><p className="eyebrow">Couldn’t open the worksheet</p><h1>There’s a setup step left.</h1><p>{error || "Configure a household or use the synthetic preview to explore the app."}</p>{!configured && <button className="button primary full" onClick={() => void resetPreview()}>Reload sample preview</button>}{configured && <button className="button ghost full" onClick={() => void signOutGoogle()}>Sign out</button>}</div></div>;

  const report = calculateMonthlySpendingReport(data.allTransactions, month);
  const postedTotal = report.totalCents;
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><Sparkles size={17} /></span><span><strong>split</strong><small>household ledger</small></span></div><nav className="primary-nav"><button className={view === "ledger" ? "active" : ""} onClick={() => setView("ledger")}><BookOpen size={17} />Ledger</button><button className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}><FolderKanban size={17} />Projects</button><button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><Settings2 size={17} />Settings</button></nav><div className="sidebar-bottom"><div className="online-state"><span></span><span>Online workspace</span></div>{configured && <button className="signout" onClick={() => void signOutGoogle()}>Sign out</button>}<div className="user-card"><span className="avatar">{initials(data.members[0]?.displayName ?? "Household")}</span><span><strong>{user?.displayName ?? data.members[0]?.displayName ?? "Household"}</strong><small>{configured ? "Shared access" : "Preview access"}</small></span></div></div></aside>
    <main className="main-content"><header className="topbar"><div className="mobile-brand"><span className="brand-mark"><Sparkles size={16} /></span><strong>split</strong></div><div className="breadcrumb"><span>Household</span><b>/</b><strong>{view === "ledger" ? monthLabel(month) : view === "projects" ? "Projects" : "Settings"}</strong></div><div className="top-actions"><label className="import-button"><FileUp size={16} /><span>Restore</span><input type="file" accept="application/json" onChange={restoreFile} /></label><button className="icon-btn" onClick={() => void exportJson()} aria-label="Download backup"><Download size={17} /></button>{configured && <button className="mobile-signout" onClick={() => void signOutGoogle()}>Sign out</button>}<span className="avatar top-avatar">{initials(data.members[0]?.displayName ?? "H")}</span></div></header><nav className="mobile-nav" aria-label="Primary navigation"><button className={view === "ledger" ? "active" : ""} onClick={() => setView("ledger")}><BookOpen size={14} /> Ledger</button><button className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}><FolderKanban size={14} /> Projects</button><button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><Settings2 size={14} /> Settings</button></nav>
      {configured && pendingRequests.length > 0 && <JoinRequestInbox householdId={activeHouseholdId} reviewerUid={actorUid} requests={pendingRequests} onChanged={async () => { setPendingRequests(await listPendingJoinRequests(activeHouseholdId)); }} />}
      {!configured && <div className="preview-banner"><Sparkles size={15} /> Sample preview · synthetic entries only · edits reset on reload</div>}
      {view === "ledger" && <><section className="month-header"><div className="month-title"><p className="eyebrow">Settlement period</p><h1>{monthLabel(month)}</h1><span className={`status-pill ${data.period.status}`}>{data.period.status === "finalized" ? <><Check size={13} />Finalized</> : <><CalendarDays size={13} />Open for edits</>}</span></div><div className="month-controls"><button className="icon-btn" onClick={() => void changeMonth(shiftMonth(month, -1))} aria-label="Previous month"><ArrowLeft size={17} /></button><button className="today-button" onClick={() => void changeMonth(currentMonth())}>This month</button><button className="icon-btn" onClick={() => void changeMonth(shiftMonth(month, 1))} aria-label="Next month"><ArrowRight size={17} /></button></div></section><section className="spending-strip"><div className="spending-total"><span>Recorded spending</span><strong>{money(postedTotal)}</strong><small>{report.transactionIds.length} posted entries · all pools</small></div><div className="pool-summary">{Object.entries(report.bySettlementPool).map(([pool, value]) => <span key={pool}><i className="pool-swatch"></i>{poolName(data.pools, pool)} <b>{money(value)}</b></span>)}</div><button className="report-button" onClick={() => setView("projects")}><BarChart3 size={16} />View report</button></section><div className="content-grid"><Ledger data={data} onAdd={() => { setEditing(undefined); setModal("transaction"); }} onEdit={(transaction) => { setEditing(transaction); setModal("transaction"); }} onExclude={(transaction) => void excludeTransaction(transaction)} selectedId={selectedId} onSelected={setSelectedId} /><SettlementPanel data={data} onPoolToggle={(poolId) => void togglePool(poolId)} onFinalize={() => void finalize()} onReopen={() => void reopen()} onSelectTransaction={(id) => { setSelectedId(id); window.scrollTo({ top: 500, behavior: "smooth" }); }} /></div></>}
      {view === "projects" && <><section className="month-header compact"><div className="month-title"><p className="eyebrow">Across the ledger</p><h1>Projects</h1></div><button className="button primary" onClick={() => setView("settings")}><Plus size={16} />New project</button></section><ProjectsView data={data} /></>}
      {view === "settings" && <><section className="month-header compact"><div className="month-title"><p className="eyebrow">Household controls</p><h1>Settings</h1></div></section><SettingsView data={data} repository={repository} householdId={activeHouseholdId} actorUid={actorUid} onRefresh={refresh} /></>}
      <footer className="app-footer"><span><Sparkles size={13} /> {configured ? "Private household data" : "Synthetic preview data"}</span><span>Export: <button onClick={() => void exportJson()}>JSON</button> · <button onClick={() => void exportTransactions()}>transactions CSV</button> · <button onClick={() => void exportSettlements()}>settlements CSV</button></span></footer>
    </main>
    {modal === "transaction" && <TransactionForm transaction={editing} data={data} actorUid={actorUid} onSave={saveTransaction} onClose={() => setModal(null)} />}
    {modal === "restore" && <div className="modal-backdrop"><section className="modal restore-modal"><div className="modal-head"><div><p className="eyebrow">Preflight restore</p><h2>Restore this backup?</h2></div><button className="icon-btn" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button></div><p>This will open the portable household snapshot in a fresh synthetic preview. Existing configured households require an empty target.</p><div className="restore-summary"><span><strong>{(window as typeof window & { __pendingBudgetRestore?: BudgetExportV1 }).__pendingBudgetRestore?.transactions.length ?? 0}</strong> transactions</span><span><strong>{(window as typeof window & { __pendingBudgetRestore?: BudgetExportV1 }).__pendingBudgetRestore?.settlementPeriods.length ?? 0}</strong> periods</span><span><strong>{(window as typeof window & { __pendingBudgetRestore?: BudgetExportV1 }).__pendingBudgetRestore?.members.length ?? 0}</strong> members</span></div><div className="modal-actions"><button className="button ghost" onClick={() => setModal(null)}>Cancel</button><button className="button primary" onClick={() => void confirmRestore()}><RotateCcw size={16} />Restore preview</button></div></section></div>}
    {toast && <button className="toast" onClick={() => setToast("")}><Check size={16} />{toast}</button>}
  </div>;
}

export default App;
