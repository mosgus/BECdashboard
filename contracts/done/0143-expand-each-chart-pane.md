# Contract 0143 — Expand each SeriesChart pane on its own

**Status:** accepted (with deviations, see Audit)
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Every individual chart pane gets its own Expand button, and the dialog shows **only that pane**.
This covers `/ticker/:symbol` and the Holdings tab. Today, contract 0142's single button opens the
whole `SeriesChart` stack: the price pane plus every indicator sub-pane.

`SeriesChart` draws up to six separate recharts charts:

| pane | heading (already in the code) | shown when |
|---|---|---|
| price / value | the `title` prop | always |
| RSI | `RSI (14)` | always |
| MACD | `MACD (12, 26, 9)` | always |
| ADX | `ADX (14) — Trend Strength` | `showAdxPane` |
| Stochastic | `Stochastic (14, 3, 3)` | `showStochasticPane` |
| OBV | `On-Balance Volume (OBV)` | `showObvPane` |

Each of these gets a button. `OptimizeChart` and `CapmChart` are already single charts, and their
call sites don't change.

## Why

Gunnar: "that only enlarges the collection of charts. I want to be able to enlarge each individual
chart." Contract 0142 treated `SeriesChart` as one chart when it's really a stack of up to six.
That was the planner's mistake, not the coder's. 0142 was built and accepted exactly as written.

Decided while drafting (2026-10-01):

- **Expansion moves inside `SeriesChart`.** Only `SeriesChart` knows its panes. The outer
  `ExpandableChart` wrappers in `TickerPage` and `PortfolioCharts` are removed, so there isn't both
  a whole-stack button and per-pane buttons.
- **The `size` prop on `SeriesChart` goes away.** Nothing outside `SeriesChart` asks for an expanded
  stack any more. `OptimizeChart` and `CapmChart` keep theirs.
- **The button sits on each pane's heading row,** not on a row of its own. Six extra 28px rows would
  waste a lot of vertical space. `ExpandableChart` gains an optional `header` prop for this.
- **Each Expand button's accessible name includes the pane:** `Expand ${title}`. Six buttons all
  labelled "Expand chart" can't be told apart by a screen reader.

## Files

Modify:
- `frontend/src/components/ExpandableChart.tsx`: add the `header` prop and change the `aria-label`.
- `frontend/src/components/SeriesChart.tsx`: wrap each pane in `ExpandableChart` and remove `size`.
- `frontend/src/pages/TickerPage.tsx` and `frontend/src/components/PortfolioCharts.tsx`: remove the
  `ExpandableChart` wrapper and its import, and render `<SeriesChart … />` directly with its existing
  props minus `size`.

**Touch nothing else.** `OptimizeChart.tsx`, `CapmChart.tsx`, `OptimizePage.tsx`, `CapmSection.tsx`,
`lib/chart.ts` and `ChartDialog.tsx` stay as they are. If the work appears to need any other file,
stop and report `BLOCKED`.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

### `ExpandableChart`

```tsx
interface ExpandableChartProps {
  /** Dialog heading, dialog aria-label, and the pane name in the Expand button's aria-label. */
  title: string
  /** Optional inline heading. When given, it shares a row with the Expand button. */
  header?: ReactNode
  children: (expanded: boolean) => ReactNode
}
```

- **Without `header`:** the inline row is exactly today's `flex justify-end` row. That keeps Optimize
  and CAPM unchanged.
- **With `header`:** the row becomes `mb-2 flex flex-wrap items-center justify-between gap-2`. It
  holds `{header}` on the left and the Expand button on the right, then `children(false)` below.
- **Button `aria-label`:** `` `Expand ${title}` `` in both cases.
- Everything else stays as-is: the portal, the dialog, Escape, backdrop click, focus return, and the
  tooltips. It must still not import `recharts`.

### `SeriesChart`

- Remove `size` from `SeriesChartProps` and from the destructuring.
- Compute two data sets:
  - `inlineData = downsample(chartData)`
  - `expandedData = downsample(chartData, EXPANDED_CHART_POINTS)`

  Compute `priceDomain` and `snapRange` from whichever set the pane is drawing. Don't reuse the
  inline values for the expanded pane.
- Turn each pane's body into a local render function that takes `(data, heightClass)`. Call it
  inline with `(inlineData, 'h-[22rem]')` for the price pane and `(inlineData, 'h-[12rem]')` for the
  sub-panes. Those are today's heights, and inline output must look identical to today. Call it
  expanded with `(expandedData, 'h-[70vh]')` for every pane.
- Wrap each pane in `<ExpandableChart title={…} header={…}>`:
  - **Price pane:** `title` is the `title` prop. `header` is the current heading block: the `h3`,
    plus the Net return `HoverTooltip` when `netReturn !== null`. Drop the old `mb-2` wrapper div,
    since `ExpandableChart`'s row provides the spacing. **Expanded:** render the Net return figure
    in a `mb-2 flex justify-end` row above the chart when it isn't null, then the chart. It must not
    be lost in the dialog.
  - **Sub-panes:** `title` is the heading string from the table above. `header` is
    `<h3 className="text-sm font-semibold">{that string}</h3>`. Remove the old `h3` and its `mb-2`.
    **Expanded:** just the chart.
- Keep the grid layout, pane order, the `show*Pane` conditions, every series, every reference line,
  and every axis exactly as they are.

### Call sites

`TickerPage.tsx` and `PortfolioCharts.tsx` go back to a plain `<SeriesChart … />` inside the
existing `Suspense`, with every prop except `size` passed unchanged.

## Out of scope

- Indicator toggles or date controls inside the dialog.
- Changing inline heights, `MAX_CHART_POINTS` or `EXPANDED_CHART_POINTS`.
- `OptimizeChart` and `CapmChart`.
- A shared modal shell (debt noted in 0142).
- Reformatting unrelated code. Don't collapse new JSX onto existing long lines.

## Acceptance criteria

Run from `frontend/`, **in bash** (`bash -c '…'` or a bash shell). zsh doesn't word-split `$F`.

1. `grep -c "<ExpandableChart" src/components/SeriesChart.tsx` prints at least `6`.
2. `grep -c "ExpandableChart" src/pages/TickerPage.tsx src/components/PortfolioCharts.tsx` prints `0`
   for both files (no tag, no import).
3. `grep -c "size=" src/pages/TickerPage.tsx src/components/PortfolioCharts.tsx` prints `0` for both.
   `grep -n "size" src/components/SeriesChart.tsx` prints nothing.
4. `grep -c "<ExpandableChart" src/pages/analysis/OptimizePage.tsx src/pages/analysis/outlook/CapmSection.tsx`
   still prints `1` each.
5. `grep -c "Expand \${title}" src/components/ExpandableChart.tsx` prints `1`, and
   `grep -c 'aria-label="Expand chart"' src/components/ExpandableChart.tsx` prints `0`.
6. `grep -c "recharts" src/components/ExpandableChart.tsx` prints `0`.
7. `grep -c "h-\[70vh\]" src/components/SeriesChart.tsx` prints at least `1`.
   `grep -c "h-\[60vh\]\|h-\[14rem\]" src/components/SeriesChart.tsx` prints `0`, so 0142's expanded
   heights are gone. `grep -c "h-\[22rem\]" src/components/SeriesChart.tsx` and
   `grep -c "h-\[12rem\]" src/components/SeriesChart.tsx` each print at least `1`.
8. `grep -c "EXPANDED_CHART_POINTS" src/components/SeriesChart.tsx` prints at least `2` (the import
   and a use).
9. `npx tsc -p tsconfig.app.json --noEmit` exits 0. Plain `--noEmit` is vacuous here; never use it.
10. `npm run lint` exits 0, with no new warnings in touched files. The two existing warnings are in
    `HelpSidebar.tsx` and `UniversePage.tsx`.
11. `npm test` passes in full (278 today), and `npm run build` succeeds.
12. After the build, `grep -l "ResponsiveContainer" dist/assets/index-*.js` prints nothing.
13. `awk 'length > 300 {print FILENAME": "FNR": "length}'` over the four touched files prints no
    line that wasn't there before. Run it before and after, and paste both.

`BLOCKED` is the right answer to a criterion that cannot be satisfied, and to an undecided design
question. Don't find a clever way to pass a criterion. A clever pass is worse than a stop.

## Verification to run and paste

Paste the **complete, verbatim** output, including failures. Summaries don't count as output.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend
bash -c '
F="src/components/ExpandableChart.tsx src/components/SeriesChart.tsx src/pages/TickerPage.tsx src/components/PortfolioCharts.tsx"
awk "length > 300 {print FILENAME\": \"FNR\": \"length}" $F   # before AND after
grep -c "<ExpandableChart" src/components/SeriesChart.tsx
grep -c "ExpandableChart" src/pages/TickerPage.tsx src/components/PortfolioCharts.tsx
grep -c "size=" src/pages/TickerPage.tsx src/components/PortfolioCharts.tsx
grep -n "size" src/components/SeriesChart.tsx
grep -c "<ExpandableChart" src/pages/analysis/OptimizePage.tsx src/pages/analysis/outlook/CapmSection.tsx
grep -c "Expand \${title}" src/components/ExpandableChart.tsx
grep -c "aria-label=\"Expand chart\"" src/components/ExpandableChart.tsx
grep -c "recharts" src/components/ExpandableChart.tsx
grep -c "h-\[70vh\]" src/components/SeriesChart.tsx
grep -c "h-\[60vh\]\|h-\[14rem\]" src/components/SeriesChart.tsx
grep -c "h-\[22rem\]" src/components/SeriesChart.tsx
grep -c "h-\[12rem\]" src/components/SeriesChart.tsx
grep -c "EXPANDED_CHART_POINTS" src/components/SeriesChart.tsx
'
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
npm run build
grep -l "ResponsiveContainer" dist/assets/index-*.js
```

## Tooltips

They're unchanged from 0142:
- Expand: **"Open a larger view of this chart"**
- Close: **"Close the larger view"**

Use the `Tooltip` component, never `title`.

## Human verification — does Gunnar need to run anything?

**Yes.** Run the frontend with the backend up and check at ~1440px and ~390px.

1. `/ticker/SPY`, with SMA, Bollinger, RSI, ADX, Stochastic and OBV on, from 2021-01-01:
   - Six panes each have their own ⤢ on the heading row. There's no button above the whole stack.
   - Expanding RSI opens a dialog titled "RSI (14)" with only the RSI chart, about 70% of the screen
     tall, with the 70/30 lines present.
   - Expanding the price pane shows Net return and all overlays.
   - Escape closes the dialog and focus returns to that pane's ⤢.
2. Holdings tab: the same per-pane buttons appear, and the value pane expands with the dollar or
   index axis intact.
3. Inline layout looks the same as before 0142: same heights, and headings aligned on the left.
4. Optimize and Outlook still expand as before.

## Open questions

None. If `70vh` is too tall for a short sub-pane like OBV in practice, report it rather than
retuning silently.

## Audit (planner, 2026-10-01)

Audited against commit `d857fac`. Criteria 1–13 were re-run and all pass: 6 wrappers in
`SeriesChart`; 0 references in `TickerPage` and `PortfolioCharts`; no `size`; per-pane
`aria-label`; tsc exit 0; lint shows only the two existing warnings; 278 tests pass; the build
succeeds; the entry bundle has no recharts; no new lines over 300 characters. Inline and expanded
data and domains are computed per pane, as specified.

Deviations, accepted as-is but recorded:
- **The Expand button has no `Tooltip`.** Gunnar removed it deliberately (2026-10-01). It's an
  accepted exception to the every-control-has-a-tooltip rule, so don't restore it.
- **The unspecified `expandButtonAboveHeader` prop** puts the price pane's button on its own row
  above the heading, which is the layout this contract rejected. That's fine if Gunnar asked for it
  after looking at it. Otherwise it's scope creep.
- **Unspecified dialog alignment change:** the backdrop went from `items-start` to `items-center`.
- **The expanded price pane always renders the Net return row,** even when `netReturn` is null. The
  result is an empty `mb-2` div. It's harmless.
- No report was pasted into the contract.
