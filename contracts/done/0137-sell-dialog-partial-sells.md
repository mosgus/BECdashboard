# Contract 0137: Remove opens a sell dialog with a 0.5% weight slider

**Status:** reported
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

On `/portfolios`, pressing **Remove** on a holding in a **shares-based** portfolio (contract 0129) opens a dialog instead of selling straight away. The dialog has:
- a slider that picks how much **portfolio weight** to sell, in 0.5-point steps;
- a live line showing the shares sold, the proceeds, and what remains;
- **Cancel** and **Confirm sale** buttons, side by side.

On Confirm, the shares are sold at the current price, the proceeds go to `cashDollars`, and the portfolio is re-marked and stays shares-based. Selling the whole weight removes the holding, exactly as Remove does today (contract 0131).

These are planner decisions. Gunnar can overrule any of them; don't change them yourself.
- **Weight means portfolio weight at current prices**, not a fraction of the holding. Selling 2% of a 5.07% holding leaves 3.07%. The holding's weight is taken from `remarkPortfolio` at the current prices, never from the stored `weight`, which can be stale.
- **The slider tops out at "sell all".** A range input can't land on 5.07 with step 0.5. The max is the holding's weight rounded **up** to the next 0.5 (5.07 → 5.5), and any slider value at or above the holding's weight means sell all. The slider starts at the max, so Remove → Confirm still does what Remove did before.
- **The preview is the saved result.** The dialog's numbers come from the same `sellPositionWeight` call that Confirm saves (the 0134 lesson).
- **Weight-based portfolios are unchanged.** Remove still takes the weight to cash immediately, with no dialog, because they have no shares or prices to sell at.
- **The 0131 fallback is kept.** If the full sale can't be priced when Remove is pressed (Universe not loaded, or a price missing), skip the dialog and call today's `handleRemovePosition` unchanged, with its notices.

## Files

Modify or create only these:
- `frontend/src/lib/portfolio.ts`: add `sellPositionWeight`, `sellSliderMax` and `SELL_STEP`.
- `frontend/src/lib/portfolio.test.ts`: tests.
- `frontend/src/components/SellPositionDialog.tsx`: **new**.
- `frontend/src/pages/PortfoliosPage.tsx`: wiring.
- `frontend/src/components/PositionsTable.tsx`: the Remove tooltip text only.

Anything else means `BLOCKED`. `frontend/src/components/NewPortfolioDialog.tsx` has Gunnar's own uncommitted edit. **Do not touch it.**

## 1. `lib/portfolio.ts`

Add these near `removePositionSelling`:

```ts
export const SELL_STEP = 0.5

/** Slider max for selling a holding: its weight rounded up to the next SELL_STEP (contract 0137). */
export function sellSliderMax(weight: number): number {
  return Math.max(SELL_STEP, Math.ceil(weight / SELL_STEP - 1e-9) * SELL_STEP)
}

export type SellResult =
  | { ok: true; portfolio: Portfolio; sharesSold: number; proceeds: number; soldAll: boolean; holdingWeight: number }
  | { ok: false; reason: 'invalid' | 'no-price' | 'unpriced-holding' }

/** Sell `sellWeight` points of portfolio weight of a shares-based holding at current prices into
 *  fixed cash, then re-mark. At or above the holding's weight, sells all of it (contract 0137). */
export function sellPositionWeight(
  portfolio: Portfolio,
  ticker: string,
  sellWeight: number,
  byTicker: Map<string, UniverseEntry>,
): SellResult
```

Steps. Don't write any new re-mark arithmetic.
1. Return `'invalid'` if any of these hold: `!isValidCurrentPortfolio(portfolio)`, `!isSharesBased(portfolio)`, `!(sellWeight > 0)`, or the ticker isn't held.
   **Use `!(sellWeight > 0)`, not `isFinitePositive`.** It rejects `0`, `-1` and `NaN` but accepts `Number.POSITIVE_INFINITY`. The dialog and the page both call this function with `Infinity` to mean "sell all", which looks up the full sale and its `holdingWeight`. Infinity always takes the sell-all branch (step 4), so it never reaches the division in step 5. (This was clarified after the first run was BLOCKED on it.)
2. `price = positionPrice(byTicker.get(ticker))`. If `!isFinitePositive(price)`, return `'no-price'`.
3. `marked = remarkPortfolio(portfolio, byTicker)`. If null, return `'unpriced-holding'`. `holdingWeight` = the ticker's weight in `marked`. `held` = the ticker's position in `portfolio` (its `shares` are the truth).
4. **Sell all**, when `sellWeight >= holdingWeight - 1e-9`:
   - `next = removePositionSelling(portfolio, ticker, byTicker)`. If null, return `'unpriced-holding'`.
   - Return `{ ok: true, portfolio: next, sharesSold: held.shares!, proceeds: held.shares! * price, soldAll: true, holdingWeight }`.
5. **Partial sale**, otherwise:
   - `sharesSold = held.shares! * sellWeight / holdingWeight`, and `proceeds = sharesSold * price`.
   - `positions` = `portfolio.positions` with that ticker's `shares` reduced by `sharesSold`. Use a new object; don't mutate the input.
   - `next = withCashDollars({ ...portfolio, positions }, portfolio.cashDollars! + proceeds, byTicker)`. If null, return `'unpriced-holding'`.
   - Return `{ ok: true, portfolio: next, sharesSold, proceeds, soldAll: false, holdingWeight }`.

Leave `removePositionSelling` and its tests unchanged.

## 2. `components/SellPositionDialog.tsx` (new)

```ts
interface SellPositionDialogProps {
  portfolio: Portfolio
  ticker: string
  byTicker: Map<string, UniverseEntry>
  onConfirm: (next: Portfolio) => void
  onCancel: () => void
}
export function SellPositionDialog(props: SellPositionDialogProps): JSX.Element
```

**Shell.** Copy the modal shell from `FilterDialog.tsx` (lines ~82–101 and ~138–150), without its open prop, because this dialog is mounted only while it's open:
- the `fixed inset-0 bg-overlay …` backdrop, and a backdrop click calls `onCancel`;
- `role="dialog" aria-modal="true" aria-label={`Sell ${ticker}`} tabIndex={-1}`;
- focus the dialog on mount, Escape calls `onCancel`, and focus returns to the previous element on close;
- card classes `bg-brand-surface border border-brand-border rounded-[var(--radius-card)] w-full max-w-[28rem] shadow-xl`, with a `px-5 py-4` body;
- heading `<h2 className="text-[1.0625rem] font-semibold">` reading `Sell {ticker}`.

**State.** Read `full = sellPositionWeight(portfolio, ticker, Number.POSITIVE_INFINITY, byTicker)` once, on the first render. It gives `holdingWeight`, and the page guarantees it's ok (see section 3).
- If it's somehow not ok, render the shell with the text `Current prices are needed to sell {ticker}.` and only the Cancel button.
- Otherwise, `const max = sellSliderMax(full.holdingWeight)` and `const [sellWeight, setSellWeight] = useState(max)`.

**Every render.** Compute `const sale = sellPositionWeight(portfolio, ticker, sellWeight, byTicker)`. Use `sale` for everything the dialog displays and for what Confirm saves.

**Body, in this order.**
1. `<p className="text-sm text-[var(--color-muted)] mb-3">`:
   `` `${ticker} is ${formatPercent(full.holdingWeight)} of this portfolio: ${formatShares(held.shares!)} shares at ${formatMoney(price)}.` ``
   Here `held` is the position from `portfolio`, and `price` is `positionPrice(byTicker.get(ticker))!`.
2. A label `<label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">`:
   - when `sale.soldAll`: `` `Sell all (${formatPercent(full.holdingWeight)} of portfolio weight)` ``;
   - otherwise: `` `Sell ${formatPercent(sellWeight)} of portfolio weight` ``.
3. The slider: `<input type="range" min={SELL_STEP} max={max} step={SELL_STEP} value={sellWeight} onChange={(e) => setSellWeight(Number(e.target.value))} className="w-full accent-[var(--color-primary)]" aria-label="Portfolio weight to sell" />`. That className is the one the cash slider in OptimizePage.tsx uses.
4. `<p className="text-sm mt-3">`:
   - when `sale.soldAll`: `` `Sells all ${formatShares(sale.sharesSold)} shares for ${formatMoney(sale.proceeds)}; ${ticker} leaves the portfolio.` ``
   - otherwise: `` `Sells ${formatShares(sale.sharesSold)} shares for ${formatMoney(sale.proceeds)}; ${formatPercent(full.holdingWeight - sellWeight)} of ${ticker} remains.` ``
   - if `!sale.ok`: `'Current prices changed; close and try again.'`, and Confirm is disabled.
5. The buttons row, `<div className="flex justify-end gap-2 mt-5">`:
   - **Cancel**: `onClick={onCancel}`, styled `text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] border border-brand-border text-foreground hover:bg-brand-border`.
   - **Confirm sale**: `disabled={!sale.ok}`, `onClick={() => sale.ok && onConfirm(sale.portfolio)}`, styled exactly like the Add button in `AddPositionForm.tsx` (the `bg-btn-action text-btn-action-text … disabled:opacity-50 disabled:cursor-not-allowed` classes).

Imports: `formatPercent` and `formatShares` from `'../lib/format'`, `formatMoney` from `'../lib/optimize'`, and the new functions plus `positionPrice` from `'../lib/portfolio'`.

⚠️ **`Tooltip` calls `Children.only`.** This dialog needs no Tooltips. If you add one anyway, it must wrap **exactly one** element.

## 3. `pages/PortfoliosPage.tsx`

- Add state: `const [sellTicker, setSellTicker] = useState<string | null>(null)`.
- In the existing effect `useEffect(() => { setPositionNotice(null) }, [current?.id])`, also call `setSellTicker(null)`.
- Add a handler:
  ```ts
  function handleRequestRemove(ticker: string): void {
    if (current !== null && sharesBased && universeState.status === 'ready'
      && sellPositionWeight(current, ticker, Number.POSITIVE_INFINITY, actualByTicker).ok) {
      setSellTicker(ticker)
      return
    }
    handleRemovePosition(ticker)
  }
  ```
- Pass `onRemove={handleRequestRemove}` to `<PositionsTable>` instead of `handleRemovePosition`.
- Leave `handleRemovePosition` itself **unchanged**.
- Render the dialog once, next to the `<PositionsTable>`:
  `{sellTicker !== null && current !== null && <SellPositionDialog portfolio={current} ticker={sellTicker} byTicker={actualByTicker} onConfirm={(next) => { persist(next); setSellTicker(null); setPositionNotice(null) }} onCancel={() => setSellTicker(null)} />}`
  Format it across lines so that no line exceeds 300 characters.
- Add `sellPositionWeight` to the `'../lib/portfolio'` import and import `SellPositionDialog`.

## 4. `components/PositionsTable.tsx`

Change only the shares-based (`valued.cashFixed`) Remove tooltip text to `` `Sell some or all of ${row.ticker} at its current price; the proceeds go to cash.` ``.

## Acceptance criteria

Use `toBeCloseTo(x, 6)` for computed floats. Add a `describe('sellPositionWeight', …)` block. Build prices with the file's `entry(price)` helper.

**Base.** AAA 10 shares @ $45 and BBB 30 @ $15, `cashDollars: 100`, weights 45/45/10, so the total is $1,000.

1. **Sell 15 of AAA.** Expect `ok`, `soldAll` false, `holdingWeight` ≈ 45, `sharesSold` ≈ 10/3, and `proceeds` ≈ 150. In the new portfolio: `cashDollars` ≈ 250, AAA shares ≈ 20/3, AAA weight ≈ 30, BBB weight ≈ 45, `cashWeight` ≈ 25. `updatedAt` is unchanged.
2. **Sell 45 of AAA.** Expect `soldAll` true and `sharesSold` `toBe(10)`. AAA is gone, `cashDollars` ≈ 550, BBB weight ≈ 45, `cashWeight` ≈ 55.
3. **Sell 45.5 of AAA** (the rounded-up slider max). The result is identical to case 2.
4. **Stale stored weights.** Use AAA @ $90 (value $900; BBB $450; cash $100; total $1,450). Selling 10 of AAA gives `holdingWeight` ≈ 900/1450×100, `proceeds` ≈ 145, `sharesSold` ≈ 145/90, AAA weight ≈ 755/1450×100, and `cashDollars` ≈ 245. This proves the code uses the re-marked weight, not the stored 45.
5. **Sell the only holding entirely.** Use a portfolio with AAA only: 10 @ $45, `cashDollars: 50`, weights 90/10. Expect `positions` `[]`, `cashWeight` ≈ 100 and `cashDollars` ≈ 500.
6. Each of `sellWeight` `0`, `-1` and `NaN` returns `'invalid'`. So does ticker `'ZZZ'` (not held). So does the base with the `cashDollars` key omitted.
6b. **Sell `Number.POSITIVE_INFINITY` of AAA.** The result is identical to case 2 (`soldAll` true, `holdingWeight` ≈ 45).
7. AAA price null gives `'no-price'`. BBB price null (while selling AAA) gives `'unpriced-holding'`.
8. The input is not mutated by case 1 (compare against `structuredClone`).
9. `sellSliderMax(5.07)` is `toBe(5.5)`. `sellSliderMax(45)` is `toBe(45)`. `sellSliderMax(0.2)` is `toBe(0.5)`. `sellSliderMax(45.0000000001)` is `toBe(45)`.

Then:

10. `grep -n "handleRequestRemove\|SellPositionDialog\|setSellTicker" frontend/src/pages/PortfoliosPage.tsx` shows:
    - the handler;
    - the table prop;
    - the dialog render;
    - the import;
    - the state;
    - the reset in the effect.
11. From `frontend/`:
    - `npx tsc -p tsconfig.app.json --noEmit` exits 0.
    - `npm test` passes in full (265 plus your new tests).
    - `npm run lint` shows only the HelpSidebar.tsx:44 and UniversePage.tsx:77 warnings.
12. **Long lines.** None exist in the touched files now. The after check must show none, including in the new file.

## Verification to run and paste

**Paste every output verbatim. Run the before awk on its own.**

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/portfolio.ts frontend/src/lib/portfolio.test.ts frontend/src/pages/PortfoliosPage.tsx frontend/src/components/PositionsTable.tsx   # BEFORE, alone
# ... edit ...
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/portfolio.ts frontend/src/lib/portfolio.test.ts frontend/src/pages/PortfoliosPage.tsx frontend/src/components/PositionsTable.tsx frontend/src/components/SellPositionDialog.tsx   # AFTER
grep -n "handleRequestRemove\|SellPositionDialog\|setSellTicker" frontend/src/pages/PortfoliosPage.tsx
grep -n "<Tooltip" frontend/src/components/SellPositionDialog.tsx
git diff --stat
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test 2>&1 | tail -6
```

## Out of scope

- A dialog for weight-based portfolios.
- Selling by share count or by dollar amount; the slider is weight only.
- Steps finer than 0.5.
- Changing the 0131 fallback notices.

## Human verification (Gunnar)

Export BEC first. Then on `/portfolios`, with BEC selected:
1. Press Remove on a holding. A dialog opens with the slider at the far right, reading "Sell all (X% of portfolio weight)" and "Sells all N shares for $…".
2. Drag the slider left. It moves in 0.5% steps, and the line updates the shares sold, the dollars, and the weight that remains.
3. Press Cancel, then press Escape, then click the dark backdrop. Each one closes the dialog without changing anything.
4. Sell, say, 2% and Confirm. That row's shares drop by the amount shown, its weight drops by about 2 points, and Cash rises by the dollars shown.
5. Remove → Confirm at the far right removes the holding entirely, as before.
6. On a weights-only portfolio, Remove still removes the holding immediately, with no dialog.
