# Contract 0097 — Generalise TickerChart into SeriesChart

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

Replace `TickerChart` with `SeriesChart`. It draws the same panels from a plain `{date, value}` series
plus a title, so Holdings can reuse it for the portfolio line (contract 0098). **/tickers must look and
behave exactly as it does now.**

## Why

`TickerChart` takes a ticker and `PriceBar[]`, but a portfolio has neither. The chart only ever used
two things from them: the ticker, for the title, and `adj_close`, for the line. This contract changes
the props to exactly those two things and nothing more. The only additions are a value formatter and
an axis width, which 0098 needs for a dollar axis. Their defaults reproduce today's output.

## Files

Create:
- `frontend/src/components/SeriesChart.tsx`: the current contents of `TickerChart.tsx`, with only
  the changes listed under Interface.

Delete:
- `frontend/src/components/TickerChart.tsx`: use `rm`, not `git rm`.

Modify:
- `frontend/src/pages/TickerPage.tsx`: lazy-import `SeriesChart` instead, and pass the new props.
- `frontend/src/lib/chart.ts`: in `PRICE_PANEL_KEYS`, change `'adj_close'` to `'value'`. Nothing else.
- `frontend/src/lib/chart.test.ts`: rename every `adj_close` object key to `value`. Change no values,
  add no tests and delete no tests.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. It is a snapshot of other working software kept so its behaviour can be compared against this
rebuild, and an edited reference stops being evidence of anything. `.claude/settings.json` denies
Edit and Write there. That deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

### `SeriesChart.tsx`: the complete list of changes from `TickerChart.tsx`

1. The imports: `import type { IndicatorsResponse } from '../api/client'`. `PriceBar` is no longer
   imported.
2. Replace `TickerChartProps` with:
   ```ts
   export interface SeriesPoint {
     date: string
     value: number
   }

   interface SeriesChartProps {
     title: string
     valueName: string
     points: SeriesPoint[]
     indicators?: IndicatorsResponse
     formatValue?: (value: number) => string
     valueAxisWidth?: number
   }
   ```
3. `ChartPoint`: rename the `adj_close: number` field to `value: number`.
4. Signature: `export default function SeriesChart({ title, valueName, points, indicators, formatValue = formatPrice, valueAxisWidth = 56 }: SeriesChartProps)`.
5. Delete the line `const points = bars.filter(...)`. Callers now pass clean points. `chartData` maps
   over the `points` prop and builds `{ date: point.date, value: point.value }` in place of
   `{ date: bar.date, adj_close: bar.adj_close }`. The rest of that map is unchanged.
6. The price-panel `<h3>` renders `{title}`.
7. The price `<Area>`: `dataKey="value"` and `name={valueName}`.
8. The price panel's `<ChartYAxis domain={priceYDomain} tickFormatter={formatValue} width={valueAxisWidth} />`
   and `<Tooltip content={<ChartTooltip format={formatValue} />} />`.
9. The MACD panel's `<ChartYAxis domain={['auto', 'auto']} width={valueAxisWidth} tickFormatter={formatValue} />`.
   Its tooltip stays `value.toFixed(2)`.

**Everything else stays byte-for-byte the same**: the RSI, ADX, Stochastic and OBV panels, all colours,
dash patterns, heights, `ChartTooltip`, `ChartXAxis` and `ChartYAxis`.

### `TickerPage.tsx`

```tsx
const SeriesChart = lazy(() => import('../components/SeriesChart'))
// replaces chartBars:
const chartPoints = filteredBars.flatMap((bar) => (bar.adj_close === null ? [] : [{ date: bar.date, value: bar.adj_close }]))
// render:
<SeriesChart title={`${symbol} — Price & Moving Averages`} valueName="Price" points={chartPoints} indicators={indicatorData} />
```

The two `chartBars.length` checks become `chartPoints.length`. The dash is an em dash (—), the same
character the old `<h3>` used.

## Out of scope

- No shaded ranges, portfolio props or Holdings changes. Those are 0098.
- Don't restyle, reorder or re-colour any panel.
- Don't touch `downsample` or `priceDomain`'s logic.
- Don't change the indicator toggles, signals or ATR card on TickerPage.

## Acceptance criteria

1. `test ! -e frontend/src/components/TickerChart.tsx && echo gone` prints `gone`.
2. `grep -rn "TickerChart" frontend/src` prints nothing.
3. `grep -n "adj_close" frontend/src/components/SeriesChart.tsx frontend/src/lib/chart.ts frontend/src/lib/chart.test.ts`
   prints nothing.
4. `grep -c "formatValue" frontend/src/components/SeriesChart.tsx` prints **4 or more**.
5. `grep -c "valueAxisWidth" frontend/src/components/SeriesChart.tsx` prints **3 or more**.
6. `grep -n "Price & Moving Averages" frontend/src/pages/TickerPage.tsx` prints exactly one line.
7. `npm run build` exits 0.
8. `npm run test` passes with **75** tests. The count is unchanged, because this is a rename.
9. `npm run lint` reports only the two pre-existing warnings, `HelpSidebar.tsx:44` and
   `UniversePage.tsx:60`.
10. The diff against the old component is limited to the nine listed changes. The audit reads the
    output of the `diff` command below line by line.

If any criterion cannot be met as written, for example because it contradicts another criterion or
the Files list, **report `BLOCKED` and name the conflict**. That is the correct answer. Don't bend the
code or the check to make it pass.

## Verification to run and paste

Run each of these from the repo root and paste the **complete, verbatim** output into the report,
including failures. Don't summarise, trim or clean up.

```bash
test ! -e frontend/src/components/TickerChart.tsx && echo gone
grep -rn "TickerChart" frontend/src
grep -n "adj_close" frontend/src/components/SeriesChart.tsx frontend/src/lib/chart.ts frontend/src/lib/chart.test.ts
grep -c "formatValue" frontend/src/components/SeriesChart.tsx
grep -c "valueAxisWidth" frontend/src/components/SeriesChart.tsx
grep -n "Price & Moving Averages" frontend/src/pages/TickerPage.tsx
git show HEAD:frontend/src/components/TickerChart.tsx | diff - frontend/src/components/SeriesChart.tsx
(cd frontend && npm run build 2>&1 | tail -8)
(cd frontend && npm run test 2>&1 | tail -8)
(cd frontend && npm run lint 2>&1 | tail -8)
git status --short
```

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** This is meant to be a no-op on /tickers, and only your eyes can
confirm that.

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173/ticker/AAPL` (or any stored ticker) at about 1280px wide and check:
- The price panel title reads "AAPL — Price & Moving Averages", and the legend's first entry is
  "Price".
- The y-axis labels look as they did, with two decimals and no `$`.
- Tick EMA, Bollinger, Donchian, ADX, Stochastic and OBV one at a time. Each overlay or panel appears
  as before.
- Change the Start date to two years back. The line redraws.

## Open questions

None. If the old file's contents don't match the line numbers or shapes described here, for example
because it was edited since 2026-09-24, report `BLOCKED` rather than adapting.
