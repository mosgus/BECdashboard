# Contract 0172 — Research tab, pill shell, and the Portfolio pill's optimizer comparison table

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

**Depends on 0171** (`POST /portfolio/compare`). Do not start until 0171 is accepted.

## Goal

After this contract, a portfolio has a **Research** tab after Risk & Performance at
`/portfolios/:id/research`. It contains a pill bar with one pill, **Portfolio**, which runs
`POST /portfolio/compare` and shows:
- the eight optimizers and the current portfolio in one table, with **holdout** columns first and
  in-sample columns second;
- a one-time trading-cost estimate per mode, from a bps slider.

The efficient frontier and the correlation heatmap are **contract 0173**, not this one.

## Why

This is step 1 of the Research tab (REBUILD.md, "Next: a Research tab inside Portfolios", and the
2026-10-26 decisions under it). Read `main`'s page first:
`git show main:frontend/app/research/portfolio/page.tsx` and
`git show main:frontend/components/research/OptimizerComparisonTable.tsx`.

**What changes from `main`, and why:**

| `main` | Here |
|---|---|
| In-sample metrics only. The best Sharpe was highlighted green, and Max Sharpe won it by construction. | Holdout columns come first, and **only holdout columns are highlighted**. In-sample columns are plain, and the copy says what they are. |
| A separate "Turnover & Cost Sensitivity" table: `Net Sharpe = Sharpe − turnover × bps / vol`. That treats a one-time rebalance cost as if it recurred every year, and uses one-way turnover, which is half the dollars traded. | One column, **Cost (one-time)** = `traded × bps / 10 000`. `traded` is the sum of absolute weight changes, i.e. buys plus sells. It is shown as a % of the whole portfolio and, when shares are known, in dollars. It is **not** subtracted from any metric. |
| A Run button with no settings, and a fixed 5-year lookback. | A lookback picker (default 1 year, matching Historical Optimize), plus Max weight and Vol target sliders. It auto-runs once on mount, like Health. |
| A portfolio picker (`ResearchContext`). | None: the portfolio comes from the route. |
| A risk-contribution table. | Dropped (Gunnar, 2026-10-26). It duplicates Risk & Perf → Health. |

## Files

Create:
- `frontend/src/pages/analysis/ResearchPage.tsx`: the pill shell.
- `frontend/src/pages/analysis/research/PortfolioSection.tsx`: the Portfolio pill.
- `frontend/src/lib/research.ts`: pure helpers.
- `frontend/src/lib/research.test.ts`

Modify:
- `frontend/src/api/client.ts`: add the compare types and `comparePortfolio`.
- `frontend/src/App.tsx`: import `ResearchPage` and add `<Route path="research" element={<ResearchPage />} />` after the `risk` route.
- `frontend/src/pages/analysis/AnalysisLayout.tsx`: append `{ path: 'research', label: 'Research' }` to `ANALYSIS_TABS`.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED`.

`reference files/` and the `main` branch are read-only.

## Interface

### `api/client.ts`

Mirror 0171's `CompareResponse` field for field. Reuse the existing `FrontierPoint` and
`OptimizeRebalance` types.

```ts
export interface CompareRequest {
  tickers: string[]; weights: number[]; lookback_days: number
  max_weight: number; min_weight: number; vol_target: number; rebalance: OptimizeRebalance
}
export interface CompareMetrics { cagr: number | null; vol: number | null; sharpe: number | null; max_dd: number | null }
export interface CompareMode {
  mode: string; error: string | null; feasible: boolean | null
  target_weights: Record<string, number> | null; traded: number | null
  in_sample: CompareMetrics | null; point: FrontierPoint | null
  holdout_weights: Record<string, number> | null; holdout: CompareMetrics | null; holdout_error: string | null
}
export interface CompareCurrent { in_sample: CompareMetrics; holdout: CompareMetrics | null; point: FrontierPoint | null }
export interface HoldoutWindow { fit_start: string; fit_end: string; score_start: string; score_end: string; tickers: string[]; excluded: string[] }
export interface CompareFrontier { points: FrontierPoint[]; cloud: FrontierPoint[]; tickers: string[]; excluded: string[] }
export interface Correlation { tickers: string[]; matrix: number[][]; start: string; end: string; n_returns: number; limited_by: string | null; excluded: string[] }
export interface CompareResponse {
  tickers: string[]; current_weights: Record<string, number>; pinned: string[]
  lookback_days: number; rebalance: OptimizeRebalance; rf: number; rf_source: 'live' | 'fallback'
  fit_start: string; fit_end: string; score_start: string
  current: CompareCurrent; modes: CompareMode[]
  holdout: HoldoutWindow | null; holdout_unavailable: string | null
  frontier: CompareFrontier | null; correlation: Correlation | null; warnings: string[]
}
export async function comparePortfolio(body: CompareRequest): Promise<CompareResponse>
// → request<CompareResponse>('/portfolio/compare', { method: 'POST', body })
```

### `lib/research.ts`

```ts
export interface CompareSettings { lookbackDays: number; maxWeightPct: number; volTargetPct: number }
export const DEFAULT_COMPARE_SETTINGS: CompareSettings = { lookbackDays: 365, maxWeightPct: 100, volTargetPct: 10 }
export const DEFAULT_COST_BPS = 10

export function buildCompareRequest(portfolio: Portfolio, settings: CompareSettings, basis?: TradeBasis): CompareRequest
// tickers and weights MUST come from buildOptimizeRequest(portfolio, { ...DEFAULT_SETTINGS, lookbackDays: settings.lookbackDays }, basis),
// so dollar-basis weighting is not duplicated. Then: max_weight = maxWeightPct / 100, min_weight = 0,
// vol_target = volTargetPct / 100, rebalance = 'none'.

export function sameCompareRequest(a: CompareRequest, b: CompareRequest): boolean

export type CompareSortKey =
  | 'mode' | 'holdout.cagr' | 'holdout.vol' | 'holdout.sharpe' | 'holdout.max_dd'
  | 'in_sample.cagr' | 'in_sample.vol' | 'in_sample.sharpe' | 'in_sample.max_dd' | 'traded'

export interface CompareRow {
  key: string            // 'current' or the mode value
  label: string          // 'Current portfolio', or modeLabel(mode) from lib/optimize
  isCurrent: boolean
  error: string | null
  feasible: boolean | null
  traded: number | null   // 0 for the current row
  inSample: CompareMetrics | null
  holdout: CompareMetrics | null
  holdoutError: string | null
}

export function compareRows(response: CompareResponse): CompareRow[]
// current row first, then response.modes in response order.

export function sortCompareRows(rows: CompareRow[], key: CompareSortKey, ascending: boolean): CompareRow[]
// Current row always first. Error rows always last, in their original relative order.
// Among the rest: a null sort value goes after every non-null value in both directions.
// 'mode' sorts by label. The sort is stable.

export function bestHoldout(rows: CompareRow[]): { cagr: number | null; vol: number | null; sharpe: number | null; max_dd: number | null }
// Over non-current rows with error === null and holdout !== null:
// max cagr, min vol, max sharpe, max max_dd (the least negative). null when no row qualifies.

export function tradeCost(traded: number, bps: number, cashWeightPct: number, basis: TradeBasis): { pct: number; dollars: number | null }
// pct = traded * bps / 10000 * (1 - cashWeightPct / 100) * 100   — % of the whole portfolio, cash included
// dollars = basis.kind === 'dollar' ? traded * bps / 10000 * basis.investedValue : null
```

`traded` is a fraction of the **invested** sleeve: 0171 sends weights without cash. That is why
`pct` scales by `(1 − cash)`. Put that sentence in a comment above `tradeCost`.

### `ResearchPage.tsx`

Copy `RiskPage.tsx`'s tablist pattern exactly: same classes, `role="tab"`, and a `Tooltip` per
pill. `TABS` has a single entry:

```ts
['portfolio', 'Portfolio', 'Compare all eight optimizers on this portfolio, tested on a year they never saw']
```

`useState<'portfolio'>('portfolio')`, rendering `<PortfolioSection />`. The single-member union
is deliberate: contracts for Asset, Robustness, Memo and Overview each add one member.

### `PortfolioSection.tsx`

Follow `risk/HealthSection.tsx`'s structure:
- the portfolio comes from `useParams`;
- `getUniverse()` supplies last closes for `tradeBasis`;
- a `RunState` union, `mountedRef`, and `autoRunRef` auto-running once when prices are ready;
- a "changed since this run" note driven by `sameCompareRequest`.

Top to bottom:

1. **Controls row:**
   - `LookbackPicker`;
   - a **Max weight** slider (10–100, step 5);
   - a **Vol target** slider (5–50, step 1). Its label says it only affects Target Volatility;
   - a **Run comparison** button, which reads `Comparing 8 optimizers…` while running.
2. **Run notes** (`text-xs text-[var(--color-muted)]`):
   - `In-sample: fit and scored on {fit_start} → {fit_end}.`
   - when `holdout` is non-null: `Holdout: fit on {fit_start} → {fit_end}, scored on {score_start} → {score_end}.`
     If `holdout.excluded` is non-empty, add `Not in the holdout (no prices before {fit_end}): {tickers}.`
   - when `holdout` is null: the `holdout_unavailable` text;
   - when `pinned` is non-empty: `Held at current weight (too little history to fit): {tickers}.`
   - every `warnings` entry;
   - the stale-run note.
3. **Explainer**, this copy verbatim:
   > In-sample numbers show how each optimizer did on the same prices it was fit to, so each one tends to win at its own goal. The holdout columns are the real test: weights fit on the prior period, then scored on the last 12 months, which the fit never saw. Green marks the best holdout value. One year is one test, not proof.
4. **Trading cost slider:** 0–100 bps, step 5, default `DEFAULT_COST_BPS`, labelled
   `Trading cost: {n} bps per dollar traded`.
5. **The table.** Two header rows:
   - group row: `Mode` (spanning both header rows) · `Holdout, last 12 months` (4) · `In-sample` (4) · `Trade` (2);
   - column row: `CAGR` `Vol` `Sharpe` `Max DD` · `CAGR` `Vol` `Sharpe` `Max DD` · `Traded` `Cost (one-time)`.

   Every column header except the group row is a sort button. The default sort is
   `holdout.sharpe`, descending. Use `TH`/`TD`/`NUMERIC`-style class constants like `HealthSection`'s.
   - Percentages are fractions × 100 to 1 decimal with a `%` sign. Sharpe has 2 decimals. `null` shows `—`.
   - `Cost (one-time)` is `{pct to 2 decimals}%`, followed by ` · {formatMoney(dollars)}` when
     dollars is non-null. The current row shows `—` for Traded and Cost.
   - The current row is visually set apart, as in `main` (a tinted background and semibold).
   - **Highlight:** a holdout cell whose value `===` the matching `bestHoldout` value gets
     `font-semibold text-brand-positive`. **No in-sample cell is ever highlighted.**
   - An error row shows the label, then one cell spanning the other 10 columns with the error
     text in `text-brand-negative`.
   - A row with `holdoutError` shows one muted cell spanning the 4 holdout columns with that text.
   - A row with `feasible === false` shows `did not converge` in muted text under its label.

## Out of scope

- The efficient frontier chart and the correlation heatmap. They are contract 0173; the
  response already carries them, so leave them unrendered.
- Any other Research pill, including disabled or "coming soon" placeholders. One pill only.
- An "Apply" button or CSV export of a mode's weights. Historical Optimize does that.
- Min weight, rebalance or shorting controls.
- Any change to `RiskPage.tsx`, `HealthSection.tsx`, `OptimizePage.tsx`, `lib/optimize.ts` or
  `FrontierChart.tsx`. Import from them, and do not edit them.
- A tooltip on the new **Research** nav tab. The four existing nav tabs in `AnalysisLayout` have
  none, so match them.
- New dependencies.

## Tooltips

Use `Tooltip` from `components/Tooltip`, never `title`. Exact copy:

| element | tooltip |
|---|---|
| Portfolio pill | `Compare all eight optimizers on this portfolio, tested on a year they never saw` |
| LookbackPicker options | `optionTooltip={(o) => \`Fit each optimizer on the last ${o.label} of daily prices\`}` |
| LookbackPicker custom | `Fit each optimizer on daily prices from a start date you choose` |
| Max weight slider | `No optimizer may put more than this share of the invested money in one holding` |
| Vol target slider | `The volatility Target Volatility aims for. The other seven optimizers ignore it.` |
| Run comparison | `Fit all eight optimizers again with these settings and the current holdings` |
| Trading cost slider | `Estimated cost per dollar bought or sold, in basis points (1 bp = 0.01%). Used only for the Cost column.` |
| each sortable header | `Sort by {header} — click again to reverse` (`{header}` prefixed `Holdout` / `In-sample` for the metric columns, e.g. `Sort by Holdout Sharpe — click again to reverse`) |

`Tooltip` calls `Children.only`. Wrap exactly **one** element per `Tooltip`. Contract 0119
blanked a whole tab by breaking this.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

`research.test.ts` contains at least these tests, with the fixture written as literal objects in
the test file:

1. `tradeCost(0.5, 10, 40, { kind: 'weights', reason: 'no-shares' })` → `pct` `toBeCloseTo(0.03, 10)`, `dollars` `null`.
2. `tradeCost(0.5, 10, 40, { kind: 'dollar', investedValue: 60000, prices: {}, shares: {} })` → `dollars` `toBeCloseTo(30, 10)`.
3. `tradeCost(0, 25, 0, { kind: 'weights', reason: 'no-shares' }).pct === 0`.
4. Rows for `sortCompareRows`: a current row, plus modes `m1`, `m2` and `m3` with holdout Sharpe
   `0.5`, `null` and `1.2`, plus mode `m4` with an `error`. Sorting by `holdout.sharpe` descending
   gives keys `['current', 'm3', 'm1', 'm2', 'm4']`. Ascending gives `['current', 'm1', 'm3', 'm2', 'm4']`.
5. `bestHoldout` over rows where the current row has the highest holdout Sharpe returns the best
   **non-current** Sharpe. It ignores error rows. With a vol tie it returns the tied minimum value.
6. `bestHoldout(compareRows(response))` where every mode's `holdout` is `null` returns all four as `null`.
7. `compareRows` puts the current row first with `traded === 0`, and keeps the response's mode order after it.
8. `buildCompareRequest` on a dollar-basis portfolio returns the same `weights` as
   `buildOptimizeRequest` for that portfolio and basis. It also returns `min_weight === 0` and
   `rebalance === 'none'`.

Global:

9. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. Plain `--noEmit` is vacuous here; do not use it.
10. `cd frontend && npm run test` passes. Count = **372 + the tests you added**, in **26** files. Report both.
11. `cd frontend && npm run build` exits 0.
12. `cd frontend && npm run lint` shows the same 2 known warnings and nothing new.
13. `grep -c "highlight\|text-brand-positive" frontend/src/pages/analysis/research/PortfolioSection.tsx` ≥ 1, **and** no
    in-sample cell is highlighted. To make that structural: the expression that decides
    highlighting must take only `row.holdout` values and `bestHoldout(...)`. Name the line numbers
    in your report.
14. `grep -n "title=" frontend/src/pages/analysis/ResearchPage.tsx frontend/src/pages/analysis/research/PortfolioSection.tsx` prints nothing.
15. `grep -n "Net Sharpe\|netSharpe" frontend/src` prints nothing.
16. **Format, then check for collapse.** Run
    `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write <each file you created>`
    on the **created** files only. Then
    `awk 'length > 300 {print FILENAME": "FNR}' frontend/src/pages/analysis/ResearchPage.tsx frontend/src/pages/analysis/research/PortfolioSection.tsx frontend/src/lib/research.ts`
    must print nothing. If `/tmp/prettier3` is missing, report it; do not hand-reformat.
17. State in the report the full list of files you created or modified.

**Planner-run** (coders skip these, and write "browser checks left for the Planner" under Not done):

18. `SMOKE_WAIT_MS=12000 node contracts/tools/smoke-render.mjs research` shows no `EXCEPTION:`
    line. PAGE TEXT contains `Research`, `Portfolio`, `Holdout, last 12 months` and `In-sample`.
19. The same command against Gunnar's local backend, with a BEC-like `SMOKE_POSITIONS`, shows eight
    mode labels and `Current portfolio` in PAGE TEXT.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it**, at a laptop width (~1280 px) and a narrow one (~800 px).
Restart the backend first: it needs 0171's route.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

Open the BEC portfolio, then click **Research**. Look for:
- the table loads on its own, without clicking Run;
- green appears only in the holdout columns;
- the cost column moves when you drag the trading-cost slider;
- at ~800 px the table scrolls sideways rather than squashing.

## Open questions — do not resolve yourself

- None known. If 0171's actual response differs from the types above, stop and report `BLOCKED`
  with the difference. Do not adapt the types to it.
