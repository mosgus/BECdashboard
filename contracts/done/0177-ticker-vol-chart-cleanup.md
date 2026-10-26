# Contract 0177 — Ticker Risk Profile: plain rolling-vol chart + tooltip wording (frontend only)

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

On `/ticker/:symbol`, the Risk & Factor Profile's rolling-volatility chart should show only the volatility line. Today it also renders:
- empty **RSI (14)** and **MACD (12, 26, 9)** panels, and
- a **"Net return"** badge, which is meaningless for a volatility line.

Also, the Factor Loadings tooltip there should name the ticker instead of "the portfolio".

## Changes

1. `frontend/src/components/SeriesChart.tsx`: add an optional prop, `plain?: boolean`, default `false`. When `plain` is true:
   - do not render `renderNetReturn()`, either in the inline header or in the expanded view;
   - do not render the RSI, MACD, ADX, Stochastic or OBV panes, or their grid wrappers;
   - leave the price pane, the expand behaviour and everything else unchanged.

   When `plain` is false or missing, the output must be identical to today. TickerPage's price chart and PortfolioCharts must not change.
2. `frontend/src/pages/ticker/RiskProfileSection.tsx`:
   - pass `plain` to the rolling-vol `SeriesChart`;
   - in the Loadings tooltip, replace `the portfolio's daily return` with `${symbol}'s daily return` (a template literal). The rest of the text stays verbatim.
3. Nothing else. No other files, no backend.

## Acceptance criteria
1. `cd frontend && npx vitest run` → all pass, with at least 412 tests.
2. `cd frontend && npx tsc --noEmit -p tsconfig.app.json` → clean.
3. `cd frontend && npx eslint src` → only the 2 known warnings (UniversePage.tsx:77, HelpSidebar.tsx:44).
4. `grep -n "plain" frontend/src/components/SeriesChart.tsx` → shows the prop in the props type, its default, and the gating.
5. `grep -rn "plain" frontend/src/pages/ticker/RiskProfileSection.tsx` → exactly one match, on the SeriesChart usage.
6. `grep -rn "<SeriesChart" frontend/src/pages/TickerPage.tsx frontend/src/components/PortfolioCharts.tsx` → neither line contains `plain`.
7. `grep -c "the portfolio's" frontend/src/pages/ticker/RiskProfileSection.tsx` → `0`.
8. `git diff --stat` for this contract touches only the two files above. RiskProfileSection.tsx is untracked, so instead confirm that no other file changed beyond the 0176 state.
9. Formatting: run `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --check` on both files only if they were Prettier-formatted before. Do not reformat SeriesChart.tsx wholesale. `awk 'length > 300' frontend/src/pages/ticker/RiskProfileSection.tsx` → no output.

## Out of scope
- Browser checks. The planner runs these on an isolated stack. Do not launch a browser.
- Any other SeriesChart cleanup. In particular, RSI and MACD render empty on the main price chart too when indicators fail. That is pre-existing and stays out of scope.

## Report
Write the standard report: criteria and their results, any judgement calls, and anything you could not verify.
