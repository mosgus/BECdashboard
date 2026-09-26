# Contract 0116 — Align signal state details and justify briefing text

**Status:** in-progress <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

The Signal States rows on the ticker and portfolio holdings views use a fixed state-details
column on larger screens, and the launch-page AI briefing paragraph is justified.

## Why

The two Signal States implementations currently use `flex-wrap`, so the state badge and its
reading/date block can shift based on the description's width and line count. The reference
image shows the state details should begin in one consistent vertical column for every row.
The launch briefing currently uses normal left alignment; its long prose should use justified
alignment as shown in the supplied reference image.

## Files

Modify:
- `frontend/src/pages/TickerPage.tsx` — change each Signal States row from the current wrapping
  flex layout to the specified responsive grid layout.
- `frontend/src/components/PortfolioCharts.tsx` — make the portfolio Signal States rows use the
  identical responsive grid layout.
- `frontend/src/components/NewsSection.tsx` — add the existing Tailwind `text-justify` utility to
  the AI briefing paragraph.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

`reference files/` is read-only and never belongs on a file list. The supplied screenshots are
visual evidence only; do not edit them.

## Interface

In both Signal States row implementations, replace the row wrapper's current class:

```tsx
className="px-4 py-4 flex flex-wrap items-start gap-4"
```

with exactly:

```tsx
className="px-4 py-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_12rem] items-start gap-x-4 gap-y-2"
```

Do not change the row contents, the state-reading logic, the descriptions, or the SignalBadge.
The one-column default keeps narrow screens readable; from the `sm` breakpoint onward the state
details occupy the same 12rem column in every row.

In `NewsSection.tsx`, change the briefing paragraph class from:

```tsx
className="font-briefing text-xl leading-relaxed"
```

to exactly:

```tsx
className="font-briefing text-xl leading-relaxed text-justify"
```

## Out of scope

- Do not create a new Signal States component or otherwise refactor the duplicated markup.
- Do not change SignalBadge styling, state values, descriptions, or reading/date copy.
- Do not justify article titles, article lists, or any text outside the AI briefing paragraph.
- Do not change breakpoints, card dimensions, typography, or responsive behavior beyond the
  specified Signal States row wrapper.
- Do not add dependencies or tests that require editing files outside this contract.

## Acceptance criteria

1. `frontend/src/pages/TickerPage.tsx` contains exactly one Signal States row wrapper with the
   specified grid class and no occurrence of the old `flex flex-wrap items-start gap-4` class.
2. `frontend/src/components/PortfolioCharts.tsx` contains exactly one Signal States row wrapper
   with the specified grid class and no occurrence of the old `flex flex-wrap items-start gap-4`
   class.
3. `frontend/src/components/NewsSection.tsx` contains the briefing paragraph class ending in
   `text-justify`, and the class occurs on the paragraph rendering `summary.text`.
4. The frontend typecheck, tests, production build, and lint command all exit 0.
5. `git diff --check` exits 0, and the coder reports only the three contract-listed application
   files as edited (pre-existing working-tree changes may remain untouched).

## Verification to run and paste

Run each command from the repository root and paste the complete, verbatim output into the report:

```bash
grep -n -F 'px-4 py-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_12rem] items-start gap-x-4 gap-y-2' frontend/src/pages/TickerPage.tsx
grep -n -F 'px-4 py-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_12rem] items-start gap-x-4 gap-y-2' frontend/src/components/PortfolioCharts.tsx
grep -n -F 'px-4 py-4 flex flex-wrap items-start gap-4' frontend/src/pages/TickerPage.tsx frontend/src/components/PortfolioCharts.tsx; echo "exit=$?"
grep -n -F 'className="font-briefing text-xl leading-relaxed text-justify"' frontend/src/components/NewsSection.tsx
npx tsc -p frontend/tsconfig.app.json --noEmit
(cd frontend && npm run test)
(cd frontend && npm run build)
(cd frontend && npm run lint)
git diff --check
git status --short
```

## Tooltips — required for any contract adding interactive elements

This contract adds no interactive elements and changes no tooltip behavior.

## Human verification — does Gunnar need to run anything?

Run the frontend and look at it. On a desktop-width viewport, open a ticker page and a portfolio
holdings tab with Signal States: the Bullish/Bearish/Neutral badge and its RSI or last-trigger
detail should start in one vertical column across all rows. Narrow the viewport below the `sm`
breakpoint and confirm each row stacks its state details below the description without horizontal
overflow. On `/`, confirm the AI briefing paragraph visibly uses justified alignment while article
cards and article-list text retain their existing alignment.

## Open questions

None.
