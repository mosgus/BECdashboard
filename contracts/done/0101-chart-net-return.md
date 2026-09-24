# Contract 0101 — Net return for the chart's date range

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

The price panel of `SeriesChart` shows **Net return**, a signed percentage coloured green or red, and
the two dates it spans. Both /tickers and the Holdings portfolio chart use `SeriesChart`, so both get
it from one change. It is computed from the first and last points in the chart's current Start/End
range.

## Why

Gunnar asked for this 2026-09-24. It is also what the removed basis date (0095) was trying to give:
"how much did this return since X". Here X is the chart's own Start date.

Four facts decide the design:
- **It must use the un-downsampled `points` prop, not `renderedData`.** Downsampling keeps every
  `step`-th row. Computing from the rendered rows would use a date near Start instead of Start
  itself.
- **Both lines are drawn from adjusted closes, so the return includes reinvested dividends.** It
  includes no fees or taxes, and the tooltip says so.
- **On the portfolio the number doesn't depend on the scaling.** Index and dollar modes differ only by
  a constant multiplier, so the percentage is the same in both. It is the return of today's allocation
  held unchanged, as the mode line already says.
- **Start and End can fall on non-trading days.** The label shows the dates of the points actually
  used, not the dates typed in.

`priceChange` in `lib/change.ts` already computes a percentage change, with sign and direction taken
from the rounded value and no division by zero. Reuse it. Don't write a second percentage formatter.

This contract also adds `key={current.id}` to `<PortfolioCharts>`. That was deferred from 0098's
audit: switching portfolios otherwise keeps the old date range and toggles, and briefly draws the old
line.

## Files

Modify:
- `frontend/src/lib/chart.ts`: add `RangeReturn` and `rangeReturn`.
- `frontend/src/lib/chart.test.ts`: add `rangeReturn` tests only.
- `frontend/src/components/SeriesChart.tsx`: render the net return in the price panel's header.
- `frontend/src/pages/analysis/HoldingsPage.tsx`: change `<PortfolioCharts portfolio={current} />`
  to `<PortfolioCharts key={current.id} portfolio={current} />`. Nothing else.

**Touch nothing else.** In particular, don't touch `TickerPage.tsx` or `PortfolioCharts.tsx`, which
both get the feature through `SeriesChart`. If the work appears to require editing a file not on this
list, stop and report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. It is a snapshot of other working software kept so its behaviour can be compared against this
rebuild, and an edited reference stops being evidence of anything. `.claude/settings.json` denies
Edit and Write there. That deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

### `lib/chart.ts`

```ts
import { priceChange } from './change'
import type { ChangeDirection } from './change'

export interface RangeReturn {
  label: string            // e.g. '+10.00%', from priceChange
  direction: ChangeDirection
  from: string             // date of the first point
  to: string               // date of the last point
}

/** Return from the first to the last point. null with fewer than two points, or when
 *  priceChange can't compute a percent (a zero first value). */
export function rangeReturn(points: ReadonlyArray<{ date: string; value: number }>): RangeReturn | null
```

The implementation:
1. If `points.length < 2`, return `null`.
2. Otherwise `const change = priceChange(last.value, first.value)`.
3. If `change.percent === null`, return `null`.
4. Otherwise return `{ label: change.label, direction: change.direction, from: first.date, to: last.date }`.

### `SeriesChart.tsx`

- Add `const netReturn = rangeReturn(points)` next to `renderedData`. **The argument is the `points`
  prop.**
- Replace the price panel's `<h3 className="mb-2 text-sm font-semibold">{title}</h3>` with:

```tsx
<div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
  <h3 className="text-sm font-semibold">{title}</h3>
  {netReturn !== null && (
    <Tooltip label="Change in the line from the first to the last date shown. Uses adjusted closes, so dividends are included. No fees or taxes.">
      <span className="text-xs text-[var(--color-muted)]">
        Net return{' '}
        <span className={`text-sm font-semibold tabular-nums ${RETURN_COLOR[netReturn.direction]}`}>{netReturn.label}</span>
        {' '}· {netReturn.from} → {netReturn.to}
      </span>
    </Tooltip>
  )}
</div>
```

- Define `const RETURN_COLOR: Record<ChangeDirection, string> = { up: 'text-brand-positive', down: 'text-brand-negative', flat: 'text-[var(--color-muted)]' }`
  at module level.
- This `Tooltip` is the project's `Tooltip` from `./Tooltip`. SeriesChart already imports recharts'
  `Tooltip` under that name, so import ours as `import { Tooltip as HoverTooltip } from './Tooltip'`
  and use `<HoverTooltip>` in the snippet above. Don't rename recharts' import.

Nothing else in SeriesChart changes.

## Out of scope

- No dollar gain figure. The request is for a percentage only.
- No annualised return, drawdown or benchmark comparison.
- Don't change the RSI, MACD or other panels.
- Don't change `priceChange`.
- No persistence of anything.

## Acceptance criteria

1. `npm run build` exits 0.
2. `npm run test` passes with **94 or more** tests (90 before, plus at least 4 new).
3. `frontend/src/lib/chart.test.ts` has `rangeReturn` tests for these literal cases:
   - `[{date:'2024-01-02',value:100},{date:'2024-01-03',value:105},{date:'2024-01-04',value:110}]`
     → `{ label: '+10.00%', direction: 'up', from: '2024-01-02', to: '2024-01-04' }`
   - `[{date:'2024-01-02',value:100},{date:'2024-01-03',value:90}]` → label `-10.00%`, direction `down`
   - `[{date:'2024-01-02',value:100},{date:'2024-01-03',value:100.004}]` → label `0.00%`, direction `flat`
   - a single point → `null`; `[]` → `null`; first value `0` → `null`
4. `grep -n "export function rangeReturn" frontend/src/lib/chart.ts` prints one line.
5. `grep -n "rangeReturn(points)" frontend/src/components/SeriesChart.tsx` prints one line. This
   proves the un-downsampled series is used.
6. `grep -c "renderedData" frontend/src/components/SeriesChart.tsx` prints the same count as before
   the change. Run `git show HEAD:frontend/src/components/SeriesChart.tsx | grep -c renderedData` for
   the baseline, and paste both numbers.
7. `grep -n "key={current.id}" frontend/src/pages/analysis/HoldingsPage.tsx` prints one line.
8. `git diff --stat -- frontend/src/pages/TickerPage.tsx frontend/src/components/PortfolioCharts.tsx`
   prints nothing.
9. `npm run lint` reports only the two pre-existing warnings, `HelpSidebar.tsx:44` and
   `UniversePage.tsx:60`.

If any criterion cannot be met as written, for example because it contradicts another criterion or
the Files list, **report `BLOCKED` and name the conflict**. That is the correct answer. Don't bend the
code or the check to make it pass.

## Verification to run and paste

Run each of these from the repo root and paste the **complete, verbatim** output into the report,
including failures. Don't summarise, trim or clean up.

```bash
(cd frontend && npm run build 2>&1 | tail -4)
(cd frontend && npx vitest run src/lib/chart.test.ts 2>&1 | tail -12)
(cd frontend && npm run test 2>&1 | tail -5)
(cd frontend && npm run lint 2>&1 | tail -6)
grep -n "export function rangeReturn" frontend/src/lib/chart.ts
grep -n "rangeReturn(points)" frontend/src/components/SeriesChart.tsx
git show HEAD:frontend/src/components/SeriesChart.tsx | grep -c renderedData
grep -c "renderedData" frontend/src/components/SeriesChart.tsx
grep -n "key={current.id}" frontend/src/pages/analysis/HoldingsPage.tsx
git diff --stat -- frontend/src/pages/TickerPage.tsx frontend/src/components/PortfolioCharts.tsx
git diff --stat
```

## Tooltips — required for any contract adding interactive elements

The net return isn't interactive, but it gets an explanatory tooltip, as the Signal States headings
do.

| element | tooltip copy |
|---|---|
| Net return readout | `Change in the line from the first to the last date shown. Uses adjusted closes, so dividends are included. No fees or taxes.` |

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.**

```bash
cd frontend && npm run dev
```

At about 1280px wide:
1. On `/ticker/AAPL`:
   - The right side of the price-panel header reads "Net return +x.xx% · YYYY-MM-DD → YYYY-MM-DD".
   - It's green if up and red if down.
   - Move Start and End. The number and dates update. A weekend Start shows the next trading day.
2. On a portfolio's Holdings tab:
   - The same readout appears.
   - In index mode, the percentage equals the line's last value minus 100.
   - For a portfolio that shows dollars, the percentage matches what you'd compute from the first
     and last dollar values.
3. Switch between two portfolios using the portfolio tabs or selector. The second one opens on its own
   default date range, not the first one's.

## Open questions

None. If `Tooltip` from `./Tooltip` doesn't accept a non-interactive child, or the name clash can't be
resolved with the alias above, report `BLOCKED`.
