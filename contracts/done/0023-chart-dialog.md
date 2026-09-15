# Contract 0023 — Price chart dialog

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Clicking a row in the Universe table opens a dialog showing that ticker's closing-price line chart,
defaulting to YTD, with range buttons for 10Y / 5Y / 1Y / YTD / 6M / 3M / 1M / 5D.

## Why

The app stores nine tickers × 2,689 daily bars and the only way to look at them is to download a
CSV. A chart is the first thing this data is actually *for*.

`REBUILD.md` recorded from the start that "no chart library — `recharts` arrives when there is
something to chart." There now is, and the old app used `recharts@^3.7.0`, so this is the documented
path rather than a new decision.

**Depends on contracts 0021 and 0022.** If `GET /universe/{ticker}/history` does not exist, or
`components/Tooltip.tsx` does not exist, stop and report `BLOCKED`.

## The mockup is the visual target

`mockup-chart-dialog.html` at the repo root is approved and **functional** — real AAPL data, working
range buttons and hover. Open it and match it.

- It is a *reference*, not a file to port. Its chart is hand-drawn SVG purely to settle layout;
  the implementation uses `recharts`.
- Where it uses a raw custom property, use the token class. Only `--color-muted`, `--radius-card`
  and `--radius-btn` have no class.
- **The mockup has no footer.** Gunnar removed the bar-count/date-span line and the Download CSV
  link: "all I want is the chart." Do not reinstate either.
- If the mockup and this contract disagree, **this contract wins** — report the discrepancy.

## Files

Create:
- `frontend/src/components/ChartDialog.tsx`
- `frontend/src/lib/ranges.ts` — pure range-slicing logic

Modify:
- `frontend/package.json` — add `recharts`
- `frontend/src/api/client.ts` — `getHistory` and its types
- `frontend/src/components/UniverseTable.tsx` — row click
- `frontend/src/pages/UniversePage.tsx` — dialog state

**Touch nothing else.** Do not modify `FilterDialog.tsx`, `AddTickerForm.tsx`, `Tooltip.tsx`,
`lib/format.ts`, `lib/filters.ts`, `globals.css`, or anything under `backend/`. If the work appears
to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `api/client.ts`

```ts
export interface PriceBar { date: string; close: number | null; adj_close: number | null }
export interface HistoryResponse { ticker: string; bars: PriceBar[] }
export async function getHistory(ticker: string): Promise<HistoryResponse>
```

Reuse the existing `request<T>` helper. **Fetch the full history once per dialog open** — roughly
161KB for 2,689 bars, measured in contract 0021 — and slice client-side. Range buttons must not
trigger network calls; instant switching is the point of having them.

### `lib/ranges.ts` — pure, no React

```ts
export type RangeKey = '10Y' | '5Y' | '1Y' | 'YTD' | '6M' | '3M' | '1M' | '5D'
export const RANGE_KEYS: RangeKey[]          // display order, 10Y first
export const DEFAULT_RANGE: RangeKey         // 'YTD'

export function rangeStart(key: RangeKey, lastBarDate: Date): Date
export function sliceRange(bars: PriceBar[], key: RangeKey, lastBarDate: Date): PriceBar[]
export function hasEnoughData(bars: PriceBar[], key: RangeKey, lastBarDate: Date): boolean
```

- **Anchor every range to the newest bar's date, not to `new Date()`.** The last bar is Friday's
  close over a weekend; anchoring to today would silently shift every window and make `5D` return
  three bars on a Monday. Passing the anchor in also keeps these functions pure and testable.
- `YTD` starts 1 January of the **last bar's** year.
- `5D` uses a **7-calendar-day** window to land ~5 trading days.
- Bars with a `null` close are **dropped** before charting — recharts renders a gap or a crash for
  nulls depending on version, and a gap in a price line is a lie. Drop, do not interpolate.
- `hasEnoughData` is `false` when a range yields fewer than 2 points.
- `10Y` against a 2016 start yields ~9.7 years; **clamp silently**, do not pad.

### `components/ChartDialog.tsx`

```tsx
interface ChartDialogProps {
  ticker: string | null        // null = closed
  entry: UniverseEntry | null  // for the header
  onClose: () => void
}
export function ChartDialog(props: ChartDialogProps): JSX.Element | null
```

Returns `null` when `ticker` is `null`. No hidden DOM.

**Layout, matching the mockup, top to bottom:**

1. **Header** — ticker in `text-brand-primary`, a muted sub-line `Name · Sector · Type`, and on the
   right the last close with the change over the **selected range** (absolute and percent, green via
   `text-brand-positive` / red via `text-brand-negative`), then a close `×`.
   The change is range-relative, not daily — switching to `5D` shows the 5-day move. That is
   deliberate and was approved.
2. **Chart** — recharts line chart, ~320px tall, responsive width.
3. **Range buttons** — eight, in `RANGE_KEYS` order, the active one `bg-brand-primary text-white`.
   A range failing `hasEnoughData` renders **disabled**, not as an empty chart.

**No footer.** No bar count, no date span, no download link.

**States:** loading (a neutral message in the chart area), error (message plus a retry), and loaded.
A failed fetch must not blank the dialog or surface an uncaught rejection.

**Closes on** the `×`, `Escape`, and a backdrop click — but **not** a click inside. Same behaviour as
`FilterDialog`; match it rather than inventing a second convention.

### Chart specifics

- Plot **`close`**, not `adj_close`. Verified 2026-09-15: with `auto_adjust=False`, yfinance's
  `Close` is already split-adjusted retroactively — AAPL's 4:1 split in August 2020 shows no
  discontinuity — so `close` is both "what the price was" and free of split cliffs. `adj_close` is
  fetched and unused for now.
- Line only. No candlesticks, no volume, no moving averages.
- Y axis auto-scales to the visible range with a small pad; **do not force a zero baseline** — it
  flattens every equity chart into a meaningless line.
- X axis labels are sparse (~5) and abbreviated.
- Hover shows a readout with the date and close. **Inside the chart the readout follows the cursor**
  — that is the correct convention for a value that changes with pointer position, and is the
  deliberate exception to contract 0022's anchored tooltips. Use recharts' `Tooltip`, not the
  project's `Tooltip` component.
- Colour the line `var(--color-primary)`; optional faint area fill beneath at low opacity.

### `UniverseTable.tsx` — row click

- The `<tr>` becomes clickable: `cursor-pointer`, a subtle `hover:bg-` row highlight, and
  `onClick` opening the dialog for that ticker.
- **The download link must not open the dialog.** Call `stopPropagation` in the anchor's `onClick`
  — otherwise clicking download both downloads *and* opens a chart. This is the single easiest bug
  to ship here.
- Keyboard: the row carries `tabIndex={0}` and opens on `Enter`. `role="button"` on the row.

### `UniversePage.tsx`

Holds `selectedTicker` state, renders `<ChartDialog>`, passes the matching entry. Nothing else
changes — not the control row, the filters, or `Update all`.

## Tooltips — required for any contract adding interactive elements

Per `REBUILD.md` and contract 0022, using the project `Tooltip` (anchored), **not** `title`:

| element | copy |
|---|---|
| Chart dialog `×` | `Close this chart` |
| Each range button | `Show the last <range>` — e.g. `Show the last 6 months`, and for YTD `Show this year so far` |
| Table row (on the ticker cell) | `Open this ticker's price chart` |

The in-chart hover readout is **not** a project tooltip — see Chart specifics.

## Out of scope

- No candlesticks, volume, indicators, moving averages, or comparison overlays.
- No zoom, pan, or brush selection.
- No date-range picker beyond the eight buttons.
- No export from the dialog — explicitly removed from the mockup.
- No fundamentals in the dialog beyond the header sub-line.
- No URL state for the open dialog.
- No changes to the backend, filters, or `Update all`.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`.**
2. `npm run build` succeeds. **Report the bundle size before and after** — recharts is a large
   dependency and the number should be on record.
3. `recharts` is the **only** dependency added — `git diff frontend/package.json` shows no other new
   entry.
4. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/ChartDialog.tsx frontend/src/lib/ranges.ts`
   matches nothing (exit 1).
5. `grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/components/ChartDialog.tsx frontend/src/lib/ranges.ts frontend/src/api/client.ts`
   matches nothing (exit 1).
6. `grep -n "stopPropagation" frontend/src/components/UniverseTable.tsx` matches on the download
   anchor.
7. `grep -rn "bar count\|Download CSV\|bars ·" frontend/src/components/ChartDialog.tsx` matches
   nothing (exit 1) — no footer.
8. `grep -n "adj_close" frontend/src/components/ChartDialog.tsx` — if present, it must not be the
   plotted series. Quote the line.
9. **`rangeStart` and `sliceRange` verified against a fixed anchor date.** There is no test framework
   here, so exercise them in a temporary script — **written to `/tmp`, not the repo, and deleted
   afterwards** — and paste the output. With `lastBarDate = 2026-09-14`: `YTD` → `2026-01-01`,
   `1Y` → `2025-09-14`, `5D` → `2026-09-07`, `10Y` → `2016-09-14`.
10. Clicking the download icon downloads **and does not open the dialog**.
11. The dialog opens on row click, defaults to **YTD**, and switching ranges triggers **no network
    request** — check the network panel.
12. `git diff --stat backend/ frontend/src/lib/format.ts frontend/src/lib/filters.ts frontend/src/components/FilterDialog.tsx frontend/src/components/AddTickerForm.tsx`
    is empty.

Criteria 10 and 11 are the ones most likely to be skipped. If a browser is unavailable, say so
plainly under "Not done."

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git diff frontend/package.json
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/ChartDialog.tsx frontend/src/lib/ranges.ts ; echo "exit=$? (1 means clean)"
grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/components/ChartDialog.tsx frontend/src/lib/ranges.ts frontend/src/api/client.ts ; echo "exit=$? (1 means clean)"
grep -n "stopPropagation" frontend/src/components/UniverseTable.tsx
grep -rn "bar count\|Download CSV\|bars ·" frontend/src/components/ChartDialog.tsx ; echo "exit=$? (1 means clean)"
git diff --stat backend/ frontend/src/lib/format.ts frontend/src/lib/filters.ts frontend/src/components/FilterDialog.tsx frontend/src/components/AddTickerForm.tsx ; echo "(empty = untouched)"
```

## Human verification — does Gunnar need to run anything?

**Yes — it is a visual, interactive contract.**

At `localhost:5173/universe`:

1. **Click a row.** The chart opens on **YTD**.
2. Cycle all eight ranges. `10Y` should show the full history back to 2016-01-04; `5D` a handful of
   points. Any range without enough data is a **disabled** button, never an empty chart.
3. Hover across the line — a readout follows the cursor showing date and close.
4. The header's change figure should **update as you switch ranges** — `5D` shows the 5-day move,
   `10Y` the ten-year move.
5. **Click a download icon.** It should download and **not** open the chart.
6. `Escape` closes; a backdrop click closes; clicking inside does not.
7. Hover a range button — the project tooltip explains it, anchored, not following the cursor.
8. Narrow to 375px — the dialog and chart stay usable.

## Open questions — do NOT resolve these yourself

- **`adj_close` as a total-return toggle.** Fetched, unused. A future decision.
- **Comparing multiple tickers on one chart.** Out of scope.
- **Persisting the selected range** between opens. Not now; every open starts at YTD.
- **Bundle size.** Record it; whether recharts is worth its weight is a later call.
