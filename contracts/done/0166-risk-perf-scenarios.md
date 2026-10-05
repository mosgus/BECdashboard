# Contract 0166 — Risk & Perf: Scenarios sub-tab (port of `main`'s Scenarios)

**Status:** done
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The **Scenarios** pill renders a new `ScenariosSection`, a port of `main`'s Scenarios section:
- a preset gallery of clickable window cards with coloured tags;
- a custom-scenario form with a Scenario Type picker (**Market Shock**, **Vol Shock**, **Historical Replay**)
  and a Scenario Guide side panel;
- a list of result cards that builds up as you run scenarios, each removable, with a **Clear** button;
- a Scenario Comparison chart once two or more historical replays have been run.

It uses the rebuild's existing `POST /portfolio/stress` and `POST /portfolio/risk`, with no backend change.
It then deletes the old `StressSection.tsx` and `RiskSection.tsx`.

## Why

This is contract 3 of 4 in the Risk & Perf port (see REBUILD.md, "Risk & Perf port (0164)"). Gunnar
wants `main`'s UI with corrected math.

Read `main`'s version first:
- `git show 'main:frontend/app/portfolios/[id]/risk/page.tsx' | sed -n 883,1065p` (ScenariosSection);
- `git show main:frontend/components/research/ScenarioResultCard.tsx | sed -n 32,435p`;
- `git show main:frontend/components/research/ScenarioComparisonBar.tsx`;
- `git show main:frontend/components/ScenarioGuide.tsx`;
- `git show main:frontend/lib/scenarios.ts`;
- `git show main:backend/core/scenarios.py`.

**What changes from `main`, and why:**

| `main` | Here |
|---|---|
| **Market Shock** applied the same % to every holding: impact = shock × Σw. It ignored beta and was really just the shock itself. | Beta-based: each holding moves `weight × beta × move`, cash doesn't move, and the portfolio moves `portfolio_beta × move`. Betas come from `POST /portfolio/risk` (1Y vs SPY). This is the old Breakdown "market move" calculator coming back. |
| **Vol Shock** rescaled the covariance matrix on the server. That is exactly `base_vol × multiplier`. | The same number, computed on the client from `portfolio_vol × multiplier` (cash counted). The card says plainly that this is arithmetic, not a forecast. |
| **Historical Replay** renormalised weights, ignored cash, rebalanced daily and dropped missing tickers silently. | `run_stress`: today's holdings bought at the start and held, cash stays flat, 80% coverage rule, missing holdings counted as flat with a warning. |
| Presets ran **Factor Replay**, which needs Fama-French data. | Presets run Historical Replay. Factor Replay is left out until 0167 settles where the Fama-French data comes from. |
| Eight presets, five of them before 2020 (2008, dot-com, 2011, 2018 ×2). | The rebuild's five `STRESS_PRESETS`. Stored prices start in 2020, so the older windows can't be replayed. |
| Contributors chart took the 6 worst and the 6 best. With 12 or fewer holdings the two lists overlapped, so tickers appeared twice. | The same rule without overlap. |
| Light-only colours (`bg-red-100 text-red-700`, hex `#10b981`/`#ef4444`). | Theme-safe: translucent `-500` tints for tags; `var(--color-positive)`, `var(--color-negative)`, `var(--color-muted)` and `var(--color-accent)` in charts. |
| `ScenarioPlaybook` existed but was never rendered. | Not ported. |
| Dollar amounts on tiles (always `null` on this page). | Not ported. |

## Files

Create:
- `frontend/src/lib/scenarios.ts`
- `frontend/src/lib/scenarios.test.ts`
- `frontend/src/components/ScenarioReplayChart.tsx`, default export, lazy-loaded
- `frontend/src/components/ScenarioImpactChart.tsx`, default export, lazy-loaded
- `frontend/src/components/ScenarioComparisonChart.tsx`, default export, lazy-loaded
- `frontend/src/pages/analysis/risk/ScenariosSection.tsx`
- `frontend/src/pages/analysis/risk/ScenarioCards.tsx`, the three result cards
- `frontend/src/pages/analysis/risk/ScenarioGuide.tsx`

Modify:
- `frontend/src/pages/analysis/RiskPage.tsx`: the `scenarios` pill renders `<ScenariosSection />`. Swap the
  `StressSection` import for the `ScenariosSection` import.
- `frontend/src/pages/analysis/risk/HealthSection.tsx`: replace the three arbitrary RGB tint classes
  (around line 228) with `bg-red-500/10`, `bg-amber-500/10` and `bg-green-500/10`. 0165's grep check
  wrongly banned these. Change nothing else in the file.

Delete, with plain `rm` of these two exact paths:
- `frontend/src/pages/analysis/risk/StressSection.tsx`
- `frontend/src/pages/analysis/risk/RiskSection.tsx`

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. Specifically:
- Keep `lib/risk.ts` and `lib/stress.ts` and their tests as they are. Some of their exports
  (`riskTiles`, `riskRows`, `shockLabel`, `stressTiles`, `stressRows`) become unused. That's expected, and
  they'll be cleaned up later.
- Keep `StressChart.tsx`; Performance uses it.
- No backend change.

`reference files/` and the `main` branch are read-only.

## Frontend

### 1. New `frontend/src/lib/scenarios.ts`

```ts
import type { RiskResponse, StressResponse } from '../api/client'
import type { GuideSection } from './capmGuide'
import { formatSigned } from './risk'
import { STRESS_PRESETS } from './stress'
import type { StressPreset } from './stress'

export type ScenarioKind = 'market_shock' | 'vol_shock' | 'historical'
export const SCENARIO_KINDS: { key: ScenarioKind; label: string }[]
// [{market_shock,'Market Shock'},{vol_shock,'Vol Shock'},{historical,'Historical Replay'}], in that order (main's)

export type ScenarioTag = 'crisis' | 'recovery' | 'rate-shock' | 'vol-shock'
export const PRESET_TAGS: Record<string, ScenarioTag[]>
// 'covid-crash': ['crisis'], 'covid-rebound': ['recovery'], 'rate-shock-2022': ['rate-shock','crisis'],
// 'carry-unwind-2024': ['vol-shock'], 'tariffs-2025': ['crisis']
export const TAG_STYLES: Record<ScenarioTag, string>
// crisis 'border border-red-500/40 bg-red-500/10', recovery green-500, rate-shock amber-500, vol-shock blue-500 (same pattern)

export interface ReplayResult { kind: 'historical'; id: number; window: { start: string; end: string }; preset: StressPreset | null; response: StressResponse; bestDay: number }
export interface ShockRow { ticker: string; weight: number; beta: number; impact: number }
export interface MarketShockResult { kind: 'market_shock'; id: number; movePct: number; marketTicker: string; portfolioBeta: number; impact: number; rows: ShockRow[]; risk: RiskResponse }
export interface VolShockResult { kind: 'vol_shock'; id: number; scale: number; baseVol: number; shockedVol: number; risk: RiskResponse }
export type ScenarioResult = ReplayResult | MarketShockResult | VolShockResult

export function parseVolScale(text: string): { ok: true; value: number } | { ok: false; message: string }
export function marketShock(risk: RiskResponse, movePct: number, id: number): MarketShockResult
export function volShock(risk: RiskResponse, scale: number, id: number): VolShockResult
export function replay(response: StressResponse, window: { start: string; end: string }, id: number): ReplayResult
export function replayCurve(r: StressResponse): { date: string; ret: number; drawdown: number; market: number | null }[]
export function contributionBars(r: StressResponse): { ticker: string; pct: number }[]
export function shockBars(r: MarketShockResult): { ticker: string; pct: number }[]
export function comparisonRows(results: ScenarioResult[]): { name: string; totalReturn: number; maxDrawdown: number }[]
export function replayInterpretation(r: StressResponse): string
export const SCENARIO_GUIDE: GuideSection[]
```

All results are fractions unless the name says `Pct` or `pct`; those are percent.

**`parseVolScale`**
- Trim, and strip one trailing `x` or `×`.
- Accept a finite number from 0.1 to 10 inclusive.
- Otherwise return `Vol multiplier must be a number from 0.1 to 10.`

**`marketShock(risk, movePct, id)`**
- `movePct` is in percent, e.g. `-20`, and has already been checked with `lib/risk.ts`'s `parseShock`.
- Let `move = movePct / 100`.
- `impact = risk.portfolio_beta × move`.
- `rows`: one per holding, `{ ticker, weight: holding.weight, beta: holding.beta, impact: holding.weight × holding.beta × move }`.
  `holding.weight` is the whole-portfolio weight, with cash counted.
- Sort `rows` by `impact`, lowest first, so the worst holding comes first for a fall.
- `marketTicker = risk.market_ticker` and `portfolioBeta = risk.portfolio_beta`.

**`volShock(risk, scale, id)`**
- `baseVol = risk.portfolio_vol`
- `shockedVol = baseVol × scale`

**`replay(response, window, id)`**
- `window` is the **requested** window. The backend moves start and end to trading days, so match on
  `window`, not on `response`.
- `preset` is the `STRESS_PRESETS` entry whose `start` and `end` equal `window`'s, or `null`.
- `bestDay` is the largest `path[i].value / path[i-1].value − 1`.

**`replayCurve`**

For each path point:
- `ret = (value − 1) × 100`
- `drawdown = (value / running peak of value − 1) × 100`
- `market = market === null ? null : (market − 1) × 100`

**`contributionBars`**
- Keep holdings whose `contribution` isn't null, and sort them by contribution, lowest first.
- If there are more than 12, keep the first 6 and the last 6. Otherwise keep them all.
- Map each to `{ ticker, pct: contribution × 100 }`.

**`shockBars`**

Map `rows` to `{ ticker, pct: impact × 100 }`.

**`comparisonRows`**
- Use only `historical` results, in the order they were run.
- `name` is `preset?.name ?? `${window.start} → ${window.end}``.
- `totalReturn = portfolio_return × 100`
- `maxDrawdown = max_drawdown × 100`

**`replayInterpretation(r)`**

Exactly:
```
Over this ${n_days}-day window, the portfolio ${gained|lost} ${|portfolio_return|×100, 1 dp}%[, while ${market_ticker} ${rose|fell} ${|market_return|×100, 1 dp}%]. Deepest drawdown: ${formatSigned(max_drawdown × 100)}. ${P} of ${N} holdings with prices contributed positively.
```
- Use `gained` when `portfolio_return ≥ 0`, otherwise `lost`.
- Use `rose` when `market_return ≥ 0`, otherwise `fell`.
- Leave out the bracketed clause when `market_return` is null.
- `N` counts holdings with a non-null contribution. `P` counts those with `contribution > 0`.

**`SCENARIO_GUIDE`**

Two sections, `{ heading, paragraphs, entries }` (the `capmGuide` shape). Copy the text verbatim.

Section `Scenario types`. `paragraphs`:
`Three ways to stress today's holdings. Every scenario keeps cash at 0% return.`

`entries`:
- `Market Shock`: `Estimates an instant move in SPY. Each holding moves by its beta × the SPY move, using betas from the last year of daily returns, and cash doesn't move. Caveat: beta only captures the part of each holding that tracks the market. In real crashes, correlations rise and stock-specific news adds to the loss, so treat this as a central estimate, not a worst case.`
- `Vol Shock`: `Scales every holding's volatility by a multiplier, keeping correlations fixed. Portfolio volatility then scales by exactly the multiplier, so this shows the arithmetic of a calmer or wilder market rather than a forecast. Caveat: in real crises correlations rise too, so the true figure is usually higher.`
- `Historical Replay`: `Buys today's holdings at the start of a past window and holds them to the end. Returns, drawdown, best and worst days, and each holding's contribution come from real prices. Caveat: stored prices start in 2020, so 2008 and the dot-com bust can't be replayed. A holding without prices for the whole window counts as flat, and a run with under 80% of the invested money priced is refused.`

Section `How to read the results`. `paragraphs`: `[]`.

`entries`:
- `Portfolio impact`: `Market Shock only. The estimated change in the whole portfolio's value, cash included.`
- `Per-holding impact`: `Market Shock only. Weight × beta × the market move. Sorted worst first.`
- `Base vs shocked vol`: `Vol Shock only. Annualised volatility now, and after scaling.`
- `Return and drawdown chart`: `Historical Replay only. The line is the portfolio's return since the start of the window; the shaded area is how far it sits below its previous high. The dashed line is SPY.`
- `Top winners and losers`: `Historical Replay only. Each holding's weight × its return over the window, which is its share of the portfolio's result.`
- `Scenario comparison`: `Appears after two or more historical replays. Total return and maximum drawdown side by side.`

### 2. New `frontend/src/lib/scenarios.test.ts` (+9)

**Risk fixture `R`**, a literal `RiskResponse`:
- `tickers ['A','B']`
- holdings:
  - `A {weight: 0.4, invested_weight: 0.5, vol: 0.3, beta: 1.2, risk_share: 0.7}`
  - `B {weight: 0.4, invested_weight: 0.5, vol: 0.15, beta: 0.6, risk_share: 0.3}`
- `market_ticker 'SPY'`, `lookback_days 365`, `start '2025-01-02'`, `end '2026-01-02'`, `n_returns 250`
- `cash_weight 0.2`, `portfolio_vol 0.2`, `portfolio_beta 0.72`
- `hhi 0.5`, `effective_holdings 2`, `top5_weight 1`, `warnings []`

**Stress fixture `S`**: copy the `S` literal from `lib/stress.test.ts` verbatim.

Tests:

1. `marketShock(R, -20, 1)`:
   - `impact ≈ -0.144`;
   - rows in order `A`, `B`, with `A.impact ≈ -0.096` and `B.impact ≈ -0.048`.
2. `marketShock(R, 10, 1)`:
   - `impact ≈ 0.072`;
   - rows in order `B` (`≈ 0.024`), then `A` (`≈ 0.048`).
3. `volShock(R, 2, 1)`: `baseVol 0.2` and `shockedVol ≈ 0.4`.
4. `parseVolScale`:
   - `' 1.5 '` gives `{ ok: true, value: 1.5 }`, and so does `'1.5x'`;
   - `'0'`, `'11'` and `'abc'` each give `ok: false`.
5. `replay` and presets:
   - `replay(S, {start: '2020-02-19', end: '2020-03-23'}, 1).preset?.name` is `'COVID crash'`;
   - the window `2021-01-04`–`2021-06-30` gives `preset` null;
   - every `STRESS_PRESETS` id has at least one entry in `PRESET_TAGS`;
   - with a path of values `[1, 0.9, 0.95, 0.93]`, `bestDay ≈ 0.05556` (`toBeCloseTo(0.05556, 4)`).
6. `replayCurve` on a path of `{2025-01-02, 1, null}`, `{2025-01-03, 1.1, null}` and `{2025-01-06, 0.99, null}`:
   - the last point has `ret ≈ -1`, `drawdown ≈ -10` and `market` null.
7. `contributionBars`:
   - on `S`, it gives `['A','B']`, with C dropped;
   - on 15 synthetic covered holdings with contributions `-0.07 … +0.07` in steps of 0.01, it gives 12 bars
     with unique tickers, the first having `pct ≈ -7` and the last `pct ≈ 7`.
8. `comparisonRows`, given a COVID-crash replay of `S`, a custom-window replay of `S` and a `marketShock(R, -20, 3)`:
   - two rows;
   - names `['COVID crash', '2021-01-04 → 2021-06-30']`;
   - `totalReturn ≈ -12.3` and `maxDrawdown ≈ -15`.
9. `replayInterpretation(S)` equals exactly
   `Over this 33-day window, the portfolio lost 12.3%, while SPY fell 18.8%. Deepest drawdown: -15.0%. 0 of 2 holdings with prices contributed positively.`
   With `market_return: null`, the result doesn't contain `while`.

### 3. New chart components

All three components:
- use recharts;
- set `isAnimationActive={false}` on every series;
- use grid stroke `var(--color-border)`;
- use axis ticks `{ fontSize: 10, fill: 'var(--color-muted)' }`;
- format tooltips as `x.xx%`;
- **contain no hex colours**.

**`ScenarioReplayChart.tsx`**: `{ data: ReturnType<typeof replayCurve>; marketTicker: string; gain: boolean }`.
This is `main`'s `ComposedChart`, height 220:
- `Return` line on the left axis, stroke `var(--color-positive)` if `gain`, else `var(--color-negative)`;
- `Drawdown` `Area` on the right axis, `fill="var(--color-negative)"`, `fillOpacity={0.15}`, no stroke,
  domain `[(min) => Math.min(min, 0), 0]`;
- a dashed `marketTicker` line on the left axis (`var(--color-muted)`, `strokeDasharray="6 3"`), only if
  some `market` isn't null. This is an addition over `main`.
- `ReferenceLine y={0}` on the left axis;
- X ticks `date.slice(0, 7)`, `minTickGap={40}`;
- a `Legend`.

**`ScenarioImpactChart.tsx`**: `{ data: { ticker: string; pct: number }[]; name: string }`.
- A vertical `BarChart`, height `Math.max(180, data.length * 22)`.
- Each bar's `Cell` is `var(--color-positive)` when `pct ≥ 0`, else `var(--color-negative)`.
- `ReferenceLine x={0}`.
- YAxis on ticker, width 54.
- Used for both the historical contributors and the market-shock impacts.

**`ScenarioComparisonChart.tsx`**: `{ data: ReturnType<typeof comparisonRows> }`.
- `main`'s grouped `BarChart`, height 260.
- Angled X labels: `angle={-25}`, `textAnchor="end"`, `interval={0}`, `height={80}`.
- `Total Return` bar coloured per cell by sign.
- `Max Drawdown` bar, `fill="var(--color-accent)"`.
- `ReferenceLine y={0}`, and a `Legend` at top right.

### 4. New `frontend/src/pages/analysis/risk/ScenarioCards.tsx`

Export `ScenarioCard({ result, index, onRemove })`, which switches on `result.kind`. Charts are lazy and wrapped
in `Suspense`.

Cards use `space-y-4 rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-5`.

**`CardHeader`** follows `main`'s layout:
- a tag pill, `rounded bg-brand-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand-primary`,
  reading `#${index + 1} · Historical`, `· Market Shock` or `· Vol Shock`;
- the title, `text-sm font-semibold`;
- the subtitle, muted `text-xs`;
- a remove button showing `×`, with `aria-label="Remove this scenario"` and the Tooltip `Remove this scenario`.

**`MetricTile`** follows `main`'s layout:
- label: `text-[10px] uppercase`, muted, wrapped in `Tooltip`;
- value: `mt-0.5 text-lg font-bold`, `text-brand-positive` or `text-brand-negative` where stated;
- the box: `rounded-[var(--radius-card)] border border-brand-border p-3`.

**Historical card**
- Title `preset?.name ?? 'Historical Replay'`. Subtitle is `stressSummary(response)`, from `lib/stress.ts`.
- Tiles in `grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6`. Signed values use `formatSigned(x × 100)`:

  | Tile | Value | Colour | Tooltip |
  |---|---|---|---|
  | `Total Return` | `portfolio_return` | positive if ≥ 0, else negative | `Today's holdings bought at the start of the window and held to the end. Cash stays flat.` |
  | `Max Drawdown` | `max_drawdown` | negative | `Largest fall from a high point during the window.` |
  | `Worst Day` | `worst_day` | negative | `Worst single-day move, on ${worst_day_date}.` |
  | `Best Day` | `bestDay` | positive | `Best single-day move in the window.` |
  | `${market_ticker} Return` | `market_return`, or `—` if null | none | `What ${market_ticker} returned over the same window.` |
  | `Trading Days` | `n_days` | none | `Trading days in the window.` |

- An interpretation box, `rounded bg-[var(--color-bg)] px-3 py-2 text-xs`:
  `<strong>Interpretation: </strong>{replayInterpretation(response)}`.
- Heading `Portfolio return and drawdown`, muted `text-xs font-semibold`, then `ScenarioReplayChart`.
- Heading `Top winners & losers (contribution to portfolio return)`, then `ScenarioImpactChart` with
  `contributionBars`, `name="Contribution"`. Render this only when there are bars.
- Warnings, each as a muted `text-xs` line starting with `⚠ `.

**Market Shock card**
- Title: `If ${marketTicker} moves ${formatSigned(movePct)}`.
- Subtitle:
  `Each holding moves by its beta × the ${marketTicker} move; cash doesn't move. ${riskSummary(risk)}`.
- Tiles in `grid grid-cols-1 gap-2 sm:grid-cols-3`:

  | Tile | Value | Colour | Tooltip |
  |---|---|---|---|
  | `Portfolio Impact` | `formatSigned(impact × 100)` | by sign | `Portfolio beta × the market move, cash included.` |
  | `Portfolio Beta` | `toFixed(2)` | none | `How much the whole portfolio moves per 1% move in ${marketTicker}. Cash counts as 0.` |
  | `Holdings` | `rows.length` | none | `Holdings included in the estimate.` |

- Heading `Per-holding impact (weight × beta × move)`, then `ScenarioImpactChart` with `shockBars`, `name="Impact"`.

**Vol Shock card**
- Title: `Vol multiplier: ${scale.toFixed(1)}×`.
- Subtitle:
  `Every holding's volatility scaled; correlations held fixed. ${riskSummary(risk)}`.
- Tiles in `sm:grid-cols-3`:
  - `Base Vol`: `x.x%`, tooltip `Annualised volatility of the whole portfolio now, cash included.`
  - `Shocked Vol`: `x.x%`, tooltip `Base volatility × the multiplier.`
  - `Δ Vol`: `formatSigned((shocked − base) × 100)`, tooltip `Change in annualised volatility.`
  - None of the three is coloured.
- Interpretation box:
  `A ${scale}× vol shock moves annualised volatility from ${base}% to ${shocked}%. Daily swings would be roughly ${scale}× their usual size. With correlations held fixed this is exact arithmetic; in real crises correlations also rise, so treat it as a floor.`
  Use `scale.toFixed(1)` and percentages to 1 dp.

### 5. New `frontend/src/pages/analysis/risk/ScenarioGuide.tsx`

Copy `outlook/CapmGuide.tsx`'s structure. Use `GuidePanel` with the title `Scenario guide`, rendering `SCENARIO_GUIDE`.

### 6. New `frontend/src/pages/analysis/risk/ScenariosSection.tsx`

**Data loading**

Load the portfolio, universe, `tradeBasis` and `mountedRef` exactly as `HealthSection.tsx` does. There is
**no** auto-run; `main` didn't auto-run here either.

**State**
- `kind`, starting as `'market_shock'`;
- `moveText`, starting as `'-20'`;
- `scaleText`, starting as `'2'`;
- `startText` and `endText`, starting as `'2022-01-03'` and `'2022-12-30'`;
- `results: ScenarioResult[]`;
- `status: idle | running | error(message)`;
- `guideOpen`;
- a `nextId` ref;
- a cached `{ request: RiskRequest; response: RiskResponse }` ref.

**Running**
- **Historical** (custom form or preset):
  - check the window with `parseWindow`;
  - build the request with `buildStressRequest(portfolio, window, 'SPY', basis)`;
  - call `stressPortfolio`;
  - append `replay(response, window, id)`.
- **Market and Vol Shock:**
  - parse `moveText` with `parseShock`, or `scaleText` with `parseVolScale`;
  - build the request with `buildRiskRequest(portfolio, DEFAULT_RISK_SETTINGS, basis)`;
  - reuse the cached response if `sameRiskRequest` matches, otherwise call `riskPortfolio` and cache the result;
  - append `marketShock(...)` or `volShock(...)`.
- Show parse and build errors as the error status, with no request sent.
- Disable every run button while running.
- Don't change state after unmount.

**Layout**

`space-y-5`, in `main`'s order:

1. **Preset gallery**
   - Label: `Preset Scenarios — click to replay one of these windows with today's holdings`, muted
     `text-xs font-semibold`.
   - Grid: `grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5`.
   - One `button` per `STRESS_PRESETS` entry, styled
     `rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-3 text-left hover:border-brand-primary disabled:opacity-50`.
   - Each card shows:
     - the name, `text-xs font-semibold`;
     - the description, muted `text-[10px]`;
     - `start → end`, `font-mono` muted `text-[10px]`;
     - the tag pills, `rounded px-1.5 py-0.5 text-[9px] font-semibold` plus `TAG_STYLES[tag]`.
   - Clicking a card sets `kind` to `historical`, fills the date inputs and runs immediately.
   - Tooltip: `Replay ${name} (${start} → ${end}) with today's holdings`.
2. **Divider**: `border-t border-brand-border pt-2`, then `Or run a custom scenario:` in muted `text-xs font-semibold`.
3. **Type row**: `flex flex-wrap items-end justify-between gap-3`.
   - A labelled `Scenario Type` `select` over `SCENARIO_KINDS`, styled like the other selects on the page.
     Tooltip: `Choose how to stress the portfolio`.
   - `HelpButton`, labelled `Scenario Guide`, with tooltip `What each scenario does and how to read the results`.
     It opens `ScenarioGuide`.
4. **Inputs card**: `flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-4`.
   - Market Shock: a `SPY move % (e.g. −20)` number input, `w-32`.
   - Vol Shock: a `Vol multiplier (e.g. 2 = 2×)` number input, `min 0.1`, `step 0.1`.
   - Historical: `Start` and `End` date inputs.
   - A **Run Scenario** primary button, styled like Health's Recompute. It reads `Running…` while running.
   - A **Clear** button when there are results, styled like `main`'s secondary button.
5. **Error** in `text-brand-negative text-sm`.
6. **Results**
   - When `comparisonRows(results).length ≥ 2`, show a comparison card titled `Scenario Comparison`, with the
     subtitle `Total return and max drawdown across the ${n} historical replays you've run.` and a
     `ScenarioComparisonChart`.
   - Then `results.map` to `ScenarioCard`, keyed by `id`, in the order they were run. Removing a card filters
     it out by `id`.
7. **Footnote**, muted `text-xs`:
   `Scenarios are estimates from past prices and betas, not forecasts. Not investment advice.`

### 7. Formatting

Run Prettier on the eight **new** files only:
`node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write <files>`.

If `/tmp/prettier3` is missing, report it and skip this step. Don't run Prettier on `RiskPage.tsx` or `HealthSection.tsx`.

## Tooltips

| Element | Copy |
|---|---|
| Preset card | `Replay ${name} (${start} → ${end}) with today's holdings` |
| Scenario Type select | `Choose how to stress the portfolio` |
| SPY move input | `How much SPY moves, in percent, from -50 to +50` |
| Vol multiplier input | `How much to scale every holding's volatility, from 0.1× to 10×` |
| Start / End inputs | `First day of the replay window` / `Last day of the replay window` |
| Run Scenario | `Run this scenario and add it to the results below` |
| Clear | `Remove all scenario results` |
| Remove (×) | `Remove this scenario` |
| Scenario Guide | `What each scenario does and how to read the results` |
| Tiles | As specified above |

## Out of scope

- Factor Replay and any Fama-French data. That's 0167's decision.
- Presets before 2020, and new presets.
- Any backend change, including a scenario endpoint.
- Removing the now-unused exports in `lib/risk.ts` and `lib/stress.ts`, or their tests.
- Dollar amounts, CSV and PNG export buttons, and the `ScenarioPlaybook`.
- Keeping results when switching pills. `main` didn't either.

## Acceptance criteria

Run these from `frontend/`:

1. `npx vitest run` passes. The baseline is 355 tests in 23 files; afterwards there are **364 in 24 files**. Paste the totals.
2. `npx tsc -p tsconfig.app.json --noEmit` is clean, `npm run lint` shows only the 2 known warnings,
   and `npm run build` succeeds.
3. `awk 'length > 300'` prints nothing for the eight new files, `RiskPage.tsx` or `HealthSection.tsx`.
4. This command prints nothing:
   ```
   grep -nE "bg-(red|amber|green|blue)-(50|100)\b|text-(red|green|amber|blue)-[0-9]|#[0-9a-fA-F]{6}\b|rgb\(" src/lib/scenarios.ts src/components/Scenario*.tsx src/pages/analysis/risk/Scenario*.tsx src/pages/analysis/risk/HealthSection.tsx
   ```
5. `grep -rn "RiskSection\|StressSection" src` prints nothing, and
   `ls src/pages/analysis/risk/` lists `HealthSection.tsx`, `PerformanceSection.tsx`,
   `ScenarioCards.tsx`, `ScenarioGuide.tsx` and `ScenariosSection.tsx` only.
6. `git status --short ../backend` prints nothing.

**Planner-run** (coders skip this: write "browser checks left for the Planner" under Not done):

7. `node contracts/tools/smoke-render.mjs risk "Scenarios"` shows `SUB-TAB CLICKED: true` and no `EXCEPTION:` line.
   Its PAGE TEXT contains `Preset Scenarios`, `COVID crash`, `Scenario Type` and `Run Scenario`.
   `risk "Health"` still renders its cards.

`BLOCKED` is a valid outcome. Report any deviation.

## Human verification — Gunnar

1. **Risk & Perf → Scenarios** looks like `main`: preset cards with coloured tags, the custom form, and
   the Scenario Guide slide-over.
2. Click **COVID crash**. A Historical card appears with six tiles, the return/drawdown chart with a
   dashed SPY line, and the winners and losers bars. Then click **2022 rate shock**. A Scenario
   Comparison chart appears above the cards.
3. Run a **Market Shock** of −20 on a portfolio with cash. Portfolio Impact equals Health's Beta × −20%
   (for example, beta 0.81 gives about −16.2%), not −20%. High-beta holdings have the longest bars.
4. Run a **Vol Shock** of 2. Shocked Vol is exactly 2 × Health's Ann. Vol.
5. Remove one card with ×, then **Clear**. Switch the theme: tags and charts stay readable in both.

## Open questions

None.
