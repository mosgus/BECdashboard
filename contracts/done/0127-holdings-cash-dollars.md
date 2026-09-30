# Contract 0127 — Show cash dollars in the Holdings table's Shares column

**Status:** reported
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

On `/portfolios`, the **Cash** row's Shares cell shows an estimated dollar amount, e.g.
`$5,000.00`. It does so only when that can be worked out: every holding has a share count and a
current price. Otherwise the cell stays empty, as today.

## Why

The saved `Portfolio` holds `cashWeight` (a percent) but no cash dollars. Contract 0059: "Cash
dollars are not persisted." When every position has shares and a price, the portfolio's total is
already derivable. `impliedPortfolioValue` in `lib/portfolio.ts` computes it as
`Σ shares × price ÷ (1 − cash%)`, and the Add-position form already relies on it. Cash dollars are
then `total × cashWeight / 100`. Optimize's Cash row (contract 0126) uses the same model.

**This is an estimate at today's prices, not the dollars originally typed.** Weights are the saved
truth and never drift, so the derived cash moves with the holdings' prices. If the holdings rise
10%, the shown cash rises 10% too, although real cash would not. The tooltip says so. Storing real
cash dollars would mean changing the `Portfolio` model and every path that edits it (add, remove,
Apply, CSV). That is a separate decision and is out of scope here.

Display only. Nothing is saved, and CSV export/import is unchanged.

## Files

Modify:
- `frontend/src/lib/portfolio.ts` — add `cashDollars: number | null` to `ValuedPortfolio`;
  `valuePortfolio` fills it.
- `frontend/src/lib/portfolio.test.ts` — add tests.
- `frontend/src/components/PositionsTable.tsx` — render it in the Cash row's Shares cell.

**Touch nothing else.** `PortfoliosPage.tsx` needs no change: it already passes `valued`. If the
work appears to need another file, report `BLOCKED`.

## Interface

`lib/portfolio.ts`:

```ts
export interface ValuedPortfolio {
  rows: ValuedRow[]
  cashWeight: number
  /** Estimated at current prices: impliedPortfolioValue × cashWeight / 100. Null unless every
   *  position has shares and a usable price. Presentation only — never saved. */
  cashDollars: number | null
  missingTickers: string[]
}
```

In `valuePortfolio`, compute `const implied = impliedPortfolioValue(portfolio, byTicker)`. Then set
`cashDollars` to `implied === null ? null : implied * portfolio.cashWeight / 100`. Everything else
in the function is unchanged. `impliedPortfolioValue` is declared later in the same file; function
declarations are hoisted, so no move is needed.

`PositionsTable.tsx`: in the Cash row, the third cell (under **Shares**) is currently
`<td className={TD} />`. Replace it with this:
- When `valued.cashDollars === null`: leave it exactly as today.
- Otherwise: `<td className={`${TD} text-right tabular-nums`}>` containing a `Tooltip` whose child
  is a `<span>` showing `formatMoney(valued.cashDollars)`.
  - Import `formatMoney` from `../lib/optimize`. It already exists: `$1,234.50`, with `$0.00` for a
    near-zero value.
  - Tooltip copy is given under Tooltips below.

No other cell, row, header or class changes.

## Out of scope

- No new `Portfolio` field, no storage change, no migration.
- No CSV change, in either export or import. A `CASH` row with a shares value of `0` would fail
  today's weight-mode import check (`Shares for CASH must be a finite number greater than zero`).
  That is one reason the export is deliberately left alone.
- No change to Optimize, CAPM, AddPositionForm or the New portfolio dialog.

## Acceptance criteria

1. `grep -n "cashDollars: number | null" frontend/src/lib/portfolio.ts` prints one line.
2. `grep -n "cashDollars" frontend/src/components/PositionsTable.tsx` prints at least one line.
3. New tests in a `describe('valuePortfolio cash dollars', …)` block. Build the `UniverseEntry`
   values with the file's existing `entry(price)` helper, adding `ticker` and `short_name` via a
   spread if needed. Use `toBeCloseTo(x, 6)` for floats.
   - (a) Cash 10%, positions AAA (weight 45, shares 10, price 45) and BBB (weight 45, shares 30,
     price 15). The market value is $900, so the total is $1000 and `cashDollars` ≈ 100.
   - (b) Same, but BBB has no `shares`: `cashDollars` is `null`.
   - (c) Same as (a), but BBB's entry has price `null`: `cashDollars` is `null`.
   - (d) Same as (a) but cash 0% and weights 50/50: `cashDollars` ≈ 0 (not null).
   - (e) Same as (a), but the map lacks BBB (a missing ticker): `cashDollars` is `null`, and
     `missingTickers` is `['BBB']`.
4. Existing tests pass unchanged. If any existing test compares a whole `valuePortfolio` result
   with `toEqual`, report `BLOCKED` rather than editing it. (None are known to.)
5. From `frontend/`, `npx tsc -p tsconfig.app.json --noEmit` exits 0 and `npm test` passes in full.
6. `npm run lint` shows no warnings in the three touched files.
7. Run `awk 'length > 300'` over the three touched files before and after, and paste both. There
   must be no new long lines.

## Verification to run and paste

Paste the complete, verbatim output of each.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/portfolio.ts frontend/src/lib/portfolio.test.ts frontend/src/components/PositionsTable.tsx   # before AND after
grep -n "cashDollars: number | null" frontend/src/lib/portfolio.ts
grep -n "cashDollars" frontend/src/components/PositionsTable.tsx
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
git diff --stat
```

## Tooltips

- Cash dollars cell: `Estimated from your share counts at current prices: cash is this portfolio's cash weight of its implied total value. It moves with prices; it isn't the amount you originally typed.`

The tooltip sits on non-interactive text, which the Tooltip component supports.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** Run `cd frontend && npm run dev` and open `/portfolios`.
1. Pick a portfolio that has share counts on every holding and some cash; the testSWAP import has
   cash 0, so it will show `$0.00`. The Cash row's Shares cell shows a dollar amount. Hovering it
   shows the tooltip.
2. Pick a weights-only portfolio, e.g. Gunnar Preset. The cell is empty, as before.

## Open questions

None. If a case isn't covered, report `BLOCKED`.
