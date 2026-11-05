# 0180 audit: accepted (2026-10-26)

## Re-run by planner
- vitest 420/420, `tsc -p tsconfig.app.json` exit 0, `npm run lint` with only the 2 known warnings.
- The bestHoldout/isBestHoldout/"Holdout, last 12 months" grep is empty. Lines over 300 characters: none.
- Frontend diff scope: research.ts, research.test.ts and PortfolioSection.tsx. client.ts and memo.test.ts belong to 0179.

## Diff review
- `walkForward`, `beatsMostYears`, `usableFolds` and the sort keys match the spec, and `bestHoldout` is gone.
- Green is only on the Beat equal wt cell.
- If no equal_weight mode is present, `beatEqual` falls back to `{wins:0, of:0}`, which displays as "—". That's harmless.

## Smoke (isolated)
Setup: a stub on :8010 served real `compare_portfolio` output (the router function, with closes, DB check and rf monkeypatched) from synthetic prices. Vite ran on :5180. Both were stopped afterwards; Gunnar's servers were not used.
- **XLK/MS/GLD:**
  - Header "Walk-forward, 4 of 4 years", default sort by mean Sharpe.
  - Green appears on exactly the four 3/4 cells.
  - By-year table has 4 folds, newest first.
  - Target Volatility's errored fold renders as "—" inside a Tooltip.
- **Match current:**
  - Checked by default; the vol-target slider (5–50) is disabled; the label reads "matches current (16.2%)".
  - Unchecking enables the slider at 20% and marks the run stale. Re-running sent `vol_target: 0.2`.
  - The default run sent `vol_target: null`.
- **XLK + young GLD (from 2024-06):**
  - "1 of 4 years".
  - Folds 2–4 have "(skipped)" headers and skipped notes.
  - Folds 3–4 also show "not included: GLD" notes.
  - No exceptions or console errors in any run.

## Not blocking
- **Redundant notes:** skipped folds that also have exclusions print both a "not included" line and a "skipped" line. It's correct but noisy. It could be fixed by filtering the excluded notes to available folds.
- **Match current can still fail when a young holding is pinned.** In smoke, fold 4 resolved a 14.4% target against a 19.1% floor and errored. This is the pinned-sleeve approximation documented in 0179. The by-year tooltip shows the error.
- **The memo still reads fold 1 only.** That was out of scope here; it's a candidate follow-up.
