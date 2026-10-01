# Contract 0131 — Removing a holding from a shares-based portfolio sells it into cash dollars

**Status:** reported
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

On `/portfolios`, clicking **Remove** on a holding of a **shares-based** portfolio (contract 0129)
sells it at the current price:
- `cashDollars += shares × price`
- the weights are re-marked
- the portfolio stays shares-based.

Today `removePositionToCash` hands the removed weight to cash and drops `cashDollars`, which reverts
the portfolio to weight-based.

Weight-based portfolios keep today's behavior exactly.

This is piece 2(a) of the shares-first work. See REBUILD: "Shares-based portfolios … (contract
0129)" and "Shares-based cash is edited in dollars (contract 0130)".

## Files

Modify only these:
- `frontend/src/lib/portfolio.ts`: new `removePositionSelling`.
- `frontend/src/lib/portfolio.test.ts`: tests.
- `frontend/src/pages/PortfoliosPage.tsx`: `handleRemovePosition` and a notice line.
- `frontend/src/components/PositionsTable.tsx`: Remove tooltip text.

Anything else → `BLOCKED`. `frontend/src/components/NewPortfolioDialog.tsx` has Gunnar's own
uncommitted edit. **Do not touch it.**

## 1. `lib/portfolio.ts`

```ts
/** Sell a shares-based holding at its current price into fixed cash, then re-mark (contract 0131).
 *  Null when the portfolio isn't shares-based, the ticker isn't held, or a needed price is unusable. */
export function removePositionSelling(
  portfolio: Portfolio,
  ticker: string,
  byTicker: Map<string, UniverseEntry>,
): Portfolio | null
```
Implement it by composing existing functions. Do not write new weight arithmetic.
1. Return null unless `isValidCurrentPortfolio(portfolio)` and `isSharesBased(portfolio)` both hold.
2. Find the position. If it is absent, return null.
3. Get `price = positionPrice(byTicker.get(ticker))`. Unless `isFinitePositive(price)`, return
   null.
4. Compute `proceeds = shares × price`. Unless it is `isFinitePositive`, return null.
5. `const base = removePositionToCash(portfolio, ticker)`. If it is null, return null. `base` is
   valid and weight-based.
6. Return `withCashDollars({ ...base, cashDollars: 0 }, portfolio.cashDollars + proceeds, byTicker)`.
   The placeholder `cashDollars: 0` only makes `base` shares-based so that `withCashDollars`
   accepts it. `withCashDollars` then sets the real amount. It already handles the "no positions
   left" case (100% cash) and returns null if any remaining holding lacks a price.

Leave `removePositionToCash` unchanged. The 0129 test proving it drops `cashDollars` must still
pass.

## 2. `pages/PortfoliosPage.tsx`

Add state: `const [positionNotice, setPositionNotice] = useState<string | null>(null)`. Clear it
whenever the selected portfolio changes. Add `current?.id` handling to an effect: either extend the
existing cash reseed effect with a `setPositionNotice(null)` line, or add a small separate effect
keyed on `current?.id`. Pick one; don't do both.

`handleRemovePosition(ticker)` becomes:
- `current === null` → return. (Unchanged.)
- **Not shares-based** → the existing code path, exactly: `removePositionToCash` then `persist`.
  Also `setPositionNotice(null)`.
- **Shares-based and `universeState.status !== 'ready'`** → do nothing to the portfolio.
  `setPositionNotice(\`Current prices are needed to sell ${ticker} into cash. Try again once the Universe has loaded.\`)`
- **Shares-based and ready**:
  - `next = removePositionSelling(current, ticker, actualByTicker)`.
  - If `next !== null`: `persist(next)` and `setPositionNotice(null)`.
  - If null: fall back to `removePositionToCash(current, ticker)`. If that is non-null, `persist`
    it and call
    `setPositionNotice(\`${ticker} was removed by weight because a current price was missing, so this portfolio is now weight-based. Set its cash in dollars again by re-importing its shares.\`)`

  Why the fallback: a holding that is "No longer in Universe" has no price and can never be sold.
  Blocking would leave the user unable to remove it, and every future re-mark of that portfolio
  would fail too. Reverting to weight-based is today's behavior, now said out loud.

Render the notice, when non-null, directly **above** `<PositionsTable …/>` as
`<p className="text-sm text-brand-negative mb-3">{positionNotice}</p>`. Match the style of the
neighbouring "The Universe could not be reached…" paragraph.

## 3. `components/PositionsTable.tsx`

The Remove button's tooltip label depends on `valued.cashFixed`:
- when true: `` `Sell ${row.ticker} at its current price; the proceeds go to cash.` ``
- otherwise, unchanged: `` `Remove ${row.ticker} from this portfolio` ``

## Acceptance criteria

Use `toBeCloseTo(x, 6)` for computed floats.

1. Add tests in a `describe('removePositionSelling', …)` block in `portfolio.test.ts`. Build prices
   with the file's existing `entry(price)` helper, as the 0129 and 0130 tests do. The base portfolio
   is AAA 10 shares @ $45 and BBB 30 @ $15, with `cashDollars: 100` and saved weights 45/45/10.
   - (a) Remove AAA at $45. The result holds only BBB. `cashDollars` ≈ 550, BBB weight ≈ 45,
     `cashWeight` ≈ 55. `updatedAt` is unchanged.
   - (b) Remove AAA with AAA at $55. `cashDollars` ≈ 650, BBB ≈ 40.909091, cash ≈ 59.090909.
   - (c) Remove AAA, then BBB (feed (a)'s result back in). `positions` is empty, `cashWeight` is
     100 and `cashDollars` ≈ 1000.
   - (d) Null when AAA's price is null.
   - (e) Null when BBB's price is null. The remaining holding can't be re-marked.
   - (f) Null for a weight-based portfolio (no `cashDollars`).
   - (g) Null for a ticker that isn't held.
   - (h) The input is not mutated.
2. `grep -n "removePositionSelling" frontend/src/pages/PortfoliosPage.tsx` prints the import and one
   call.
3. `grep -n "removed by weight because a current price was missing" frontend/src/pages/PortfoliosPage.tsx`
   prints one line.
4. `grep -n "the proceeds go to cash" frontend/src/components/PositionsTable.tsx` prints one line.
5. From `frontend/`:
   - `npx tsc -p tsconfig.app.json --noEmit` exits 0.
   - `npm test` passes in full.
   - `npm run lint` shows only the pre-existing HelpSidebar.tsx:44 and UniversePage.tsx:77
     warnings.
6. Before and after, `awk 'length > 300'` over the three source files prints nothing. If a TSX
   file collapses, run `npx --yes prettier@3 --print-width 120 --single-quote --no-semi --write <file>`.

## Verification to run and paste

**Paste every output verbatim.**

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/PortfoliosPage.tsx frontend/src/components/PositionsTable.tsx frontend/src/lib/portfolio.ts   # before AND after
grep -n "removePositionSelling" frontend/src/pages/PortfoliosPage.tsx
grep -n "removed by weight because a current price was missing" frontend/src/pages/PortfoliosPage.tsx
grep -n "the proceeds go to cash" frontend/src/components/PositionsTable.tsx
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test 2>&1 | tail -6
git diff --stat
```

## Out of scope

- Selling part of a holding. Remove sells the whole position.
- Add position (2b) and Apply (2d).
- A confirm dialog before selling. Remove has never asked for confirmation; keep that.

## Human verification (Gunnar)

Run `cd frontend && npm run dev`, open `/portfolios`, and select a shares-based BEC portfolio.
1. Hover **Remove** on a row. The tooltip says it sells at the current price.
2. Note that row's value (shares × price) and the current Cash dollars. Click Remove. Cash dollars
   rise by about that value. The other weights re-mark, and the Cash tooltip still says the amount
   is fixed.
3. Reload the page. The change persists.
4. On a weights-only portfolio, Remove behaves as before, with no notice.

Tip: export the BEC portfolio first, so you can re-import it to undo the test.

## Open questions

None. Report `BLOCKED` for anything uncovered.
