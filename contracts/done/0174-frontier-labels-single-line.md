# Contract 0174 — Research frontier: mode labels on one line

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

On Research → Portfolio's efficient frontier, each optimizer label renders as **one line** of text,
centred above its point. Today `Min Var`, `Max Sharpe`, `Risk Parity`, `Max Sortino`, `Min CVaR`,
`Max Div` and `Target Vol` each break into two stacked lines.

## Why

0173's `<LabelList dataKey="label" position="top" …>` lets recharts pass each label the scatter
point's width. recharts' `<Text>` then word-wraps at every space. The planner's audit saw this in
the DOM: the `Min Var` label is two `<tspan>`s, `Min` at `dy=-1em` and `Var` at `dy=1em`. Two-line
labels double the vertical footprint, so the Max Sharpe/Max Sortino overlap is worse. Gunnar needs
to judge that overlap on the true rendering.

## Files

Modify only `frontend/src/components/CompareFrontierChart.tsx`.

**Touch nothing else.** `SHORT_MODE_LABELS`, `lib/research.ts`, `PortfolioSection.tsx` and
`FrontierChart.tsx` are not edited. If the work appears to require editing another file, stop and
report `BLOCKED`.

## Change

Give the `Optimizers` scatter's `LabelList` a `content` render function that returns one plain
SVG `<text>`, with no recharts `<Text>`:
- `x` = the point's centre x;
- `y` = the point's centre y minus 10;
- `textAnchor="middle"`, `fontSize={11}`, `fill="var(--color-foreground)"`;
- the label string as its only child.

Read the props recharts passes to `content` (`x`, `y`, `width`, `height`, `value`) from the
installed recharts' types. Work out the centre from them, and say in the report which
props you used. Keep `dataKey="label"`.

## Out of scope

- Collision avoidance, offsets per mode, or hiding labels. Gunnar decides that after seeing
  single-line labels (0173's open question).
- The tooltip, legend, colours and marker sizes.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written.

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
2. `cd frontend && npm run test`: 387 passed in 26 files. No tests are added or changed.
3. `cd frontend && npm run build` exits 0.
4. `cd frontend && npm run lint` shows the same 2 known warnings and nothing new.
5. `grep -c "content=" frontend/src/components/CompareFrontierChart.tsx` ≥ 1.
6. `git diff --stat` lists `frontend/src/components/CompareFrontierChart.tsx` and no other file
   that was clean before this contract. Report the full list of files you modified.
7. Run `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write frontend/src/components/CompareFrontierChart.tsx`.
   Then `awk 'length > 300' frontend/src/components/CompareFrontierChart.tsx` prints nothing.

**Planner-run** (coders skip these, and write "browser checks left for the Planner" under Not done):

8. `SMOKE_EVAL` over `.recharts-label-list text` shows no element with more than one `tspan`, and
   at least one `textContent` of `Min Var`, with the space.
9. No `EXCEPTION:` line on `research` or `optimize`.

## Human verification

This folds into the 0172/0173 look (Research → Portfolio, BEC, light and dark themes). With labels
on one line, decide whether the Max Sharpe/Max Sortino overlap is tolerable.
