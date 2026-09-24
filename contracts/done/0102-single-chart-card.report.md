# Report 0102 — Date range, indicators and chart in one card

**Outcome:** accepted
**Agent:** haiku
**Audited by:** planner (opus), 2026-09-24

## Re-run verification (planner)

- Build passes. 96 tests pass, the same number as before. Lint shows only the two pre-existing warnings.
- Grep counts, before → after, for each file:

| pattern | TickerPage | PortfolioCharts |
|---|---|---|
| card radius | 6 → 4 | 6 → 4 |
| `border-b border-brand-border` | 1 → 2 | 1 → 2 |
| `type="date"` | 2 → 2 | 2 → 2 |
| `toggleIndicator(group.key)` | 1 → 1 | 1 → 1 |
| `<SeriesChart` | 1 → 1 | 1 → 1 |
| `Loading chart…` | 2 → 2 | 2 → 2 |
| `No stored data in this date range.` | 1 → 1 | 1 → 1 |

## Diff review

`git diff -w` shows only this, in both files:
- the three section wrappers are replaced by one section
- a controls `div` with a `border-b` divider is added
- a dates `div` and an indicators `div` (`flex-1 min-w-64`) are added

No inner content, handler, tooltip or copy changed. The loading and error early returns in
PortfolioCharts are unchanged. No other file was touched.

## Outstanding

Gunnar still needs to check the layout in a browser at about 1280px and about 700px.
