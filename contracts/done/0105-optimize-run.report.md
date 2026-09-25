# Report 0105: run_optimize (planner audit)

**Verdict:** accepted, with two message fixes carried into 0106
**Coder:** sonnet · **Auditor:** planner (opus)

## Re-run by the planner
- Full backend suite: **603 passed** (581 before, +22).
- I read `app/optimize_run.py` against rules 1–13. Everything checks out:
  - pinning, the fit frame, scaled bounds, views/κ and the CAPM join
  - the fallback, final weights and scoring through `backtest_series`
  - the benchmark reindex and the metrics
- `OptimizeInputError` for missing SPY is raised inside the `try`. It is a ValueError, not a
  RuntimeError, so it propagates rather than triggering the fallback. That is correct.

## Defects (user-facing text, fixed in 0106)
1. **A stale warning.** Every result carries `main`'s
   `"Optimization is simulated: current weights assumed constant baseline."` It is `main`'s literal
   first warning, and my contract said to port the warnings line for line, so this is the planner's
   miss. The text is now **false**: scoring is buy-and-hold from the window start, not constant
   weights.
2. **The min-weight feasibility message states the wrong threshold when holdings are pinned.**
   Take s=0.5, N=2, min_weight=0.3. It raises correctly, but it says `"= 0.60 > 1.0"`, which is false.
   The real bound is `min_weight × N > 1 − pinned`. The max-weight message prints the right number
   (s/N) but labels it "1/N".

## Notes
- Tests use `date` indices only. 0106 loads `date` objects from `PriceBar`, the same as `/portfolio/series`,
  so Timestamp input never happens in production.
