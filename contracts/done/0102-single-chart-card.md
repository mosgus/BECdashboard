# Contract 0102 — Date range, indicators and chart in one card

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

Today /ticker/:symbol and the Holdings portfolio charts each spread one chart across three cards: the
Start/End dates, the Indicators checkboxes, and the chart. Merge those three into a **single card** on
both pages:

1. A controls strip at the top of the card: dates on the left, indicators on the right, wrapping on
   narrow screens.
2. A divider line.
3. The chart content, including its loading, empty and mode-note states.

The ATR card and the Signal States card stay as separate cards.

## Why

Gunnar asked for this 2026-09-24. The controls only affect the chart, so putting them in the same card
makes that relationship obvious. It also removes two card gaps' worth of vertical space above the
chart.

This is markup and class changes only. No state, handlers, props, copy or tooltips change.

## Files

Modify:
- `frontend/src/pages/TickerPage.tsx`: only the three `<section>`s for the Start/End dates, the
  Indicators and the chart.
- `frontend/src/components/PortfolioCharts.tsx`: only the three `<section>`s for the Start/End dates,
  the Indicators and the chart. The loading and error early returns stay as they are.

**Touch nothing else.** That includes `SeriesChart.tsx`, `HoldingsPage.tsx`, `lib/` and any test file.
If the work appears to require editing a file not on this list, stop and report `BLOCKED` instead of
editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. It is a snapshot of other working software kept so its behaviour can be compared against this
rebuild, and an edited reference stops being evidence of anything. `.claude/settings.json` denies
Edit and Write there. That deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Target structure (both files)

Replace the three sibling sections with this one section. Move the existing inner content into the
marked places **unchanged**:
- the Start and End `<label>`s, including their Tooltips, inputs, `min`/`max` and handlers
- the Indicators label, the checkbox list and, in PortfolioCharts, the "ATR, Donchian…" note
- the chart body

```tsx
<section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
  <div className="flex flex-wrap items-start gap-x-8 gap-y-4 pb-4 mb-4 border-b border-brand-border">
    <div className="flex flex-wrap gap-4">
      {/* existing Start <label> */}
      {/* existing End <label> */}
    </div>
    <div className="flex-1 min-w-64">
      {/* existing "Indicators" label span (with its Tooltip on TickerPage) */}
      {/* existing checkbox <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2"> */}
      {/* PortfolioCharts only: existing "ATR, Donchian, ADX…" <p> note */}
    </div>
  </div>
  {/* existing chart body: loading / empty / Suspense+SeriesChart, and in PortfolioCharts the mode-note div */}
</section>
```

Notes:
- The old sections' own classes (`p-4 flex flex-wrap gap-4` on the dates section, `p-4` on the
  others) go away along with those sections.
- In PortfolioCharts the chart body is the `points.length === 0 ? … : (<>…</>)` expression. It moves
  in unchanged.
- In TickerPage the chart body is the three `history.status` lines. They move in unchanged.
- Keep the surrounding `space-y-5` wrappers (`<main>` on TickerPage, the `<div className="space-y-5 mt-5">`
  in PortfolioCharts). They still space the merged card from ATR and Signal States.

## Out of scope

- Don't move the chart title or the net return out of `SeriesChart`.
- Don't restyle the inputs or checkboxes.
- Don't merge ATR or Signal States into the card.
- Don't change the loading and error early returns in PortfolioCharts.
- No new tooltips and no copy changes.

## Acceptance criteria

1. `npm run build` exits 0.
2. `npm run test` passes with the same count as before. Run it before you start and paste both
   numbers. This work adds no tests.
3. `grep -c "rounded-\[var(--radius-card)\]" frontend/src/pages/TickerPage.tsx` prints `4` (it was 6).
   The four are the unknown-ticker box, the merged card, ATR and Signal States.
4. `grep -c "rounded-\[var(--radius-card)\]" frontend/src/components/PortfolioCharts.tsx` prints `4`
   (it was 6). The four are loading, error, the merged card and Signal States.
5. `grep -c 'border-b border-brand-border' frontend/src/pages/TickerPage.tsx` and the same command on
   `PortfolioCharts.tsx` each print one more than before. The added line is the divider. Paste the
   before and after numbers from `git show HEAD:<path> | grep -c 'border-b border-brand-border'`.
6. Nothing was lost or duplicated. Each of these prints the same count before and after, using
   `git show HEAD:<path> | grep -c` for the baseline:
   - `type="date"`
   - `toggleIndicator(group.key)`
   - `<SeriesChart`
   - `Loading chart…`
   - `No stored data in this date range.`

   Run each one against both files.
7. `git diff --stat` lists only `TickerPage.tsx` and `PortfolioCharts.tsx` among the files you changed.
   Other files may already be modified by earlier work; list those as pre-existing.
8. `npm run lint` reports only the two pre-existing warnings, `HelpSidebar.tsx:44` and
   `UniversePage.tsx:60`.

If any criterion cannot be met as written, for example because a file no longer matches what this
contract describes or HEAD has moved, **report `BLOCKED` and name the conflict**. That is the correct
answer. Don't bend the code or the check to make it pass.

## Verification to run and paste

Run each of these from the repo root and paste the **complete, verbatim** output into the report,
including failures. Don't summarise, trim or clean up.

```bash
(cd frontend && npm run build 2>&1 | tail -4)
(cd frontend && npm run test 2>&1 | tail -5)
(cd frontend && npm run lint 2>&1 | tail -6)
for f in frontend/src/pages/TickerPage.tsx frontend/src/components/PortfolioCharts.tsx; do
  echo "== $f"
  for p in 'rounded-\[var(--radius-card)\]' 'border-b border-brand-border' 'type="date"' 'toggleIndicator(group.key)' '<SeriesChart' 'Loading chart…' 'No stored data in this date range.'; do
    echo "$p  before=$(git show HEAD:$f | grep -c -- "$p")  after=$(grep -c -- "$p" $f)"
  done
done
git diff --stat
```

## Tooltips — required for any contract adding interactive elements

This contract adds no interactive elements. The existing tooltips move with their elements unchanged.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.**

```bash
cd frontend && npm run dev
```

At about 1280px wide, then at about 700px:
1. `/ticker/AAPL`:
   - There is one card containing the dates, then the indicators beside or below them, then a
     divider, then the chart.
   - ATR and Signal States are still separate cards below it.
2. On a portfolio's Holdings tab, the same layout. The "ATR, Donchian…" note sits under the
   checkboxes, and the dollar or index note sits above the chart.
3. Toggling an indicator and changing Start still update the chart.

## Open questions

None.
