# Contract 0193 — The optimizer comparison computes the efficient frontier once, not 40 times

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, `run_compare` calls `efficient_frontier` and `random_portfolios` exactly once
each: for the in-sample equal-weight run, which is the only frontier the comparison returns. The
comparison's output is unchanged.

## Why

`run_optimize` always computes a full frontier:
- a 25-point SLSQP sweep (`efficient_frontier`),
- a 500-portfolio cloud (`random_portfolios`),
- an extra max-Sharpe solve.

`run_compare` calls `run_optimize` 40 times: 8 modes in-sample, plus 8 for each of 4 walk-forward
folds. It uses only:
- the equal-weight in-sample run's frontier (`points`, `cloud`, `current`, `tickers`, `excluded`);
- each in-sample run's **single point**, `frontier.optimized`, the (vol, return) dot drawn on that
  chart.

The 32 fold runs use nothing from their frontier. The planner measured 1.4 s of a 3.8 s comparison
in `efficient_frontier` alone on 2026-11-09.

The single point is two lines of arithmetic: `sqrt(w·Σ·w)` and `w·μ`. It doesn't need the sweep.
So `run_optimize` gains a flag to skip the frontier, and always returns that point separately.

## Files

Modify:
- `backend/app/optimize_run.py`: `OptimizeResult` gains `optimized_point`, and `run_optimize` gains
  `include_frontier`.
- `backend/app/compare_run.py`: pass `include_frontier=False` everywhere except the in-sample
  equal-weight run. `_mode_row` reads `run.optimized_point`.
- `backend/tests/test_optimize_run.py`: add the tests in criterion 1.
- `backend/tests/test_compare_run.py`: add the test in criterion 2.

**Touch nothing else.** In particular, `backend/app/routers/portfolio.py` does not change: the
`/portfolio/optimize` response is built field by field and must not gain `optimized_point`. If the
work appears to require editing a file not on this list, stop and report `BLOCKED` instead of
editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs — that is what it is for — but it is a snapshot of other working software kept so its behaviour
can be compared against this rebuild, and an edited reference stops being evidence of anything.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it.

**`BLOCKED` is also the right answer if any criterion below cannot be satisfied as written.** Do not
find a clever way to pass a criterion that contradicts another one or the code. Stop and say which.

## Interface: exact changes

### `optimize_run.py`

1. Add a last field to `OptimizeResult`, with a default so no other construction site has to change:
   ```python
       optimized_point: tuple[float, float] | None = None
   ```
2. Add a keyword parameter to `run_optimize`, after `rf`:
   ```python
       include_frontier: bool = True,
   ```
   Document it in the docstring: when `False`, the frontier sweep, the random cloud and the extra
   max-Sharpe solve are skipped, and `frontier` is `None`. `optimized_point` is computed either way.
3. Move these lines **out of** the frontier `try:` block to just before it, unchanged:
   - `mu = returns.mean().values * 252`
   - `cov = returns.cov().values * 252`
   - the nested `def point(...)`
   - `current_fit = ...` and its `/=` normalisation
   - `optimized_fit = ...`
   
   Then add:
   ```python
   optimized_point = point(optimized_fit)
   ```
4. Wrap the remaining frontier block in `if include_frontier:`. Inside it nothing changes, except
   that `FrontierResult(...)` uses `optimized=optimized_point` instead of calling
   `point(optimized_fit)` again. `frontier` stays initialised to `None` before the `if`. The
   `except` that appends `"The efficient frontier could not be computed for this run."` stays inside
   the `if`, so it never fires when the frontier was skipped.
5. Pass `optimized_point=optimized_point` in the `return OptimizeResult(...)`.

### `compare_run.py`

6. In `_mode_row`, change `point=None if run.frontier is None else run.frontier.optimized` to
   `point=run.optimized_point`.
7. In `run_compare`, the in-sample loop over `MODES[1:]` calls
   `run_optimize(..., include_frontier=False, **common)`. The in-sample `equal_run` call is
   **unchanged** and keeps the default `True`, because its frontier is the one the comparison
   returns.
8. In `_run_fold`, both `run_optimize` calls (the fold's `equal` and the loop over `MODES[1:]`) pass
   `include_frontier=False`.

**The one intended output difference.** Today, if the frontier sweep fails, the equal-weight row's
`point` is `None`. After this change it holds the computed point. In that case the comparison's
`frontier` is `None` (it still comes from the equal run), and the frontend draws mode points only
when `frontier` is non-null (`compareFrontierData` in `frontend/src/lib/research.ts` returns `null`
first). So nothing visible changes. Do not add code to null the point to preserve the old value.

## Out of scope

- Do not change `efficient_frontier`, `random_portfolios`, any optimizer, or `backtest_series`.
- Do not change the `/portfolio/optimize` route or its response.
- Do not parallelise folds or modes.

## Acceptance criteria

1. New tests in `tests/test_optimize_run.py`, using that file's existing fixtures:
   - **a.** A default `run_optimize` (mode `min_variance`) has `optimized_point is not None` and
     `result.optimized_point == result.frontier.optimized`.
   - **b.** The same call with `include_frontier=False` has `frontier is None`, and its
     `optimized_point` equals (a)'s within `pytest.approx(rel=1e-12)`. Its `warnings` do not contain
     `"The efficient frontier could not be computed for this run."`.
   - **c.** With `include_frontier=False`, monkeypatch `app.optimize_run.efficient_frontier` and
     `app.optimize_run.random_portfolios` to raise `AssertionError("frontier was computed")`. The
     call completes without raising.
2. A new test in `tests/test_compare_run.py`:
   - Wrap `app.optimize_run.efficient_frontier` and `app.optimize_run.random_portfolios` with
     monkeypatched counters that call through to the originals.
   - Run `run_compare` once on that file's existing multi-holding fixture.
   - Assert each counter is exactly `1`.
3. `cd backend && .venv/bin/python -m pytest tests/test_optimize_run.py tests/test_compare_run.py -q`
   passes, including every pre-existing test, unchanged.
4. `cd backend && .venv/bin/python -m pytest -q` passes. This is the whole backend suite.
5. **End-to-end reference.** `cd backend && DATABASE_URL="" .venv/bin/python ../contracts/tools/compare_reference.py check`
   prints `MATCH`. The planner recorded it before this contract. It compares every field of three
   `run_compare` results, including each mode's `point` and the full frontier and cloud, at a
   relative 1e-9. Run `check` only, **never `record`**.
6. `grep -c "include_frontier=False" backend/app/compare_run.py` prints `3`: the in-sample loop and
   the two fold calls.
7. `grep -n "optimized_point" backend/app/routers/portfolio.py` prints nothing.
8. **Planner-run.** The planner times `compare_reference.py check` before and after, with
   informational timings as in 0192.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string — so any script run without that prefix talks to the **production database**.
> `tests/conftest.py` strips the variable for `pytest` only; it does not cover scripts.

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up. A description of the output is not the
output.

```bash
cd backend && .venv/bin/python -m pytest tests/test_optimize_run.py tests/test_compare_run.py -v 2>&1 | tail -30; cd ..
cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -3; cd ..
cd backend && DATABASE_URL="" .venv/bin/python ../contracts/tools/compare_reference.py check; cd ..
grep -c "include_frontier=False" backend/app/compare_run.py
grep -n "optimized_point" backend/app/routers/portfolio.py
```

State which files you edited.

## Human verification — does Gunnar need to run anything?

- **Nothing to run.** The output is proven unchanged by the reference check. After deploy, the
  Research and Optimize-comparison waits should be shorter.

## Open questions

None. If `compare_reference.py check` reports a mismatch, report `BLOCKED` with its output. Do not
edit `contracts/tools/` or re-record the reference.
