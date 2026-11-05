# 0179 audit: accepted (2026-10-26)

## Re-run by planner
- Backend: `pytest -q` → 868 passed (coder reported 857 → 868).
- Old tests: `git diff -U0 backend/tests/test_compare_run.py | grep '^-[^-]'` → empty, so no existing test was changed.
- `backtest_series(` count: 2, the same as before. One `_run_fold` loop; the legacy holdout fields are derived from fold 1.
- Frontend: `tsc -p tsconfig.app.json` exit 0; vitest 415/415.
- Diff scope: the listed files, plus REBUILD.md, performance.ts and performance.test.ts, which were already modified (0178 and planner edits) before the coder started.

## Diff review
- **Fold windows:** match the probe and the contract. The scoring upper bound `≤ score_end` is the only new filter, so fold 1 is identical to the old holdout.
- **Failure paths are preserved:** in-sample-failed modes are skipped, a per-mode `OptimizeInputError` becomes a holdout error, a non-converged fit gets the existing string, and scoring uses equal weight's `fit_end` even when equal weight is infeasible. These are the same as the old code.
- **Match current:** the in-sample equal-weight run uses the 0.10 fallback. This is harmless because equal weight ignores vol_target. Each fold re-resolves from its own equal-weight run. The pinned-holdings caveat is in a docstring.
- **Schema/router/client:** match the spec. The HTTP default for `vol_target` is now `None`; the Python default stays 0.10.

## Gaps (not blocking)
- These paths are untested: the non-finite fallback to 0.10, a per-fold `OptimizeInputError` mode error, and `unavailable = "Fold fit: …"`. The code for each is a few lines and mirrors legacy paths.
- `test_folds_have_no_lookahead` skips modes with no holdout. Nothing checks that it actually recomputed at least one mode.
- Unavailable folds still report `tickers`/`excluded`. This is reasonable and the contract didn't say otherwise.
- Test imports were added as separate lines to keep the diff additions-only. That's cosmetic.

## Note for 0180
`MemoSection` uses `DEFAULT_COMPARE_SETTINGS`, so it switches to match current once 0180 changes the default. This is intended; I added a line to 0180 saying so.
