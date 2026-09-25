# Contract 0107 — Optimize tab: settings, run, results and equity curve

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The portfolio's **Backtest** tab becomes **Optimize** at `/portfolios/:id/optimize`. It has:
- a settings card
- a Run button that calls `POST /portfolio/optimize`
- an Optimizer guide panel
- a results section: the run summary, the pinned-holdings banner, the warnings, a weights table, in-sample metric cards for Current and Optimized, and an equity-curve chart with an SPY line when SPY is available.

## Why

REBUILD.md, "The Backtest tab becomes Optimize". The backend is done: 0103 optimizer, 0104 buy-and-hold
scoring, 0105 `run_optimize`, 0106 the endpoint. This contract is the first UI on top of it. It ports
`main:"frontend/app/portfolios/[id]/targets/page.tsx"` (read it with `git show`), with these changes
from REBUILD.md:
- **Rebalance.** A dropdown is added. None (buy and hold) is the default.
- **Pinning.** Young holdings are pinned, and a banner names them.
- **Labels.** The weights are labelled constant-mix, and the results are labelled in-sample,
  invested holdings only.
- **Deferred.** CAPM, conviction views/κ and tilt come in 0110. The action table and CSV come in 0108.
  Apply comes in 0109.

Put every piece of logic that can be pure in `lib/optimize.ts`, with tests. Vitest runs only
`src/lib/**/*.test.ts` in a node environment, so components have no tests. Anything left in a
component is checked only by Gunnar's eyes.

## Files

Create:
- `frontend/src/lib/optimize.ts`: the constants, types and pure helpers in **Interface**.
- `frontend/src/lib/optimize.test.ts`: the tests in **Tests**.
- `frontend/src/pages/analysis/OptimizePage.tsx`: the page (`export function OptimizePage(): JSX.Element`).
- `frontend/src/components/OptimizerGuide.tsx`: the guide side panel.
- `frontend/src/components/OptimizeChart.tsx`: the equity-curve chart. Use a default export, loaded
  with `lazy()` the way `PortfolioCharts.tsx` loads `SeriesChart`.

Modify:
- `frontend/src/api/client.ts`: add the optimize types and `optimizePortfolio` (see **Interface**).
  Add nothing else.
- `frontend/src/App.tsx`:
  - change the import to `OptimizePage`
  - change `<Route path="backtest" element={<BacktestPage />} />` to
    `<Route path="optimize" element={<OptimizePage />} />`
  - add no redirect from `backtest`
- `frontend/src/pages/analysis/AnalysisLayout.tsx`: in `ANALYSIS_TABS`, change
  `{ path: 'backtest', label: 'Backtest' }` to `{ path: 'optimize', label: 'Optimize' }`. Change
  nothing else in the file.

Delete:
- `frontend/src/pages/analysis/BacktestPage.tsx`, with plain `rm`. Do not use `git rm`, and do not run
  any other git command that writes.

**Touch nothing else.** That includes the backend, `SeriesChart.tsx`, `PortfolioCharts.tsx`,
`HelpSidebar.tsx`, `Tooltip.tsx`, `lib/chart.ts` (import `downsample` from it, but don't edit it) and
`lib/format.ts`. If the work seems to need any other file, stop and report `BLOCKED`.

**`reference files/` and `~/WebstormProjects/blue-eagle-reference` are read-only and never belong on
a file list.** Read `main` with `git show main:<path>`. Never check it out.

## Interface

### `api/client.ts`

Add these next to `getPortfolioSeries`. The field names match `backend/app/schemas.py`
(`OptimizeRequest`, `OptimizeResponse`, `PinnedHoldingOut`, `OptimizeCurvesOut`) exactly. Dates are ISO
`YYYY-MM-DD` strings.

```ts
export type OptimizeRebalance = 'none' | 'monthly' | 'quarterly' | 'annual'

export interface OptimizeRequest {
  tickers: string[]
  weights: number[]
  mode: string
  lookback_days: number
  max_weight: number
  min_weight: number
  vol_target: number
  allow_short: boolean
  rebalance: OptimizeRebalance
  conviction_views?: Record<string, number>
  kappa?: number
}

export interface PinnedHolding {
  ticker: string
  first_bar: string
  weight: number
  exceeds_max: boolean
}

export interface OptimizeCurves {
  dates: string[]
  current: number[]
  optimized: number[]
  benchmark: number[] | null
}

export type OptimizeMetrics = Record<string, number | null>

export interface OptimizeResponse {
  tickers: string[]
  current_weights: Record<string, number>
  target_weights: Record<string, number>
  implied_trades: Record<string, number>
  pinned: PinnedHolding[]
  fit_start: string
  fit_end: string
  score_start: string
  score_limited_by: string | null
  curves: OptimizeCurves
  metrics: {
    current: OptimizeMetrics | null
    optimized: OptimizeMetrics | null
    forward_looking: OptimizeMetrics | null
  }
  capm_expected_returns: Record<string, number> | null
  feasible: boolean
  mode: string
  rebalance: OptimizeRebalance
  lookback_days: number
  views_applied: boolean
  delta_mu: Record<string, number>
  warnings: string[]
}

export async function optimizePortfolio(body: OptimizeRequest): Promise<OptimizeResponse> {
  return request<OptimizeResponse>('/portfolio/optimize', { method: 'POST', body })
}
```

`request` already JSON-encodes `body`, sets the content type and never retries a POST. Don't change it.

### `lib/optimize.ts`

```ts
import type { OptimizeCurves, OptimizeMetrics, OptimizeRebalance, OptimizeRequest, OptimizeResponse, PinnedHolding } from '../api/client'
import { downsample } from './chart'
import type { Portfolio } from './portfolio'

export type OptimizeMode =
  | 'equal_weight' | 'min_variance' | 'max_sharpe' | 'risk_parity'
  | 'max_sortino' | 'min_cvar' | 'max_diversification' | 'target_volatility'

// Main's dropdown order and labels, verbatim. The CAPM mode is deliberately absent until 0110.
export const OPTIMIZE_MODES: ReadonlyArray<{ value: OptimizeMode; label: string }> = [
  { value: 'equal_weight', label: 'Equal Weight (1/N)' },
  { value: 'min_variance', label: 'Min Variance' },
  { value: 'max_sharpe', label: 'Max Sharpe (Historical)' },
  { value: 'risk_parity', label: 'Risk Parity' },
  { value: 'max_sortino', label: 'Max Sortino' },
  { value: 'min_cvar', label: 'Min CVaR (95%)' },
  { value: 'max_diversification', label: 'Max Diversification' },
  { value: 'target_volatility', label: 'Target Volatility' },
]

export const LONG_ONLY_MODES: ReadonlyArray<OptimizeMode> = ['equal_weight', 'risk_parity', 'max_diversification']

export const LOOKBACK_OPTIONS: ReadonlyArray<{ label: string; days: number }> = [
  { label: '1Y', days: 365 }, { label: '2Y', days: 730 }, { label: '3Y', days: 1095 }, { label: '5Y', days: 1825 },
]

export const REBALANCE_OPTIONS: ReadonlyArray<{ value: OptimizeRebalance; label: string; summary: string }> = [
  { value: 'none', label: 'None (buy and hold)', summary: 'buy and hold' },
  { value: 'monthly', label: 'Monthly', summary: 'rebalanced monthly' },
  { value: 'quarterly', label: 'Quarterly', summary: 'rebalanced quarterly' },
  { value: 'annual', label: 'Annual', summary: 'rebalanced annually' },
]

export interface OptimizeSettings {
  mode: OptimizeMode
  lookbackDays: number
  maxWeightPct: number   // slider 10–100, step 5
  minWeightPct: number   // slider 0–20, step 1
  volTargetPct: number   // slider 5–50, step 1
  allowShort: boolean
  rebalance: OptimizeRebalance
}

export const DEFAULT_SETTINGS: OptimizeSettings = {
  mode: 'min_variance', lookbackDays: 1825, maxWeightPct: 100, minWeightPct: 0,
  volTargetPct: 10, allowShort: false, rebalance: 'none',
}

export interface WeightRow { ticker: string; current: number; target: number; change: number; pinned: boolean }
export interface CurveRow { date: string; current: number; optimized: number; benchmark: number | null }
export interface MetricItem { label: string; value: string; tooltip: string }

export function canOptimize(portfolio: Portfolio): boolean
export function buildOptimizeRequest(portfolio: Portfolio, settings: OptimizeSettings): OptimizeRequest
export function sameSettings(a: OptimizeSettings, b: OptimizeSettings): boolean
export function formatWeight(fraction: number): string
export function formatChangePp(fraction: number): string
export function weightRows(response: OptimizeResponse): WeightRow[]
export function curveRows(curves: OptimizeCurves): CurveRow[]
export function metricItems(metrics: OptimizeMetrics | null): MetricItem[]
export function pinnedBannerLines(pinned: PinnedHolding[], maxWeightPct: number): string[]
export function scoreWindowNote(response: OptimizeResponse): string | null
export function runSummary(response: OptimizeResponse): string
export function modeLabel(mode: string): string
```

Behaviour. Each of these is pinned by a test below.

- **`canOptimize`**: `portfolio.positions.length >= 2`.
- **`buildOptimizeRequest`**:
  - `tickers` and `weights` come from `portfolio.positions` in order. `weights` are the position
    weights as stored, in percent; the backend normalises them.
  - `mode` and `rebalance` are copied from the settings, and `lookback_days = lookbackDays`.
  - The percentages are divided by 100: `max_weight = maxWeightPct / 100` and
    `vol_target = volTargetPct / 100`.
  - `min_weight` is `0` when `allowShort`; otherwise it is `minWeightPct / 100`. The backend ignores
    the minimum when shorting, and sending 0 keeps the request honest.
  - `allow_short = allowShort`.
  - `conviction_views` and `kappa` are **omitted**: not present as keys at all.
- **`sameSettings`**: true when all 7 fields are equal (`===`).
- **`formatWeight(f)`**: let `r = Math.round(f * 1000) / 10`. If `r === 0`, return `'0.0%'`. Otherwise
  return `` `${r.toFixed(1)}%` ``. The `r === 0` branch keeps `-0.0%` from ever appearing.
- **`formatChangePp(f)`**: with the same `r`, return `'0.0 pp'` when `r === 0`. Otherwise return
  `` `${r > 0 ? '+' : '-'}${Math.abs(r).toFixed(1)} pp` ``.
- **`weightRows`**: one row per `response.tickers`, in that order:
  - `current = current_weights[t]`
  - `target = target_weights[t]`
  - `change = implied_trades[t]`
  - `pinned` is whether `t` appears in `response.pinned`
- **`curveRows`**:
  - Zip the curves by index into `{ date, current, optimized, benchmark }`.
  - `benchmark` is `curves.benchmark?.[i] ?? null`.
  - Pass the result through `downsample()` from `lib/chart` with its default maximum.
- **`metricItems(m)`**:
  - Always return these 4 items, in this order:

    | label | value |
    |---|---|
    | `CAGR` | `formatWeight` |
    | `Volatility` | `formatWeight` |
    | `Sharpe` | `toFixed(2)` |
    | `Max drawdown` | `formatWeight` |

  - Then add `Beta vs SPY` (`toFixed(2)`) **only when `m` has a `beta` key**, and `Alpha`
    (`formatWeight`) **only when `m` has an `alpha` key**.
  - A value that is `null`, or missing, or `m` itself being `null` or `{}`, renders as `'—'` (U+2014).
    The backend returns `{}` for fewer than 2 scored days, so `{}` must work.
  - Tooltip copy is in **Tooltips**.
- **`pinnedBannerLines(pinned, maxWeightPct)`**:
  - One string per pinned holding:
    `` `${ticker}: prices start ${first_bar}, so it is held at its current ${formatWeight(weight)} and not optimized.` ``
  - When `exceeds_max` is true, append `` ` That is above the ${maxWeightPct}% max weight.` ``
    (with a leading space).
  - Use the backend's `exceeds_max` flag; don't recompute it.
- **`scoreWindowNote`**: `null` when `score_limited_by === null`. Otherwise:
  `` `The curves start ${score_start}, when ${score_limited_by}'s price history begins. The weights were fitted on ${fit_start} → ${fit_end}.` ``
  Use an ASCII apostrophe and the → character (U+2192).
- **`modeLabel(mode)`**: the `OPTIMIZE_MODES` label, or the raw string if the mode isn't listed.
- **`runSummary`**:
  `` `${modeLabel(mode)} · ${lookback label} lookback · ${rebalance summary} · fitted ${fit_start} → ${fit_end}` ``
  - The lookback label comes from `LOOKBACK_OPTIONS`; fall back to `` `${lookback_days}d` `` if it
    isn't listed.
  - The rebalance summary comes from `REBALANCE_OPTIONS`.
  - The separator is ` · ` (U+00B7 with a space on each side).

### `OptimizePage.tsx`

It reads the portfolio the way `HoldingsPage.tsx` does:
`listPortfolios().find(...)`, then treat a legacy portfolio as absent. If the portfolio is absent,
return `null`, since `AnalysisLayout` already renders the not-found state.

**State:** `settings` (starts at `DEFAULT_SETTINGS`), `guideOpen` and `run`. `run` is one of:
- `{ status: 'idle' }`
- `{ status: 'running' }`
- `{ status: 'error'; message: string }`
- `{ status: 'ready'; response: OptimizeResponse; settings: OptimizeSettings }`

**Run:**
- Call `optimizePortfolio(buildOptimizeRequest(portfolio, settings))`.
- On error, the message is `error instanceof Error ? error.message : 'The optimizer request failed.'`.
  `ApiError`'s message already carries the backend's `detail` and status, which is how a 422 like
  "Need at least 2 holdings with full history to optimize." reaches the user.
- Ignore a response that arrives after unmount, using the `cancelled` flag or ref pattern that
  `HoldingsPage` uses.

**Layout**, top to bottom. Use the existing card classes:
`bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4`.

1. **Settings card**, heading "Optimization settings". Controls, in order:
   - **Mode**: `<select>` over `OPTIMIZE_MODES`.
   - **Lookback**: 4 buttons from `LOOKBACK_OPTIONS`. Style the selected one the way `AnalysisLayout`
     styles its active tab.
   - **Max weight**:
     - a range input, 10–100, step 5
     - its label reads `Max weight: N%`, or `Max abs. weight: N%` when `allowShort`
   - **Min weight**:
     - a range input, 0–20, step 1
     - its label reads `Min weight: N%`
     - `disabled` when `allowShort`
   - **Vol target**:
     - a range input, 5–50, step 1
     - its label reads `Vol target: N%`
     - rendered **only** when `mode === 'target_volatility'`
   - **Allow short positions**: a checkbox.
   - **Rebalance**: `<select>` over `REBALANCE_OPTIONS` (the `label` text).
   - **Buttons**: `Run optimizer` and `Optimizer guide`.
     - While running, `Run optimizer` reads `Optimizing…` and is disabled.
     - It is also disabled when `!canOptimize(portfolio)`.
   - **Error line**: under the buttons when `run.status === 'error'`, in `text-brand-negative`.
2. **Results**. Render only when `run.status === 'ready'`, using `run.response` and `run.settings`:
   1. **Summary**: `runSummary(response)` in muted text.
   2. **Stale note**: when `!sameSettings(settings, run.settings)`, a muted line reading
      "Settings have changed since this run. Run it again to update the results."
   3. **Did not converge**: when `!response.feasible`, a `bg-brand-negative/10 text-brand-negative`
      box reading "The optimizer did not converge, so the results below use your current weights."
   4. **Pinned banner**: when `response.pinned.length > 0`, a `bg-brand-accent/10` box.
      - Its heading is "Held at current weight: not enough price history".
      - Under the heading, one `<p>` per `pinnedBannerLines(response.pinned, run.settings.maxWeightPct)`.
   5. **Warnings**: one muted `<p>` per `response.warnings` entry, verbatim.
   6. **Fixed notes**, muted:
      - "Weights are constant-mix: chosen as if held at these proportions every day. Invested holdings
        only."
      - When `portfolio.cashWeight > 0`, add
        `` ` Cash (${portfolio.cashWeight.toFixed(1)}%) is left out and stays as it is.` `` to the same
        paragraph.
   7. **Weights card**:
      - Heading "Weights".
      - A table with columns Ticker, Current, Optimized and Change, from `weightRows`.
        - Format Current and Optimized with `formatWeight`, and Change with `formatChangePp`.
        - Colour Change `text-brand-positive` when it is above zero and `text-brand-negative` when it
          is below zero, deciding from the **formatted** value so that `0.0 pp` stays muted.
      - Pinned rows show a small muted `pinned` label after the ticker.
      - Reuse `HoldingsPage`'s `TH`/`TD` class strings by copying them. Don't export them from
        HoldingsPage.
   8. **Metrics card**:
      - Heading "In-sample backtest: not a forecast".
      - Two labelled rows of metric tiles: "Current" from `metricItems(response.metrics.current)`, and
        `` `Optimized (${modeLabel(response.mode)})` `` from `metricItems(response.metrics.optimized)`.
      - Each tile shows the label (wrapped in `Tooltip` with the item's tooltip) above the value.
      - Use a grid of `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`.
   9. **Equity curve card**:
      - Heading "Growth of 100: Current vs Optimized".
      - Muted subtitle:
        `` `Index, 100 on ${response.score_start}. In-sample, invested holdings only. Not a forecast.` ``
      - Then `scoreWindowNote(response)` when non-null.
      - Then this muted line: "The Current curve starts from today's weights on that date, so it will
        not match the Holdings chart, which is anchored at today."
      - Then the lazy `OptimizeChart`, inside `Suspense`, with the fallback `Loading chart…`.
        Pass `rows={curveRows(response.curves)}` and `hasBenchmark={response.curves.benchmark !== null}`.
3. The `OptimizerGuide` panel, when `guideOpen`.

### `OptimizeChart.tsx`

```ts
export default function OptimizeChart({ rows, hasBenchmark }: { rows: CurveRow[]; hasBenchmark: boolean }): JSX.Element
```

Build it with recharts `ResponsiveContainer` + `LineChart`, in a `h-[22rem]` wrapper:
- `CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)"`
- `XAxis dataKey="date"`, and a `YAxis` with ticks formatted `v.toFixed(0)` and `domain={['auto', 'auto']}`
- `Legend`
- the recharts `Tooltip`, imported as `Tooltip as ChartTooltip`, with values formatted to 2 decimals

Lines, all with `dot={false} isAnimationActive={false}`:

| dataKey | name | stroke | strokeWidth | strokeDasharray |
|---|---|---|---|---|
| `optimized` | "Optimized" | `var(--color-positive)` | 2 | — |
| `current` | "Current" | `var(--color-primary)` | 1.5 | `"5 3"` |
| `benchmark` | "SPY" | `var(--color-accent)` | 1.5 | `"3 3"` |

Render the `benchmark` line only when `hasBenchmark`.

### `OptimizerGuide.tsx`

```ts
export function OptimizerGuide({ onClose }: { onClose: () => void }): JSX.Element
```

**Shell.** Copy the panel shell from `HelpSidebar.tsx`:
- the overlay `fixed inset-0 bg-overlay z-[100] flex justify-end`, with a click on the overlay itself
  closing it
- a `role="dialog" aria-modal="true" aria-label="Optimizer guide"` panel, `tabIndex={-1}`, focused on
  mount
- Escape closes it
- focus returns to the element that was focused before it opened; store `document.activeElement` on
  mount
- the × close button

Widen the panel to `w-96` rather than `w-80`.

**Content.** One block per mode, for the **8** modes in `OPTIMIZE_MODES` order. Each block has:
- the name, bold
- the tagline
- the when-to-use text, muted
- the caveat, muted italic, prefixed `⚠ `

Copy the `name`, `tagline`, `whenToUse` and `caveat` strings verbatim from
`git show main:frontend/components/OptimizerGuide.tsx`, **except**:
- **Skip** the "Max Sharpe — CAPM" entry (it arrives in 0110).
- **Risk Parity caveat**: replace "requires w > 0 for all assets" with "every holding gets a positive
  weight".

After the 8 blocks, add one muted paragraph: "Every mode picks constant-mix weights: proportions
assumed to be held every day. The curves then score those weights as bought and held, or rebalanced
on the schedule you choose."

## Tests (`lib/optimize.test.ts`)

Use this literal fixture, typed `OptimizeResponse`:

```ts
const RESPONSE: OptimizeResponse = {
  tickers: ['AAA', 'BBB', 'YNG'],
  current_weights: { AAA: 0.5, BBB: 0.3, YNG: 0.2 },
  target_weights: { AAA: 0.62, BBB: 0.18, YNG: 0.2 },
  implied_trades: { AAA: 0.12, BBB: -0.12, YNG: 0 },
  pinned: [{ ticker: 'YNG', first_bar: '2026-03-02', weight: 0.2, exceeds_max: true }],
  fit_start: '2021-09-27', fit_end: '2026-09-23',
  score_start: '2026-03-02', score_limited_by: 'YNG',
  curves: {
    dates: ['2026-03-02', '2026-03-03', '2026-03-04'],
    current: [100, 101.5, 99.8], optimized: [100, 102.25, 100.4], benchmark: [100, 100.9, 99.1],
  },
  metrics: {
    current: { cagr: 0.1234, vol: 0.2071, sharpe: 0.5958, max_dd: -0.1826, beta: 1.1, alpha: -0.0123 },
    optimized: { cagr: 0.15, vol: 0.19, sharpe: null, max_dd: -0.1 },
    forward_looking: null,
  },
  capm_expected_returns: null, feasible: true, mode: 'min_variance', rebalance: 'none',
  lookback_days: 1825, views_applied: false, delta_mu: {},
  warnings: ['In-sample: the optimized weights were chosen using the same prices they are scored on.'],
}
const PORTFOLIO: Portfolio = {
  id: 'p1', name: 'Test', cashWeight: 10, updatedAt: '2026-09-24T00:00:00Z',
  positions: [{ ticker: 'AAA', weight: 45, shares: 3 }, { ticker: 'BBB', weight: 27 }, { ticker: 'YNG', weight: 18 }],
}
```

Required tests, at least one `it` each. Use `toEqual` unless stated otherwise:

1. `buildOptimizeRequest(PORTFOLIO, DEFAULT_SETTINGS)` equals
   `{ tickers: ['AAA','BBB','YNG'], weights: [45,27,18], mode: 'min_variance', lookback_days: 1825, max_weight: 1, min_weight: 0, vol_target: 0.1, allow_short: false, rebalance: 'none' }`.
   Also assert `'kappa' in req` and `'conviction_views' in req` are both `false`.
2. Build with `{ ...DEFAULT_SETTINGS, mode: 'target_volatility', lookbackDays: 730, maxWeightPct: 40, minWeightPct: 5, volTargetPct: 15, allowShort: true, rebalance: 'monthly' }`.
   The result has `max_weight` 0.4, `min_weight` 0, `vol_target` 0.15, `allow_short` true,
   `lookback_days` 730 and `rebalance` 'monthly'. The same settings with `allowShort: false` give
   `min_weight` 0.05.
3. `canOptimize`: true for PORTFOLIO, and false when only its first position is kept.
4. `sameSettings`: true for `DEFAULT_SETTINGS` against a spread copy, and false when `rebalance`
   differs.
5. `formatWeight`: 0.62 → `'62.0%'`, 0.1234 → `'12.3%'`, -0.05 → `'-5.0%'`, -0.0004 → `'0.0%'`,
   0 → `'0.0%'`.
6. `formatChangePp`: 0.12 → `'+12.0 pp'`, -0.12 → `'-12.0 pp'`, 0 → `'0.0 pp'`, 0.0004 → `'0.0 pp'`,
   -0.0004 → `'0.0 pp'`.
7. `weightRows(RESPONSE)` equals
   `[{ ticker:'AAA', current:0.5, target:0.62, change:0.12, pinned:false }, { ticker:'BBB', current:0.3, target:0.18, change:-0.12, pinned:false }, { ticker:'YNG', current:0.2, target:0.2, change:0, pinned:true }]`.
8. `curveRows(RESPONSE.curves)` equals the 3 zipped rows, with `benchmark` 100, 100.9 and 99.1. With
   `benchmark: null`, every row's `benchmark` is `null`.
9. `curveRows` downsampling: 1000 rows with dates `` `d${i}` `` and values `i` return 334 rows, whose
   last `date` is `'d999'`.
10. `metricItems(RESPONSE.metrics.current)`: the labels are
    `['CAGR','Volatility','Sharpe','Max drawdown','Beta vs SPY','Alpha']` and the values are
    `['12.3%','20.7%','0.60','-18.3%','1.10','-1.2%']`.
11. `metricItems(RESPONSE.metrics.optimized)`: the values are `['15.0%','19.0%','—','-10.0%']` (4 items).
    `metricItems(null)` and `metricItems({})` each give 4 values, all `'—'`.
    `metricItems({ cagr: 0.1, vol: 0.2, sharpe: 0.5, max_dd: -0.1, beta: null })` has 5 items, the last
    labelled `'Beta vs SPY'` with value `'—'`.
12. `pinnedBannerLines(RESPONSE.pinned, 15)` equals
    `['YNG: prices start 2026-03-02, so it is held at its current 20.0% and not optimized. That is above the 15% max weight.']`.
    With `exceeds_max: false` it equals
    `['YNG: prices start 2026-03-02, so it is held at its current 20.0% and not optimized.']`.
    `pinnedBannerLines([], 15)` equals `[]`.
13. `scoreWindowNote(RESPONSE)` equals
    `"The curves start 2026-03-02, when YNG's price history begins. The weights were fitted on 2021-09-27 → 2026-09-23."`.
    With `score_limited_by: null` it is `null`.
14. `runSummary(RESPONSE)` equals `'Min Variance · 5Y lookback · buy and hold · fitted 2021-09-27 → 2026-09-23'`.
    With `lookback_days: 365, rebalance: 'quarterly'` it equals
    `'Min Variance · 1Y lookback · rebalanced quarterly · fitted 2021-09-27 → 2026-09-23'`.
    `modeLabel('max_sharpe_capm')` equals `'max_sharpe_capm'`.

## Out of scope

- The action table, share counts, dollar values and CSV export (0108).
- Apply to portfolio (0109).
- The CAPM mode, the forward-looking panel, conviction views, the κ slider and tilt (0110). Don't add
  `max_sharpe_capm` to the dropdown or the guide.
- Persisting settings or results (in localStorage or elsewhere). Results live in component state only.
- A redirect from the old `backtest` path.
- Any backend change. If the backend's response doesn't match the types above, report `BLOCKED`.
- New dependencies. `recharts` is already installed; lucide is not, so use the text × as HelpSidebar
  does.
- Refactoring `HelpSidebar` into a shared panel component.

## Acceptance criteria

1. **Take the before test count first,** before you edit anything:
   `(cd frontend && npm run test 2>&1 | grep -E "Tests +[0-9]+")`. It should read 96 passed. Don't
   overwrite or stash working files to recover a count; if it isn't 96, paste what it is and carry on.
2. `(cd frontend && npm run build)` exits 0.
3. `(cd frontend && npm run test)` passes, with at least before + 14 tests, and every existing test
   still passes unmodified.
4. `(cd frontend && npm run lint)` reports only the two pre-existing warnings, `HelpSidebar.tsx:44` and
   `UniversePage.tsx:60`.
5. `test ! -e frontend/src/pages/analysis/BacktestPage.tsx && echo gone` prints `gone`.
6. `grep -rn "BacktestPage\|'backtest'\|\"backtest\"" frontend/src` prints nothing.
7. `grep -n "path: 'optimize', label: 'Optimize'" frontend/src/pages/analysis/AnalysisLayout.tsx`
   prints one line, and `grep -n 'path="optimize"' frontend/src/App.tsx` prints one line.
8. `grep -n "max_sharpe_capm\|Max Sharpe — CAPM" frontend/src/lib/optimize.ts frontend/src/components/OptimizerGuide.tsx frontend/src/pages/analysis/OptimizePage.tsx`
   prints nothing. (The test file may mention `max_sharpe_capm`, for `modeLabel`.)
9. `grep -n " title=" frontend/src/pages/analysis/OptimizePage.tsx frontend/src/components/OptimizerGuide.tsx frontend/src/components/OptimizeChart.tsx`
   prints nothing. Tooltips use `Tooltip`, never `title`.
10. `grep -c "<Tooltip" frontend/src/pages/analysis/OptimizePage.tsx` prints at least `9`.
11. `grep -n "export async function optimizePortfolio" frontend/src/api/client.ts` prints one line.
12. `git status --short frontend backend` lists only:
    - the files in **Files**
    - `BacktestPage.tsx` as deleted (` D`)
    - the backend files that were already modified or untracked before you started. List those as
      pre-existing.

If any criterion can't be met as written (a file doesn't match this contract, the response shape
differs, or HEAD has moved), **report `BLOCKED` and name the conflict**. Don't bend the code or the
check to make it pass.

## Verification to run and paste

Run from the repo root. Paste the **complete, verbatim** output, including failures.

```bash
(cd frontend && npm run build 2>&1 | tail -4)
(cd frontend && npm run test 2>&1 | tail -6)
(cd frontend && npm run test 2>&1 | grep -E "optimize" | head -40)
(cd frontend && npm run lint 2>&1 | tail -6)
test ! -e frontend/src/pages/analysis/BacktestPage.tsx && echo gone
grep -rn "BacktestPage\|'backtest'\|\"backtest\"" frontend/src; echo "backtest-refs exit=$?"
grep -n "path: 'optimize', label: 'Optimize'" frontend/src/pages/analysis/AnalysisLayout.tsx
grep -n 'path="optimize"' frontend/src/App.tsx
grep -n "max_sharpe_capm\|Max Sharpe — CAPM" frontend/src/lib/optimize.ts frontend/src/components/OptimizerGuide.tsx frontend/src/pages/analysis/OptimizePage.tsx; echo "capm exit=$?"
grep -n " title=" frontend/src/pages/analysis/OptimizePage.tsx frontend/src/components/OptimizerGuide.tsx frontend/src/components/OptimizeChart.tsx; echo "title exit=$?"
grep -c "<Tooltip" frontend/src/pages/analysis/OptimizePage.tsx
grep -n "export async function optimizePortfolio" frontend/src/api/client.ts
git status --short frontend backend
```

## Tooltips — required for any contract adding interactive elements

Wrap each element in `Tooltip` with exactly this copy. Where a control has a label, wrap the control
itself.

| Element | Tooltip label |
|---|---|
| Mode select | "Choose what the optimizer aims for. The Optimizer guide describes each mode." |
| Lookback buttons (one tooltip per button, `n = days / 365`) | `` `Fit the weights on the last ${n} ${n === 1 ? 'year' : 'years'} of daily prices` `` |
| Max weight slider | when `allowShort`, "Cap on any one holding's absolute weight, long or short"; otherwise "Cap on any one holding's share of the invested holdings" |
| Min weight slider | when enabled, "Floor on every holding's weight. Min weight × number of holdings must stay at or below 100%."; when disabled, "Not used while short positions are allowed" |
| Vol target slider | "The optimizer finds the highest-return mix whose annual volatility stays at or below this" |
| Allow short checkbox | "Let weights go negative. Equal Weight, Risk Parity and Max Diversification stay long-only." |
| Rebalance select | "How the curves hold the weights: bought and held from the start, or reset to them on this schedule. It doesn't change which weights are picked." |
| Run optimizer button | "Fit weights on stored prices and score them against your current weights". When `!canOptimize`: "Needs at least 2 holdings to optimize". |
| Optimizer guide button | "Open a short description of each optimization mode" |
| Guide × button (in OptimizerGuide.tsx) | "Close the guide" |

Metric tile labels (the `tooltip` field of `metricItems`, shown through `Tooltip` on the label):

| Label | Tooltip |
|---|---|
| CAGR | "Compound annual growth rate of the curve over the scored window" |
| Volatility | "Annualised volatility: daily standard deviation of returns × √252" |
| Sharpe | "CAGR ÷ volatility, with the risk-free rate taken as 0. Above 1 is broadly acceptable; above 2 is excellent." |
| Max drawdown | "Largest peak-to-trough fall in the curve" |
| Beta vs SPY | "How much the curve moves with SPY: 1 moves in step, above 1 amplifies, below 1 dampens" |
| Alpha | "Annualised return above what beta to SPY predicts, with the risk-free rate taken as 0" |

The Tooltip wrapper already works on a disabled control. That is why this project uses it and not
`title`, so the disabled Min weight and Run tooltips must render.

## Human verification — does Gunnar need to run anything?

**Run the frontend and backend against the real database and look at it.** The tests cover only
`lib/optimize.ts`, not the page.

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN   # kill any stale uvicorn first
(cd backend && .venv/bin/uvicorn app.main:app --port 8000)
(cd frontend && npm run dev)
```

On one of your portfolios, at about 1280px and then about 700px wide:
1. The tab reads **Optimize**, and the URL ends `/optimize`.
2. With the default settings, click **Run optimizer**.
   - A summary line, the in-sample warning, the weights table, two rows of metric tiles and a chart
     appear.
   - The chart has three lines, including SPY, if SPY is in your universe; otherwise it has two lines
     plus the "SPY is not stored" warning.
3. If any holding listed within the last 5 years, the amber banner names it with its first date. The
   chart's start date and the "curves start … when X's price history begins" note should agree with
   it.
4. Switch to **Target Volatility**. The Vol target slider appears, and the stale-settings note shows
   until you run again.
5. Tick **Allow short**. Min weight is greyed out and its tooltip says why; Max weight's label reads
   "Max abs. weight".
6. Set Min weight to 20% on a portfolio with 6 or more holdings and run. The red error line shows the
   backend's infeasibility message.
7. **Rebalance Monthly** vs **None**: run both. The curves differ, and the weights table doesn't.
8. Open the **Optimizer guide**. It shows 8 modes and no CAPM. Escape closes it, and so does clicking
   outside.

## Open questions

None. If a decision above turns out to be wrong in the browser, Gunnar will say so at verification.
Don't pre-empt it.

---

## Amendment 1 — audit fixes (planner, 2026-09-24)

The first pass was reported COMPLETE, and every criterion above passed on re-run. The audit found one
real bug and two copy/style slips. Fix **only** these, in `frontend/src/pages/analysis/OptimizePage.tsx`.
Touch no other file.

1. **Under StrictMode, Run never finishes (blocking).** `main.tsx` renders `<StrictMode>`. In dev,
   React 19 mounts, unmounts and remounts every component on its first render.
   - The mount-only effect's cleanup sets `mountedRef.current = false`, and nothing sets it back to
     `true` on the remount.
   - So under `npm run dev` every response is dropped, and the button stays on `Optimizing…` forever.
     That is exactly how Gunnar verifies.
   - Fix it by setting `mountedRef.current = true` in the effect body, before the `return`. This is
     the standard idiom. Keep the ref approach; your reason for choosing it over HoldingsPage's
     effect-scoped flag was right.
2. **Min weight tooltip apostrophe.** It uses `’` (U+2019). The contract copy is `holding's`, with an
   ASCII apostrophe. Make it match the Tooltips table exactly.
3. **A zero change isn't muted.** `changeColor` returns `''` for `0.0 pp`, which renders in the default
   foreground colour. The contract says it "stays muted", so return `'text-[var(--color-muted)]'` in
   that case.

### Amendment acceptance

A. `grep -n "mountedRef.current = true" frontend/src/pages/analysis/OptimizePage.tsx` prints one line,
   inside the `useEffect` body.
B. `grep -c "’" frontend/src/pages/analysis/OptimizePage.tsx` prints `0`.
C. `grep -n "return 'text-\[var(--color-muted)\]'" frontend/src/pages/analysis/OptimizePage.tsx` prints
   one line.
D. `npm run build` exits 0, `npm run test` shows 111 passed, and `npm run lint` shows only the two
   pre-existing warnings.
E. `git status --short frontend` is unchanged from your first report.

Paste the output of:

```bash
grep -n "mountedRef" frontend/src/pages/analysis/OptimizePage.tsx
grep -c "’" frontend/src/pages/analysis/OptimizePage.tsx
grep -n "function changeColor" -A 5 frontend/src/pages/analysis/OptimizePage.tsx
(cd frontend && npm run build 2>&1 | tail -3)
(cd frontend && npm run test 2>&1 | grep -E "Tests +[0-9]+")
(cd frontend && npm run lint 2>&1 | tail -4)
git status --short frontend
```

Append the results to your report under a heading "Amendment 1".
