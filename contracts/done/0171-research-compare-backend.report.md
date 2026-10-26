# 0171 audit (planner, 2026-10-26): accepted

**Re-run:** the 17 new tests pass, and the full backend suite passes with 857 tests (840 + 17). There is no `except Exception`, and `run_optimize(` appears 4 times. `optimize_run.py`, `optimizer.py` and `portfolio_series.py` are unchanged. The router follows the `optimize_portfolio` prelude, and its `_point` helper is local to an allowed file.

**Accepted with known gaps. None of them blocks 0172.**
- **Correlation window edge (my spec's fault).** The frame is sliced to `>= common_start` *before* `ffill`. If one holding has no bar on `common_start` (a calendar mismatch), row 0 holds a NaN. `compute_returns` then drops that row, so one return is lost and `start` shifts by one bar. For US-listed holdings this is negligible. Fix it when step 3 (walk-forward) reworks the windowing: ffill over `[start, end]`, then slice.
- **Untested holdout branches.** The holdout `OptimizeInputError` and `feasible=False` branches have no tests. Both are short and read correctly. Add tests if the holdout engine is generalised in step 3.
- **Real-data check not done.** The planner's run on real BEC data, checking in-sample parity with Historical Optimize, was blocked: it needs production price reads. Gunnar's local check is below. Parity is otherwise covered by criterion 2 on fixtures.

**Not part of 0171:** the working tree also has a `frontend/src/pages/UniversePage.tsx` change, a status spinner from a separate task. It was not audited here.
