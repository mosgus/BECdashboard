# Contract 0108 — Optimize tab: trade table, CSV export, settings layout and % chart

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Four changes to the Optimize tab that 0107 built:

1. **Trade table.** When every holding has a share count that agrees with its weight, the Weights
   table gains price, share and dollar columns (current, target and trade). Otherwise it stays
   weights-only, with a note saying why.
2. **CSV export** of that table.
3. **Settings card re-laid out** in three stretched columns like `main`'s, with a link-style
   "Optimizer guide →".
4. **Equity chart y-axis** shows % change from the start (0% at the start, negative below, positive
   above) instead of an index of 100.

## Why

- **1 and 2** are the planned 0108: `main`'s action table and CSV export.
- **3 and 4** are Gunnar's review of 0107 on 2026-09-24. He compared it with `main`, using
  `reference files/images/rebuild.png` and `reference files/images/reference.png`. Look at both
  images. The layout target is `reference.png`.

**Design decisions:**
- **Dollar trades need a trustworthy dollar value.** That exists only when every holding has shares
  and a stored price, and the shares agree with the stored weights within the 0.5-point tolerance
  Holdings already uses (`DOLLAR_WEIGHT_TOLERANCE_PP` and `chartMode` in `lib/portfolioChart.ts`).
- **In dollar mode the optimizer is sent the share-implied weights** (`shares × price`) instead of the
  stored weights. Then "Current" in the table is exactly what the shares say. A pinned holding also
  shows a zero trade, where the stored weights could differ from the shares by up to 0.5 points and
  show a phantom trade.
- **Price is `last_close`.** This matches the REBUILD.md Apply rule.
- **Shares are fractional, not floored as in `main`**, matching the Apply rule for all-shares
  portfolios. Apply itself is 0109.
- **Cash is left as it is.** Target dollar values are fractions of the **invested** value only.

## Files

Modify:
- `frontend/src/lib/optimize.ts`:
  - add the helpers in **Interface**
  - change `curveRows` to return percent change
  - give `buildOptimizeRequest` an optional third parameter
- `frontend/src/lib/optimize.test.ts`:
  - add the tests in **Tests**
  - update **only** the two existing `curveRows` tests, as described below
- `frontend/src/lib/portfolioCsv.ts`: add the `export` keyword to the existing `datePart`, `quote` and
  `filenameSafeName` functions. Change nothing else in the file.
- `frontend/src/components/Tooltip.tsx`: add an optional `block?: boolean` prop.
  - When it is true, the wrapper `<span>`'s class is `flex w-full`.
  - Otherwise it stays `inline-flex`.
  - Nothing else changes, and every existing caller is unaffected.
- `frontend/src/components/OptimizeChart.tsx`: the % axis (see **Interface**).
- `frontend/src/pages/analysis/OptimizePage.tsx`: the layout, the price load, the trade table, the
  CSV button and the chart copy.

**Touch nothing else.** If the work seems to need another file, stop and report `BLOCKED`.

**`reference files/` is read-only** (the two images included). Read `main` with `git show main:<path>`.

## Before you start

Take the test count **before editing anything**: `(cd frontend && npm run test 2>&1 | grep -E "Tests +[0-9]+")`.
It should read 111 passed. Don't overwrite or stash working files to recover a count; if it isn't 111,
paste what it is and carry on.

## Interface

### `lib/optimize.ts` additions

```ts
import { DOLLAR_WEIGHT_TOLERANCE_PP } from './portfolioChart'
import { datePart, filenameSafeName, quote } from './portfolioCsv'
import { formatShares } from './format'

export type TradeBasis =
  | { kind: 'dollar'; investedValue: number; prices: Record<string, number>; shares: Record<string, number> }
  | { kind: 'weights'; reason: 'no-shares' | 'no-price' | 'shares-mismatch' }

export interface TradeRow extends WeightRow {
  price: number
  currentShares: number
  currentValue: number
  targetShares: number
  targetValue: number
  tradeShares: number
  tradeValue: number
}

export function tradeBasis(portfolio: Portfolio, lastCloseByTicker: ReadonlyMap<string, number | null>): TradeBasis
export function buildOptimizeRequest(portfolio: Portfolio, settings: OptimizeSettings, basis?: TradeBasis): OptimizeRequest
export function tradeRows(response: OptimizeResponse, basis: Extract<TradeBasis, { kind: 'dollar' }>): TradeRow[]
export function formatMoney(value: number): string
export function formatSignedMoney(value: number): string
export function formatSignedShares(value: number): string
export function tradeBasisNote(basis: TradeBasis): string
export function optimizeCsv(response: OptimizeResponse, basis: TradeBasis): string
export function optimizeCsvFilename(portfolioName: string, mode: string, now: Date): string
```

Behaviour. Each item is pinned by a test.

- **`tradeBasis`**. Check in this order and return at the first match:
  1. If any position lacks a finite `shares > 0`, return `{ kind: 'weights', reason: 'no-shares' }`.
  2. If any position's price (`lastCloseByTicker.get(ticker)`) is missing, `null`, non-finite or
     `<= 0`, return `'no-price'`.
  3. Let `invested = Σ shares × price`, and `total = invested / ((100 − cashWeight) / 100)`. If
     `100 − cashWeight <= 0`, return `'no-shares'`. If any position has
     `|shares × price / total × 100 − weight| > DOLLAR_WEIGHT_TOLERANCE_PP`, return
     `'shares-mismatch'`.
  4. Otherwise return `{ kind: 'dollar', investedValue: invested, prices, shares }`. `prices` and
     `shares` are keyed by ticker.
- **`buildOptimizeRequest(portfolio, settings, basis)`**. Unchanged when `basis` is absent or
  `kind: 'weights'`. When `basis.kind === 'dollar'`, `weights` becomes
  `positions.map(p => basis.shares[p.ticker] * basis.prices[p.ticker])`, in position order. The
  backend normalises them.
- **`tradeRows(response, basis)`**. One row per `response.tickers`, in order. It starts from the
  `weightRows` fields, then adds, with `V = basis.investedValue`:
  - `price = prices[t]` and `currentShares = shares[t]`
  - `currentValue = current × V` and `targetValue = target × V`
  - `targetShares = targetValue / price`
  - `tradeShares = targetShares − currentShares` and `tradeValue = targetValue − currentValue`
- **`formatMoney(v)`**:
  `` `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` ``.
  If `|v| < 0.005`, return `'$0.00'`.
- **`formatSignedMoney(v)`**: `'$0.00'` when `|v| < 0.005`. Otherwise `'+'` or `'-'`, followed by
  `formatMoney(Math.abs(v))`.
- **`formatSignedShares(v)`**: `'0'` when `|v| < 1e-6`. Otherwise `'+'` or `'-'`, followed by
  `formatShares(Math.abs(v))`.
- **`tradeBasisNote(basis)`**:

  | basis | returns |
  |---|---|
  | `dollar` | `` `Trades use each holding's last stored close and fractional shares, on ${formatMoney(investedValue)} invested. Cash is left as it is.` `` |
  | `no-shares` | `'Add a share count to every holding to see share and dollar trades.'` |
  | `no-price` | `'A holding has no stored closing price, so trades are shown as weights only.'` |
  | `shares-mismatch` | `"Share counts don't match the weights within 0.5 points, so trades are shown as weights only."` |

- **`optimizeCsv(response, basis)`**:
  - Use a local `num(v, dp) = String(Number(v.toFixed(dp)))`. It strips trailing zeros and turns `-0`
    into `'0'`.
  - Every field goes through `quote()` from `portfolioCsv`.
  - The lines are joined with `'\n'`, and there is a trailing `'\n'`.
  - **Dollar basis**:
    - Header:
      `ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned`
    - Per `tradeRows` row:

      | column | value |
      |---|---|
      | `ticker` | ticker |
      | `price` | `num(price, 4)` |
      | `current_shares` | `num(currentShares, 6)` |
      | `current_value` | `num(currentValue, 2)` |
      | `current_pct` | `num(current × 100, 2)` |
      | `target_shares` | `num(targetShares, 6)` |
      | `target_value` | `num(targetValue, 2)` |
      | `target_pct` | `num(target × 100, 2)` |
      | `trade_shares` | `num(tradeShares, 6)` |
      | `trade_value` | `num(tradeValue, 2)` |
      | `change_pp` | `num(change × 100, 2)` |
      | `pinned` | `String(pinned)` |

  - **Weights basis**:
    - Header: `ticker,current_pct,target_pct,change_pp,pinned`
    - Per `weightRows` row: the same fields as the dollar rows, with the same rounding.
- **`optimizeCsvFilename(name, mode, now)`**:
  `` `${filenameSafeName(name.trim()) || 'portfolio'}-optimize-${mode}-${datePart(now)}.csv` ``.
  This is deliberately different from `portfolioCsvFilename`, so an export is never mistaken for a
  portfolio file.
- **`curveRows` (changed)**:
  - Each series becomes percent change from its own first value: `(v / series[0] − 1) × 100`.
  - The benchmark uses its own first value, and stays `null` when there is no benchmark.
  - Still downsampled the same way.

### `OptimizeChart.tsx`

- **Axis:**
  - `YAxis` gets `allowDecimals={false}` and `tickFormatter={(v: number) => `${v.toFixed(0)}%`}`.
  - Add `<ReferenceLine y={0} stroke="var(--color-muted)" />`.
- **Tooltip formatter:** numbers render as `` `${v > 0 ? '+' : ''}${v.toFixed(2)}%` ``. Keep the
  `typeof value === 'number'` guard.
- **Lines:** unchanged.

### `OptimizePage.tsx`

#### Prices

- **Loading:** on mount, call `getUniverse()` and build
  `Map<ticker, entry.last_close>`. Keep it in a
  `{ status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null> }` state.
  - On error, set `ready` with an **empty** map. `tradeBasis` then gives `'no-price'`, and the
    optimizer still runs on weights.
  - Guard the late response with a `cancelled` flag inside that effect, as `TickerPage.tsx:59` does.
- **Run button:** disabled while prices are loading, as well as for the existing conditions.
- **Run handler:** compute `const basis = tradeBasis(current, prices.lastClose)`, call
  `buildOptimizeRequest(current, settings, basis)`, and store `basis` in the `ready` run state next to
  `response` and `settings`. The results always use the basis the run was made with.

#### Settings card: three columns

Build it as `<div className="grid gap-6 md:grid-cols-3">`. Every select, slider, lookback button and the Run button is
full width inside its column. Wrap each of those controls' `Tooltip` with `block`, since the default
`inline-flex` wrapper is what kept them narrow in 0107. Use `accent-[var(--color-primary)]` on the
range inputs. The rest of the card is:
- **Column 1** (`flex flex-col`):
  - Mode: a label and a full-width select.
  - At the bottom, `Run optimizer` in a `mt-auto pt-6` wrapper: full width, `py-3`,
    `bg-btn-action text-btn-action-text font-semibold`, with `disabled:opacity-50`.
  - Replace 0107's `bg-brand-primary text-white`. In dark mode the primary colour lightens, and white
    text on it is unreadable. `bg-btn-action`/`text-btn-action-text` is the project's token pair for
    this.
- **Column 2**:
  - Lookback: a label, then `<div className="grid grid-cols-4 gap-2">` of 4 buttons, each
    `w-full py-2 text-xs font-medium rounded-[var(--radius-btn)]`.
  - Selected: `bg-btn-action text-btn-action-text`.
  - Unselected: `border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground`.
- **Column 3** (`flex flex-col gap-4`), in this order:
  1. the Max weight slider
  2. the Min weight slider
  3. the Vol target slider (only for `target_volatility`; it moves here from wherever it was)
  4. the Rebalance select
  5. the Allow short checkbox
- **Below the grid**:
  - The error line, if any.
  - A `flex justify-end mt-4` row holding the guide link. The link is a
    `<button type="button">` styled as a link:
    `inline-flex items-center gap-1.5 text-sm font-medium text-btn-selected-text hover:underline`.
    Its content is an inline book icon SVG, 14×14, `stroke="currentColor"`, `fill="none"`,
    `strokeWidth={2}`, drawn with these paths:
    - `M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z`
    - `M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z`

    followed by the text `Optimizer guide →`.

Labels, tooltips and behaviour don't change, except for the additions listed under **Tooltips**.

#### Weights card

- **Header row:** the heading `Weights` on the left. On the right, an `Export CSV` button with
  `DownloadIcon`, styled like UniversePage's "Download Universe" control. Clicking it runs:
  ```ts
  downloadTextFile(optimizeCsvFilename(current.name, response.mode, new Date()), optimizeCsv(response, basis), 'text/csv;charset=utf-8')
  ```
- **Table columns:**
  - **Dollar basis:** Ticker, Price, Current shares, Current value, Current, Optimized shares,
    Optimized value, Optimized, Trade shares, Trade $, Change.

    | column | formatter |
    |---|---|
    | Price | `formatPrice` |
    | shares | `formatShares` |
    | values | `formatMoney` |
    | % | `formatWeight` |
    | Trade shares | `formatSignedShares` |
    | Trade $ | `formatSignedMoney` |
    | Change | `formatChangePp` |

    Trade shares, Trade $ and Change use the same sign colouring as Change, read from the
    **formatted** text: `+` positive, `-` negative, otherwise muted. Right-align every column except
    Ticker.
  - **Weights basis:** the existing four columns, unchanged.
- **Note:** under the table, `tradeBasisNote(basis)` in muted `text-xs`.
- **Pinned label:** unchanged.

#### Chart card

- **Heading:** `Return: Current vs Optimized`, replacing `Growth of 100: Current vs Optimized`.
- **Subtitle:**
  `` `Change since ${response.score_start}. In-sample, invested holdings only. Not a forecast.` ``.
- **Other copy:** the score-window note and the Holdings note stay as they are.

## Tests

**Existing tests:** every one passes **unmodified**, except the two `curveRows` tests, which change
only like this:
- **The zip test:** the expected rows become
  - current `[0, 1.5, -0.2]`
  - optimized `[0, 2.25, 0.4]`
  - benchmark `[0, 0.9, -0.9]` (or `null` when there is no benchmark)
  - dates unchanged

  Compare the numbers with `toBeCloseTo(x, 6)`, because `101.5/100 − 1` is not exact.
- **The downsampling test:** the values become `100 + i`, because a first value of 0 would divide by
  zero. The expected 334 rows and last date `'d999'` are unchanged.

**New fixtures** (literal):

```ts
const DOLLAR_PORTFOLIO: Portfolio = {
  id: 'p2', name: 'Dollar / Test', cashWeight: 10, updatedAt: '2026-09-24T00:00:00Z',
  positions: [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 27, shares: 20 }, { ticker: 'YNG', weight: 18, shares: 4 }],
}
const CLOSES = new Map<string, number | null>([['AAA', 45], ['BBB', 13.5], ['YNG', 45]])
const DOLLAR_BASIS = { kind: 'dollar', investedValue: 900, prices: { AAA: 45, BBB: 13.5, YNG: 45 }, shares: { AAA: 10, BBB: 20, YNG: 4 } } as const
```

Share values are 450, 270 and 180, so invested is 900, the total is 1000 and the implied weights are
exactly 45/27/18.

**Required new tests** (at least one `it` each):

1. **`tradeBasis` in dollar mode:** `tradeBasis(DOLLAR_PORTFOLIO, CLOSES)` equals `DOLLAR_BASIS`.
2. **`tradeBasis` fallbacks:**
   - `tradeBasis(PORTFOLIO, CLOSES)` (from 0107; BBB has no shares) equals
     `{ kind: 'weights', reason: 'no-shares' }`.
   - `DOLLAR_PORTFOLIO` with `CLOSES` minus YNG gives `'no-price'`, and with YNG set to `null` gives
     `'no-price'`.
   - With BBB's shares set to 21 it gives `'shares-mismatch'`. The implied weights are then 44.33,
     27.93 and 17.73.
3. **`buildOptimizeRequest` with a basis:**
   - `buildOptimizeRequest(DOLLAR_PORTFOLIO, DEFAULT_SETTINGS, DOLLAR_BASIS).weights` equals
     `[450, 270, 180]`.
   - With `{ kind: 'weights', reason: 'no-shares' }`, the weights equal `[45, 27, 18]`.
4. **`tradeRows(RESPONSE, DOLLAR_BASIS)`.** Use `toBeCloseTo(x, 6)` on the numbers:

   | ticker | price | currentShares | currentValue | targetValue | targetShares | tradeShares | tradeValue | pinned |
   |---|---|---|---|---|---|---|---|---|
   | AAA | 45 | 10 | 450 | 558 | 12.4 | 2.4 | 108 | false |
   | BBB | 13.5 | 20 | 270 | 162 | 12 | -8 | -108 | false |
   | YNG | 45 | 4 | 180 | 180 | 4 | 0 | 0 | true |

5. **Money and share formatting:**
   - `formatMoney`: 1234.5 → `'$1,234.50'`, -108 → `'-$108.00'`, 0.004 → `'$0.00'`.
   - `formatSignedMoney`: 108 → `'+$108.00'`, -108 → `'-$108.00'`, 0.004 → `'$0.00'`.
   - `formatSignedShares`: 2.4 → `'+2.4'`, -8 → `'-8'`, 1e-9 → `'0'`, 1234.5678901 → `'+1,234.56789'`.
6. **`tradeBasisNote`:**
   - For `DOLLAR_BASIS` it equals
     `"Trades use each holding's last stored close and fractional shares, on $900.00 invested. Cash is left as it is."`.
   - Each of the three weights reasons gives its exact string from the table above.
7. **`optimizeCsv(RESPONSE, DOLLAR_BASIS)`** equals exactly:
   ```
   "ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned\nAAA,45,10,450,50,12.4,558,62,2.4,108,12,false\nBBB,13.5,20,270,30,12,162,18,-8,-108,-12,false\nYNG,45,4,180,20,4,180,20,0,0,0,true\n"
   ```
8. **`optimizeCsv(RESPONSE, { kind: 'weights', reason: 'no-shares' })`** equals exactly:
   ```
   "ticker,current_pct,target_pct,change_pp,pinned\nAAA,50,62,12,false\nBBB,30,18,-12,false\nYNG,20,20,0,true\n"
   ```
9. **`optimizeCsvFilename`:**
   - `optimizeCsvFilename('Dollar / Test', 'min_variance', new Date(2026, 8, 24))` equals
     `'Dollar Test-optimize-min_variance-2026-09-24.csv'`. `filenameSafeName` turns `/` into a space
     and collapses the spaces.
   - `optimizeCsvFilename('   ', 'max_sharpe', new Date(2026, 8, 24))` equals
     `'portfolio-optimize-max_sharpe-2026-09-24.csv'`.

**Test count:** the suite should reach at least 111 + 9. The `portfolioCsv` tests must pass
unmodified.

## Out of scope

- Apply to portfolio (0109). Don't write anything to localStorage.
- CAPM, conviction views, κ and tilt (0110).
- Restyling the results cards, metric tiles or the pinned banner beyond what is listed above.
- Changing `Tooltip`'s bubble behaviour or copy. `block` only changes the wrapper's display.
- Any backend change, and any new dependency (so no lucide).
- Adding tooltips to the metric tiles or elsewhere beyond the ones listed.

## Acceptance criteria

1. The before test count is pasted (expected 111).
2. `(cd frontend && npm run build)` exits 0.
3. `(cd frontend && npm run test)` passes, with at least 120 tests. Apart from the two `curveRows`
   tests changed exactly as described, every existing test passes unmodified.
4. `(cd frontend && npm run lint)` reports only `HelpSidebar.tsx:44` and `UniversePage.tsx:60`.
5. `grep -c "bg-brand-primary" frontend/src/pages/analysis/OptimizePage.tsx` prints `0`.
6. `grep -n "md:grid-cols-3" frontend/src/pages/analysis/OptimizePage.tsx` prints at least one line.
7. `grep -c "<Tooltip block" frontend/src/pages/analysis/OptimizePage.tsx` prints at least `6`.
8. `grep -n "Growth of 100\|Index, 100 on" frontend/src/pages/analysis/OptimizePage.tsx` prints nothing.
9. `grep -n "ReferenceLine" frontend/src/components/OptimizeChart.tsx` prints at least one line.
10. `grep -n "Optimizer guide →" frontend/src/pages/analysis/OptimizePage.tsx` prints one line.
11. `grep -n "block" frontend/src/components/Tooltip.tsx` shows the new prop, and
    `grep -n "inline-flex" frontend/src/components/Tooltip.tsx` still prints a line.
12. `grep -nE "^export function (datePart|quote|filenameSafeName)" frontend/src/lib/portfolioCsv.ts`
    prints 3 lines.
13. `git status --short frontend` lists only the files in **Files** among those changed by this
    contract. List everything else it shows as pre-existing: the 0107 files and anything untracked.
14. `grep -n " title=" frontend/src/pages/analysis/OptimizePage.tsx frontend/src/components/OptimizeChart.tsx`
    prints nothing.

If a criterion can't be met as written, **report `BLOCKED` and name the conflict**. Don't bend the
code or the check to make it pass.

## Verification to run and paste

From the repo root. Paste the complete, verbatim output.

```bash
(cd frontend && npm run build 2>&1 | tail -3)
(cd frontend && npm run test 2>&1 | grep -E "Tests +[0-9]+|✗|FAIL")
(cd frontend && npm run test 2>&1 | grep -iE "optimize|curveRows|tradeBasis|Csv" | head -60)
(cd frontend && npm run lint 2>&1 | tail -4)
grep -c "bg-brand-primary" frontend/src/pages/analysis/OptimizePage.tsx
grep -n "md:grid-cols-3" frontend/src/pages/analysis/OptimizePage.tsx
grep -c "<Tooltip block" frontend/src/pages/analysis/OptimizePage.tsx
grep -n "Growth of 100\|Index, 100 on" frontend/src/pages/analysis/OptimizePage.tsx; echo "old-copy exit=$?"
grep -n "ReferenceLine" frontend/src/components/OptimizeChart.tsx
grep -n "Optimizer guide →" frontend/src/pages/analysis/OptimizePage.tsx
grep -n "block\|inline-flex" frontend/src/components/Tooltip.tsx
grep -nE "^export function (datePart|quote|filenameSafeName)" frontend/src/lib/portfolioCsv.ts
grep -n " title=" frontend/src/pages/analysis/OptimizePage.tsx frontend/src/components/OptimizeChart.tsx; echo "title exit=$?"
git status --short frontend
git diff --stat frontend/src/lib/portfolioCsv.ts frontend/src/components/Tooltip.tsx
```

## Tooltips

Existing tooltips keep their copy. New or changed:

| Element | Tooltip label |
|---|---|
| Export CSV button | "Download this table as a CSV" |
| Run optimizer while prices load | "Loading the latest prices" (takes precedence over the other Run labels while `prices.status === 'loading'`) |
| Optimizer guide link | unchanged: "Open a short description of each optimization mode" |

## Human verification — does Gunnar need to run anything?

**Run it and look.** Restart the backend first.

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
(cd backend && .venv/bin/uvicorn app.main:app --port 8000)
(cd frontend && npm run dev)
```

Check each of these at about 1280px wide, then at about 700px:
1. **Layout:** the settings card matches `reference files/images/reference.png`.
   - Column 1 has Mode, with a full-width Run optimizer button at its foot.
   - Column 2 has the four lookback buttons, equal width and filling the column.
   - Column 3 has the full-width sliders, then Rebalance, then Allow short.
   - "📖 Optimizer guide →" sits bottom-right as a link.

   At 700px the columns stack.
2. **Dark mode:** the Run button and the selected lookback button stay readable.
3. **Chart axis:** the y-axis reads 0% at the start, with a zero line, and hover shows `+x.xx%`.
4. **Trades, dollar mode:** a portfolio where every holding has shares shows the dollar columns and
   the note with the invested total. The trade dollar amounts should sum to about $0.
5. **Trades, weights mode:** a portfolio without shares shows four columns and the "Add a share
   count" note.
6. **CSV export:** it downloads `<name>-optimize-<mode>-<date>.csv`, which opens cleanly in a
   spreadsheet.

## Open questions

None.

## Amendment 1 (planner audit, 2026-09-24) — Haiku

**Status:** open

This fixes one spacing defect found in the audit. Column 3 of the settings card is
`flex flex-col gap-4`.
- **The defect:** the **Max weight** `<label>` and its slider `<Tooltip block>` are two separate
  children of that column, so `gap-4` puts about 20px between the label and its slider. Min weight,
  Vol target and Rebalance each wrap their label and control in one `<div>`, so theirs are about 4px
  apart. The Max weight slider therefore sits visibly lower than its own label.
- **The Vol target block** in the same column is indented two spaces less than its siblings.

**Change**, in `frontend/src/pages/analysis/OptimizePage.tsx` only:
1. Wrap the Max weight `<label>` and its `<Tooltip block>…</Tooltip>` in one `<div>`. Don't change
   either element itself.
2. Re-indent the Vol target block's contents to match the Min weight block. This is whitespace only.

Change nothing else. If anything else seems to need changing, report `BLOCKED`.

**Acceptance.** Run these and paste the output.

```bash
(cd frontend && npm run build 2>&1 | tail -2)
(cd frontend && npm run test 2>&1 | grep -E "Tests +[0-9]+")
(cd frontend && npm run lint 2>&1 | grep -cE "warning|error")
grep -n -B2 "Max abs. weight" frontend/src/pages/analysis/OptimizePage.tsx
```

Expected:
- the build succeeds
- `Tests  120 passed (120)`
- `2`
- a `<div>` line appears within the two lines above the `Max abs. weight` line
