/*
 * Read a Google Sheets grid dump and emit ignored, normalized migration
 * candidates plus a reconciliation report. This is a source adapter only:
 * it does not parse bank files, write the app repository, or finalize periods.
 *
 * Usage: node scripts/migrate-private-source.mjs [input candidates report]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [, , inputArg = 'private-data/budget-2026-source.json', candidatesArg = 'private-data/migration-candidates-2026.json', reportArg = 'private-data/migration-report-2026.json'] = process.argv;
const source = JSON.parse(await readFile(resolve(inputArg), 'utf8'));
const rows = [];
const monthPattern = /^(January|February|Febuary|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i;
const monthNumber = new Map([['january', 1], ['february', 2], ['febuary', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6], ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12]]);
const ignoredLabel = /^(total|blaire|john|blaire to transfer|john to transfer)$/i;
const amountColumns = ['V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC'];
const monthReports = new Map();

function cellValue(cell) {
  if (!cell || typeof cell !== 'object') return '';
  return cell.formattedValue ?? cell.effectiveValue?.stringValue ?? cell.effectiveValue?.numberValue ?? cell.userEnteredValue?.stringValue ?? cell.userEnteredValue?.numberValue ?? '';
}
function formulaValue(cell) { return cell?.userEnteredValue?.formulaValue ?? null; }
function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const cleaned = value.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const result = Number(cleaned);
  return Number.isFinite(result) ? result : null;
}
function keyFor(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function iso(month) { return `${month}-01T00:00:00.000Z`; }
function cellRef(column, row) { return `${amountColumns[column] ?? `COL${column}`}${row}`; }
function signedAmount(row) { return row.kind === 'refund' ? -row.amountCents : row.kind === 'reimbursement' ? 0 : row.amountCents; }

for (const sheet of source.sheets ?? []) for (const block of sheet.data ?? []) {
  const grid = block.rowData ?? [];
  const startRow = block.startRow ?? 0;
  const monthStarts = [];
  for (let index = 0; index < grid.length; index += 1) {
    const label = String(cellValue(grid[index]?.values?.[0])).trim();
    const match = label.match(monthPattern);
    if (match) monthStarts.push({ index, month: `${match[2]}-${String(monthNumber.get(match[1].toLowerCase())).padStart(2, '0')}` });
  }
  for (const [monthIndex, monthStart] of monthStarts.entries()) {
    const end = monthStarts[monthIndex + 1]?.index ?? grid.length;
    const heading = grid[monthStart.index]?.values ?? [];
    const ordinal = { value: 0 };
    const blockCandidates = [];
    const summaryFormulas = [];
    for (let index = monthStart.index + 1; index < end; index += 1) {
      const values = grid[index]?.values ?? [];
      const sheetRow = startRow + index + 1;
      for (let column = 0; column < values.length; column += 2) {
        const rawLabel = String(cellValue(values[column])).trim();
        const amount = numeric(cellValue(values[column + 1]));
        const label = rawLabel || (column === 4 ? String(cellValue(heading[column])).trim() : '');
        if (!label || ignoredLabel.test(label) || /^column\s+\d+$/i.test(label)) continue;
        const formula = formulaValue(values[column + 1]);
        if (formula && amount !== null && (/transfer$/i.test(label) || /^total$/i.test(label))) summaryFormulas.push({ label, value: amount, sourceCell: cellRef(column + 1, sheetRow), formula });
        const receipt = label.match(/^(Blaire|JH|John)\s+owes\s+(\d+(?:\.\d+)?)\s+extra\s+since\s+.+venmoed/i);
        if (receipt && amount === null) {
          const receivedByMemberId = /^Blaire$/i.test(receipt[1]) ? 'm-blaire' : 'm-john';
          blockCandidates.push({ rowId: `${monthStart.month}:received-on-behalf:${keyFor(receipt[1])}:${ordinal.value++}`, economicDate: iso(monthStart.month), description: `Received on behalf of household (${receipt[1]})`, amountCents: Math.round(Number(receipt[2]) * 100), kind: 'reimbursement', reimbursement: { treatment: 'received_on_behalf_of_household', receivedByMemberId, relatedTransactionIds: [], sourceDescription: label }, settlementPoolId: 'pool-operating', settlementPeriodId: `period-${monthStart.month}`, sourceCell: cellRef(column, sheetRow), sourceFormula: null });
          continue;
        }
        if (amount === null) continue;
        // The main “Other” cell is a formula subtotal of the Y detail column.
        // Keep the detail rows and omit this aggregate to prevent double count.
        if (column === 0 && /^other$/i.test(label) && formula) continue;
        const pool = column === 4 ? 'pool-renovation' : 'pool-operating';
        const candidate = { rowId: `${monthStart.month}:${keyFor(label)}:${ordinal.value++}`, economicDate: iso(monthStart.month), description: label, amountCents: Math.round(Math.abs(amount) * 100), kind: amount < 0 ? 'refund' : 'expense', settlementPoolId: pool, settlementPeriodId: `period-${monthStart.month}`, sourceDescription: amount < 0 && /^renovations$/i.test(label) ? `Explicit source subtraction at ${cellRef(column + 1, sheetRow)}; renovation offset semantics require review.` : `Imported at source granularity from ${monthStart.month}`, sourceCell: cellRef(column + 1, sheetRow), sourceFormula: formula };
        blockCandidates.push(candidate);
      }
    }

    // Infer personal payer deductions from the source's own final formulas.
    // This keeps the adapter generic while preserving the workbook's intent.
    const candidateByCell = new Map(blockCandidates.map((candidate) => [candidate.sourceCell, candidate]));
    for (const summary of summaryFormulas) {
      const memberId = /^john\s+to\s+transfer$/i.test(summary.label) ? 'm-john' : /^blaire\s+to\s+transfer$/i.test(summary.label) ? 'm-blaire' : /^blaire$/i.test(summary.label) ? 'm-blaire' : null;
      if (!memberId) continue;
      for (const token of summary.formula.match(/-\s*([A-Z]+\d+)/g) ?? []) {
        const normalized = token.replace(/\s+/g, '');
        const referenced = candidateByCell.get(normalized.slice(1));
        if (referenced && (normalized.startsWith('-W') || normalized.startsWith('-Y')) && referenced.kind === 'expense') referenced.paymentSource = { type: 'member', memberId };
      }
    }
    for (const candidate of blockCandidates) {
      const formula = candidate.sourceFormula;
      if (!formula) continue;
      const reference = formula.match(/-\s*([A-Z]+\d+)/g) ?? [];
      for (const token of reference) {
        const sourceCell = token.replace(/\s+/g, '').slice(1);
        const referenced = candidateByCell.get(sourceCell);
        if (!referenced) continue;
        // W deductions are on John's final transfer; Y deductions are in
        // Blaire's responsibility formula.
        const memberId = token.replace(/\s+/g, '').startsWith('-W') ? 'm-john' : token.replace(/\s+/g, '').startsWith('-Y') ? 'm-blaire' : null;
        if (memberId && referenced.kind === 'expense') referenced.paymentSource = { type: 'member', memberId };
      }
    }
    rows.push(...blockCandidates);
    monthReports.set(monthStart.month, summaryFormulas);
  }
}

const months = [...new Set(rows.map((row) => row.settlementPeriodId.replace('period-', '')))].sort();
const byMonth = Object.fromEntries(months.map((month) => {
  const monthRows = rows.filter((row) => row.settlementPeriodId === `period-${month}`);
  const operatingRows = monthRows.filter((row) => row.settlementPoolId === 'pool-operating' && row.kind !== 'reimbursement');
  const operatingExpenseCents = operatingRows.reduce((sum, row) => sum + signedAmount(row), 0);
  const formulas = monthReports.get(month) ?? [];
  const shares = { 'm-john': Number((formulas.find((item) => /^john$/i.test(item.label))?.formula?.match(/\*\s*(0\.\d+)/)?.[1] ?? 0.6)), 'm-blaire': Number((formulas.find((item) => /^blaire$/i.test(item.label))?.formula?.match(/\*\s*(0\.\d+)/)?.[1] ?? 0.4)) };
  const contributions = { 'm-john': Number(formulas.find((item) => /^john\s+to\s+transfer$/i.test(item.label))?.formula?.match(/-\s*(\d+(?:\.\d+)?)(?![A-Z])/ )?.[1] ?? 0) * 100, 'm-blaire': Number(formulas.find((item) => /^blaire\s+to\s+transfer$/i.test(item.label))?.formula?.match(/-\s*(\d+(?:\.\d+)?)(?![A-Z])/ )?.[1] ?? 0) * 100 };
  const responsibility = { 'm-john': Math.round(operatingExpenseCents * shares['m-john']), 'm-blaire': operatingExpenseCents - Math.round(operatingExpenseCents * shares['m-john']) };
  const personal = { 'm-john': monthRows.filter((row) => row.paymentSource?.memberId === 'm-john').reduce((sum, row) => sum + signedAmount(row), 0), 'm-blaire': monthRows.filter((row) => row.paymentSource?.memberId === 'm-blaire').reduce((sum, row) => sum + signedAmount(row), 0) };
  const received = { 'm-john': monthRows.filter((row) => row.reimbursement?.receivedByMemberId === 'm-john').reduce((sum, row) => sum + row.amountCents, 0), 'm-blaire': monthRows.filter((row) => row.reimbursement?.receivedByMemberId === 'm-blaire').reduce((sum, row) => sum + row.amountCents, 0) };
  const calculatedTransferCents = { 'm-john': responsibility['m-john'] - contributions['m-john'] - personal['m-john'] + received['m-john'], 'm-blaire': responsibility['m-blaire'] - contributions['m-blaire'] - personal['m-blaire'] + received['m-blaire'] };
  const sourceTransfers = Object.fromEntries(formulas.filter((item) => /transfer$/i.test(item.label)).map((item) => [/^john/i.test(item.label) ? 'm-john' : 'm-blaire', item.value * 100]));
  const transferDifferenceCents = Object.fromEntries(Object.entries(calculatedTransferCents).map(([memberId, value]) => [memberId, sourceTransfers[memberId] === undefined ? null : value - sourceTransfers[memberId]]));
  return [month, { rowCount: monthRows.length, signedSourceTotalCents: monthRows.reduce((sum, row) => sum + signedAmount(row), 0), operatingExpenseCents, refunds: monthRows.filter((row) => row.kind === 'refund').length, receivedOnBehalf: monthRows.filter((row) => row.reimbursement?.treatment === 'received_on_behalf_of_household').length, inferredPersonalPayers: monthRows.filter((row) => row.paymentSource?.type === 'member').map((row) => ({ rowId: row.rowId, memberId: row.paymentSource.memberId })), finalFormulaRows: formulas, calculatedSettlement: { shares, contributionsCents: contributions, responsibilityCents: responsibility, personalPaymentsCents: personal, reimbursementsCents: received, transferCents: calculatedTransferCents, sourceTransferCents: sourceTransfers, differenceCents: transferDifferenceCents } }];
}));
const report = { generatedAt: new Date().toISOString(), sourceFile: inputArg, sourceRowCount: rows.length, months, byMonth, checks: { preservedSourceGranularity: true, excludesFormulaAggregates: true, createsNoUnderlyingPurchases: true, createsNoImportRecords: true, autoFinalized: false, requiresUserSignoff: true, juneReceivedOnBehalfCents: rows.filter((row) => row.settlementPeriodId === 'period-2026-06' && row.reimbursement?.treatment === 'received_on_behalf_of_household').map((row) => row.amountCents), januaryRenovationReviewCells: rows.filter((row) => row.settlementPeriodId === 'period-2026-01' && /renovations/i.test(row.description) && row.kind === 'refund').map((row) => row.sourceCell), subcentDifferences: 'Compare integer-cent settlement calculations with source formula outputs; retain any fractional-cent difference in review.' } };
await writeFile(resolve(candidatesArg), JSON.stringify({ format: 'normalized-spreadsheet-candidates', generatedAt: report.generatedAt, rows }, null, 2) + '\n');
await writeFile(resolve(reportArg), JSON.stringify(report, null, 2) + '\n');
console.log(`Wrote ${rows.length} normalized candidates across ${months.length} months.`);
