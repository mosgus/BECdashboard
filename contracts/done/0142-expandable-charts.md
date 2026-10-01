# Contract 0142 — Open any analysis chart in a larger dialog

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Every chart on `/ticker/:symbol` and on the Portfolios tabs has an **Expand** button. The button
opens the same chart, with the same data, in a large modal dialog. The four charts:

| where | component | call site |
|---|---|---|
| `/ticker/:symbol` | `SeriesChart` | `pages/TickerPage.tsx` |
| Holdings tab | `SeriesChart` | `components/PortfolioCharts.tsx` |
| Optimize tab | `OptimizeChart` | `pages/analysis/OptimizePage.tsx` |
| Outlook tab (CAPM) | `CapmChart` | `pages/analysis/outlook/CapmSection.tsx` |

## Why

Every chart is 22rem tall, and `SeriesChart`'s indicator sub-panes are 12rem. With several overlays
on, or multi-year ranges, that's too cramped to read. Gunnar asked for a larger view in a popup.

Decided while drafting (2026-10-01):

- **An explicit button, not click-anywhere-on-the-chart.** A clickable plot area can't be found by
  looking at it or reached by keyboard. On touch screens, tapping to read a recharts tooltip would
  open the dialog instead.
- **The dialog re-renders the chart component with the same props.** It isn't a DOM clone or a
  screenshot. The data is already in memory, so nothing is refetched. The page's controls (date
  range, indicator toggles, optimizer settings) stay on the page. The dialog is view-only, and it
  re-renders when page state changes.
- **The larger view shows more points.** `downsample` caps every chart at `MAX_CHART_POINTS = 400`.
  A dialog that stretches the same 400 points over a wider plot is bigger but no more detailed. The
  expanded `SeriesChart` uses a higher cap.

## Files

Create:
- `frontend/src/components/ExpandableChart.tsx`: the button plus the dialog.

Modify:
- `frontend/src/lib/chart.ts`: add `export const EXPANDED_CHART_POINTS = 1200` next to
  `MAX_CHART_POINTS`.
- `frontend/src/components/SeriesChart.tsx`: add the `size` prop.
- `frontend/src/components/OptimizeChart.tsx`: add the `size` prop.
- `frontend/src/components/CapmChart.tsx`: add the `size` prop.
- `frontend/src/pages/TickerPage.tsx`, `frontend/src/components/PortfolioCharts.tsx`,
  `frontend/src/pages/analysis/OptimizePage.tsx`, `frontend/src/pages/analysis/outlook/CapmSection.tsx`:
  wrap the chart in `ExpandableChart`.

**Touch nothing else.** `ChartDialog.tsx` (the Universe page's per-ticker dialog) and every other
dialog stay as they are. If the work appears to require editing any other file, stop and report
`BLOCKED` instead.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

### `ExpandableChart`

```tsx
interface ExpandableChartProps {
  /** Dialog heading and aria-label. */
  title: string
  /** Rendered once inline (expanded = false) and again inside the open dialog (expanded = true). */
  children: (expanded: boolean) => ReactNode
}
export function ExpandableChart({ title, children }: ExpandableChartProps): JSX.Element
```

- **It must not import `recharts`,** directly or through any chart component. It's a main-bundle
  component, and `REBUILD.md` ("recharts is lazy-loaded; the launch page must never pull it")
  forbids recharts there. Charts reach it only through the `children` render prop.
- **Inline:** a `flex justify-end` row with the Expand button, then `children(false)`. Put the button
  on its own row. Don't overlay it on the chart: `SeriesChart`'s header row already uses its right
  edge for the Net return figure.
- **Button:** a small icon button (`⤢` or an inline SVG, your choice) with an `aria-label` of
  `Expand chart`, wrapped in `Tooltip` (copy below). No `title` attribute.
- **Dialog**, open while local state `open` is true:
  - Portaled with `createPortal(…, document.body)`. Some chart cards are `overflow-hidden`, and the
    dialog must escape them.
  - Follow `FilterDialog.tsx`'s structure and classes: a `fixed inset-0 bg-overlay … z-[100]`
    backdrop; an inner panel with `role="dialog"`, `aria-modal="true"`, `aria-label={title}`, and
    `tabIndex={-1}`, focused when it opens; Escape closes it; a click on the backdrop itself (not the
    panel) closes it; and closing returns focus to the Expand button.
  - Panel size: `w-[min(96vw,110rem)] max-h-[92vh]`, with its body `overflow-y-auto`.
  - Header: an `h2` with `{title}` and a `×` close button wrapped in `Tooltip` (copy below).
  - Body: `children(true)`.
  - Do not add body-scroll locking or a focus trap. No other dialog in this app has them. Matching
    the existing ones is the point; diverging belongs in a separate contract.
- **No `Suspense` inside `ExpandableChart`.** At each call site, put `ExpandableChart` *inside* the
  existing `Suspense`. The lazy chart has resolved by the time the button can be clicked, so the
  dialog's render never suspends.

### `size` prop on the three chart components

`size?: 'inline' | 'expanded'`, default `'inline'`. Inline output must be **identical** to today.

| component | element | inline (today) | expanded |
|---|---|---|---|
| `SeriesChart` | main price pane | `h-[22rem]` | `h-[60vh]` |
| `SeriesChart` | every indicator sub-pane | `h-[12rem]` | `h-[14rem]` |
| `SeriesChart` | `downsample(chartData)` | `MAX_CHART_POINTS` (default) | `downsample(chartData, EXPANDED_CHART_POINTS)` |
| `OptimizeChart` | outer div | `h-[22rem]` | `h-[70vh]` |
| `CapmChart` | outer div | `h-[22rem]` | `h-[70vh]` |

`OptimizeChart` and `CapmChart` don't downsample, so give them no point-cap change.

### Call sites

Each one becomes `<ExpandableChart title="…">{(expanded) => <Chart … size={expanded ? 'expanded' : 'inline'} />}</ExpandableChart>`,
with every existing prop passed unchanged. Titles:

- `TickerPage.tsx`: `` `${symbol} — Price & Moving Averages` `` (the same string as `SeriesChart`'s `title`)
- `PortfolioCharts.tsx`: `"Portfolio — Value & Moving Averages"`
- `OptimizePage.tsx`: `"Return: Current vs Optimized"`
- `CapmSection.tsx`: `"Risk vs return: Capital Allocation Line"`

The expanded `SeriesChart` repeats its own `title` under the dialog's `h2`. Accept that. Don't add a
prop to hide it.

## Out of scope

- Click-to-open on the plot area.
- Controls inside the dialog: date pickers, indicator toggles, a download or export button.
- The Universe page's `ChartDialog`, and extracting a shared modal shell from the existing dialogs.
  There are now five hand-rolled copies. That's real duplication, but it belongs in its own contract.
- Changing `MAX_CHART_POINTS` or the inline heights.
- New dependencies.
- Reformatting unrelated code. The touched files already have long single-line JSX; leave those
  lines as they are and don't collapse new code onto them.

## Acceptance criteria

1. `grep -c "recharts" frontend/src/components/ExpandableChart.tsx` prints `0`.
2. `grep -n "import.*from '\./\(SeriesChart\|OptimizeChart\|CapmChart\)'" frontend/src/components/ExpandableChart.tsx`
   prints nothing.
3. `grep -c "<ExpandableChart" frontend/src/pages/TickerPage.tsx frontend/src/components/PortfolioCharts.tsx frontend/src/pages/analysis/OptimizePage.tsx frontend/src/pages/analysis/outlook/CapmSection.tsx`
   prints `1` for each of the four files. (This counts opening tags; `</ExpandableChart>` doesn't
   match `<ExpandableChart`.)
4. `grep -c "size={expanded ? 'expanded' : 'inline'}" <same four files>` prints `1` for each.
5. In `frontend/src/components/ExpandableChart.tsx`: `grep -c "createPortal(" ` prints at least `1`, and
   `grep -c 'role="dialog"'` and `grep -c 'aria-modal="true"'` each print `1`.
6. `grep -n "title=" frontend/src/components/ExpandableChart.tsx` prints nothing. There's no HTML
   `title` attribute. (The prop is destructured as `title`, never written as `title=`.)
7. `grep -c "h-\[22rem\]" frontend/src/components/OptimizeChart.tsx frontend/src/components/CapmChart.tsx`
   prints at least `1` each. The inline height survives.
8. `grep -n "EXPANDED_CHART_POINTS" frontend/src/lib/chart.ts frontend/src/components/SeriesChart.tsx`
   shows the export in `chart.ts` and a use in `SeriesChart.tsx`.
9. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (Plain `--noEmit` checks nothing
   in this project; never use it.)
10. `cd frontend && npm run lint` exits 0, with no new warnings in touched or created files.
11. `cd frontend && npm test` passes in full, and `npm run build` succeeds.
12. **Bundle check:** after `npm run build`, run
    `grep -l "ResponsiveContainer" dist/assets/index-*.js`. It must print nothing: recharts is still
    out of the entry chunk. Run it **before** your change too, and paste both outputs. If it prints a
    file before your change, report that and don't count it against you.
13. `awk 'length > 300 {print FILENAME": "FNR": "length}'` over every touched or created file
    prints no line that wasn't there before. Run it before and after, and paste both.

`BLOCKED` is the right answer to a criterion that cannot be satisfied, and to an undecided design
question. Don't find a clever way to pass a criterion. A clever pass is worse than a stop.

## Verification to run and paste

Paste the **complete, verbatim** output, including failures. State which files you created and
edited.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend
F="src/pages/TickerPage.tsx src/components/PortfolioCharts.tsx src/pages/analysis/OptimizePage.tsx src/pages/analysis/outlook/CapmSection.tsx"
awk 'length > 300 {print FILENAME": "FNR": "length}' $F src/components/SeriesChart.tsx src/components/OptimizeChart.tsx src/components/CapmChart.tsx src/lib/chart.ts src/components/ExpandableChart.tsx   # before AND after
grep -c "recharts" src/components/ExpandableChart.tsx
grep -n "import.*from '\./\(SeriesChart\|OptimizeChart\|CapmChart\)'" src/components/ExpandableChart.tsx
grep -c "<ExpandableChart" $F
grep -c "size={expanded ? 'expanded' : 'inline'}" $F
grep -c "createPortal(" src/components/ExpandableChart.tsx
grep -c 'role="dialog"' src/components/ExpandableChart.tsx
grep -c 'aria-modal="true"' src/components/ExpandableChart.tsx
grep -n "title=" src/components/ExpandableChart.tsx
grep -c "h-\[22rem\]" src/components/OptimizeChart.tsx src/components/CapmChart.tsx
grep -n "EXPANDED_CHART_POINTS" src/lib/chart.ts src/components/SeriesChart.tsx
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
npm run build
grep -l "ResponsiveContainer" dist/assets/index-*.js   # before AND after
```

## Tooltips

- Expand button: **"Open a larger view of this chart"**
- Dialog close (×): **"Close the larger view"**

Both use the `Tooltip` component, never `title`.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it**, at a desktop width (~1440px) and a narrow one (~390px). Use
`npm run dev` in `frontend/`, with the backend running.

1. `/ticker/SPY`: turn on SMA, Bollinger, RSI and ADX, and set the start date to 2021-01-01. Click
   Expand. The dialog fills most of the screen. The price pane is visibly taller, and all four
   overlays plus both sub-panes are present. Lines look finer than inline (more points). Hover shows
   recharts tooltips **above** the dialog. Escape closes it, and focus lands back on Expand.
2. Holdings tab of a portfolio: Expand works, and a click on the dark backdrop closes it.
3. Optimize tab, after a run: Expand works, with the legend and SPY line present.
4. Outlook tab, after a CAPM run: Expand works, and the ticker labels are readable.
5. At ~390px: the dialog fits the screen width, and the body scrolls vertically if the sub-panes
   overflow.

## Open questions

None. If something here turns out to be wrong in practice (e.g. `60vh` leaves the sub-panes
off-screen at common heights), report it rather than retuning silently. Small sizing adjustments are
fine if you state them and say why.
