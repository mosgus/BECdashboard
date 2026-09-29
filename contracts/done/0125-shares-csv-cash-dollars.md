# Contract 0125 — Read CASH as dollars in shares-only portfolio CSVs

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

A portfolio CSV with a shares column and **no** weight column can carry a `CASH` row. That row's
`shares` cell is read as a **dollar amount** and lands in the dialog's "Cash $" field. Today the
same file is rejected with `CASH needs a finite weight of zero or greater`.

```csv
ticker,shares
AAPL,10
CASH,5000
```

## Why

`parsePortfolioCsv` already seeds shares mode when a file has shares but no weights (the test "uses
shares mode when shares are the only allocation input"). In shares mode the dialog's cash field is
in **dollars** (`summariseDraft`'s `cashDollars`). But the parser only ever reads `CASH` from the
weight column, so a shares-only file has no way to state cash. A brokerage-style holdings file is
therefore rejected on its cash line.

Decided 2026-09-29: in a shares-only file, `CASH`'s `shares` cell means dollars, as if cash had a
price of $1 per share. We rejected a separate `value` column: it would add a column to the format we
own to serve one row. Every other file type is unchanged. A file with any weight column
(`weight_pct`, `weight`, `target_pct`) keeps reading `CASH` from the weight column and still rejects
a `CASH` row with no weight.

## Files

Modify:
- `frontend/src/lib/portfolioCsv.ts` — `parsePortfolioCsv` only.
- `frontend/src/lib/portfolioCsv.test.ts` — add the tests listed below.

**Touch nothing else.** `NewPortfolioDialog.tsx`, `portfolio.ts`, `serializePortfolioCsv` and
`REBUILD.md` do **not** change. The planner has already recorded the decision in `REBUILD.md`. If the
work appears to require editing any other file, stop and report `BLOCKED` instead.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

No signature changes. `CsvImportResult`, `DraftSeed` and `SeedRow` stay exactly as they are.

"Shares-only file" means the existing local `mode === 'shares'`, which is already computed before
the row loop. It is true exactly when there is no `target_pct` column, no weight column, and there is
a shares column. Do not compute a second condition. Reuse `mode`.

Changes inside `parsePortfolioCsv`:

1. Declare `let cashDollars: string | null = null` next to `statedCash`.
2. In the row loop, insert this branch **after** the duplicate-ticker check (`seen.add(ticker)`) and
   **before** the `if (sharesIndex !== null && shares.trim() !== '' && finitePositive(shares) === null)`
   check. The order matters: that check rejects `0`, and `CASH,0` must be accepted.

   ```ts
   if (mode === 'shares' && ticker === 'CASH') {
     const dollars = Number(shares)
     if (shares.trim() === '' || !Number.isFinite(dollars) || dollars < 0) {
       return failure('CASH needs a dollar amount of zero or greater in the shares column', row.line)
     }
     cashDollars = shares.trim()
     continue
   }
   ```

   This branch must **not** touch `statedCash` or `positionWeightTotal`. Dollars are not a
   percentage. If they fed those variables, the `cannot exceed 100%` and `requires the file total to
   equal 100%` checks would fire on any cash over $100.
3. In the `positions.length === 0` early return, when `mode === 'shares'` return
   `{ ok: true, seed: { name, mode: 'shares', cash: cashDollars ?? '', rows: [] }, dropped: [] }`.
   The existing return is unchanged for every other mode.
4. In the `if (mode === 'shares')` return, change `cash: ''` to `cash: cashDollars ?? ''`. Nothing
   else on that line changes.

The existing weight-mode `CASH` branch (`CASH needs a finite weight of zero or greater`) stays as it
is, and it is still reached for every file that is not shares-only.

## Out of scope

- Do not accept `$`, thousands separators (`1,234`), or parenthesised negatives. Reading brokerage
  number formats is a separate decision, and `REBUILD.md` rejected guessing at formats on purpose.
- Do not change how `CASH` is read in any file that has a weight column. That includes a file with
  both `weight_pct` and `shares` whose `CASH` row has a blank weight but a filled shares cell: it
  must still fail with the existing weight message.
- Do not change the dialog, its dropped-ticker messages, or its Cash $ tooltip.
- Do not change `serializePortfolioCsv`. Exports stay `ticker,weight_pct,shares` with cash as a
  percentage.
- Do not reformat unrelated code, and do not collapse multi-line code onto one line.

## Acceptance criteria

1. `grep -c "CASH needs a dollar amount of zero or greater in the shares column" frontend/src/lib/portfolioCsv.ts`
   prints `1`.
2. `grep -c "CASH needs a finite weight of zero or greater" frontend/src/lib/portfolioCsv.ts` prints
   `1`. The weight-mode branch still exists.
3. `grep -n "cash: cashDollars ?? ''" frontend/src/lib/portfolioCsv.ts` prints exactly two lines:
   the empty-positions return and the shares-mode return.
4. `grep -n "cashDollars" frontend/src/lib/portfolioCsv.ts` shows no line that also contains
   `statedCash` or `positionWeightTotal`.
5. A new `describe('shares-only CSV cash', …)` block in `portfolioCsv.test.ts` contains **at least**
   these tests, using the file's existing `universe` set and `successful` helper, with exactly these
   inputs:
   - (a) `'ticker,shares\nAAPL,10\nCASH,5000\n'` → `result.seed` `toEqual`
     `{ name: '', mode: 'shares', cash: '5000', rows: [{ ticker: 'AAPL', weight: '', shares: '10' }] }`
     and `result.dropped` `toEqual([])`.
   - (b) `'ticker,shares\nAAPL,10\nCASH,0\n'` → `seed.cash` is `'0'`.
   - (c) `'ticker,shares\nAAPL,10\nCASH,250\n'` succeeds with `seed.cash` `'250'`. This proves that
     dollars never reach the 100% checks.
   - (d) `'ticker,quantity\nAAPL,10\nCASH,\n'`, `'ticker,shares\nAAPL,10\nCASH,-5\n'` and
     `'ticker,shares\nAAPL,10\nCASH,abc\n'` each return
     `{ ok: false, error: 'CASH needs a dollar amount of zero or greater in the shares column', line: 3 }`
     (use `toEqual`).
   - (e) `'ticker,shares\nCASH,5000\n'` → the whole result `toEqual`
     `{ ok: true, seed: { name: '', mode: 'shares', cash: '5000', rows: [] }, dropped: [] }`.
   - (f) `'ticker,shares\nAAPL,10\nZZZ,5\nCASH,100\n'` → `seed.cash` is `'100'`, `seed.rows` is only
     AAPL, and `dropped` `toEqual([{ ticker: 'ZZZ', weightPct: null }])`.
   - (g) `'ticker,shares\nAAPL,10\nCASH,100\nCASH,200\n'` →
     `toMatchObject({ ok: false, error: 'Duplicate ticker: CASH', line: 4 })`.
   - (h) **Regression, weight file unchanged:** `'ticker,weight_pct,shares\nAAPL,60,2\nCASH,,5000\n'`
     → `toMatchObject({ ok: false, error: 'CASH needs a finite weight of zero or greater', line: 3 })`.
   - (i) **End to end through the dialog's math:** parse (a)'s input. Then call
     `summariseDraft(toDraft({ ...result.seed, name: 'X' }), new Map([['AAPL', { ...entry('AAPL'), current_price: 100 }]]))`.
     Assert `canCreate` is `true`, `cashWeight` `toBeCloseTo(83.333333, 4)`, and the AAPL row's
     `weight` `toBeCloseTo(16.666667, 4)`. (10 × $100 = $1000 in AAPL, plus $5000 cash, makes $6000.)
     Use `toBeCloseTo`, never `toBe`. These values come from a division.
6. Every test that already exists in `portfolioCsv.test.ts` passes **unmodified**. Do not edit an
   existing test to make it pass. If one fails, report `BLOCKED`.
7. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (Plain `--noEmit` doesn't check
   anything in this project, so never use it.)
8. `cd frontend && npm run lint` exits 0, with no new warnings in the two touched files.
9. `cd frontend && npm test` passes in full.
10. `awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/portfolioCsv.ts frontend/src/lib/portfolioCsv.test.ts`
    prints nothing new compared with before your edit. Run it before editing too, and paste both
    outputs.

If any criterion cannot be met as written, report `BLOCKED` and say which one. That includes
criteria that contradict each other. Don't find a clever way to pass it. A clever pass is worse than
a stop.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output, including failures. Do not
summarize, do not trim, do not clean up. State which files you edited.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/portfolioCsv.ts frontend/src/lib/portfolioCsv.test.ts   # before AND after
grep -c "CASH needs a dollar amount of zero or greater in the shares column" frontend/src/lib/portfolioCsv.ts
grep -c "CASH needs a finite weight of zero or greater" frontend/src/lib/portfolioCsv.ts
grep -n "cash: cashDollars ?? ''" frontend/src/lib/portfolioCsv.ts
grep -n "cashDollars" frontend/src/lib/portfolioCsv.ts
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
```

## Tooltips

No new interactive elements.

## Human verification — does Gunnar need to run anything?

**Run the frontend and import a file.** Save this as `cash-test.csv`:

```csv
ticker,shares
AAPL,10
CASH,5000
```

Use any ticker that is in your Universe in place of `AAPL`. Run `cd frontend && npm run dev`, open
http://localhost:5173/portfolios, click **New portfolio**, and import the file. You should see:

1. The dialog opens in **Shares** mode, and the ticker row shows 10 shares.
2. The **Cash $** field shows `5000`.
3. The derived cash % equals 5000 ÷ (10 × price + 5000), and **Create** is enabled.

Then change the header to `ticker,weight_pct,shares` and the cash line to `CASH,,5000`, and import
again. It must still fail with `CASH needs a finite weight of zero or greater (line 3)`.

## Open questions

None. If a case isn't covered above, report `BLOCKED`. Don't guess.
