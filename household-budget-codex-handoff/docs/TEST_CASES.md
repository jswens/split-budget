# Required Accounting Test Cases

These tests are release gates for the settlement engine.

Use integer cents in fixtures.

## Fixture A — Baseline joint mortgage

Transactions:
- Mortgage $4,347, paid joint, 60/40.

Contributions:
- John $2,000
- Blaire $1,200

Expected:
- household expense = $4,347
- John responsibility = $2,608.20
- Blaire responsibility = $1,738.80
- John personal payments = $0
- Blaire personal payments = $0
- John transfer = $608.20
- Blaire transfer = $538.80

## Fixture B — Costco paid personally by John

Transactions:
- Mortgage $4,347 joint
- Costco $804 paid personally by John
- both 60/40

Expected:
- household expense = $5,151
- John responsibility = $3,090.60
- Blaire responsibility = $2,060.40
- John personal payments = $804
- John transfer = $286.60
- Blaire transfer = $860.40

Critical assertion: no Costco-specific code path exists.

## Fixture C — Blaire Venmo babysitter

Add:
- Babysitter $500 paid personally by Blaire, 60/40.

Expected after mortgage + Costco + babysitter:
- household expense = $5,651
- John responsibility = $3,390.60
- Blaire responsibility = $2,260.40
- John personal payments = $804
- Blaire personal payments = $500
- John transfer = $586.60
- Blaire transfer = $560.40

Critical assertion: same generic personal-payment mechanism as Costco.

## Fixture D — Household reimbursement received personally by John

Create an underlying household expense already included in settlement, then:
- Mike reimbursement $341
- treatment = received_on_behalf_of_household
- receivedByMemberId = John

Expected:
- original household expense remains intact;
- John reimbursements component = +$341;
- John's transfer obligation increases by $341;
- no hidden manual `+341` formula is required.

Repeat analogous case for Blaire $266.

## Fixture E — Refund reducing expense

- Shared purchase $1,000, 60/40
- Merchant refund $200, treatment `reduce_expense`

Expected:
- net household expense = $800
- John net responsibility = $480
- Blaire net responsibility = $320

## Fixture F — Renovation excluded from operating settlement

- Operating expenses $5,651 in `household-operating`
- Renovation materials $1,500 in `renovation`
- period includes only `household-operating`

Expected:
- operating household expense = $5,651
- renovation visible in ledger/reporting
- renovation contributes $0 to operating settlement

Then include both pools and confirm total becomes $7,151.

## Fixture G — Credit card statement mode

Account trackingMode = `statement`.

- Chase statement $2,709 is posted as expense.
- No individual purchases are present.

Expected:
- statement contributes $2,709 to household expense.

## Fixture H — Credit card transaction mode

Account trackingMode = `transactions`.

- individual purchases total $2,709 and are expenses.
- checking -> Chase $2,709 card payment is a `transfer`.

Expected:
- household expense impact = $2,709, not $5,418.
- transfer contributes $0.

Add validation test that attempts to import/post card payment as expense and fails domain validation.

## Fixture I — Different economic month and settlement month

- Economic date: Jan 29
- settlementPeriodId: Feb

Expected:
- appears in chronological/account history as Jan 29;
- participates in February settlement;
- does not participate in January solely because of its date.

## Fixture J — Custom allocation

Expense $100:
- John 50%
- Blaire 50%

Expected:
- $50/$50 responsibility.

Then test John-only:
- John 10000 basis points
- Blaire omitted/0
- $100/$0.

## Fixture K — Rounding

Expense $10.01 split 60/40.

Expected:
- exact integer cents;
- member allocations total 1001 cents;
- deterministic result across runs.

Also test 3-member artificial fixture to ensure leftover-cent algorithm is deterministic even though MVP UI has two members.

## Fixture L — Multi-month contribution

Settlement period covers two contribution cycles:
- John contribution snapshot $4,000
- Blaire contribution snapshot $2,400

Expected:
- engine uses the period snapshot, not current household config.

## Fixture M — Finalized history stability

1. Finalize a period.
2. Change household split/config.
3. Recalculate current open period.
4. Read old finalized settlement.

Expected:
- old finalized result remains byte-for-byte economically unchanged.
- old settlement references original config version.

## Fixture N — Export round trip

1. Seed household/accounts/config/transactions/settlement.
2. Export portable JSON.
3. Import into empty test repository.
4. Recalculate non-finalized fixtures and compare finalized snapshots.

Expected:
- IDs and references restored;
- same calculation results;
- no Firebase-specific values required in export.

## Real historical regression fixtures

Before replacing the spreadsheet, add anonymized fixtures for at least:
- January 2026
- April 2026
- June 2026
- July 2026

The June fixture must explicitly cover the +$266 Blaire and +$341 John reimbursement behavior found in the spreadsheet.

## Fixture O — Automatic month creation

Given:
- no September period exists;
- current config has contribution values;
- two active monthly recurring templates exist.

When:
- the user opens September.

Expected:
- exactly one September settlement period is created;
- contribution/config snapshot is captured;
- exactly two draft recurring transactions are created;
- reopening/retrying bootstrap does not create duplicates.

## Fixture P — Recurring rule history isolation

1. Generate September cleaners draft at $200.
2. Change cleaners template to $225.
3. Open October.

Expected:
- September generated transaction remains $200 unless manually edited;
- October draft is $225;
- historical transaction is not rewritten by template edit.

## Fixture Q — Reopen version history

1. Finalize period as settlement version 1.
2. Reopen with confirmation.
3. Change a transaction.
4. Re-finalize.

Expected:
- version 1 remains immutable;
- version 2 is created;
- version 2 links to/supersedes version 1;
- period points at version 2;
- audit log contains reopen and re-finalization events.

## Fixture R — Monthly report across pools

Given:
- operating spending = $5,651;
- renovation spending = $1,500;
- operating settlement includes only operating pool.

Expected:
- monthly spending report default total = $7,151;
- report exposes pool breakdown;
- operating settlement household expense remains $5,651.

## Fixture S — No hard delete

Attempt to delete a posted historical transaction through normal repository/UI workflow.

Expected:
- hard delete is rejected/not exposed;
- transaction is archived or marked excluded;
- historical/audit reference remains available.

## Fixture T — Historical migration granularity

Import a representative spreadsheet month.

Expected:
- statement/bill totals are preserved as statement/bill-level transactions;
- no invented underlying purchase transactions are created;
- migration source metadata is present;
- calculated settlement matches documented historical intent.
