# Contract 0118 — Outlook sub-tabs and the CAPM Optimizer UI

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

The Outlook tab has three sub-tabs: "CAPM Optimizer", "Monte Carlo" and "Forecast".

- **CAPM Optimizer** is live:
  - A settings card holds the lookback, risk-free rate, MRP and market ticker, plus global min/max
    with "Apply to all".
  - A per-holding table sets freeze, view, and min % / max % for each holding.
  - A Run button calls `POST /portfolio/capm` (contract 0115).
  - Results show a summary, warnings, expected-statistics tiles, VaR tiles, and one "Weights and
    CAPM details" table.
- **Monte Carlo** and **Forecast** are "not built yet" placeholders.

## Why

REBUILD.md, entry "The Outlook tab is a port of `main`'s Outlook page, all three sections"
(2026-09-24). The backend is done and accepted (0115). The source UI is
`main:frontend/app/portfolios/[id]/outlook/page.tsx`: the `CAPMSection` at lines 45–388 and the
sub-tab shell at lines 920–973. Read it with
`git show 'main:frontend/app/portfolios/[id]/outlook/page.tsx' | sed -n 45,388p`.

**Deliberate differences from `main`, all decided by the planner.** Gunnar may veto any of them in
the audit:

| `main` | this contract | why |
|---|---|---|
| free-text market ticker, default `VT` | a `<select>` of Universe tickers, default `SPY` | a typo can't reach the backend; 0115 made SPY the default |
| risk-free input where `0` means live | blank means live; `0` means 0% | matches 0115 |
| the view slider is disabled when a holding is frozen | the view stays enabled | a frozen holding's view still changes the expected return and the statistics, so disabling it hides a live input |
| an Action table, target value, VaR in dollars, CAL chart and Apply | **not in this contract** | that is the next Outlook contract, which reuses Optimize's `tradeRows` and `applyPlan` |
| two tables: action and CAPM details | one table: weights plus CAPM details | with no action table, one table is enough |
| rounding done in the backend | the frontend formats | 0115 returns full precision |

## Files

Create:
- `frontend/src/lib/capm.ts` — pure helpers: no React, no fetch.
- `frontend/src/lib/capm.test.ts`
- `frontend/src/pages/analysis/outlook/CapmSection.tsx` — a new folder. Outlook's sub-tab sections
  live here: Monte Carlo and Forecast will be added beside it, and `components/` does not grow.

Modify:
- `frontend/src/api/client.ts` — **only append** the CAPM types and `capmPortfolio`, directly after
  `optimizePortfolio`. Change no existing line.
- `frontend/src/pages/analysis/OutlookPage.tsx` — replace the placeholder with the sub-tab shell.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. In particular, do not edit `OptimizePage.tsx` or
`lib/optimize.ts`. Import from them; do not change them.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs — that is what it is for — but it is a snapshot of other working software kept so its behaviour
can be compared against this rebuild, and an edited reference stops being evidence of anything.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it. The same applies to `main`: read it with
`git show`, and never check it out.

## Interface

### `api/client.ts` (append only)

```ts
export interface CapmHoldingConfig {
  freeze: boolean
  view: number        // fraction, -0.5 … 1.0
  min_weight: number  // fraction
  max_weight: number
}

export interface CapmRequest {
  tickers: string[]
  weights: number[]
  lookback_days: number
  rf: number | null   // null = live 3-month T-bill
  mrp: number
  market_ticker: string
  configs: Record<string, CapmHoldingConfig>
}

export interface CapmHolding {
  ticker: string
  current_weight: number
  target_weight: number
  beta: number
  capm_return: number
  view: number
  expected_return: number
  vol: number
  frozen: boolean
  pinned: boolean
  first_bar: string
}

export interface CapmResponse {
  tickers: string[]
  holdings: CapmHolding[]
  current_weights: Record<string, number>
  target_weights: Record<string, number>
  metrics: { expected_return: number; expected_vol: number; expected_sharpe: number | null; portfolio_beta: number }
  var_95: { daily: number; weekly: number; monthly: number; quarterly: number; annual: number }
  rf: number
  rf_source: 'live' | 'fallback' | 'manual'
  mrp: number
  market_ticker: string
  lookback_days: number
  fit_start: string
  fit_end: string
  score_start: string
  warnings: string[]
}

export async function capmPortfolio(body: CapmRequest): Promise<CapmResponse> {
  return request<CapmResponse>('/portfolio/capm', { method: 'POST', body })
}
```

### `lib/capm.ts`

It imports types from `../api/client` and `./portfolio`. From `./optimize` it imports `LOOKBACK_OPTIONS`,
`formatWeight` and the `TradeBasis` type. It must not import React.

```ts
export interface CapmSettings {
  lookbackDays: number
  rfPct: string        // text input; '' = live rate
  mrpPct: string       // text input
  marketTicker: string
}

export interface CapmHoldingInput {
  freeze: boolean
  viewPct: number      // slider -50 … 100, step 5
  minPct: string       // text input
  maxPct: string       // text input
}

export type CapmInputs = Record<string, CapmHoldingInput>
export interface CapmRun { settings: CapmSettings; inputs: CapmInputs }

export interface CapmRow {
  ticker: string
  beta: number
  capmReturn: number
  view: number
  expectedReturn: number
  vol: number
  current: number
  target: number
  change: number       // target - current
  frozen: boolean
  pinned: boolean
}

export interface CapmItem { label: string; value: string; tooltip: string }

export const DEFAULT_CAPM_SETTINGS: CapmSettings =
  { lookbackDays: 1825, rfPct: '', mrpPct: '5', marketTicker: 'SPY' }

export function defaultHoldingInputs(portfolio: Portfolio): CapmInputs
export function applyGlobalBounds(inputs: CapmInputs, minPct: string, maxPct: string): CapmInputs
export function buildCapmRequest(portfolio: Portfolio, settings: CapmSettings, inputs: CapmInputs, basis: TradeBasis):
  { ok: true; request: CapmRequest } | { ok: false; message: string }
export function sameCapmRun(a: CapmRun, b: CapmRun): boolean
export function capmRows(response: CapmResponse): CapmRow[]
export function formatReturn(fraction: number): string
export function formatView(fraction: number): string
export function formatBeta(beta: number): string
export function rfLabel(rf: number, source: CapmResponse['rf_source']): string
export function capmSummary(response: CapmResponse): string
export function statItems(response: CapmResponse): CapmItem[]
export function varItems(response: CapmResponse): CapmItem[]
```

**Rules:**

- **`defaultHoldingInputs`:** for every position, in position order, the value is
  `{ freeze: false, viewPct: 0, minPct: '0', maxPct: '100' }`.
- **`applyGlobalBounds`:** returns a **new** object. Every holding that is not frozen gets
  `minPct` / `maxPct` set to the arguments. A frozen holding is copied unchanged. The input object is
  not mutated.
- **`buildCapmRequest`** validates in this order and returns the **first** failure. The messages are
  exact. "Parse" means `s.trim() === ''` counts as blank; otherwise the value is `Number(s)` and it
  must be `Number.isFinite`.
  1. `settings.marketTicker.trim() === ''` → `'Choose a market ticker.'`
  2. `rfPct` is not blank and (it does not parse, or it is `< 0`, or it is `>= 20`) →
     `'Risk-free rate must be at least 0% and below 20%, or blank for the live 3-month T-bill rate.'`
  3. `mrpPct` is blank, does not parse, is `<= 0` or is `> 20` →
     `'Market risk premium must be above 0% and at most 20%.'`
  4. For each position, in order: `minPct` or `maxPct` is blank or does not parse →
     `` `${ticker}: min and max weight must be numbers.` ``. A ticker missing from `inputs` uses the
     default input. Range checks and min > max are left to the backend, whose messages are already
     plain (0115).

  On success the request is:
  - `tickers`: position order.
  - `weights`: if `basis.kind === 'dollar'`, `shares × price` per position, exactly as
    `buildOptimizeRequest` does it. Otherwise `position.weight`.
  - `lookback_days: settings.lookbackDays`.
  - `rf`: `null` when blank, otherwise `Number(rfPct) / 100`.
  - `mrp: Number(mrpPct) / 100`.
  - `market_ticker: settings.marketTicker.trim()`.
  - `configs`: one entry per position, `{ freeze, view: viewPct / 100, min_weight: Number(minPct) / 100, max_weight: Number(maxPct) / 100 }`.
- **`sameCapmRun`:** true when all 4 settings fields are equal, both inputs have the same key set,
  and all 4 fields of every holding are equal.
- **`capmRows`:** one row per `response.holdings`, in order. `change = target_weight - current_weight`.
- **`formatReturn(x)`:** `'0.00%'` when `Math.round(x * 10000) === 0`, otherwise
  `` `${(x * 100).toFixed(2)}%` ``.
- **`formatView(x)`:** let `p = Math.round(x * 100)`. When `p > 0` it is `` `+${p}%` ``; when `p === 0`
  it is `'0%'`; otherwise it is `` `${p}%` ``.
- **`formatBeta(b)`:** `b.toFixed(2)`.
- **`rfLabel`** has three forms, each built with `formatReturn(rf)`:
  - `'live'` → `` `${formatReturn(rf)} (3-month T-bill)` ``
  - `'fallback'` → `` `${formatReturn(rf)} (fallback, live rate unavailable)` ``
  - `'manual'` → `` `${formatReturn(rf)} (entered)` ``
- **`capmSummary`:**
  `` `${lookback} lookback · market ${market_ticker} · risk-free ${rfLabel(rf, rf_source)} · MRP ${formatReturn(mrp)} · fitted ${fit_start} → ${fit_end}` ``.
  `lookback` is the `LOOKBACK_OPTIONS` label, or `` `${days}d` `` when none matches.
- **`statItems`** returns four items, in this order:

  | label | value | tooltip |
  |---|---|---|
  | `Expected return` | `formatReturn(expected_return)` | `Weighted average of each holding's CAPM expected return, including your views` |
  | `Expected volatility` | `formatReturn(expected_vol)` | `Annualised volatility of the Target weights, from the covariance of daily returns` |
  | `Expected Sharpe` | `'—'` when null, else `.toFixed(2)` | `` `(Expected return − risk-free rate) ÷ expected volatility. Risk-free rate: ${rfLabel(...)}.` `` |
  | `` `Beta vs ${market_ticker}` `` | `formatBeta(portfolio_beta)` | `` `Weighted average of the holdings' betas against ${market_ticker}` `` |
- **`varItems`** returns five items, labelled `Daily`, `Weekly`, `Monthly`, `Quarterly` and `Annual`,
  with `value` = `formatReturn(var_95[key])` and the tooltips:

  | label | tooltip |
  |---|---|
  | Daily | `One day in 20, the return is expected to be below this` |
  | Weekly | `One week in 20, the return is expected to be below this` |
  | Monthly | `One month in 20, the return is expected to be below this` |
  | Quarterly | `One quarter in 20, the return is expected to be below this` |
  | Annual | `One year in 20, the return is expected to be below this` |

### `OutlookPage.tsx`

- The state is `useState<'capm' | 'montecarlo' | 'forecast'>('capm')`. Sub-tabs are **in-page state,
  not routes** (REBUILD).
- The tab bar is a `<div role="tablist" aria-label="Outlook sections" className="flex gap-1 border-b border-brand-border mb-5">`.
  It holds three `<button type="button" role="tab" aria-selected={…}>`, labelled `CAPM Optimizer`,
  `Monte Carlo` and `Forecast`, in that order, each wrapped in a `Tooltip`.
  - Button classes: `px-4 py-2 text-sm font-medium border-b-2 -mb-px`.
  - Active: `border-brand-primary text-brand-primary`.
  - Inactive: `border-transparent text-[var(--color-muted)] hover:text-foreground`.
- `capm` renders `<CapmSection />`. The other two render the existing placeholder card, with the text
  `Monte Carlo — not built yet.` or `Forecast — not built yet.` and headings `Monte Carlo` or
  `Forecast`.
- Switching sub-tab unmounts the section, so CAPM settings and results reset. `main` behaves the same
  way, and this is accepted.

### `outlook/CapmSection.tsx`

Export `CapmSection(): JSX.Element | null`. Follow `OptimizePage.tsx` as the pattern to copy:
- the portfolio lookup via `useParams` / `listPortfolios` / `isLegacyPortfolio`
- the `mountedRef` guard
- a `RunState` union of `idle | running | error | ready{ response, run: CapmRun }`
- one `getUniverse()` on mount, giving both the last-close map and the market-ticker options
- card, `TH` and `TD` classes and button classes copied verbatim
- a local tiles component shaped like `MetricTiles`, copied rather than exported from `OptimizePage`

**Settings card** (`h2`: `CAPM optimization settings`), top to bottom:
1. A disclaimer, as `p` with `text-xs text-[var(--color-muted)]`:
   `Forward-looking: uses CAPM expected returns and your views, not a historical backtest. Results are model-based projections, not guarantees.`
2. A grid (`grid gap-4 md:grid-cols-4`) with four inputs:
   - **Lookback:** four buttons, built exactly like Optimize's lookback buttons.
   - **Risk-free rate (%):** a text input with `inputMode="decimal"` and placeholder `Live`.
   - **Market risk premium (%):** a text input with `inputMode="decimal"`.
   - **Market ticker:** a `<select>` of Universe tickers sorted A→Z.
     - While the Universe loads, it is disabled and shows only `SPY`.
     - If `getUniverse` fails, the only option is `SPY`.
     - If the list does not contain the current value, add the current value as an option, so the
       select never shows a value it doesn't have.
3. **Global limits:** two text inputs, `Min % for all` (default `'0'`) and `Max % for all` (default
   `'100'`), then an `Apply to all` button that calls `applyGlobalBounds`.
4. **Holdings table.** Columns: `Ticker`, `Freeze`, `View`, `Min %` and `Max %`. There is one row per
   position, in order.
   - **Freeze** is a checkbox.
   - **View** is `<input type="range" min={-50} max={100} step={5}>`, followed by a `w-12 text-right
     font-mono` label, `formatView(viewPct / 100)`. The label is coloured `text-brand-positive` when
     above 0, `text-brand-negative` when below 0, and muted at 0. The view stays **enabled when
     frozen** (see Why).
   - **Min %** and **Max %** are `w-16` text inputs with `inputMode="decimal"`, disabled when frozen.
5. **Run button.** It uses the same classes and layout as Optimize's, with the text `Run CAPM
   optimizer`, or `Optimizing…` while running. It is disabled when:
   - `!canOptimize(portfolio)` (import from `lib/optimize`)
   - the Universe is loading
   - a run is in progress

   On click:
   - Compute `tradeBasis(portfolio, lastClose)`.
   - Call `buildCapmRequest`. If it returns `ok: false`, set the error state with that message and do
     **not** call the API.
   - Otherwise call `capmPortfolio`, and on success store `{ response, run: { settings, inputs } }`.
   - API errors are shown via `error.message`, exactly as Optimize does it.
6. The error, when present, is shown as `p` with `mt-3 text-sm text-brand-negative`.

**Results**, shown only when `ready`:
1. **Summary card** with `space-y-2`, containing in order:
   - `capmSummary(response)`
   - `Settings have changed since this run. Run it again to update the results.`, when
     `!sameCapmRun(live, run.run)`
   - one `p` per `response.warnings` entry
   - `Invested holdings only.` plus, when `cashWeight > 0`,
     `` ` Cash (${cashWeight.toFixed(1)}%) is left out and stays as it is.` ``
2. **Two cards side by side** (`grid gap-5 md:grid-cols-2`):
   - `Expected portfolio statistics`, showing the tiles of `statItems`.
   - `Value at Risk (95%)`, showing the tiles of `varItems`. Its heading is wrapped in a `Tooltip`
     (see below).
3. **The `Weights and CAPM details` card.** It holds one table with the columns `Ticker`, `Beta`,
   `CAPM E[R]`, `View`, `E[R] with view`, `Volatility`, `Current`, `Target` and `Change`.
   - `Beta` uses `formatBeta`.
   - The three return columns and `Volatility` use `formatReturn`.
   - `View` uses `formatView`.
   - `Current` and `Target` use `formatWeight` from `lib/optimize`.
   - `Change` uses `formatChangePp` from `lib/optimize`, coloured the way Optimize's `changeColor` does
     it.
   - The ticker cell adds a `pinned` tag and/or a `frozen` tag, styled like Optimize's `TickerCell`
     (`ml-2 text-[10px] …`). The `frozen` tag is shown only when `frozen && !pinned`, because 0115
     ignores the freeze on pinned holdings.

## Test fixtures (literal — use exactly these)

This is a **formatting fixture** in `capm.test.ts`. Its numbers are not meant to be internally
consistent; they are chosen to exercise rounding.

```ts
const RESPONSE: CapmResponse = {
  tickers: ['A', 'B', 'Y'],
  holdings: [
    { ticker: 'A', current_weight: 0.4, target_weight: 0.6, beta: 1.5, capm_return: 0.115, view: 0.2, expected_return: 0.125, vol: 0.286243, frozen: false, pinned: false, first_bar: '2021-01-04' },
    { ticker: 'B', current_weight: 0.4, target_weight: 0.2, beta: 0.5, capm_return: 0.065, view: 0, expected_return: 0.065, vol: 0.177594, frozen: true, pinned: false, first_bar: '2021-01-04' },
    { ticker: 'Y', current_weight: 0.2, target_weight: 0.2, beta: 0.793333, capm_return: 0.0796667, view: -0.1, expected_return: 0.0746667, vol: 0.169006, frozen: false, pinned: true, first_bar: '2024-06-03' },
  ],
  current_weights: { A: 0.4, B: 0.4, Y: 0.2 },
  target_weights: { A: 0.6, B: 0.2, Y: 0.2 },
  metrics: { expected_return: 0.0979333, expected_vol: 0.219962, expected_sharpe: 0.263379, portfolio_beta: 1.158667 },
  var_95: { daily: -0.0224, weekly: -0.0483, monthly: -0.0963, quarterly: -0.1564, annual: -0.2639 },
  rf: 0.0427, rf_source: 'live', mrp: 0.05, market_ticker: 'SPY', lookback_days: 1825,
  fit_start: '2021-09-27', fit_end: '2026-09-25', score_start: '2024-06-04',
  warnings: [],
}

const PORTFOLIO: Portfolio = {
  id: 'p1', name: 'Test', cashWeight: 10,
  positions: [{ ticker: 'A', weight: 50 }, { ticker: 'B', weight: 40 }],
  updatedAt: '2026-09-26T00:00:00.000Z',
}
const WEIGHTS_BASIS: TradeBasis = { kind: 'weights', reason: 'no-shares' }
const DOLLAR_BASIS: TradeBasis = { kind: 'dollar', investedValue: 900, prices: { A: 100, B: 50 }, shares: { A: 5, B: 8 } }
```

## Expected values — `capm.test.ts` has exactly **21** tests (12 `it` + one `it.each` of 9)

1. **`defaultHoldingInputs(PORTFOLIO)`** `toEqual`s
   `{ A: { freeze: false, viewPct: 0, minPct: '0', maxPct: '100' }, B: { …same } }`, and
   `Object.keys(...)` is `['A', 'B']`.
2. **`applyGlobalBounds`**, called on inputs where B is `{ freeze: true, viewPct: 0, minPct: '0', maxPct: '100' }`,
   with `'5', '50'`:
   - A becomes `{ freeze: false, viewPct: 0, minPct: '5', maxPct: '50' }`.
   - B is unchanged.
   - The original object still has A's `minPct === '0'`.
3. **Weights basis.** Inputs are the defaults, with A set to `{ freeze: false, viewPct: -20, minPct: '10', maxPct: '60' }`.
   `buildCapmRequest(PORTFOLIO, DEFAULT_CAPM_SETTINGS, inputs, WEIGHTS_BASIS)` `toEqual`s:
   ```ts
   { ok: true, request: {
     tickers: ['A', 'B'], weights: [50, 40], lookback_days: 1825, rf: null, mrp: 0.05, market_ticker: 'SPY',
     configs: { A: { freeze: false, view: -0.2, min_weight: 0.1, max_weight: 0.6 },
                B: { freeze: false, view: 0, min_weight: 0, max_weight: 1 } } } }
   ```
4. **Dollar basis.** The same call with `DOLLAR_BASIS` gives `request.weights` `[500, 400]`.
5. **Manual rf.** `rfPct: '4.5'` gives `request.rf` `toBeCloseTo(0.045, 12)`. `rfPct: '0'` gives
   `request.rf === 0`, not null.
6. **`it.each`, 9 cases.** Each changes one field from the defaults and expects `{ ok: false, message }`:

   | change | message |
   |---|---|
   | `marketTicker: '  '` | `Choose a market ticker.` |
   | `rfPct: '20'` | `Risk-free rate must be at least 0% and below 20%, or blank for the live 3-month T-bill rate.` |
   | `rfPct: '-0.5'` | (same rf message) |
   | `rfPct: 'abc'` | (same rf message) |
   | `mrpPct: '0'` | `Market risk premium must be above 0% and at most 20%.` |
   | `mrpPct: ''` | (same mrp message) |
   | `mrpPct: '25'` | (same mrp message) |
   | inputs A `minPct: ''` | `A: min and max weight must be numbers.` |
   | inputs B `maxPct: 'x'` | `B: min and max weight must be numbers.` |
7. **`sameCapmRun`:**
   - a run and its `structuredClone` → `true`
   - A's `viewPct` changed → `false`
   - `mrpPct` changed → `false`
   - an extra key `Z` in the inputs → `false`
8. **`capmRows(RESPONSE)`:**
   - the tickers are `['A', 'B', 'Y']`
   - A's `change` is `toBeCloseTo(0.2, 12)`, B's is `toBeCloseTo(-0.2, 12)`, and Y's is `0`
   - B has `frozen: true`; Y has `pinned: true`
   - A has `beta: 1.5` and `expectedReturn: 0.125`
9. **Formatters:**
   - `formatReturn`: `0.115` → `'11.50%'`, `0.0746667` → `'7.47%'`, `-0.0224` → `'-2.24%'`,
     `-0.00001` → `'0.00%'`
   - `formatView`: `0.2` → `'+20%'`, `0` → `'0%'`, `-0.1` → `'-10%'`, `-0.05` → `'-5%'`
   - `formatBeta`: `0.793333` → `'0.79'`, `1.5` → `'1.50'`
10. **`rfLabel(0.0427, …)`:** `'live'` → `'4.27% (3-month T-bill)'`,
    `'fallback'` → `'4.27% (fallback, live rate unavailable)'`, `'manual'` → `'4.27% (entered)'`.
11. **`capmSummary(RESPONSE)`** is
    `'5Y lookback · market SPY · risk-free 4.27% (3-month T-bill) · MRP 5.00% · fitted 2021-09-27 → 2026-09-25'`.
12. **`statItems(RESPONSE)`:**
    - the `[label, value]` pairs are `[['Expected return', '9.79%'], ['Expected volatility', '22.00%'], ['Expected Sharpe', '0.26'], ['Beta vs SPY', '1.16']]`
    - with `expected_sharpe: null`, the Sharpe value is `'—'`
    - the Sharpe tooltip contains `'4.27% (3-month T-bill)'`
13. **`varItems(RESPONSE)`:** the pairs are
    `[['Daily', '-2.24%'], ['Weekly', '-4.83%'], ['Monthly', '-9.63%'], ['Quarterly', '-15.64%'], ['Annual', '-26.39%']]`.

## Out of scope

- The target value, trades, shares and dollars, CSV, the CAL chart and Apply all come in the next
  Outlook contract.
- Monte Carlo and Forecast, beyond their placeholders.
- Any backend change. Removing `/optimize`'s CAPM path is a later contract.
- Persisting CAPM settings across reloads or sub-tab switches.
- Refactoring `OptimizePage` to share components with this page. The copy of the tiles component is
  accepted duplication.
- Do not edit `REBUILD.md`, `README.md` or `contracts/done/`.

## Acceptance criteria

1. **Before any edit:** run `git status --short` and paste it. Then run
   `(cd frontend && npx vitest run 2>&1 | grep -E "^ +Tests")`, which must report `141 passed`.
   Other sessions may have uncommitted changes (backend files, `REBUILD.md`, other contracts). Leave
   them alone.
2. **After:** vitest reports `162 passed` (141 + 21).
3. `(cd frontend && npx vitest run src/lib/capm.test.ts 2>&1 | grep -E "^ +Tests")` reports `21 passed`.
4. `(cd frontend && npm run build)` exits 0.
5. `(cd frontend && npm run lint)` reports only the two existing warnings, `HelpSidebar.tsx:44` and
   `UniversePage.tsx:60`.
6. `grep -n "from 'react'" frontend/src/lib/capm.ts` prints nothing.
7. `grep -rn "title=" frontend/src/pages/analysis/outlook/ frontend/src/pages/analysis/OutlookPage.tsx`
   prints nothing.
8. `git diff --stat -- frontend/src/pages/analysis/OptimizePage.tsx frontend/src/lib/optimize.ts backend/`
   shows no change made by this contract. Compare it with the pre-edit status from criterion 1.
9. `git diff -- frontend/src/api/client.ts | grep '^-' | grep -v '^---'` prints nothing (append only).
10. `grep -c "'/portfolio/capm'" frontend/src/api/client.ts` prints `1`.
11. `grep -rn "kappa\|conviction" frontend/src/lib/capm.ts frontend/src/pages/analysis/outlook/` prints
    nothing.
12. Compared with the pre-edit status, `git status --short` shows only the 5 files under Files, plus
    this contract and its report.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string — so any script run without that prefix talks to the **production database**.
> `tests/conftest.py` strips the variable for `pytest` only; it does not cover scripts.
>
> **`DATABASE_URL=""` is the only ambient value that works.** Setting it to a real throwaway URL
> raises at import, because `config.py`'s conflict guard (contract 0041) rejects any *non-empty*
> ambient value that differs from `.env`. Use the pytest fixtures if you need a database.

(This contract needs no Python. The warning stays because it is standard.)

Run each of these from the repo root and paste the **complete, verbatim** output into the report:

```bash
# before editing
git status --short
(cd frontend && npx vitest run 2>&1 | grep -E "^ +Tests")
# after editing
(cd frontend && npx vitest run 2>&1 | grep -E "^ +Tests")
(cd frontend && npx vitest run src/lib/capm.test.ts 2>&1 | grep -E "^ +Tests")
(cd frontend && npm run build 2>&1 | tail -2)
(cd frontend && npm run lint 2>&1 | grep -E "warning|error")
grep -n "from 'react'" frontend/src/lib/capm.ts; echo "exit=$?"
grep -rn "title=" frontend/src/pages/analysis/outlook/ frontend/src/pages/analysis/OutlookPage.tsx; echo "exit=$?"
git diff --stat -- frontend/src/pages/analysis/OptimizePage.tsx frontend/src/lib/optimize.ts backend/
git diff -- frontend/src/api/client.ts | grep '^-' | grep -v '^---'; echo "exit=$?"
grep -c "'/portfolio/capm'" frontend/src/api/client.ts
grep -rn "kappa\|conviction" frontend/src/lib/capm.ts frontend/src/pages/analysis/outlook/; echo "exit=$?"
git status --short
```

## Tooltips — required for any contract adding interactive elements

Every element listed here uses `Tooltip`. None uses `title`. Where the copy contains `{T}`, substitute
the row's ticker.

| element | tooltip |
|---|---|
| sub-tab `CAPM Optimizer` | `Optimize weights on CAPM expected returns and your views` |
| sub-tab `Monte Carlo` | `Simulate many possible paths for this portfolio (not built yet)` |
| sub-tab `Forecast` | `Project this portfolio with statistical forecasting models (not built yet)` |
| lookback buttons | `` `Estimate betas and covariances from the last ${n} ${n === 1 ? 'year' : 'years'} of daily prices` `` |
| risk-free input | `Annual risk-free rate in percent. Leave blank to use the live 3-month Treasury bill yield.` |
| MRP input | `Market risk premium: how much more than the risk-free rate the market is expected to return each year, in percent` |
| market select | `The index or fund that betas are measured against. Only Universe tickers can be chosen.` |
| `Min % for all` | `Minimum weight to give every holding that isn't frozen when you press Apply to all` |
| `Max % for all` | `Maximum weight to give every holding that isn't frozen when you press Apply to all` |
| `Apply to all` | `Copy these limits to every holding that isn't frozen` |
| Freeze checkbox | `Keep {T} at its current weight. The optimizer moves only the other holdings.` |
| View slider | `Your view on {T}: how undervalued you think it is. Each +10% adds 10% of the market risk premium to its expected return.` |
| Min % input | `Lowest weight the optimizer may give {T}, in percent` |
| Max % input | `Highest weight the optimizer may give {T}, in percent` |
| Run button, Universe loading | `Loading the latest prices` |
| Run button, fewer than 2 holdings | `Needs at least 2 holdings to optimize` |
| Run button, otherwise | `Find the highest-Sharpe mix using CAPM expected returns and your views` |
| tile labels | the `tooltip` of each `statItems` / `varItems` item |
| `Value at Risk (95%)` heading | `Parametric 95% Value at Risk from a normal model of the Target weights' returns` |

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** This contract depends on 0115's backend being committed. Run the
backend and frontend the way you did for the Optimize click-throughs (0109). Then open any portfolio
with 3 or more holdings and go to **Outlook**.

1. The three sub-tabs show, and CAPM Optimizer is selected. Monte Carlo and Forecast each show "not
   built yet".
2. With the default settings (5Y, blank risk-free rate, MRP 5, SPY), press **Run CAPM optimizer**:
   - The summary reads "risk-free x.xx% (3-month T-bill)".
   - The Target weights in the table add up to 100%.
3. Set a view of +50% on one holding and run again. That holding's "E[R] with view" rises by 2.50
   points (50% of the 5% MRP), and its Target weight goes up.
4. Freeze one holding and run. Its Target equals its Current.
5. Set every Max % to 10 with **Apply to all** on a 3-holding portfolio and run. You should get the
   red "Maximum and frozen weights add up to 30.0%…" message, and no results.
6. Type `abc` in Risk-free rate and run. You should get the risk-free message, and no request is made.
7. Check the page at a desktop width, and at a phone width (about 390 px): the holdings table and the
   results table scroll sideways rather than overflowing the card.

## Open questions

None for the coder. If an expected string above doesn't reproduce, report `BLOCKED` with the actual
output rather than changing the fixture.

## Rework 1 (planner audit, 2026-09-26) — behaviour is accepted, presentation is not

The logic is correct. `lib/capm.ts` matches the spec, and the 21 tests are real. The problems are one
visible bug and code that the next Outlook contract cannot reasonably edit. **Change no behaviour and
no test.** Touch only `CapmSection.tsx`, `OutlookPage.tsx` and `lib/capm.ts`.

1. **The inputs and select are unstyled, which is a bug.** `className="control"` names a CSS class
   that does not exist anywhere in `src/`. The risk-free input, the MRP input and the market select
   therefore render as bare browser defaults, which may be unreadable in the dark theme.
   - Use Optimize's control class on all three:
     `w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground`
   - Add `bg-brand-surface text-foreground` to the other text inputs: the two global inputs and the
     per-row min/max inputs.
2. **Reformat to the house style.** `CapmSection`'s whole render is a single line of 6,044
   characters, with several statements per line. Lay out `CapmSection.tsx`, `OutlookPage.tsx` and the
   one-line functions in `capm.ts` the way `OptimizePage.tsx` and `lib/optimize.ts` are laid out:
   - one statement per line
   - JSX nested and indented one element per line, with long attribute lists wrapped
   - `useState` declarations on separate lines

   Split the settings JSX into a local `HoldingsTable` component, alongside `Results`.
3. **Ticker cell and tags must match Optimize's `TickerCell`.**
   - The cell is `font-mono text-xs font-semibold whitespace-nowrap`.
   - The tags are lowercase `pinned` and `frozen`, in
     `ml-2 text-[10px] font-sans font-normal text-[var(--color-muted)]`.
   - The contract said "styled like Optimize's `TickerCell`". Uppercase `PINNED` / `FROZEN` was a
     deviation that the report did not list.
4. **The numeric columns in the results table** (every column except Ticker) use
   `text-right tabular-nums whitespace-nowrap` on both the `th` and the `td`, as Optimize does.
5. **The tiles must be shaped like `MetricTiles`, as the contract said:**
   - Each tile is `rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-3 text-center`.
   - The label is `p.text-xs.text-[var(--color-muted)]`, with the `Tooltip` around a `<span>` of the
     label only, not the whole tile.
   - The value is `p.mt-0.5.text-base.font-bold`.
   - The grid is `grid grid-cols-2 gap-3` for statistics and `grid grid-cols-2 gap-3 sm:grid-cols-3`
     for VaR.
6. **Remove the duplicated default.**
   - Export `defaultHoldingInput(): CapmHoldingInput` from `capm.ts`. Rename the private
     `defaultInput`; `defaultHoldingInputs` keeps using it.
   - Use it for both inline `{ freeze: false, viewPct: 0, minPct: '0', maxPct: '100' }` literals in
     `CapmSection.tsx`.
   - Delete `export { formatWeight }` from `capm.ts`. It was not in the interface, and nothing uses it.

**How to do item 2 (added after a BLOCKED attempt).** Do not use a formatter. Prettier is not a
project dependency, and installing it or running `npx prettier` is out of scope. Rewrite the three
files by hand, with the same edit tool you use for any source change. Replacing a whole file in one
patch is fine, and is probably easiest for `CapmSection.tsx`. "Tool not installed" is not a reason to
block when a hand edit does the job.

### Rework acceptance (paste the complete output)

```bash
(cd frontend && npx vitest run 2>&1 | grep -E "^ +Tests")            # 162 passed
(cd frontend && npm run build 2>&1 | tail -2)                         # exits 0
(cd frontend && npm run lint 2>&1 | grep -E "warning|error")          # only HelpSidebar.tsx:44 and UniversePage.tsx:60
grep -rn "\"control\"" frontend/src; echo "exit=$?"                   # exit=1
awk 'length > 300 { print FILENAME": "FNR }' frontend/src/pages/analysis/outlook/CapmSection.tsx frontend/src/pages/analysis/OutlookPage.tsx frontend/src/lib/capm.ts; echo "done"   # only "done"
grep -n "PINNED\|FROZEN" frontend/src/pages/analysis/outlook/CapmSection.tsx; echo "exit=$?"   # exit=1
grep -n "export { formatWeight }" frontend/src/lib/capm.ts; echo "exit=$?"                    # exit=1
grep -c "freeze: false, viewPct: 0" frontend/src/pages/analysis/outlook/CapmSection.tsx       # 0
git diff --stat -- frontend/src/lib/capm.test.ts frontend/src/api/client.ts                     # capm.test.ts is untracked; client.ts diff unchanged from round 1
```
