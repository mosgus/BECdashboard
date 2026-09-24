# Report 0101 — Net return for the chart's date range

**Outcome:** accepted
**Agent:** haiku
**Audited by:** planner (opus), 2026-09-24

## Re-run verification (planner)

| # | Criterion | Result |
|---|---|---|
| 1 | `npm run build` exits 0 | ✓ built |
| 2 | ≥94 tests | ✓ 96 passed (7 files) |
| 3 | literal rangeReturn cases | ✓ all six cases present in chart.test.ts, including the `100.004 → '0.00%' flat` rounding case |
| 4 | `export function rangeReturn` | ✓ chart.ts:14 |
| 5 | `rangeReturn(points)` | ✓ SeriesChart.tsx:120. Uses the un-downsampled prop |
| 6 | renderedData count unchanged | ✓ 9 before, 9 after |
| 7 | `key={current.id}` | ✓ HoldingsPage.tsx:223 |
| 8 | TickerPage / PortfolioCharts untouched | ✓ empty diff |
| 9 | lint | ✓ only UniversePage.tsx:60 and HelpSidebar.tsx:44 |

## Diff review

- `rangeReturn` reuses `priceChange` as specified. It adds no second percentage formatter.
- The Tooltip alias `HoverTooltip` leaves the recharts `Tooltip` import intact.
- The date range is handled correctly on both pages:
  - TickerPage builds `points` from `filteredBars`, which is filtered to `start <= date <= end` at TickerPage.tsx:95.
  - PortfolioCharts passes only the visible points.
- Files changed are exactly the four listed. There are no deviations.

## Outstanding

Gunnar's browser checks (Human verification §1–3) haven't been done. In particular: the weekend Start snapping, the index-mode percentage equalling the last value minus 100, and portfolio switching resetting the range.
