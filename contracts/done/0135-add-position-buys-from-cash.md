# Contract 0135 — Adding a holding to a shares-based portfolio buys it with cash dollars

**Status:** reported
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

On `/portfolios`, adding a holding to a **shares-based** portfolio (contract 0129) **buys** it:
- it costs shares × current price, paid from `cashDollars`;
- the portfolio is re-marked;
- it stays shares-based.

Today `addPositionDiluting` drops `cashDollars`, so the portfolio silently reverts to weight-based.
This is piece 2(b), the last of piece 2.

Planner decisions. Gunnar can overrule any of them; don't change them yourself.
- **Shares only.** The weight field is disabled for shares-based portfolios. Typing "5%" would mean
  guessing a total value to convert from, and the shares are the truth.
- **No buying on margin.** If the cost exceeds the cash, Add is disabled and the form shows the
  most shares the cash can buy. We do **not** sell other holdings to make room. The weight-based
  form dilutes existing positions, but here that would rewrite share counts Gunnar typed in from
  the brokerage.
- **One source of truth.** The form's preview (cost, cash left, resulting weight) comes from the
  same function that produces the saved portfolio. That lesson comes from 0134.

Weight-based portfolios keep today's form and behavior **exactly**.

## Files

Modify only these:
- `frontend/src/lib/portfolio.ts`: new `addPositionBuying`.
- `frontend/src/lib/portfolio.test.ts`: tests.
- `frontend/src/components/AddPositionForm.tsx`: shares-based mode.
- `frontend/src/pages/PortfoliosPage.tsx`: pass two new props.

Anything else → `BLOCKED`. `frontend/src/components/NewPortfolioDialog.tsx` has Gunnar's own
uncommitted edit. **Do not touch it.**

## 1. `lib/portfolio.ts`

```ts
export type BuyResult =
  | { ok: true; portfolio: Portfolio; cost: number }
  | { ok: false; reason: 'invalid' | 'held' | 'no-price' | 'insufficient-cash' | 'unpriced-holding' }

/** Buy a new holding in a shares-based portfolio with its fixed cash, then re-mark (contract 0135). */
export function addPositionBuying(
  portfolio: Portfolio,
  ticker: string,
  shares: number,
  byTicker: Map<string, UniverseEntry>,
): BuyResult
```

Implement it by composing existing functions, the same pattern as `removePositionSelling` (0131).
Don't write new weight arithmetic.
1. If `!isValidCurrentPortfolio(portfolio)`, `!isSharesBased(portfolio)`, `ticker === ''` or
   `!isFinitePositive(shares)` → `'invalid'`.
2. If the ticker is already held → `'held'`.
3. `price = positionPrice(byTicker.get(ticker))`. If `!isFinitePositive(price)` → `'no-price'`.
4. `cost = shares * price`. If `!isFinitePositive(cost)` → `'invalid'`.
5. If `cost > portfolio.cashDollars! + 0.005` → `'insufficient-cash'`. The half-cent tolerance
   lets "spend all of it" work through rounding.
6. `cashAfter = Math.max(0, portfolio.cashDollars! - cost)`.
7. `base = addPositionDiluting(portfolio, { ticker, weight: 1, shares })`. If null → `'invalid'`.
   The 1% weight is a **placeholder**: it only gives `base` valid weights, so the next step accepts
   it, and the re-mark overwrites every weight.
8. `next = withCashDollars({ ...base, cashDollars: 0 }, cashAfter, byTicker)`. The `cashDollars: 0`
   placeholder makes `base` shares-based again; `withCashDollars` sets the real amount and re-marks.
   - If null → `'unpriced-holding'`. The new ticker's price was already checked, so the failure
     came from an existing holding.
   - Otherwise return `{ ok: true, portfolio: next, cost }`.

Leave `addPositionDiluting` unchanged. Its 0129 test proving it drops `cashDollars`
(`portfolio.test.ts:96`) must still pass.

## 2. `components/AddPositionForm.tsx`

Add two props: `sharesBased: boolean` and `onBuy: (next: Portfolio) => void`. When
`sharesBased` is **false**, render and behave exactly as today; don't restructure that path.

When `sharesBased` is **true**:
- Build `const allByTicker = new Map(universe.map((entry) => [entry.ticker, entry]))` from **all**
  universe entries, not the `holdable` filter. Existing holdings must be priced even if they aren't
  holdable types.
- Compute
  `const buy = ticker !== '' && available.some((entry) => entry.ticker === ticker) && shares.trim() !== '' ? addPositionBuying(portfolio, ticker, Number(shares), allByTicker) : null`
  on every render.
- **Weight input:** `disabled`, its value forced to `''`, and its tooltip label becomes
  `'This portfolio is shares-based: enter a share count. The weight follows from shares and current prices.'`
- **Read-only derived-weight box:** show it only when `buy?.ok`. Its value is the new position's
  weight in `buy.portfolio`: find it by ticker and run it through `formatPercent`. Don't use
  `weightFromShares` here; it assumes new money is added, but a buy only converts cash.
- **Add button:** disabled unless `buy?.ok`. On click, call `onBuy(buy.portfolio)`, then clear the
  three fields as today. Tooltip label: `'Buy these shares with this portfolio\'s cash'`.
- **One message line**, in the existing
  `<p className="basis-full text-xs text-[var(--color-muted)]">` style, when `buy !== null`:
  - ok: `` `Costs ${formatMoney(buy.cost)} of ${formatMoney(portfolio.cashDollars!)} cash; ${formatMoney(buy.portfolio.cashDollars!)} left.` ``
  - `'insufficient-cash'`: `` `Not enough cash: ${formatMoney(portfolio.cashDollars!)} buys at most ${formatShares(portfolio.cashDollars! / price)} shares of ${ticker}.` ``
    Here `price` is `positionPrice(allByTicker.get(ticker))`, which is guaranteed usable at this
    point.
  - `'no-price'`: `'Add by shares needs a usable current price for the selected ticker.'`
  - `'unpriced-holding'`: `'Every holding needs a current price before buying, so the weights can be re-marked.'`
  - `'invalid'`: `'Enter a share count greater than 0.'`
  - `'held'` can't occur, because `available` excludes held tickers. Render nothing for it.
- Do **not** render the weight-mode extras in shares mode: the two "Add by shares needs…"
  hints and the "Funding … will scale existing positions" line.
- Import `formatMoney` from `'../lib/optimize'` (as PositionsTable does), `formatShares` from
  `'../lib/format'`, and `addPositionBuying` from `'../lib/portfolio'`.

⚠️ **`Tooltip` calls `Children.only`.** Every `<Tooltip>` must wrap **exactly one** element. A
conditional sibling inside a Tooltip blanks the whole page; that's how 0119 broke the Outlook tab.
Put new conditional elements **outside** Tooltips.

## 3. `pages/PortfoliosPage.tsx`

On `<AddPositionForm …/>` add `sharesBased={sharesBased}` and `onBuy={persist}`. Leave
`handleAddPosition` alone. It still serves weight-based portfolios, and the shares-based form never
calls `onAdd`.

## Acceptance criteria

Use `toBeCloseTo(x, 6)` for computed floats. Add a `describe('addPositionBuying', …)` block. Build
prices with the file's `entry(price)` helper.

Base portfolio:
- AAA 10 shares @ $45 and BBB 30 @ $15;
- `cashDollars: 100`, weights 45/45/10;
- CCC is in the map @ $20.

Cases:
1. **Buy 4 CCC.** `ok`, `cost` ≈ 80, `cashDollars` ≈ 20. Weights: AAA ≈ 45, BBB ≈ 45, CCC ≈ 8,
   `cashWeight` ≈ 2. CCC shares 4. `updatedAt` is unchanged.
2. **Buy 5 CCC** (all the cash). `cashDollars` ≈ 0, `cashWeight` ≈ 0, CCC ≈ 10.
3. **Buy 5.0002 CCC** (cost 100.004, inside the half cent). `ok`, `cashDollars` is exactly `0`
   (`toBe(0)`).
4. **Buy 6 CCC** → `{ ok: false, reason: 'insufficient-cash' }`.
5. CCC's price is null → `'no-price'`.
6. BBB's price is null → `'unpriced-holding'`.
7. Ticker `'AAA'` → `'held'`.
8. Shares of `0`, `-1` and `NaN` → `'invalid'` each.
9. The same portfolio with the `cashDollars` key omitted (weight-based) → `'invalid'`.
10. **All-cash shares-based portfolio** (`cashWeight: 100`, `cashDollars: 100`, `positions: []`).
    Buy 4 CCC → CCC ≈ 80, `cashWeight` ≈ 20, `cashDollars` ≈ 20.
11. The input portfolio is not mutated (compare to a `structuredClone` taken beforehand).

Then:

12. `grep -n "addPositionBuying" frontend/src/components/AddPositionForm.tsx` shows an import and a
    call.
13. `grep -n "sharesBased={sharesBased}\|onBuy={persist}" frontend/src/pages/PortfoliosPage.tsx`
    shows both.
14. From `frontend/`:
    - `npx tsc -p tsconfig.app.json --noEmit` exits 0.
    - `npm test` passes in full (248 + new).
    - `npm run lint` shows only the HelpSidebar.tsx:44 and UniversePage.tsx:77 warnings.
15. **Long lines.** The baseline has exactly one long line, `portfolio.test.ts: 3: 307`, the import
    line. Adding `addPositionBuying` to that import may lengthen it; that's accepted. The after
    check must show no **other** long line in the four files.

## Verification to run and paste

**Paste every output verbatim. Run the before awk on its own.**

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/portfolio.ts frontend/src/lib/portfolio.test.ts frontend/src/components/AddPositionForm.tsx frontend/src/pages/PortfoliosPage.tsx   # BEFORE, alone
# ... edit ...
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/portfolio.ts frontend/src/lib/portfolio.test.ts frontend/src/components/AddPositionForm.tsx frontend/src/pages/PortfoliosPage.tsx   # AFTER
grep -n "addPositionBuying" frontend/src/components/AddPositionForm.tsx
grep -n "sharesBased={sharesBased}\|onBuy={persist}" frontend/src/pages/PortfoliosPage.tsx
grep -n "<Tooltip" -A2 frontend/src/components/AddPositionForm.tsx
git diff --stat
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test 2>&1 | tail -6
```

## Out of scope

- Adding to an existing holding (buying more of a ticker already held). That's a separate feature
  if wanted.
- Margin, or selling other holdings to fund a buy.
- Adding by weight to a shares-based portfolio.

## Human verification (Gunnar)

Export BEC first. Then on `/portfolios`, with BEC selected:
1. The Weight % field is greyed out, and its tooltip explains why.
2. Pick a ticker you don't hold and type a small share count. You should see
   "Costs $X of $Y cash; $Z left" and a derived weight.
3. Type a share count that costs more than your cash. Add disables, and the line shows the maximum
   shares.
4. Add a valid amount. Cash dollars drop by the cost, the new row shows your shares, the other share
   counts are unchanged, and the Cash editor still shows **dollars**.
5. Select a weights-only portfolio. The form works exactly as before, Weight % included.
