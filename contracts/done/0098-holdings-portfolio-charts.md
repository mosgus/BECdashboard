# Contract 0098 — Portfolio charts on the Holdings tab

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)
**Depends on:** 0096 (`GET /portfolio/series`) and 0097 (`SeriesChart`). Both must be accepted
first. If `frontend/src/components/SeriesChart.tsx` doesn't exist, or `backend/app/routers/portfolio.py`
doesn't exist, report `BLOCKED`.

## Goal

Add the /tickers chart experience below the holdings table on `/portfolios/:id/holdings`, drawn for
the whole portfolio. It includes:

- a date range,
- the close-only indicator toggles,
- the price, RSI and MACD panels,
- a signal-states section,
- a dollar or index y-axis chosen by the 0.5-point rule,
- a shaded, labelled flat-fill stretch.

## Why

Gunnar wants "the holdings table, then basically the whole /tickers page below it, charting the whole
portfolio". Every modelling choice is already decided and recorded in `REBUILD.md`. Read these before
starting:

- "**The portfolio value line is buy-and-hold, anchored at today, cash included.**" and all of its
  bullets, especially **"Dollars on the y-axis only when the share counts agree with the weights"**
  and **"Before a holding's first stored bar, its value is held flat"**.

The backend returns a line whose last value is 100. The frontend multiplies everything by one factor
`k`:
- In index mode, `k` makes the first visible point equal 100.
- In dollar mode, `k` makes the last point equal the dollar value.

RSI is invariant to `k`. SMA, EMA, Bollinger and MACD scale linearly. So scaling is a single multiply
and never needs a refetch.

## Files

Create:
- `frontend/src/lib/portfolioChart.ts`: pure functions (below). No React, no fetch.
- `frontend/src/lib/portfolioChart.test.ts`: literal-value tests (below).
- `frontend/src/components/PortfolioCharts.tsx`: the section. Takes `{ portfolio: Portfolio }`.

Modify:
- `frontend/src/api/client.ts`: add the `PortfolioHolding` and `PortfolioSeriesResponse` types and
  `getPortfolioSeries`.
- `frontend/src/lib/chart.ts`: add `ShadedRange` and `snapRange`.
- `frontend/src/lib/chart.test.ts`: add `snapRange` tests only.
- `frontend/src/components/SeriesChart.tsx`: add the optional `shaded` prop (below). This is the only
  change.
- `frontend/src/lib/indicators.ts`: move `SIGNAL_DESCRIPTIONS` here from `TickerPage.tsx`,
  exported, with its text unchanged.
- `frontend/src/pages/TickerPage.tsx`: delete its local `SIGNAL_DESCRIPTIONS` and import it from
  `lib/indicators`. Nothing else.
- `frontend/src/pages/analysis/HoldingsPage.tsx`: render `<PortfolioCharts portfolio={current} />`
  after the table's container `div`, inside the page's outer `div`. Nothing else. Leave the existing
  `<HelpSidebar />` and signal `<select>` alone.

**Touch nothing else.** No backend changes. If the endpoint's response doesn't match the types below,
report `BLOCKED` rather than editing the backend. If the work appears to require editing a file not on
this list, stop and report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. It is a snapshot of other working software kept so its behaviour can be compared against this
rebuild, and an edited reference stops being evidence of anything. `.claude/settings.json` denies
Edit and Write there. That deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

### `api/client.ts`

```ts
export interface PortfolioHolding {
  ticker: string
  weight: number
  first_bar: string
  last_close: number
}

export interface PortfolioSeriesResponse {
  dates: string[]
  value: number[]
  cash_value: number
  holdings: PortfolioHolding[]
  series: IndicatorSeries[]
  signals: SignalOut[]
}

export async function getPortfolioSeries(
  tickers: string[], weights: number[], cash: number, include: string[],
): Promise<PortfolioSeriesResponse>
// URLSearchParams({ tickers: tickers.join(','), weights: weights.map(String).join(','),
//                   cash: String(cash), include: include.join(',') }) → `/portfolio/series?${query}`
```

### `lib/chart.ts`

```ts
export interface ShadedRange {
  from: string
  to: string
  label: string
}

/** Snap a date range onto the dates actually rendered. The chart's x-axis is categorical and
 *  downsampled, so a ReferenceArea edge that isn't a rendered date doesn't draw. Returns
 *  [first date >= from, last date <= to], or null when either is missing or they cross. */
export function snapRange(dates: string[], from: string, to: string): [string, string] | null
```

### `SeriesChart.tsx`: one prop

- Add `shaded?: ShadedRange` to the props and the destructure.
- In the **price panel only**, after the grid and before the lines:
  1. Compute `snapRange(renderedData.map((row) => row.date), shaded.from, shaded.to)`.
  2. If it isn't null, render
     `<ReferenceArea x1={x1} x2={x2} fill="var(--color-muted)" fillOpacity={0.12} label={{ value: shaded.label, position: 'insideTopLeft', fontSize: 10, fill: 'var(--color-muted)' }} />`.
- Import `ReferenceArea` from `recharts`.

/tickers never passes `shaded`, so it's unchanged.

### `lib/portfolioChart.ts`

```ts
export const DOLLAR_WEIGHT_TOLERANCE_PP = 0.5
export const PORTFOLIO_INDICATOR_KEYS = ['ema', 'bollinger'] as const  // the optional toggles
export const PORTFOLIO_ALWAYS_ON = ['sma', 'rsi', 'macd'] as const

export type ChartMode =
  | { kind: 'dollar'; value: number }
  | { kind: 'index'; reason: 'no-shares' | 'shares-mismatch' }

export function chartMode(portfolio: Portfolio, holdings: PortfolioHolding[]): ChartMode
export function visibleStartIndex(dates: string[], start: string): number   // first index with dates[i] >= start, else -1
export function scaleFactor(mode: ChartMode, values: number[], startIndex: number): number
export function scaleSeries(series: IndicatorSeries[], k: number): IndicatorSeries[]
export function flatFillRange(holdings: PortfolioHolding[], visibleStart: string, visibleEnd: string): ShadedRange | null
export function defaultStart(holdings: PortfolioHolding[]): string
export function formatDollars(value: number): string
```

The rules:

- **`chartMode`**
  - It returns `{kind:'index', reason:'no-shares'}` when:
    - any position lacks a finite positive `shares`,
    - any position has no matching holding with a finite positive `last_close`, or
    - `100 − cashWeight` is not > 0.
  - Otherwise:
    - `V = Σ shares × last_close / ((100 − cashWeight) / 100)`.
    - For each position, `implied = shares × last_close / V × 100`.
    - If any `|implied − weight| > DOLLAR_WEIGHT_TOLERANCE_PP`, it returns
      `{kind:'index', reason:'shares-mismatch'}`.
    - Otherwise it returns `{kind:'dollar', value: V}`.
  - **Use `last_close`, never `positionPrice`.** REBUILD.md explains why.
- **`scaleFactor`**: index mode returns `100 / values[startIndex]`. Dollar mode returns
  `mode.value / values[values.length - 1]`.
- **`scaleSeries`**: multiply every point of every series by `k`, **except `key === 'rsi'`**, which is
  returned unchanged. `null` stays `null`. It returns new arrays and never mutates its input.
- **`flatFillRange`**
  - `late` is the holdings whose `first_bar > visibleStart`, sorted by `first_bar` and then by `ticker`.
  - If `late` is empty, it returns `null`.
  - Otherwise it returns:
    - `from`: `visibleStart`
    - `to`: the earlier of the last `late` `first_bar` and `visibleEnd`
    - `label`: `late.map(h => `${h.ticker} listed ${h.first_bar}`).join(', ') + '; flat before then'`
- **`defaultStart`**: the latest `first_bar` among the holdings (the youngest holding's first bar).
- **`formatDollars`**:
  - The sign goes first: `-$1.5K`.
  - If |v| ≥ 1e6, it returns `$X.XXM`.
  - If |v| ≥ 1e3, it returns `$X.XK`.
  - Otherwise it returns `$X.XX`.

### `PortfolioCharts.tsx`

- It returns `null` when `portfolio.positions` is empty.
- **Fetch.**
  - Call `getPortfolioSeries(tickers, weights, portfolio.cashWeight, include)`.
  - `include` is the sorted union of `PORTFOLIO_ALWAYS_ON` and the enabled toggles.
  - The effect's dependencies are **strings**: a joined ticker key, a joined weight key, the cash,
    and the include key. They are never the `portfolio` object, because `HoldingsPage` rebuilds it from
    localStorage on every render and an object dependency would refetch forever.
  - Use a `cancelled` guard, as `TickerPage` does.
- **Dates.**
  - `start` and `end` are `useState<string | null>(null)`.
  - The effective start is `start ?? defaultStart(data.holdings)`. The effective end is
    `end ?? data.dates.at(-1)`.
  - The Start input has `min={data.dates[0]}` and `max={effectiveEnd}`. The End input has
    `min={effectiveStart}` and `max={data.dates.at(-1)}`.
- **Visible data.**
  1. Filter the indices whose date is between the effective start and the effective end, inclusive.
     If there are none, show `No stored data in this date range.`
  2. `mode = chartMode(portfolio, data.holdings)`.
  3. `k = scaleFactor(mode, data.value, firstVisibleIndex)`.
  4. `points` is the visible `{ date, value: data.value[i] * k }`.
  5. `indicators = { ticker: 'PORTFOLIO', dates: data.dates, series: scaleSeries(data.series, k) }`.
  6. `shaded = flatFillRange(data.holdings, effectiveStart, effectiveEnd) ?? undefined`.
- **The chart.** `const SeriesChart = lazy(() => import('./SeriesChart'))`, inside `Suspense` with the
  `Loading chart…` fallback, rendered as `<SeriesChart title="Portfolio — Value & Moving Averages"
  valueName="Portfolio" points={points} indicators={indicators} shaded={shaded} formatValue={...}
  valueAxisWidth={...} />`.
  - Dollar mode uses `formatDollars` and a width of 64.
  - Index mode uses `(v) => v.toFixed(2)` and a width of 56.
- **The mode line.** Show it above the chart in muted `text-xs`. The copy is exact:
  - Dollar: `Dollars at the last close ({lastDate}), from today's share counts held unchanged. No rebalancing.`
  - Index: `Index, 100 on {firstVisibleDate}. Built from today's weights held unchanged. No rebalancing.`
  - When the reason is `shares-mismatch`, add a second line: `Share counts don't match the declared
    weights within 0.5 points, so this is shown as an index rather than dollars.`
  - When the reason is `no-shares`, add a second line: `Add a share count to every holding to see this
    in dollars.`
- **Controls.** Use the same card styling as TickerPage.
  - The Start and End date inputs.
  - An Indicators card with checkboxes for the `INDICATOR_GROUPS` entries whose key is in
    `PORTFOLIO_INDICATOR_KEYS`, labelled with the group's label.
  - Below the checkboxes, a muted note: `ATR, Donchian, ADX, Stochastic and OBV need a single
    security's high, low or volume, so they aren't drawn for a portfolio.`
- **Signals.** Add a "Signal States" section laid out like TickerPage's, using `SignalBadge` and
  `SIGNAL_DESCRIPTIONS` from `lib/indicators`.
  - Show the reading only for `rsi_threshold` (`RSI 54.21`). The MACD histogram is in index units and
    would change meaning with the scale, so don't show it.
  - Show `Last trigger {date}` as TickerPage does.
- **Loading and errors.**
  - While loading, show `Loading chart…`.
  - An `ApiError` with status 404 shows `A holding has no stored price history, so the portfolio
    can't be charted.`
  - Any other error shows `The portfolio chart could not be loaded.`

## Out of scope

- No backend changes.
- Don't change the Help sidebar's contents. Its glossary still describes the ticker page, and that's a
  separate decision for Gunnar.
- No ATR card, and no Donchian, ADX, Stochastic or OBV.
- No benchmark line, returns statistics or per-holding contribution chart.
- Don't persist the date range or toggles.
- Don't change the holdings table or the /tickers page, beyond the `SIGNAL_DESCRIPTIONS` import.
- No new dependencies.

## Acceptance criteria

1. `npm run build` exits 0.
2. `npm run test` passes. The count is 75 plus the new tests, and at least **10** are new. Grouping several `expect`s under one `it` is fine.
3. `frontend/src/lib/portfolioChart.test.ts` contains tests for these literal cases. Floats are
   compared with `toBeCloseTo(x, 2)`.
   - a. `chartMode`, with positions A weight 60 shares 10, B weight 30 shares 5, and cashWeight 10.
     - Holdings A and B both have `last_close` 54 → `{kind:'dollar'}` with value ≈ 900.
     - The same, but B has shares 6 → `{kind:'index', reason:'shares-mismatch'}` (A is implied at 56.25).
     - The same as the first, but A has `last_close` 54.4 → dollar, with value ≈ 904.44 (inside the
       tolerance).
     - The same as the first, but B has no `shares` → `{kind:'index', reason:'no-shares'}`.
   - b. `scaleFactor`: values `[80, 90, 100]`. Index with startIndex 1 gives ≈ 1.11. Dollar with
     value 900 gives 9.
   - c. `scaleSeries`: `[{key:'sma_fast', points:[null, 2]}, {key:'rsi', points:[50]}]` with k = 3 gives
     sma `[null, 6]` and rsi `[50]`, and the input arrays are unchanged afterwards.
   - d. `flatFillRange`, with holdings AAA first 2020-01-02, NEWB 2023-04-12 and NEWC 2022-01-05.
     - Visible 2021-06-01 → 2026-09-24 gives from `2021-06-01`, to `2023-04-12`, and label
       `NEWC listed 2022-01-05, NEWB listed 2023-04-12; flat before then`.
     - Visible 2023-05-01 → 2026-09-24 gives `null`.
     - Visible 2021-06-01 → 2022-06-30 gives `to` `2022-06-30`.
   - e. `defaultStart` on the same holdings gives `2023-04-12`.
   - f. `visibleStartIndex(['2024-01-02','2024-01-05'], '2024-01-03')` gives 1, and with `'2024-02-01'`
     gives -1.
   - g. `formatDollars`: `1234567` → `$1.23M`, `51234` → `$51.2K`, `904.44` → `$904.44`, and
     `-1500` → `-$1.5K`.
4. `frontend/src/lib/chart.test.ts` gains `snapRange` tests over the dates
   `['2024-01-02','2024-01-05','2024-01-09']`:
   - `('2024-01-03','2024-01-08')` gives `['2024-01-05','2024-01-05']`.
   - `('2024-01-10','2024-01-12')` gives `null`.
   - `('2024-01-01','2024-01-01')` gives `null`.
5. `grep -n "positionPrice" frontend/src/lib/portfolioChart.ts frontend/src/components/PortfolioCharts.tsx`
   prints nothing.
6. `grep -n "DOLLAR_WEIGHT_TOLERANCE_PP = 0.5" frontend/src/lib/portfolioChart.ts` prints one line.
7. `grep -nE "'(donchian|adx|stochastic|obv|atr)'" frontend/src/components/PortfolioCharts.tsx frontend/src/lib/portfolioChart.ts`
   prints nothing.
8. `grep -rn "SIGNAL_DESCRIPTIONS: Record" frontend/src` prints exactly one line, in
   `lib/indicators.ts`.
9. `grep -c "PortfolioCharts" frontend/src/pages/analysis/HoldingsPage.tsx` prints **2** (the import
   and the use).
10. `grep -n "lazy(() => import('./SeriesChart'))" frontend/src/components/PortfolioCharts.tsx` prints
    one line.
11. `grep -c "ReferenceArea" frontend/src/components/SeriesChart.tsx` prints **2 or more**.
12. `npm run lint` reports only the two pre-existing warnings, `HelpSidebar.tsx:44` and
    `UniversePage.tsx:60`.

If any criterion cannot be met as written, for example because it contradicts another criterion or
the Files list, **report `BLOCKED` and name the conflict**. That is the correct answer. Don't bend the
code or the check to make it pass.

## Verification to run and paste

Run each of these from the repo root and paste the **complete, verbatim** output into the report,
including failures. Don't summarise, trim or clean up.

```bash
(cd frontend && npm run build 2>&1 | tail -8)
(cd frontend && npx vitest run src/lib/portfolioChart.test.ts src/lib/chart.test.ts 2>&1 | tail -15)
(cd frontend && npm run test 2>&1 | tail -8)
(cd frontend && npm run lint 2>&1 | tail -8)
grep -n "positionPrice" frontend/src/lib/portfolioChart.ts frontend/src/components/PortfolioCharts.tsx
grep -n "DOLLAR_WEIGHT_TOLERANCE_PP = 0.5" frontend/src/lib/portfolioChart.ts
grep -nE "'(donchian|adx|stochastic|obv|atr)'" frontend/src/components/PortfolioCharts.tsx frontend/src/lib/portfolioChart.ts
grep -rn "SIGNAL_DESCRIPTIONS: Record" frontend/src
grep -c "PortfolioCharts" frontend/src/pages/analysis/HoldingsPage.tsx
grep -n "lazy(() => import('./SeriesChart'))" frontend/src/components/PortfolioCharts.tsx
grep -c "ReferenceArea" frontend/src/components/SeriesChart.tsx
git status --short
```

## Tooltips — required for any contract adding interactive elements

Use the `Tooltip` component, never `title`.

| element | tooltip copy |
|---|---|
| Start date input | `Limit the chart to this date range. Before a holding's first stored price, it is held flat.` |
| End date input | `Limit the chart to this date range` |
| each indicator checkbox | `Draw this indicator on the chart` |
| the "Signal States" heading | `Computed from the portfolio line's closing values. State reflects the most recent crossover or threshold event.` |

## Human verification — does Gunnar need to run anything?

**Run it against real data, and look at it.** The tests cover the maths. Only a real portfolio shows
whether the chart reads right.

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN   # kill any old backend — it predates /portfolio/series
cd backend && PATH="$PWD/.venv/bin:$PATH" uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

At about 1280px wide, open `http://localhost:5173/portfolios/<id>/holdings` for:

1. **A portfolio with shares on every holding that match the weights.**
   - The mode line says "Dollars at the last close".
   - The y-axis reads `$…K` or `$…M`.
   - The line's right end is roughly the portfolio value you'd expect. It won't match to the penny
     intraday, because it uses the last close.
2. **A weights-only portfolio.**
   - It shows "Index, 100 on …", the no-shares note appears, and the first visible point sits at
     100.
   - Move Start later. The line rebases to 100 at the new start. The RSI panel doesn't change shape or
     values. The MACD panel changes scale only.
3. **Flat fill.** Use a portfolio holding something listed after 2020, or add one.
   - The default Start is that listing date, with no shading.
   - Move Start earlier. A grey band appears with "TICKER listed YYYY-MM-DD; flat before then".
4. Tick EMA and Bollinger. Both overlays appear, and no Donchian, ADX, Stochastic or OBV toggle
   exists.
5. Signal States shows three rows, with an RSI reading and no MACD histogram number.
6. /tickers still has its Signal States descriptions, so the moved constant reached it.

## Open questions

- **The default start produces long charts.** History is stored from 2020, so for most portfolios
  "youngest holding's first bar" means about 6.7 years. /tickers defaults to one year. This contract
  follows the approved rule. If Gunnar wants `max(youngest first bar, one year ago)` instead, it's a
  one-line change in `defaultStart`'s caller. **Don't make that change unilaterally.**
- If the 0096 response shape differs from the types above, report `BLOCKED`.
