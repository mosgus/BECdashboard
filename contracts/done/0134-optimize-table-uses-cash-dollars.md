# Contract 0134 — The Optimize trade table and CSV use the same cash dollars that Apply saves

**Status:** reported
**Assigned to:** haiku
**Author:** planner (opus)

## Bug

For a shares-based portfolio, the Optimize results table and CSV work out cash from the
percentage:
- `OptimizePage.tsx:372` sets `total = investedValue / ((100 - cashWeight) / 100)`.
- `DollarCashRow` shows `total × cashWeight / 100`.
- `dollarRows` and `optimizeCsv` size targets with `deployedInvestedValue(...)`.

Since 0133, Apply sizes from the stored `cashDollars`. The two sources disagree:
- `cashWeight` is a re-mark snapshot taken at `current_price`.
- The table values holdings at last close.

Gunnar's BEC run showed current cash **$296,801.20** in the table against stored cash of about
$292,406.58. With 50% deployed, the table promised $148,400.60 left in cash, but Apply saves
≈ $146,203. Every share count Apply saves is ~0.4% below what the table showed.

**The table must show what Apply will save.**

## Fix: one shared helper, used by Apply, the table, the note and the CSV

### `frontend/src/lib/optimize.ts`

Add, next to `deployedInvestedValue`:
```ts
export interface CashSplit { cashBeforeDollars: number; cashAfterDollars: number; sizedValue: number }

/** Dollars in cash before and after deployment, and the invested value to size targets on (contract 0134).
 *  Uses fixed cash dollars when present; otherwise infers cash from the percentage. */
export function cashSplit(investedValue: number, cashWeight: number, cashAfter: number, cashDollars?: number): CashSplit {
  if (cashDollars !== undefined) {
    const cashAfterDollars = cashWeight > 0 ? cashDollars * cashAfter / cashWeight : cashDollars
    return { cashBeforeDollars: cashDollars, cashAfterDollars, sizedValue: investedValue + cashDollars - cashAfterDollars }
  }
  const total = cashWeight < 100 ? investedValue / ((100 - cashWeight) / 100) : 0
  return { cashBeforeDollars: total * cashWeight / 100, cashAfterDollars: total * cashAfter / 100, sizedValue: deployedInvestedValue(investedValue, cashWeight, cashAfter) }
}
```

- **`applyPlan`:** delete the `keptCash` and `sizedValue` constants that 0133 added. Keep the
  `cashDollars` constant, then add
  `const split = cashSplit(investedValue, portfolio.cashWeight, cashAfter, cashDollars)`.
  - The shares use `split.sizedValue`.
  - The conditional spread becomes
    `...(cashDollars === undefined ? {} : { cashDollars: split.cashAfterDollars })`.
  - Behavior must not change: all 242 existing tests pass unedited.
- **`optimizeCsv`:** add a trailing optional parameter, `cashDollars?: number`. In the dollar
  branch, replace `deployedInvestedValue(basis.investedValue, cashWeight, cashAfter)` with
  `cashSplit(basis.investedValue, cashWeight, cashAfter, cashDollars).sizedValue`.

### `frontend/src/pages/analysis/OptimizePage.tsx`

- In `OptimizeResults`, widen the prop type from `portfolio: { cashWeight: number; name: string }`
  to `{ cashWeight: number; name: string; cashDollars?: number }`. The caller already passes the
  full portfolio.
- Replace the `total` constant (line 372) with
  `const split = basis.kind === 'dollar' ? cashSplit(basis.investedValue, portfolio.cashWeight, cashAfter, portfolio.cashDollars) : null`.
- `dollarRows`: its `tradeRows(...)` target value argument becomes `split!.sizedValue`. That
  branch only runs when `basis.kind === 'dollar'`; a non-null check is fine if you prefer it to
  `!`.
- CSV button: pass `portfolio.cashDollars` as the new last argument to `optimizeCsv`.
- `DollarCashRow`: change its props to
  `{ cashWeight: number; cashAfter: number; beforeDollars: number; afterDollars: number }`.
  - Current value: `formatMoney(beforeDollars)`.
  - Optimized value: `formatMoney(afterDollars)`.
  - Trade $: `formatSignedMoney(afterDollars - beforeDollars)`.
  - The percentage cells are unchanged.
  - Where it renders: `total !== null` → `split !== null`, passing
    `beforeDollars={split.cashBeforeDollars} afterDollars={split.cashAfterDollars}`.
- `tradeBasisNote` call (line 474): its second argument becomes
  `split === null ? 0 : split.cashBeforeDollars - split.cashAfterDollars`.
- Import `cashSplit`. Remove the `deployedInvestedValue` import if nothing else in the file uses it,
  or lint will flag it.

`grep -n "total" frontend/src/pages/analysis/OptimizePage.tsx` should no longer show the old
`total` constant or its uses. "Max total short" is a label and stays.

## Files

Modify only:
- `frontend/src/lib/optimize.ts`
- `frontend/src/lib/optimize.test.ts`
- `frontend/src/pages/analysis/OptimizePage.tsx`

Anything else → `BLOCKED`. `frontend/src/components/NewPortfolioDialog.tsx` has Gunnar's own
uncommitted edit. **Do not touch it.**

**Long lines:** `OptimizePage.tsx` **already** has three long lines, at 458, 463 and 468 (380,
574 and 1123 chars). Don't run prettier on it; that would bury this change in a whole-file
reformat. The after check must show **no more than three** long lines in that file, and no long
lines in the other two.

## Acceptance criteria

Use `toBeCloseTo(x, 6)` for computed floats. Add a `describe('cashSplit', …)` block with these
cases:
1. `cashSplit(900, 10, 5, 100)` →
   - `cashBeforeDollars` ≈ 100
   - `cashAfterDollars` ≈ 50
   - `sizedValue` ≈ 950
2. **Snapshot drift.** `cashSplit(900, 12, 6, 100)` →
   - before ≈ 100, after ≈ 50, sized ≈ 950
   - The percentage path would give 961.363636, so this case proves the dollars are used.
3. `cashSplit(900, 10, 5)`, with no dollars →
   - before ≈ 100, after ≈ 50
   - sized ≈ 950, equal to `deployedInvestedValue(900, 10, 5)`
4. `cashSplit(900, 0, 0, 0)` → before 0, after 0, sized ≈ 900.
5. **Drift through Apply.** Take 0133's `SHARES_BASED`, but with `cashWeight: 12` and weights 44/44
   so it stays valid. Then `applyPlan(…, SB_RESPONSE, SB_CLOSES, 6)` gives:
   - `cashDollars` ≈ 50
   - AAA shares ≈ 12.666667 (0.6 × 950 / 45)
   - BBB ≈ 25.333333

   This also closes the 0133 test gap.
6. **CSV agrees with Apply.** For a dollar basis with investedValue 900 and shares/prices matching
   the SB fixture, and a response whose current/target weights come from `RESPONSE`'s shape or a
   local two-ticker response: `optimizeCsv(response, basis, 12, 6, 100)`'s AAA `target_shares`
   equals `applyPlan`'s AAA shares for the same inputs, to 6 decimals.

   If building a matching `OptimizeResponse` fixture takes more than ~15 lines, drop test 6 and say
   so in the report. Don't report `BLOCKED` for it.
7. All pre-existing tests pass **unedited**. `git diff frontend/src/lib/optimize.test.ts` shows
   only additions.
8. From `frontend/`:
   - `npx tsc -p tsconfig.app.json --noEmit` exits 0.
   - `npm test` passes in full.
   - `npm run lint` shows only the HelpSidebar.tsx:44 and UniversePage.tsx:77 warnings.

## Verification to run and paste

**Paste every output verbatim, including the before awk. Don't bundle the before check into a
longer command whose output gets truncated.**

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/analysis/OptimizePage.tsx frontend/src/lib/optimize.ts frontend/src/lib/optimize.test.ts   # BEFORE, run alone
# ... edit ...
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/analysis/OptimizePage.tsx frontend/src/lib/optimize.ts frontend/src/lib/optimize.test.ts   # AFTER
grep -n "total" frontend/src/pages/analysis/OptimizePage.tsx
grep -n "cashSplit" frontend/src/pages/analysis/OptimizePage.tsx frontend/src/lib/optimize.ts
git diff --stat
git diff frontend/src/lib/optimize.test.ts | grep -c '^-[^-]'   # must print 0
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test 2>&1 | tail -6
```

## Out of scope

- The CAPM tables. CAPM doesn't deploy cash, and its trade rows size on invested value, not cash.
- The Current % column. It is still the saved re-mark snapshot, and that drift is accepted
  (REBUILD, 0133).

## Human verification (Gunnar)

1. On `/portfolios`, note BEC's Cash dollars.
2. On Optimize, run and set the slider to 50%.
   - The Cash row's Current value equals the dollars from step 1 exactly.
   - Its Optimized value is half of that.
3. Apply, then return to `/portfolios`. The Cash dollars and every share count match the table's
   Optimized columns to the cent and to the share.
