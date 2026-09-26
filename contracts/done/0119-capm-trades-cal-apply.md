# Contract 0119 — CAPM: current vs target statistics, target value, trades, VaR in dollars, CSV, CAL chart, Apply

**Status:** reported (Rework 1) <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After a CAPM run, the Outlook tab shows:

- the Current portfolio's expected statistics next to the Target's
- a note when every view is 0%
- a Target value ($) that sizes a share/dollar trades table and dollar VaR
- an Export CSV button and an Apply to portfolio button
- a risk-vs-return chart with the Capital Allocation Line (CAL)

## Why

Contract 0118 shipped the CAPM Optimizer with weights only. Main's CAPM page also had the pieces this contract adds: a target value, an action table, dollar VaR, the CAL chart and Apply.

Gunnar's first real run showed two gaps.

1. **No baseline.** A Target Sharpe of 0.30 cannot be judged without the Current portfolio's figure. The backend already computes everything needed for that figure, but only for the target weights.
2. **Views of 0% look like advice.** With every view at 0%, the optimizer moved 30 points from MS to XLK. That is purely CAPM favouring holdings whose risk mostly moves with the market, not a signal about either stock.

Trades and Apply must reuse `tradeRows` / `applyPlan` from `lib/optimize.ts`, not re-implement them. The Optimize tab's arithmetic has already been audited, and REBUILD.md's Outlook entry says "trades on the frontend".

## Files

Modify, backend:

- `backend/app/capm_run.py`
  - Add `current_metrics: dict[str, float | None]` to `CapmResult`.
  - Compute it in `run_capm`.
- `backend/app/schemas.py`
  - Add `current_metrics: CapmMetricsOut` to `CapmResponse`.
- `backend/app/routers/portfolio.py`
  - Return `"current_metrics": result.current_metrics` in `capm_portfolio`.
- `backend/tests/test_capm_run.py` — add one test.
- `backend/tests/test_api_capm.py` — extend `test_manual_rf_and_lowercase_inputs` with one assertion.

Modify, frontend:

- `frontend/src/api/client.ts`
  - Add `current_metrics` to `CapmResponse`.
  - Change nothing else.
- `frontend/src/lib/optimize.ts` — make only these changes:
  - add `WeightSource` / `ApplySource` types and use them as the parameter types of `weightRows`, `tradeRows` and `applyPlan`
  - give `tradeRows` an optional `targetValue`
  - give `applyConfirmLines` an optional `column`
  - export `csvNumber`
- `frontend/src/lib/capm.ts` — add the functions in the Interface section. `statItems` and `varItems` gain optional parameters.
- `frontend/src/lib/capm.test.ts`
  - Add `current_metrics` to `RESPONSE`.
  - Add the tests listed below.
- `frontend/src/pages/analysis/outlook/CapmSection.tsx` — the UI.

Create:

- `frontend/src/components/CapmChart.tsx` — the CAL chart. Default export, lazy-loaded the same way `OptimizePage.tsx` loads `OptimizeChart`.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and report `BLOCKED` instead of editing it. In particular:

- `optimize.test.ts` must keep passing unchanged.
- `OptimizePage.tsx` must not change.

**`reference files/` is read-only and never belongs on a file list.**
- Read it (and `main` via `git show 'main:<path>'`) as much as you need.
- Never edit it, including through shell redirects, `sed -i`, `cp` or `mv`.

**Before any edit**, run and paste:
- `git status --short`. Other sessions may have uncommitted work, so this is the pre-edit snapshot.
- The two "before" test counts:
  - `(cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -1)`: expect 658 passed. The planner measured this on 2026-09-26.
  - `(cd frontend && npx vitest run 2>&1 | grep -E "^ +Tests")`: expect 162 passed.

## Interface

### Backend

In `run_capm`, next to the existing target-metric block, build `current_array` from the current weights. Use the same `tickers` order and the same `covariance`, `return_array` and `beta_array`, then:

```python
current_return = float(current_array @ return_array)
current_vol = float(math.sqrt(max(current_array @ covariance @ current_array, 0.0)))
current_metrics = {
    "expected_return": current_return,
    "expected_vol": current_vol,
    "expected_sharpe": (current_return - rf) / current_vol if current_vol > 1e-12 else None,
    "portfolio_beta": float(current_array @ beta_array),
}
```

Pass `current_metrics=current_metrics` to `CapmResult`, as a new field placed directly after `portfolio_beta`. The target metrics, VaR and warnings are unchanged.

New test in `test_capm_run.py`. Use the module's existing `run()` helper and default fixture. The values were checked in a scratch run against the committed code:

```python
def test_current_metrics_use_current_weights():
    result = run()
    current = result.current_metrics
    assert current["expected_return"] == pytest.approx(0.09, abs=1e-9)
    assert current["expected_vol"] == pytest.approx(0.194797, abs=1e-5)
    assert current["expected_sharpe"] == pytest.approx(0.256677, abs=1e-4)
    assert current["portfolio_beta"] == pytest.approx(1.0, abs=1e-9)
    assert result.expected_vol == pytest.approx(0.235240, abs=1e-4)
```

In `test_api_capm.py::test_manual_rf_and_lowercase_inputs`, add one assertion on the response JSON: `set(body["current_metrics"]) == {"expected_return", "expected_vol", "expected_sharpe", "portfolio_beta"}`. Use whatever that test names its parsed response. This adds no new test function.

### `frontend/src/api/client.ts`

In `CapmResponse`, directly after `metrics`:

```ts
current_metrics: { expected_return: number; expected_vol: number; expected_sharpe: number | null; portfolio_beta: number }
```

### `frontend/src/lib/optimize.ts` (type widening; no behaviour change for existing callers)

```ts
export type WeightSource = Pick<OptimizeResponse, 'tickers' | 'current_weights' | 'target_weights' | 'implied_trades'> & { pinned: ReadonlyArray<{ ticker: string }> }
export type ApplySource = Pick<OptimizeResponse, 'tickers' | 'target_weights' | 'feasible'>

export function weightRows(response: WeightSource): WeightRow[]              // body unchanged
export function tradeRows(response: WeightSource, basis: Extract<TradeBasis, { kind: 'dollar' }>, targetValue: number = basis.investedValue): TradeRow[]
export function applyPlan(portfolio: Portfolio, response: ApplySource, lastCloseByTicker: ReadonlyMap<string, number | null>): ApplyPlan   // body unchanged
export function applyConfirmLines(plan: Extract<ApplyPlan, { ok: true }>, column: string = 'Optimized'): string[]
export function csvNumber(value: number, decimals: number): string          // was private; body unchanged
```

- **`tradeRows`:** the one body change is `const targetValue = row.target * basis.investedValue` becoming `row.target * targetValue`. Rename the local so it doesn't shadow the parameter. `currentValue` still uses `basis.investedValue`.
- **`applyConfirmLines`:** the first line becomes `` `Holdings weights will be replaced by the ${column} column. Cash stays at ...` ``, with the rest of the text identical.

### `frontend/src/lib/capm.ts` additions

Import what you need from `./optimize`, `./portfolioCsv` (`quote`, `filenameSafeName`, `datePart`) and `./portfolio`.

```ts
export interface CapmTradeRow extends TradeRow { frozen: boolean }
export interface CalPoint { vol: number; ret: number }            // both in percent, e.g. 21.9962
export interface CalChartData { rf: CalPoint; current: CalPoint; target: CalPoint; line: CalPoint[]; assets: Array<CalPoint & { ticker: string }> }

export function capmWeightSource(response: CapmResponse): WeightSource
export function parseTargetValue(text: string): { ok: true; value: number | null } | { ok: false; message: string }
export function defaultTargetValue(basis: TradeBasis): string
export function capmTradeRows(response: CapmResponse, basis: Extract<TradeBasis, { kind: 'dollar' }>, targetValue: number): CapmTradeRow[]
export function allViewsZero(response: CapmResponse): boolean
export function capmCsv(response: CapmResponse, basis: TradeBasis, targetValue: number | null): string
export function capmCsvFilename(portfolioName: string, now: Date): string
export function capmApplyPlan(portfolio: Portfolio, response: CapmResponse, lastCloseByTicker: ReadonlyMap<string, number | null>): ApplyPlan
export function capmApplyLines(plan: Extract<ApplyPlan, { ok: true }>, basis: TradeBasis, targetValue: number | null): string[]
export function calChartData(response: CapmResponse): CalChartData
// changed signatures (defaults keep every existing call and test working):
export function statItems(response: CapmResponse, weights: 'current' | 'target' = 'target'): CapmItem[]
export function varItems(response: CapmResponse, targetValue: number | null = null): CapmItem[]
// CapmItem gains an optional field:
export interface CapmItem { label: string; value: string; tooltip: string; detail?: string }
```

**Rules:**

- **`capmWeightSource`:**
  - `tickers`, `current_weights` and `target_weights` are copied through.
  - `implied_trades[t] = target_weights[t] - current_weights[t]`.
  - `pinned` is `holdings.filter(h => h.pinned).map(h => ({ ticker: h.ticker }))`.
- **`parseTargetValue`:** trim the text, then remove every `,` and one leading `$`.
  - An empty result gives `{ ok: true, value: null }`.
  - A finite number above 0 gives `{ ok: true, value }`.
  - Anything else gives `{ ok: false, message: 'Target value must be a dollar amount above $0, or blank.' }`.
- **`defaultTargetValue`:** a dollar basis gives `basis.investedValue.toFixed(2)`; a weights basis gives `''`.
  - Do **not** round up to the next $100k the way main did. That makes a do-nothing run show buys.
- **`capmTradeRows`:** `tradeRows(capmWeightSource(response), basis, targetValue)`, with `frozen` taken from the matching `holdings` entry.
- **`allViewsZero`:** `holdings.every(h => h.view === 0)`.
- **`capmCsv`:** rows follow `response.holdings` order, and the file ends with `\n`.
  - **Weights header** (used when the basis is `weights` or `targetValue` is `null`):
    `ticker,beta,capm_return_pct,view_pct,expected_return_pct,vol_pct,current_pct,target_pct,change_pp,frozen,pinned`
  - **Weights row values:**

    | Column | Value |
    |---|---|
    | beta | `csvNumber(beta,4)` |
    | capm_return_pct, view_pct, expected_return_pct, vol_pct, current_pct, target_pct | `csvNumber(x*100,2)` |
    | change_pp | `csvNumber((target-current)*100,2)` |
    | frozen, pinned | `String(...)` |

  - **Dollar header** (used when the basis is `dollar` and `targetValue` is a number): the same header with `,price,current_shares,current_value,target_shares,target_value,trade_shares,trade_value` appended.
  - **Dollar row values** come from `capmTradeRows`, with the same decimals as `optimizeCsv`:

    | Column | Decimals |
    |---|---|
    | price | 4 |
    | shares | 6 |
    | values | 2 |

  - Every field goes through `quote`.
- **`capmCsvFilename`:** `` `${filenameSafeName(portfolioName.trim()) || 'portfolio'}-capm-${datePart(now)}.csv` ``.
- **`capmApplyPlan`:** `applyPlan(portfolio, { tickers: response.tickers, target_weights: response.target_weights, feasible: true }, lastCloseByTicker)`. The CAPM route raises instead of returning an infeasible result, so `feasible` is always true.
- **`capmApplyLines`:** start from `applyConfirmLines(plan, 'Target')`. Insert one extra line immediately before the final `'There is no undo.'` when all of these hold:
  - the basis is `dollar`
  - `targetValue !== null`
  - `plan.sharesMode === 'recomputed'`
  - `Math.abs(targetValue - basis.investedValue) >= 0.005`

  The line is: `` `Share counts are sized to the current invested value (${formatMoney(basis.investedValue)}), not the ${formatMoney(targetValue)} Target value.` ``
- **`statItems(response, 'current')`:**
  - Reads `response.current_metrics` instead of `response.metrics`.
  - The labels and the Sharpe / Beta tooltips are identical to the target version.
  - The Expected volatility tooltip says `Current weights` where the target version says `Target weights`.
  - The target output is unchanged.
- **`varItems(response, targetValue)`:**
  - When `targetValue` is a number, each item gets `detail: formatMoney(targetValue * var)`, for example `-$22.40`.
  - When it is `null`, there is no `detail` key.
- **`calChartData`:** every value is ×100.
  - `rf = { vol: 0, ret: rf }`
  - `target` = `(metrics.expected_vol, metrics.expected_return)`
  - `current` = `(current_metrics.expected_vol, current_metrics.expected_return)`
  - `assets` = each holding's `(vol, expected_return)` plus its ticker, in holdings order
  - `line`:
    - When `metrics.expected_vol <= 1e-12`, it is `[]`.
    - Otherwise it has two points: `rf`, then `xEnd = 1.1 × max(every asset vol, target vol, current vol)` with `ret = rf + slope × xEnd`, where `slope = (target.ret − rf.ret) / target.vol`.

### Test fixture additions (`capm.test.ts`)

Add this to `RESPONSE`, directly after `metrics`:

```ts
current_metrics: { expected_return: 0.0901, expected_vol: 0.2, expected_sharpe: 0.2412, portfolio_beta: 0.9587 },
```

New constants:

```ts
const DOLLAR3: Extract<TradeBasis, { kind: 'dollar' }> = { kind: 'dollar', investedValue: 1000, prices: { A: 100, B: 50, Y: 20 }, shares: { A: 4, B: 8, Y: 10 } }
const PORTFOLIO3: Portfolio = { id: 'p3', name: 'Test', cashWeight: 10, positions: [{ ticker: 'A', weight: 36, shares: 4 }, { ticker: 'B', weight: 36, shares: 8 }, { ticker: 'Y', weight: 18, shares: 10 }], updatedAt: '2026-09-26T00:00:00.000Z' }
const CLOSES3 = new Map<string, number | null>([['A', 100], ['B', 50], ['Y', 20]])
```

**Eleven new `it`s.** Expected values were scratch-computed with node from the rules above. Use `toBeCloseTo` for any floating value; the strings below are exact.

1. **`parseTargetValue`:**

   | Input | Result |
   |---|---|
   | `''` and `'  '` | `{ok:true,value:null}` |
   | `'1,500'` | 1500 |
   | `'$1,500.50'` | 1500.5 |
   | `' 900 '` | 900 |

   `'0'`, `'-5'`, `'abc'` and `'Infinity'` each give the error message.
2. **`defaultTargetValue`:**
   - `DOLLAR3` gives `'1000.00'`.
   - `{ ...DOLLAR3, investedValue: 123456.789 }` gives `'123456.79'`.
   - `WEIGHTS_BASIS` gives `''`.
3. **`capmWeightSource(RESPONSE)`:**
   - `implied_trades` ≈ `{ A: 0.2, B: -0.2, Y: 0 }`
   - `pinned` is `[{ ticker: 'Y' }]`
4. **`capmTradeRows`**, each row as `[ticker, currentValue, targetShares, targetValue, tradeShares, tradeValue, frozen]`:

   | Ticker | At `1000` | At `1500` |
   |---|---|---|
   | A | `400, 6, 600, +2, +200, false` | `400, 9, 900, +5, +500, false` |
   | B | `400, 4, 200, −4, −200, true` | `400, 6, 300, −2, −100, true` |
   | Y | `200, 10, 200, 0, 0, false` | `200, 15, 300, +5, +100, false` |

5. **`varItems(RESPONSE, 1000)`:**
   - `detail`s are `['-$22.40', '-$48.30', '-$96.30', '-$156.40', '-$263.90']`.
   - `varItems(RESPONSE)[0]` has no `detail` property (`expect('detail' in item).toBe(false)`).
6. **`statItems(RESPONSE, 'current')`:**
   - `[label, value]` pairs are `[['Expected return','9.01%'],['Expected volatility','20.00%'],['Expected Sharpe','0.24'],['Beta vs SPY','0.96']]`.
   - `[1].tooltip` contains `'Current weights'`.
7. **`allViewsZero`:**
   - `RESPONSE` gives false.
   - The same response with every holding's `view` set to 0 gives true.
8. **`capmCsv`**, three cases:
   - **Weights basis:** `capmCsv(RESPONSE, WEIGHTS_BASIS, 1000)` equals exactly
     `'ticker,beta,capm_return_pct,view_pct,expected_return_pct,vol_pct,current_pct,target_pct,change_pp,frozen,pinned\nA,1.5,11.5,20,12.5,28.62,40,60,20,false,false\nB,0.5,6.5,0,6.5,17.76,40,20,-20,true,false\nY,0.7933,7.97,-10,7.47,16.9,20,20,0,false,true\n'`
   - **No target value:** `capmCsv(RESPONSE, DOLLAR3, null)` equals the same string.
   - **Dollar basis:** `capmCsv(RESPONSE, DOLLAR3, 1500)` equals exactly
     `'ticker,beta,capm_return_pct,view_pct,expected_return_pct,vol_pct,current_pct,target_pct,change_pp,frozen,pinned,price,current_shares,current_value,target_shares,target_value,trade_shares,trade_value\nA,1.5,11.5,20,12.5,28.62,40,60,20,false,false,100,4,400,9,900,5,500\nB,0.5,6.5,0,6.5,17.76,40,20,-20,true,false,50,8,400,6,300,-2,-100\nY,0.7933,7.97,-10,7.47,16.9,20,20,0,false,true,20,10,200,15,300,5,100\n'`
9. **`capmCsvFilename('My: Fund', new Date(2026, 8, 26))`** gives `'My Fund-capm-2026-09-26.csv'`.
10. **`capmApplyPlan(PORTFOLIO3, RESPONSE, CLOSES3)`**:
    - Returns `ok: true`, `sharesMode: 'recomputed'` and `removed: []`.
    - Positions ≈ `A {weight 54, shares 6}`, `B {18, 4}`, `Y {18, 10}`.
    - `capmApplyLines(plan, DOLLAR3, 1000)` equals `['Holdings weights will be replaced by the Target column. Cash stays at 10.0%.', "Share counts will be recalculated from each holding's last stored close, as fractional shares.", 'There is no undo.']`.
    - `capmApplyLines(plan, DOLLAR3, 1500)` has 4 lines, and line index 2 is `'Share counts are sized to the current invested value ($1,000.00), not the $1,500.00 Target value.'`.
11. **`calChartData(RESPONSE)`:**
    - Point values:

      | Point | vol | ret |
      |---|---|---|
      | `rf` | 0 | 4.27 |
      | `target` | ≈ 21.9962 | ≈ 9.79333 |
      | `current` | ≈ 20 | ≈ 9.01 |

    - `assets.map(a => a.ticker)` is `['A','B','Y']`, with `assets[0]` ≈ `(28.6243, 12.5)`.
    - `line` has 2 points: `line[1].vol` ≈ 31.48673 and `line[1].ret` ≈ 12.17644 (`toBeCloseTo(…, 4)`).
    - With `metrics.expected_vol: 0`, `line` is `[]`.

### `CapmSection.tsx` UI

**State and wiring:**

- Keep the page structure and everything 0118 built.
- Store the `TradeBasis` used by a run in the `ready` run state, the same way `OptimizePage.tsx` does (`basis` computed in `submit`). Add `applied: boolean` too, starting `false`.
- **Target value state:** `const [targetText, setTargetText] = useState<string | null>(null)`.
  - `null` means "use the default". The shown text is `targetText ?? defaultTargetValue(liveBasis)`, where `liveBasis = tradeBasis(current, universe.lastClose)` once prices are loaded, and `''` before that.
  - Typing sets it. There is no `useEffect` for the default.
  - Target value is **not** part of `CapmSettings` or `sameCapmRun`. Changing it updates the dollar figures live and never shows "Settings have changed".
- **Settings panel:** add a `Field` labelled `Target value ($)` as the first item of the row that holds Min % / Max % for all.
  - It is a text input, `inputMode="decimal"`, `w-40`, with the house control classes.
  - When `parseTargetValue` fails, show its message in `text-xs text-brand-negative` below the input, and treat the target value as `null`.

**Results, in this order:**

1. **Summary card.** Unchanged, except when `allViewsZero(response)` it shows this `text-sm text-[var(--color-muted)]` line after the warnings: `Every view is 0%, so these weights come from CAPM alone. They favour holdings whose price moves mostly with the market, not holdings expected to beat it.`
2. **"Expected portfolio statistics" card, full width.**
   - Two labelled rows, `Current` then `Target`, styled like `OptimizePage`'s `<p className="text-xs font-medium text-[var(--color-muted)] mb-2">` labels.
   - Each row is `<Tiles items={statItems(response, 'current' | 'target')} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />`.
3. **"Value at Risk (95%)" card, full width.**
   - `varItems(response, targetValue)` in `grid grid-cols-2 gap-3 sm:grid-cols-5`.
   - `Tiles` renders `detail`, when present, as `<dd className="text-xs text-[var(--color-muted)]">` under the value.
4. **"Weights and CAPM details" card.**
   - The table is unchanged.
   - The heading row becomes `flex items-center justify-between gap-3` with two buttons on the right, copying `OptimizePage.tsx`'s Export CSV and Apply buttons (same classes, `DownloadIcon`):
     - **Export CSV** calls `downloadTextFile(capmCsvFilename(current.name, new Date()), capmCsv(response, run.basis, targetValue), 'text/csv;charset=utf-8')`.
     - **Apply to portfolio** is disabled when `applied` or `!plan.ok`.
       - `plan = capmApplyPlan(current, response, universe.lastClose)`.
       - The confirm dialog is copied from `OptimizePage.tsx`: the same markup and z-index, and `handleConfirmApply` does the same `savePortfolio` / read-back / error text.
       - The dialog's lines are `capmApplyLines(plan, run.basis, targetValue)`.
     - After a successful save, show `Applied. Holdings now use the Target weights. Run again to compare against them.` in `text-sm text-brand-positive`.
5. **"Trades" card.** Rendered only when `run.basis.kind === 'dollar'` and `targetValue !== null`.
   - **Columns:** Ticker, Price, Current shares, Current value, Current, Target shares, Target value, Target, Trade shares, Trade $.
   - **Formatting** uses the same formatters as Optimize's dollar table: `formatPrice`, `formatShares`, `formatMoney`, `formatWeight`, `formatSignedShares` and `formatSignedMoney`.
     - Numeric cells use `NUMERIC_TH` / `NUMERIC_TD`.
     - Trade cells are coloured with the existing `color()` helper.
     - The Ticker cell matches the results table's ticker cell, including the `pinned` / `frozen` tags.
   - **Note below the table** (`text-xs text-[var(--color-muted)] mt-3`): `` `Trades use each holding's last stored close and fractional shares, sized to a Target value of ${formatMoney(targetValue)}. Current values total ${formatMoney(run.basis.investedValue)}; any difference is money added or withdrawn. Cash is left as it is.` ``
   - **When the card is not rendered** and `run.basis.kind === 'weights'`, show `tradeBasisNote(run.basis)` as a muted `text-xs` line at the bottom of the Weights card instead.
6. **"Risk vs return" card.**
   - `<h2>` reads `Risk vs return: Capital Allocation Line`.
   - Below it, a `text-xs text-[var(--color-muted)]` line: `Each holding's expected return (with your views) against its volatility. The dashed line runs from the risk-free rate through the Target portfolio. Model projections, not guarantees.`
   - Then the lazy-loaded `<CapmChart data={calChartData(response)} />` inside `Suspense` with the same fallback markup as OptimizePage, height `h-[22rem]`.

**Also:** in `HoldingsTable`, the first `<td>` (ticker) gets `font-mono text-xs font-semibold whitespace-nowrap`, matching the results table.

### `CapmChart.tsx`

Follow `OptimizeChart.tsx`'s conventions: `ResponsiveContainer` in `h-[22rem]`, `CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)"`, the same tooltip `contentStyle`, and `isAnimationActive={false}` everywhere.

Use recharts `ScatterChart` (recharts 3.x is installed):

- **Axes:**
  - `XAxis type="number" dataKey="vol" name="Volatility" tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={[0, 'auto']}`
  - `YAxis type="number" dataKey="ret" name="Expected return"`, with the same tickFormatter and `domain={['auto', 'auto']}`
- **CAL:** `<ReferenceLine segment={[{ x: line[0].vol, y: line[0].ret }, { x: line[1].vol, y: line[1].ret }]} stroke="var(--color-primary)" strokeDasharray="6 3" ifOverflow="extendDomain" />`, rendered only when `line.length === 2`.
- **Scatter series:**

  | Series | Data | Fill | Extras |
  |---|---|---|---|
  | `Holdings` | `assets` | `var(--color-muted)` | `<LabelList dataKey="ticker" position="top" />` (font size 10, fill `var(--color-muted)`) |
  | `Current` | `[current]` | `var(--color-accent)` | |
  | `Target` | `[target]` | `var(--color-positive)` | `shape="star"` |
  | `Risk-free` | `[rf]` | `var(--color-primary)` | |

- **`<Legend />` and tooltip:** the tooltip formatter shows numbers as `${value.toFixed(2)}%`.

No leverage (2×/3×) markers. Main had them, but this app is long-only and cannot act on them.

## Out of scope

- Monte Carlo, the efficient frontier and Forecast.
- Any change to `/portfolio/optimize` or the Optimize tab's UI.
- Changing default weight limits. Concentration (check 4: one +50% view put 84.4% in VEA) is noted for Gunnar, not fixed here.
- VaR for the Current weights. Only the expected-statistics tiles get a Current row.
- Chart PNG export, and main's chart-level CSV export. The CSV button exports the table data.
- Persisting target value or settings across page loads.
- Reformatting `capm.test.ts`'s existing long lines. Add the new tests in the same file; wrapping them across lines is fine.

## Acceptance criteria

1. `(cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -1)` reports **659 passed**, the before count plus 1. If your before count differs from 658, the expected figure is your before count + 1.
2. `(cd frontend && npx vitest run 2>&1 | grep -E "^ +Tests")` reports **173 passed**, the before count plus 11. `optimize.test.ts` is byte-identical to before: `git diff --quiet -- frontend/src/lib/optimize.test.ts` exits 0.
3. `(cd frontend && npm run build)` exits 0.
4. `(cd frontend && npm run lint)` shows only the two baseline warnings (`HelpSidebar.tsx:44`, `UniversePage.tsx:60`).
5. `git diff --stat` plus `git status --short`, compared with the pre-edit snapshot, show changes only to the files listed in Files, plus the new `CapmChart.tsx` and this contract's Status line.
6. `git diff -- frontend/src/pages/analysis/OptimizePage.tsx frontend/src/lib/optimize.test.ts` is empty.
7. `grep -c "tradeRows(capmWeightSource" frontend/src/lib/capm.ts` gives 1, and `grep -c "applyPlan(portfolio" frontend/src/lib/capm.ts` gives 1. Reuse, not reimplementation.
8. `grep -n "leverage\|2x\|3x" frontend/src/components/CapmChart.tsx` prints nothing.
9. `awk 'length > 300 { print FILENAME": "FNR }' frontend/src/pages/analysis/outlook/CapmSection.tsx frontend/src/components/CapmChart.tsx frontend/src/lib/capm.ts` prints nothing.
10. `grep -n "title=" frontend/src/pages/analysis/outlook/CapmSection.tsx frontend/src/components/CapmChart.tsx` prints nothing.
11. `grep -c "useEffect" frontend/src/pages/analysis/outlook/CapmSection.tsx` gives **3** (the import line plus the two existing effects), the same as before. The target-value default is derived, not synced by an effect.
12. `git diff -- backend/app/capm_run.py | grep -c '^-[^-]'` gives **0**. The backend change is purely additive: a new dataclass field, a new block and a new keyword argument.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> - **Why:** `backend/.env` holds the live production database URL, and `app/config.py` loads it at import. `tests/conftest.py` strips it for pytest only.
> - **Only an empty value works.** A non-empty throwaway URL raises at import.
> - **For a real database**, use the pytest fixtures, not an ad-hoc script.
>
> None of the commands below need a script.

Paste the complete, verbatim output of each:

```bash
git status --short
(cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -1)
(cd backend && .venv/bin/python -m pytest -q tests/test_capm_run.py tests/test_api_capm.py 2>&1 | tail -3)
(cd frontend && npx vitest run 2>&1 | grep -E "^ +Tests")
(cd frontend && npx vitest run src/lib/capm.test.ts 2>&1 | tail -6)
(cd frontend && npm run build 2>&1 | tail -3)
(cd frontend && npm run lint 2>&1 | tail -6)
git diff --stat
git diff --quiet -- frontend/src/lib/optimize.test.ts frontend/src/pages/analysis/OptimizePage.tsx; echo "untouched exit=$?"
grep -c "tradeRows(capmWeightSource" frontend/src/lib/capm.ts
grep -c "applyPlan(portfolio" frontend/src/lib/capm.ts
grep -n "leverage\|2x\|3x" frontend/src/components/CapmChart.tsx; echo "leverage exit=$?"
awk 'length > 300 { print FILENAME": "FNR }' frontend/src/pages/analysis/outlook/CapmSection.tsx frontend/src/components/CapmChart.tsx frontend/src/lib/capm.ts; echo done
grep -n "title=" frontend/src/pages/analysis/outlook/CapmSection.tsx frontend/src/components/CapmChart.tsx; echo "title exit=$?"
grep -c "useEffect" frontend/src/pages/analysis/outlook/CapmSection.tsx
git diff -- backend/app/capm_run.py
git diff -- backend/app/capm_run.py | grep -c '^-[^-]'
```

## Tooltips — required for any contract adding interactive elements

Use `Tooltip` for every item below; never `title`.

| Element | Tooltip copy |
|---|---|
| Target value ($) field | `Portfolio value to size trades and dollar VaR. Defaults to what your holdings are worth now. Changing it doesn't change the optimization, so there's no need to run again.` |
| Export CSV button | `Download the CAPM results as a CSV, with share and dollar trades when they're shown` |
| Apply to portfolio button | `'Already applied. Run again to optimize the new weights.'` when applied; otherwise `applyBlockedText(plan.reason)` when blocked; otherwise `"Save the Target weights to this portfolio's Holdings"` |
| Confirm dialog Cancel / Apply | Copy OptimizePage exactly. It has no tooltips on these, and that stays as-is. |

The chart has no clickable elements. The recharts hover tooltip is not an interactive control for this rule.

## Human verification — does Gunnar need to run anything?

**Run the frontend and backend, and look at it.**

Restart the backend first, because this contract changes the response shape:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
(cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000)
(cd frontend && npm run dev)
```

Then, on the portfolio from checks 2 and 4 (it has share counts):

1. Run with every view at 0%.
   - The "Every view is 0%…" note shows.
   - The statistics card has a Current row and a Target row.
   - Current Beta should be close to the weighted average of the Current column's betas.
2. The Target value defaults to what the holdings are worth now (it matches the Holdings tab's invested total, not including cash).
   - Every Trade $ in the Trades card sums to about $0.
   - VaR tiles show dollar amounts under each percentage.
3. Type a Target value $100,000 higher.
   - The Trades card and VaR dollars update without re-running, and "Settings have changed" does **not** appear.
   - Trade $ now sums to about +$100,000.
   - Type `abc`: the error shows, and the Trades card and VaR dollars disappear.
4. Click **Export CSV**. Open the file and check that it has the dollar columns.
5. Look at the CAL chart in light and dark themes.
   - Holdings are labelled, and the Target star sits on the dashed line.
   - The line starts at the risk-free rate on the vertical axis.
6. Click **Apply to portfolio**. The confirm dialog says "Target column", then Apply.
   - Holdings now show the Target weights.
   - The button disables with the "Applied" message.
   - Re-running shows Current ≈ the previous Target.
7. At a narrow window (~400px), the tiles wrap and the tables scroll sideways instead of overflowing.

## Open questions

None known. If something in this contract conflicts with the code as it stands, report `BLOCKED` with the conflict instead of choosing. Examples: `tradeRows`'s body differs from the one quoted, or the `RESPONSE` fixture doesn't match.

## Rework 1 (planner audit, 2026-09-26): the logic is accepted, `CapmSection.tsx` is not. Adds the CAPM Help guide.

The audit reproduced every acceptance check except line length. The backend, `optimize.ts`, `capm.ts`,
`capm.test.ts` and `CapmChart.tsx` are accepted as they are. **Do not change them**, with one exception:
item B adds a new `lib/capmGuide.ts` and its test.

### A. Rewrite `CapmSection.tsx` by hand (this is the rejection)

The file is 44 lines. Lines 10–44 each run 370 to 6,494 characters. This is the same failure as 0118
round 1, and it has the same fix:

- **Do not use a formatter.** Prettier is not a project dependency. Installing it, or running `npx prettier`, is out of scope.
- **"Formatter unavailable" is not a reason for PARTIAL or BLOCKED.** Rewrite the file by hand with your edit tool. Replacing the whole file in one write is fine and probably easiest.
- **Shape model:** `git show HEAD:frontend/src/pages/analysis/outlook/CapmSection.tsx`, the accepted 0118 version: 409 lines, longest 274 characters. Follow its layout:
  - one statement per line
  - JSX indented one element per line
  - long attribute lists wrapped one attribute per line
  - long imports wrapped one name per line
  - each component's props type on its own lines
- **Change no behaviour.** Every string, class, handler and state transition that is in the file now stays exactly as it is. The only additions are item B's.

### B. Help button and CAPM guide

Every Outlook technique gets a **Help** button at the top right of its settings card. It opens a side
panel that explains what the technique is, how it works, and what each setting and result means. This
contract builds the shared pieces and the CAPM guide. Monte Carlo and Forecast will add their own guides
in their own contracts.

**New file `frontend/src/components/GuidePanel.tsx`.** It exports two components:

1. `GuidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode })`.
   - This is `OptimizerGuide.tsx`'s shell copied exactly: the same overlay, click-outside close, Escape close, focus-on-open, focus restore on close, the `eslint-disable-next-line` comment, the panel classes (`w-96`), the header row and the × button with `<Tooltip label="Close the guide">`.
   - The differences:
     - `aria-label={title}`
     - the `h2` shows `{title}`
     - the body is `<div className="flex flex-col gap-4 p-4">{children}</div>`
2. `HelpButton({ tooltip, onClick }: { tooltip: string; onClick: () => void })`.
   - It renders `<Tooltip label={tooltip}>` around a `<button type="button">` that uses HelpSidebar's trigger classes exactly:
     `inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-btn)] border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground`
   - The button contains a private `HelpIcon` (a copy of HelpSidebar's svg) and the text `Help`.

Leave `OptimizerGuide.tsx`, `HelpSidebar.tsx` and `OptimizePage.tsx` untouched. Moving them onto
`GuidePanel` is a possible later cleanup, not part of this contract.

**New file `frontend/src/lib/capmGuide.ts`.** Copy it exactly as written below. It has no JSX, so a test
can check it.

```ts
export interface GuideEntry {
  term: string
  text: string
}

export interface GuideSection {
  heading: string
  paragraphs: string[]
  entries: GuideEntry[]
}

export const CAPM_SETTING_TERMS = [
  'Lookback',
  'Risk-free rate',
  'Market risk premium',
  'Market ticker',
  'Target value',
  'Min % / Max %',
  'Freeze',
  'View',
] as const

export const CAPM_GUIDE: GuideSection[] = [
  {
    heading: 'What this does',
    paragraphs: [
      'CAPM optimization chooses Target weights for your invested holdings that give the highest expected Sharpe ratio. The expected returns come from the Capital Asset Pricing Model (CAPM) plus any views you add.',
      'It looks forward: the returns are model assumptions, not a backtest of what happened. Cash is left out and stays as it is.',
    ],
    entries: [],
  },
  {
    heading: 'Expected returns',
    paragraphs: [
      'Each holding’s expected annual return is: risk-free rate + beta × market risk premium + market risk premium × view.',
      'Beta measures how much the holding has moved with the market ticker over the lookback. A beta of 1.0 moves with the market, above 1 amplifies it, and below 1 dampens it. With every view at 0%, a holding’s expected return depends only on its beta.',
    ],
    entries: [],
  },
  {
    heading: 'How the weights are chosen',
    paragraphs: [
      'The optimizer searches for the weights, adding up to 100% of the invested holdings, with the highest (expected return − risk-free rate) ÷ expected volatility.',
      'Volatility and correlations come from the daily returns over the lookback. Every weight stays within its min/max limits, and frozen holdings keep their current weight.',
    ],
    entries: [],
  },
  {
    heading: 'Settings',
    paragraphs: [],
    entries: [
      { term: 'Lookback', text: 'How many years of daily prices are used to estimate betas, volatilities and correlations. Longer lookbacks are steadier but slower to reflect change; shorter ones react faster but are noisier.' },
      { term: 'Risk-free rate', text: 'The annual return on cash-like assets. Leave it blank to use the live 3-month Treasury bill yield. Every expected return and the Sharpe ratio start from it.' },
      { term: 'Market risk premium', text: 'How much more than the risk-free rate you expect the market to return each year (5% by default). At 0%, every holding expects the risk-free rate and views have no effect.' },
      { term: 'Market ticker', text: 'The benchmark that betas are measured against (SPY by default). Its prices must cover the whole lookback.' },
      { term: 'Target value', text: 'The dollar size used for the Trades card and the VaR dollar amounts. It defaults to what the invested holdings are worth now, and changing it does not re-run the model. It is a planning figure: Apply always uses the current invested value.' },
      { term: 'Min % / Max %', text: 'Limits on each holding’s Target weight. “Min % for all” and “Max % for all” copy one pair of limits to every holding that isn’t frozen. Limits that cannot all be met stop the run, and the error says which way to relax them.' },
      { term: 'Freeze', text: 'Keeps the holding at its current weight. The optimizer arranges the other holdings around it.' },
      { term: 'View', text: 'Your opinion of the holding compared with what CAPM implies, from −50% to +100%. The view is scaled by the market risk premium: +50% with a 5% premium adds 2.5 percentage points to that holding’s expected return.' },
    ],
  },
  {
    heading: 'Pinned holdings',
    paragraphs: [
      'A holding whose prices start more than a week after the lookback start is pinned. It keeps its current weight, it isn’t optimized, and its limits and freeze setting don’t apply. The results list any pinned holdings. Choose a shorter lookback to include them.',
    ],
    entries: [],
  },
  {
    heading: 'Reading the results',
    paragraphs: [],
    entries: [
      { term: 'Current and Target', text: 'Expected return, volatility, Sharpe ratio and beta for your weights now and for the Target weights, from the same model. The difference is what the optimizer changes.' },
      { term: 'Value at Risk', text: 'Parametric 95% VaR of the Target weights: one period in 20, the return is expected to be worse than this. It comes from a normal model of returns, which understates the chance of large crashes.' },
      { term: 'Holdings table', text: 'Each holding’s beta, CAPM return, view, expected return and volatility, with its Current and Target weights.' },
      { term: 'Trades', text: 'The shares and dollars to buy or sell to move from the current holdings to the Target weights at the Target value.' },
      { term: 'Chart', text: 'Each holding is plotted by volatility and expected return, along with Current, Target (the star) and the risk-free rate. The dashed line runs from the risk-free rate through the Target, and its slope is the Target’s Sharpe ratio. Mixing the Target with cash moves along that line.' },
      { term: 'Export and Apply', text: 'Export CSV downloads the results. Apply to portfolio saves the Target weights as the portfolio’s holdings, sized to the current invested value, and leaves cash unchanged.' },
    ],
  },
  {
    heading: 'Limits of the model',
    paragraphs: [
      'With no views and wide limits, the Target tends to pile into a few holdings, often those with a high beta relative to their volatility. Use Max % to cap any one holding.',
      'Betas, volatilities and correlations are estimated from the past and change over time. Expected returns are assumptions: a single large view can move most of the portfolio into one holding.',
      'Taxes and trading costs are not considered.',
    ],
    entries: [],
  },
]
```

**New file `frontend/src/lib/capmGuide.test.ts`** with exactly two tests, in the style of `capm.test.ts`:

1. The `Settings` section's entry terms equal `[...CAPM_SETTING_TERMS]`, in that order.
2. Every section has a non-empty `heading`, and `paragraphs.length + entries.length > 0`.
   - Every paragraph and every entry `text` is non-empty and ends with `.`.

**New file `frontend/src/pages/analysis/outlook/CapmGuide.tsx`.** It exports
`CapmGuide({ onClose }: { onClose: () => void })`, which renders
`<GuidePanel title="CAPM guide" onClose={onClose}>`. Inside, it maps `CAPM_GUIDE`, one
`<section key={section.heading}>` per section:

- heading: `<h3 className="text-xs font-bold">`
- each paragraph: `<p className="mt-1 text-xs text-[var(--color-muted)] leading-relaxed">`
- when `entries.length > 0`: `<dl className="mt-2 flex flex-col gap-2">`, with each entry as `<div key={term}>`. Inside it:
  - `<dt className="text-xs font-semibold">`
  - `<dd className="mt-0.5 text-xs text-[var(--color-muted)] leading-relaxed">`

**In `CapmSection.tsx`:**

- Replace the settings card's `<h2 className="text-sm font-semibold mb-2">CAPM optimization settings</h2>` with:
  ```tsx
  <div className="flex items-center justify-between gap-4 mb-2">
    <h2 className="text-sm font-semibold">CAPM optimization settings</h2>
    <HelpButton
      tooltip="What CAPM optimization does and how each setting works"
      onClick={() => setGuideOpen(true)}
    />
  </div>
  ```
- Add `const [guideOpen, setGuideOpen] = useState(false)`.
- Render `{guideOpen && <CapmGuide onClose={() => setGuideOpen(false)} />}` as the last child of the section's root `div`. Optimize places its guide the same way.
- Add nothing else. There is no new `useEffect` in `CapmSection.tsx`; the panel's effect lives in `GuidePanel`.

### Rework acceptance (paste the complete output of each command)

```bash
git status --short                                                        # BEFORE editing; paste it
(cd backend && PYTHONPATH=. DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)   # 659 passed
(cd frontend && npx vitest run 2>&1 | grep -E "^ +Tests")                 # 175 passed (173 + 2)
(cd frontend && npm run build 2>&1 | tail -2)                             # exits 0
(cd frontend && npm run lint 2>&1 | grep -E "warning|error")              # only HelpSidebar.tsx:44 and UniversePage.tsx:60
F=frontend/src/pages/analysis/outlook
awk 'length > 300 { print FILENAME": "FNR }' $F/CapmSection.tsx $F/CapmGuide.tsx frontend/src/components/GuidePanel.tsx; echo done   # only "done"
wc -l < $F/CapmSection.tsx                                                # at least 450
awk 'length > 160' $F/CapmSection.tsx | wc -l                             # at most 12 (HEAD had 6; OptimizePage has 16)
grep -c "useEffect" $F/CapmSection.tsx                                    # 3, unchanged
grep -n "title=" $F/CapmSection.tsx $F/CapmGuide.tsx frontend/src/components/GuidePanel.tsx; echo "exit=$?"   # exit=1
grep -c "HelpButton\|CapmGuide" $F/CapmSection.tsx                        # at least 4 (2 imports + 2 uses)
git diff --stat -- frontend/src/components/OptimizerGuide.tsx frontend/src/components/HelpSidebar.tsx frontend/src/pages/analysis/OptimizePage.tsx frontend/src/lib/optimize.test.ts   # empty
git diff --stat -- backend frontend/src/lib/capm.ts frontend/src/lib/optimize.ts frontend/src/api/client.ts   # identical to before this rework
for s in "Target value" "Invested holdings only." "Settings have changed" "Apply to portfolio" "sm:grid-cols-5" "text-xs text-brand-negative" "tradeBasisNote(" "defaultTargetValue"; do printf '%s: ' "$s"; grep -c "$s" $F/CapmSection.tsx; done   # every count ≥ 1
```

**Browser (the coder runs it if a browser is available; otherwise it is left to Gunnar):**

1. Outlook → CAPM. The **Help** button sits at the top right of the settings card, level with the title, and hovering it shows the tooltip.
2. Click it. The panel slides in on the right with the title "CAPM guide" and seven sections.
3. Close it three ways: Escape, clicking the overlay, and ×. Each time, focus returns to the Help button.
4. Check both themes and a narrow window (~400px). The panel scrolls and its text doesn't overflow.
5. Repeat 0119's human checks 1–7 above, to confirm the rewrite changed no behaviour.

If anything here conflicts with the code as it stands, report `BLOCKED` with the conflict instead of
choosing. For example, the settings card's `h2` might not match the quoted markup, or `OptimizerGuide.tsx`'s
shell might differ from what item B describes.

## Acceptance (planner, 2026-09-26)

- **Rework 1, part B (Help guide):** accepted as delivered. `capmGuide.ts` matches the contract byte for byte.
- **Rework 1, part A (hand reformat):** not achieved by the coder. Gunnar ran
  `npx --yes prettier@3 --print-width 120 --single-quote --no-semi --write` on `CapmSection.tsx`.
  The result is 771 lines with none over 300 characters.
- **Crash found after the rework.** The Outlook tab rendered blank, because the Target value `Field`
  passed two children (the input and the conditional error) to `Tooltip`, which calls `Children.only`.
  It was introduced in the first 0119 build. My spec said "below the input" without warning that
  `Field` takes a single child.
  - Fixed by a coder by wrapping the `Field` and the error in a `div`.
  - Verified with the new `contracts/tools/smoke-render.mjs outlook`: no exception, and the page text renders.
- **Final checks:**
  - backend 659 passed; vitest 175 passed; build succeeds; lint baseline unchanged
  - Gunnar's browser checks all pass: Help panel, Apply, Target value, and 0118 checks 3, 6 and 7
  - the CSV without dollar columns is correct for a portfolio with no share counts
