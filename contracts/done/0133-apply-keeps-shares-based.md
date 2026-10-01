# Contract 0133 — Optimize/CAPM Apply keeps a shares-based portfolio shares-based

**Status:** reported
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

Today `applyPlan` in `frontend/src/lib/optimize.ts` builds its result with explicit fields
(`id, name, cashWeight, positions, updatedAt`). That silently drops `cashDollars`, so every Optimize
or CAPM Apply turns a shares-based portfolio (contract 0129) back into a weight-based one.

This is piece 2(d). After this contract, when the input has `cashDollars`:
- the result keeps `cashDollars`, reduced by whatever cash the deploy slider spends;
- share counts are sized from **dollars**: invested value + cash spent.

The current cash-percentage path is unchanged for weight-based portfolios.

`OptimizePage.tsx` and `CapmSection.tsx` need **no changes**. Both already pass the stored portfolio,
`cashDollars` included, into `applyPlan` (CAPM via `capmApplyPlan`) and save the returned
`plan.portfolio`, and `savePortfolio` keeps `cashDollars`.

## Files

Modify only these:
- `frontend/src/lib/optimize.ts`: the `applyPlan` and `applyConfirmLines` bodies.
- `frontend/src/lib/optimize.test.ts`: new tests.

Anything else → `BLOCKED`. `frontend/src/components/NewPortfolioDialog.tsx` has Gunnar's own
uncommitted edit. **Do not touch it.**

## 1. `applyPlan`

Keep the signature, the early checks and the `sharesMode` logic exactly as they are.

Add, after the `investedValue` line:
```ts
const cashDollars = sharesMode === 'recomputed' ? portfolio.cashDollars : undefined
const keptCash = cashDollars === undefined ? undefined : portfolio.cashWeight > 0 ? cashDollars * cashAfter / portfolio.cashWeight : cashDollars
const sizedValue = cashDollars === undefined || keptCash === undefined
  ? deployedInvestedValue(investedValue, portfolio.cashWeight, cashAfter)
  : investedValue + (cashDollars - keptCash)
```
- In the `positions` map, the recomputed-shares branch uses `sizedValue` in place of the inline
  `deployedInvestedValue(...)` call. The weight formula is unchanged.
- Build `next` with a conditional spread, as `savePortfolio` does:
  `...(keptCash === undefined ? {} : { cashDollars: keptCash })`.

Reasoning, so you don't "simplify" it away:
- The deploy slider keeps a fraction `cashAfter / cashWeight` of the cash. For a shares-based
  portfolio that fraction is applied to the **dollars**.
- The dollars leaving cash are exactly the dollars added to holdings, so total value is conserved
  at the last-close prices Apply already uses.
- `deployedInvestedValue` infers cash from the percentage instead. That percentage is a re-mark
  snapshot taken at `current_price`, not at last close, so it can drift a little.
- When `cashWeight` is 0, `cashAfter` must also be 0 (the existing guard enforces
  `cashAfter <= cashWeight`), so the cash is kept as it is.
- A portfolio with `cashDollars` but some holdings lacking shares is not shares-based. It takes the
  `'cleared'` or `'none'` path, and its `cashDollars` is dropped, as today.

## 2. `applyConfirmLines`

When `plan.portfolio.cashDollars !== undefined`, insert this line directly after the
"Share counts will be recalculated…" line:

`` `Cash will be ${formatMoney(plan.portfolio.cashDollars)} and stays fixed; weights are re-marked from share counts at the next price load.` ``

`formatMoney` is already defined in this file. The final "There is no undo." line stays last. The
existing line-index tests use weight-based fixtures, so they're unaffected. If one breaks, report
`BLOCKED`; don't rewrite it.

## Acceptance criteria

Add a `describe('applyPlan for shares-based portfolios', …)` block in `optimize.test.ts` with its
own fixtures. Don't reuse `PORTFOLIO`/`RESPONSE`.
```ts
const SHARES_BASED: Portfolio = {
  id: 'sb', name: 'Shares', cashWeight: 10, cashDollars: 100, updatedAt: '2026-09-30T00:00:00.000Z',
  positions: [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 45, shares: 30 }],
}
const SB_CLOSES = new Map<string, number | null>([['AAA', 45], ['BBB', 15]])
const SB_RESPONSE = { tickers: ['AAA', 'BBB'], target_weights: { AAA: 0.6, BBB: 0.4 }, feasible: true }
```
Use `toBeCloseTo(x, 6)` for computed floats.

1. `applyPlan(SHARES_BASED, SB_RESPONSE, SB_CLOSES)` (no deploy):
   - `ok`
   - `cashDollars` ≈ 100 and `cashWeight` 10
   - shares AAA ≈ 12 and BBB ≈ 24
   - weights ≈ 54 and 36
   - `sharesMode` is `'recomputed'`
2. Deploy half the cash (`cashAfter` 5):
   - `cashDollars` ≈ 50
   - shares AAA ≈ 12.666667 and BBB ≈ 25.333333
   - weights ≈ 57 and 38
3. Deploy all the cash (`cashAfter` 0):
   - `cashDollars` ≈ 0; it is **present**: `toBeCloseTo(0, 6)`, not undefined
   - shares AAA ≈ 13.333333 and BBB ≈ 26.666667
4. A target of `{ AAA: 1, BBB: 0 }`:
   - positions are `[AAA]` only
   - AAA shares ≈ 20
   - `cashDollars` ≈ 100 and `removed` is `['BBB']`
5. The same holdings with the `cashDollars` key omitted (a weight-based portfolio with shares):
   - the result has no `cashDollars` key: `expect('cashDollars' in plan.portfolio).toBe(false)`
   - with `cashAfter` 5, AAA shares ≈ 12.666667. `deployedInvestedValue(900,10,5)` = 950, so this
     holds on the old path too.
6. `cashDollars: 100`, but BBB has no `shares`:
   - `sharesMode` is `'cleared'`
   - no `cashDollars` key in the result
7. `applyConfirmLines` on plan 2 contains
   `'Cash will be $50.00 and stays fixed; weights are re-marked from share counts at the next price load.'`,
   and its last line is `'There is no undo.'`.
8. From `frontend/`:
   - `npx tsc -p tsconfig.app.json --noEmit` exits 0.
   - `npm test` passes in full: 236 + the new tests.
   - `npm run lint` shows only the HelpSidebar.tsx:44 and UniversePage.tsx:77 warnings.
9. Run `awk 'length > 300'` on both files, **before and after**. Both runs print nothing.

## Verification to run and paste

**Paste every output verbatim, including the before awk.**

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/optimize.ts frontend/src/lib/optimize.test.ts   # BEFORE editing
# ... edit ...
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/optimize.ts frontend/src/lib/optimize.test.ts   # AFTER
git diff frontend/src/lib/optimize.ts
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test 2>&1 | tail -6
```

## Out of scope

- Re-marking weights at Apply time. The next `getUniverse` load does it (contract 0129).
- Selling or buying whole shares. Shares stay fractional, as today.
- Add position (2b).

## Human verification (Gunnar)

Export BEC first so you can restore it.
1. On `/portfolios`, confirm BEC's Cash editor shows dollars (shares-based).
2. Open Analyze → Optimize and run it. Set the cash slider to about 50%, then Apply. The confirmation
   should include the "Cash will be $… and stays fixed" line, at about half of the previous cash.
3. Back on `/portfolios`, the Cash editor still shows **dollars**, not %, at that amount. Shares
   changed, and weights look right after a reload.
4. Do the same through CAPM Apply. Cash dollars should be unchanged, because CAPM doesn't deploy cash.
