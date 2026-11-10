# Contract 0192 — `backtest_series` on numpy arrays instead of a per-day pandas loop

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, `app.portfolio_series.backtest_series` returns the same results as today,
equal within a relative 1e-9, but computes them on numpy arrays. There is no Python loop that reads
one pandas row per trading day.

## Why

The planner profiled `run_compare` on 2026-11-09: a 10-holding, 12-year portfolio took 3.8 s
locally. **1.7 s of that was `backtest_series`.** It loops over every trading day, builds a pandas
row with `prices.iloc[index]`, and reads each price with `row[ticker]`. That's about 1.1 million
pandas lookups per comparison, because one comparison calls `backtest_series` about 116 times. The
same function scores every Historical Optimize run.

The arithmetic is simple:
- A buy-and-hold segment is `prices × units`.
- At each rebalance date, units are re-derived from the portfolio's value that day.

On arrays this should take milliseconds.

**This is a pure performance change.** Every output must stay the same. The proof is a permanent
equivalence test against the current implementation, plus the planner's end-to-end comparison
reference.

## Files

Modify:
- `backend/app/portfolio_series.py`: the body of `backtest_series` only.
- `backend/tests/test_portfolio_series.py`: add the equivalence tests below. Do not change any
  existing test.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs — that is what it is for — but it is a snapshot of other working software kept so its behaviour
can be compared against this rebuild, and an edited reference stops being evidence of anything.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it.

**`BLOCKED` is also the right answer if any criterion below cannot be satisfied as written.** Do not
find a clever way to pass a criterion that contradicts another one or the code. Stop and say which.

## Interface

The signature, the `BacktestSeries` dataclass, and every `ValueError` (with its message) stay
exactly as they are:

```python
def backtest_series(
    weights: dict[str, float],
    closes: dict[str, pd.Series],
    rebalance: Rebalance = "none",
    anchor_value: float = 100.0,
) -> BacktestSeries
```

What must not change:
1. **Validation:** the four checks at the top, in the same order with the same messages.
2. **Alignment:** `normalised`, `start`, and building `prices` (the `DataFrame`, `sort_index`,
   `>= start` filter and `ffill`) stay as they are, line for line.
3. **Return types:**
   - `dates` is `list(prices.index)`, the same objects as today.
   - `start` is unchanged.
   - `total` and every `by_holding[ticker]` are Python `list[float]` with one entry per date. Use
     `ndarray.tolist()`, not numpy scalars.
   - `by_holding` keys appear in `weights` order.
   - `rebalance_dates` is a list of the same date objects that are in `dates`.
4. **Starting units:** they still come from
   `units_from_weights(normalised, 0.0, prices_at_start, anchor_value)`.
5. **Rebalance timing:** a rebalance happens on the first date (index > 0) whose `_period_key`
   differs from the previous date's. On that date:
   - The portfolio value is `sum(units × that day's prices)`, using the units held **before** the
     rebalance.
   - The new units are `normalised × value / that day's price`.
   - That day's row is valued with the **new** units, as today.
   
   Use `_period_key` to find the boundaries. Computing the keys once per date is fine; that's a few
   thousand cheap calls.
6. **NaN:** a NaN price propagates NaN the same way it does today, since numpy and Python
   arithmetic agree on NaN. Do not add `nan` handling, `fillna`, or `np.errstate` suppression.

Implementation shape (the details are yours):
- `values = prices[list(weights)].to_numpy(dtype=float)`, columns in `weights` order.
- Split the rows into segments at the rebalance indices (one segment for `"none"`).
- For each segment, `values[seg] * units_vector`. `total` is the row sum.

Sums may come out in a different order than Python's sequential `sum`. That is why the tolerance
below is relative 1e-9, not exact equality.

## Out of scope

- Do not change `align_closes`, `units_from_weights`, `value_series`, `build_portfolio_series` or
  `_period_key`.
- Do not change any caller (`optimize_run.py`, `compare_run.py`).
- Do not "fix" behaviour you think is wrong, e.g. a NaN start price. Report it instead.
- No new dependencies.

## Acceptance criteria

1. **The old implementation becomes the test oracle.** At the start of the work, before editing
   `portfolio_series.py`, copy the current body of `backtest_series` verbatim into
   `tests/test_portfolio_series.py` as `_loop_backtest_series`. It is the per-day loop version
   committed at `HEAD:backend/app/portfolio_series.py` as of 2026-11-09. Keep its signature and
   return type. Change only the name, and prefix its docstring with
   `"Pre-0192 reference implementation, kept as the equivalence oracle."`.
2. A new parametrized test `test_matches_loop_reference` runs **all four** rebalance schedules
   (`"none"`, `"monthly"`, `"quarterly"`, `"annual"`) against **each** fixture below. For every
   combination it asserts:
   - `dates`, `start` and `rebalance_dates` are `==` the oracle's.
   - `total` and every `by_holding[ticker]` are `pytest.approx(oracle, rel=1e-9, nan_ok=True)`.
   - The `by_holding` key order is equal.
   
   The fixtures, written as code:
   - **staggered:**
     - `rng = np.random.default_rng(192)` and `dates = pd.bdate_range("2016-01-04", periods=2600)`.
     - Six tickers `"A"`–`"F"`, each `100 * np.cumprod(1 + rng.normal(0.0003, 0.012, len(dates)))`.
     - `"E"` starts at `dates[400]`.
     - `"F"` drops every third row (`k % 3 == 2`).
     - Weights `{"A": 0.3, "B": 0.2, "C": 0.15, "D": 0.15, "E": 0.1, "F": 0.1}`.
   - **shorts:** two tickers from the same `rng` over 500 dates, weights `{"X": 1.5, "Y": -0.5}`.
   - **single:** one ticker over 300 dates, weights `{"Z": 1.0}`.
3. `cd backend && .venv/bin/python -m pytest tests/test_portfolio_series.py -q` passes, including
   every pre-existing test, unchanged.
4. `cd backend && .venv/bin/python -m pytest -q` passes. This is the whole backend suite.
5. `grep -n "iloc\[index\]" backend/app/portfolio_series.py` prints nothing.
   `grep -n "for index, current_date in enumerate" backend/app/portfolio_series.py` prints nothing.
   The oracle in the test file is exempt; these greps cover the app module only.
6. **End-to-end reference.** `cd backend && DATABASE_URL="" .venv/bin/python ../contracts/tools/compare_reference.py check`
   prints `MATCH`. The script was recorded by the planner before this contract and runs
   `run_compare` on fixed data. Coders run `check` only, **never `record`**.
7. **Planner-run.** The planner times `compare_reference.py check`. The recorded pre-0192 timings
   were 2.66 s / 3.13 s / 2.84 s. Each case should drop by roughly the share `backtest_series` used
   to take, about 40%. This is informational and not a pass/fail gate.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string — so any script run without that prefix talks to the **production database**.
> `tests/conftest.py` strips the variable for `pytest` only; it does not cover scripts.

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up. A description of the output is not the
output.

```bash
cd backend && .venv/bin/python -m pytest tests/test_portfolio_series.py -v 2>&1 | tail -40; cd ..
cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -3; cd ..
grep -n "iloc\[index\]" backend/app/portfolio_series.py
grep -n "for index, current_date in enumerate" backend/app/portfolio_series.py
cd backend && DATABASE_URL="" .venv/bin/python ../contracts/tools/compare_reference.py check; cd ..
```

State which files you edited.

## Human verification — does Gunnar need to run anything?

- **Nothing to run.** There is no visible change; the outputs are proven equal by the oracle test and
  the reference check. Speed shows up in the Research and Optimize tabs after deploy.

## Open questions

None. If the oracle and the new implementation disagree beyond 1e-9 on a fixture, report `BLOCKED`
with the first mismatching index. Do not loosen the tolerance or change the fixture.
