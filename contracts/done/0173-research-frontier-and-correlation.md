# Contract 0173 — Portfolio pill: efficient frontier with all eight modes, and the correlation heatmap

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

**Depends on 0172.** Do not start until 0172 is accepted.

## Goal

After this contract, the Research → Portfolio pill shows two more cards below the comparison table:
1. **Efficient frontier.** The frontier curve and the random-portfolio cloud from 0171's
   response, with **all eight optimizer modes and the current portfolio plotted as labelled points**.
2. **Correlation.** A heatmap of the holdings' pairwise correlations, in the cluster order the
   backend returns.

## Why

Step 1 of the Research tab, finishing the Portfolio pill (REBUILD.md, 2026-10-26 decisions).
Read `main`'s versions first: `git show main:frontend/app/research/portfolio/page.tsx`. They are
`CorrelationHeatmap` and the `ScatterChart` block.

- **Frontier.** Historical Optimize already draws a frontier, but with one optimized point.
  Gunnar kept the frontier here **only because** it shows all eight modes at once, which no
  other tab does. Without the mode points, this card is a duplicate and should not exist.
- **Correlation.** This is new to the rebuild; no other tab shows it. `main` used fixed Tailwind
  reds and blues (`bg-red-500`, `bg-blue-300`, …), which ignore the theme. Here the colour comes
  from theme tokens, so light and dark both work.

## Files

Create:
- `frontend/src/components/CompareFrontierChart.tsx`: a recharts scatter, default export, lazy-loaded.
- `frontend/src/components/CorrelationHeatmap.tsx`: a plain HTML table, with no recharts.

Modify:
- `frontend/src/lib/research.ts`: add the helpers below.
- `frontend/src/lib/research.test.ts`: add tests for them.
- `frontend/src/pages/analysis/research/PortfolioSection.tsx`: render the two cards below the table.

**Touch nothing else.** `FrontierChart.tsx`, `lib/optimize.ts` and `OptimizePage.tsx` are not
edited. Historical Optimize's frontier must not change. If the work appears to require editing
another file, stop and report `BLOCKED`.

`reference files/` and the `main` branch are read-only.

## Interface

### `lib/research.ts` additions

```ts
export const SHORT_MODE_LABELS: Record<OptimizeMode, string> = {
  equal_weight: 'Equal', min_variance: 'Min Var', max_sharpe: 'Max Sharpe', risk_parity: 'Risk Parity',
  max_sortino: 'Max Sortino', min_cvar: 'Min CVaR', max_diversification: 'Max Div', target_volatility: 'Target Vol',
}

export interface CompareFrontierPoint { vol: number; ret: number; label: string; name: string }
export interface CompareFrontierData {
  curve: { vol: number; ret: number }[]
  cloud: { vol: number; ret: number }[]
  current: CompareFrontierPoint | null      // label 'Current', name 'Current portfolio'
  modes: CompareFrontierPoint[]             // label SHORT_MODE_LABELS[mode], name modeLabel(mode)
}

export function compareFrontierData(response: CompareResponse): CompareFrontierData | null
// null when response.frontier is null. All vol/ret are × 100 (percent units, as frontierChartData does).
// modes: response.modes in order, skipping any with point === null. current: null when current.point is null.

export function compareFrontierNote(frontier: CompareFrontier): string | null
// Same wording as lib/optimize's frontierNote. Copy the template string; do not import and cast.

export function correlationCellBackground(rho: number): string
// rho >= 0: `color-mix(in srgb, var(--color-primary) ${Math.round(Math.abs(rho) * 60)}%, transparent)`
// rho <  0: `color-mix(in srgb, var(--color-accent) ${Math.round(Math.abs(rho) * 60)}%, transparent)`
// The 60% cap keeps text readable at |rho| = 1 in both themes.

export function correlationNote(correlation: Correlation): string
// `Daily returns ${start} → ${end} (${n_returns} days).`
// + (limited_by ? ` Starts when ${limited_by} first has prices.` : '')
// + (excluded.length ? ` Left out (no price movement): ${excluded.join(', ')}.` : '')
```

`OptimizeMode` and `modeLabel` are imported from `lib/optimize`. A `mode` string from the
response that is not an `OptimizeMode` falls back to the raw string for both `label` and `name`.

### `CompareFrontierChart.tsx`

`export default function CompareFrontierChart({ data, size = 'inline' }: { data: CompareFrontierData; size?: 'inline' | 'expanded' })`

- Same axes, grid, height classes, tick formatters, margins and cloud/curve series as
  `FrontierChart.tsx`. Reading it and matching it is the point.
- **Mode points:** one `Scatter` named `Optimizers`, filled `var(--color-primary)`, with a
  recharts `LabelList` showing `label` above each point.
- **Current:** one `Scatter` named `Current`, filled `var(--color-accent)`, with a larger marker
  than the mode points. It is drawn **after** the mode points so it sits on top.
- The tooltip for any mode or current point shows `name`, then `Vol x.x%`, then `Return x.x%`.
- No legend entry per mode. The legend shows: Random portfolios, Efficient frontier, Optimizers, Current.

### `CorrelationHeatmap.tsx`

`export function CorrelationHeatmap({ correlation }: { correlation: Correlation }): JSX.Element`

- A `<table>` inside `overflow-x-auto`.
- Column headers are the tickers, rotated vertically as `main` does
  (`writingMode: 'vertical-lr'`, `transform: 'rotate(180deg)'`). Row headers are the tickers.
  Both use `correlation.tickers` order.
- Each off-diagonal cell shows `rho.toFixed(2)` with `tabular-nums`, background
  `correlationCellBackground(rho)` via `style`, and text in the normal foreground colour.
  **Diagonal cells are empty**, with no background.
- Below the table, a two-swatch legend: a swatch of `correlationCellBackground(1)` labelled
  `Move together (+1)`, and a swatch of `correlationCellBackground(-1)` labelled `Move opposite (−1)`.

### `PortfolioSection.tsx` placement

Below the comparison table, in this order, each in the same card style the page already uses:

1. **Efficient frontier.** Use `ExpandableChart` exactly as `OptimizePage.tsx` wraps `FrontierChart`
   (`title="Efficient frontier"`, render-prop `expanded`), with `CompareFrontierChart` lazy-loaded
   inside `Suspense`. Under it, in muted `text-xs`:
   > In-sample: the curve and every point use the same prices the optimizers were fit on. The comparison table's holdout columns are the out-of-sample check.

   Then `compareFrontierNote(...)` when non-null. When `compareFrontierData(response)` is `null`,
   show `The efficient frontier could not be computed for this run.` instead of the chart.
2. **Correlation.** Use the heading `Correlation`. Then this explainer, verbatim:
   > Ordered so holdings that move together sit next to each other. A block of dark cells is a group that will tend to fall at the same time.

   Then `<CorrelationHeatmap>`, then `correlationNote(...)` in muted `text-xs`. When
   `response.correlation` is `null`, show `Correlation needs at least two holdings with price movement over a common window.`

## Out of scope

- Any change to `FrontierChart.tsx`, including exporting its `markerShape`. Write what you need
  in `CompareFrontierChart.tsx`.
- Clicking a mode point or a heatmap cell to do anything. They are not interactive, so no
  tooltips are needed on cells. The chart's hover tooltip is recharts', not ours.
- Plotting holdout results on the frontier. The frontier is in-sample by definition.
- Risk-contribution output (dropped 2026-10-26).
- New dependencies.

## Tooltips

This contract adds one interactive element, `ExpandableChart`'s expand control, and it brings
its own tooltip. Add no others. Do not use `title=` anywhere.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

New tests in `research.test.ts`, with literal fixtures:

1. `compareFrontierData` on a response with `frontier.points = [{vol: 0.1, ret: 0.05}]`,
   `current.point = {vol: 0.2, ret: 0.08}`, and modes `equal_weight` (point `{vol: 0.15, ret: 0.06}`)
   and `min_variance` (point `null`) gives:
   - `curve` `[{vol: 10, ret: 5}]` (`toBeCloseTo` per field);
   - `current` with `label === 'Current'` and `vol` close to `20`;
   - `modes` of length **1**, with `label === 'Equal'` and `name === modeLabel('equal_weight')`.
2. `compareFrontierData` returns `null` when `frontier` is `null`.
3. `correlationCellBackground(1)` contains `var(--color-primary) 60%`.
   `correlationCellBackground(-0.5)` contains `var(--color-accent) 30%`.
   `correlationCellBackground(0)` contains ` 0%`.
4. `correlationNote` with `limited_by: 'F'` and `excluded: ['Y']` contains both `Starts when F first has prices.` and `Left out (no price movement): Y.`
   With `limited_by: null` and `excluded: []`, it contains neither `Starts when` nor `Left out`.

Global:

5. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
6. `cd frontend && npm run test` passes. The count is 0172's accepted count plus the tests you
   added, in 26 files. Report both.
7. `cd frontend && npm run build` exits 0, and `recharts` stays out of the main entry chunk:
   `CompareFrontierChart` is imported only via `lazy(() => import(...))`. Check with
   `grep -n "CompareFrontierChart" frontend/src/pages/analysis/research/PortfolioSection.tsx`,
   which must show only the `lazy(` line and JSX uses.
8. `cd frontend && npm run lint` shows the same 2 known warnings and nothing new.
9. `grep -rn "bg-red-\|bg-blue-" frontend/src/components/CorrelationHeatmap.tsx` prints nothing.
10. `grep -n "title=" frontend/src/components/CompareFrontierChart.tsx frontend/src/components/CorrelationHeatmap.tsx frontend/src/pages/analysis/research/PortfolioSection.tsx` prints nothing.
11. `grep -c "LabelList" frontend/src/components/CompareFrontierChart.tsx` ≥ 1.
12. Run `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write`
    on the two **created** files. Then
    `awk 'length > 300 {print FILENAME": "FNR}' frontend/src/components/CompareFrontierChart.tsx frontend/src/components/CorrelationHeatmap.tsx frontend/src/pages/analysis/research/PortfolioSection.tsx`
    must print nothing. If `/tmp/prettier3` is missing, report it; do not hand-reformat.
13. State in the report the full list of files you created or modified.

**Planner-run** (coders skip these, and write "browser checks left for the Planner" under Not done):

14. `SMOKE_WAIT_MS=12000 node contracts/tools/smoke-render.mjs research` shows no `EXCEPTION:`
    line. PAGE TEXT contains `Efficient frontier`, `Correlation` and `Move together (+1)`.
15. `SMOKE_EVAL` over `.recharts-wrapper text` lists at least the eight short mode labels.
16. `node contracts/tools/smoke-render.mjs optimize` still renders Historical Optimize's frontier
    without an exception.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it**, in both light and dark themes, on the BEC portfolio.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

Research → Portfolio, scroll below the table. Look for:
- **Labels:** are the eight mode labels readable? Max Sharpe and Max Sortino often land on almost the same point. Is that overlap tolerable, or does it need a different treatment?
- **Heatmap, both themes:** is the text readable at the darkest cells?
- **Heatmap order:** do obviously related holdings sit next to each other (e.g. XLK near MS, GLD apart)?

## Open questions — do not resolve yourself

- None known. If labels overlapping is unreadable, **report it**. Do not invent a collision-avoidance
  scheme; Gunnar decides the treatment.
