# Contract 0170 — Show every ticker label on the horizontal bar charts

**Status:** done
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Every bar in the Scenarios contribution chart and the Health risk-contribution chart has its ticker
label.

## Why

Gunnar's 2008 replay screenshot shows six contribution bars but only three labels: XLV, XLP and
GLD. The biggest loser, presumably MS, has no label.

Recharts' category axis defaults to `interval="preserveEnd"`, which drops ticks it thinks would
collide. `interval={0}` forces every tick to render. Each row is already at least 22px tall, which
is plenty for a 10–11px label.

`RiskContributionChart` has the same `YAxis` without `interval` and the same latent bug.

## Files

Modify:
- `frontend/src/components/ScenarioImpactChart.tsx`: add `interval={0}` to the `<YAxis type="category" …>`.
- `frontend/src/components/RiskContributionChart.tsx`: add `interval={0}` to the `<YAxis type="category" …>`.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

## Out of scope

- No other prop changes: no heights, widths, margins or tick styles.
- No new tests. Recharts doesn't lay out in jsdom, so a unit test can't see dropped ticks. The
  planner checks this with the smoke render.
- Do not launch a browser or start a backend.

## Acceptance criteria

Baselines: frontend **372** tests in **25** files; lint has 2 known warnings (`UniversePage:77`,
`HelpSidebar:44`).

1. `grep -c "interval={0}" frontend/src/components/ScenarioImpactChart.tsx frontend/src/components/RiskContributionChart.tsx`
   prints `1` for each file.
2. `npx vitest run` (in `frontend/`) gives **372** tests in **25** files, all passing.
3. `npx tsc -b`, `npm run build` and `npm run lint` are clean apart from the 2 known warnings.
4. `git diff --stat -- frontend/` lists only the two files, each with a 1-line change.

## Verification to run and paste

Paste the output of criteria 1–4 verbatim.

## Report

Use `contracts/TEMPLATE-report.md`. Set **Status:** reported.
