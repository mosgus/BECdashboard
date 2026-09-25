# Contract 0105: `run_optimize`, the pure orchestration behind Optimize

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Create `backend/app/optimize_run.py` with one pure function, `run_optimize(...)`. It does everything
`main`'s `POST /portfolios/{id}/optimize` handler did between loading prices and returning JSON. It
takes the price series as arguments, so it has **no database, network, FastAPI or `date.today()`**.
The thin endpoint that loads bars and calls this is 0106.

It does these jobs:
1. It picks the fit window from a lookback in days.
2. It **pins** young holdings.
3. It scales the bounds and runs the feasibility guards.
4. It dispatches the nine modes, including conviction views, κ and CAPM, as in `main`.
5. It falls back to the current weights when the solver doesn't converge.
6. It **scores** Current, Optimized and SPY with 0104's `backtest_series`.
7. It computes the metrics.

## Why

REBUILD.md, "The Backtest tab becomes Optimize", has the rules this implements. Read that entry first,
especially these bullets:
- "Picking vs scoring are two jobs"
- "Young holdings are pinned, not allowed to shrink the fit" (decided 2026-09-24)
- "Cash is excluded from both curves"
- "Metrics are computed from the scored curve's daily returns"

The reference handler is `git show main:backend/routers/portfolios_optimize.py`, in `optimize_portfolio`,
lines 125–327. Follow its dispatch, its views/κ handling, its warnings and its non-convergence fallback
**line for line**, except where this contract says otherwise. The deliberate departures from `main` are:
- pinning and bound scaling
- scoring with `backtest_series` instead of daily-rebalanced constant weights
- a lookback measured back from the last common bar rather than from today
- SPY supplied by the caller, and CAPM refusing to run without it

## Files

Create:
- `backend/app/optimize_run.py`
- `backend/tests/test_optimize_run.py`

**Touch nothing else.** In particular, don't edit `app/optimizer.py`, `app/portfolio_series.py`, any
router or `schemas.py`. If the work appears to require it, stop and report `BLOCKED`.

**`reference files/` is read-only and never belongs on a file list.** The same applies to
`~/WebstormProjects/blue-eagle-reference`. Read `main` only through `git show main:<path>`.

**`backend/.env` holds the live production database URL.** Every ad-hoc `python -c` must be prefixed
with `DATABASE_URL=""`.

**Take the before test count before editing anything.** Don't overwrite working files to recover it.

## Interface

```python
Mode = Literal["equal_weight", "min_variance", "max_sharpe", "max_sharpe_capm", "risk_parity",
               "max_sortino", "min_cvar", "max_diversification", "target_volatility"]
LOOKBACK_DAYS = (365, 730, 1095, 1825)   # main's 1Y/2Y/3Y/5Y buttons
PIN_GRACE_DAYS = 7
BENCHMARK = "SPY"

class OptimizeInputError(ValueError):
    """The request cannot be optimized as asked. 0106 maps it to HTTP 422 with str(exc) as the detail."""

@dataclass(frozen=True)
class PinnedHolding:
    ticker: str
    first_bar: date
    weight: float          # its current (normalised) weight, which is also its target weight
    exceeds_max: bool      # weight > max_weight + 1e-9

@dataclass(frozen=True)
class OptimizeCurves:
    dates: list[date]
    current: list[float]
    optimized: list[float]
    benchmark: list[float] | None

@dataclass(frozen=True)
class OptimizeResult:
    tickers: list[str]                       # input order of `weights`
    current_weights: dict[str, float]        # normalised to sum 1
    target_weights: dict[str, float]         # sums to 1; pinned tickers keep their current weight
    implied_trades: dict[str, float]         # target − current
    pinned: list[PinnedHolding]              # input order
    fit_start: date                          # first date of the fit returns
    fit_end: date                            # last date of the fit returns
    score_start: date                        # curves' first date
    score_limited_by: str | None             # ticker whose first bar set score_start, or None
    curves: OptimizeCurves
    metrics: dict                            # {"current": …, "optimized": …, "forward_looking": dict | None}
    capm_expected_returns: dict[str, float] | None
    feasible: bool
    mode: str
    rebalance: str
    lookback_days: int
    views_applied: bool
    delta_mu: dict[str, float]
    warnings: list[str]

def run_optimize(
    weights: dict[str, float],
    closes: dict[str, pd.Series],
    benchmark: pd.Series | None,
    *,
    mode: Mode = "min_variance",
    lookback_days: int = 1825,
    max_weight: float = 1.0,
    min_weight: float = 0.0,
    vol_target: float = 0.10,
    allow_short: bool = False,
    conviction_views: dict[str, float] | None = None,
    kappa: float = 0.05,
    rebalance: Rebalance = "none",
    rf: float = 0.0427,
) -> OptimizeResult: ...
```

Every float in the result is a Python `float`. Do **not** round anything here. Rounding for display is
the UI's job.

## Rules, in order

1. **Input checks** raise `OptimizeInputError`:
   - `weights` is empty, or a weight is ≤ 0 or non-finite.
   - A weighted ticker is missing from `closes`, or its series is empty.
   - `mode` is not one of the nine.
   - `lookback_days` is not in `LOOKBACK_DAYS`.
   - `rebalance` is not one of the four values.
2. **Current weights** are `cw = w / Σw`, over the tickers only. The caller has already removed cash.
3. **Window.**
   - `end` = the minimum, across the weighted tickers, of each series' last index date.
   - `lookback_start = end − timedelta(days=lookback_days)`.
4. **Pinning.**
   - A ticker is pinned when its first index date is `> lookback_start + timedelta(days=PIN_GRACE_DAYS)`.
   - The **fitted** set F is every other ticker. If `len(F) < 2`, raise `OptimizeInputError`, and the
     message must contain `"at least 2 holdings with full history"`.
   - Let `p = Σ cw[pinned]` and `s = 1 − p`.
5. **Fit returns.**
   - Build a frame of the F tickers' closes, keeping rows with `lookback_start <= date <= end`.
   - Forward-fill it (no back-fill), then apply `compute_returns` from `app.optimizer`, which is
     `pct_change().dropna()`.
   - `fit_start` and `fit_end` are that frame's first and last index.
   - If it has fewer than 60 rows, append `main`'s warning:
     `"Fewer than 60 trading days of history — optimization results may be unreliable."`
6. **Bounds, scaled so that the user's bounds apply to final weights.**
   - `max_fit = min(1.0, max_weight / s)`.
   - `global_min = 0.0 if allow_short else min_weight / s`.
   - `min_w = -max_fit if allow_short else global_min`.
   - If `allow_short`, append `main`'s warning verbatim:
     `"Short positions enabled. Equal Weight, Risk Parity, and Max Diversification remain long-only."`
   - Then run `main`'s two feasibility guards with `n = len(F)`, `max_fit` and `global_min`:
     - `global_min > 0 and global_min * n > 1 + 1e-6`
     - `max_fit < 1/n − 1e-6`

     Each raises `OptimizeInputError`, not HTTPException. Keep `main`'s wording, but state the
     numbers in **final-weight** terms, i.e. the user's `min_weight`/`max_weight`. When anything is
     pinned, add `" (after pinning {p:.1%} in short-history holdings)"`.
7. **Views and κ**, as in `main`.
   - `views_applied = bool(conviction_views) and mode in {"max_sharpe", "max_sharpe_capm", "max_sortino"}`.
   - When `views_applied`, `delta_mu[t] = kappa * conviction_views.get(t, 0.0) / 100` for every
     t in F. Otherwise `delta_mu = {}`.
   - The bump is `returns[t] + delta_mu[t] / 252` on a copy of the fit returns, for max_sharpe and
     max_sortino.
8. **Dispatch.** Use the same calls and the same per-mode bound arguments as `main`'s if/elif chain,
   with `max_fit`/`min_w` in place of `body.max_weight`/`min_w`. For `max_sharpe_capm`:
   - If `benchmark is None`, raise `OptimizeInputError`, and the message must contain `"SPY"`.
   - Otherwise:
     - `betas = compute_betas(compute_returns(frame_with_SPY), "SPY")`. `frame_with_SPY` is the F
       frame from rule 5 with the benchmark joined as column `"SPY"`, using the same row filter and
       forward fill.
     - `capm_views = {t: u / 100 for t, u in (conviction_views or {}).items()}`.
     - `exp_ret = compute_capm_expected_returns(betas, rf=rf, mrp=0.05, views=capm_views)`.
     - Add `delta_mu` on top, as in `main`.
     - Call `optimize_max_sharpe_capm(returns, exp_ret, rf=rf, …)`.
     - Keep `exp_ret` for the output.
9. **Non-convergence.** On `RuntimeError`:
   - Append `f"Optimizer did not converge: {exc}"`.
   - Set the fitted weights to `cw[F]` renormalised over F, and set `feasible = False`.
   - Otherwise `feasible = True`.
10. **Final weights.**
    - `target[t] = fit[t] × s` for t in F.
    - `target[t] = cw[t]` for pinned t.
    - Keep the input order, and use `implied_trades = target − cw`.
11. **Scoring.**
    - Slice every weighted ticker's closes to `lookback_start <= date <= end`.
    - `cur = backtest_series(cw, sliced, rebalance)` and `opt = backtest_series(target, sliced, rebalance)`.
    - `score_start = cur.start`.
    - `score_limited_by` is the ticker whose sliced first date equals `score_start` **when**
      `score_start > fit_start`. Otherwise it is `None`. If several tickers qualify, take the first in
      input order.
12. **Benchmark curve.** When `benchmark` is given:
    - Reindex it to `cur.dates` with a forward fill, then scale it to 100 at `cur.dates[0]`.
    - If any value is missing (SPY has no bar at or before `score_start`), set `benchmark = None` and
      append a warning containing `"SPY"`.
    - When `benchmark` is not given, the curve is `None` and a warning must contain `"SPY is not stored"`.
13. **Metrics.**
    - `r_cur = pd.Series(cur.total).pct_change().dropna()`, with the same for opt and the benchmark
      curve.
    - `metrics["current"] = compute_metrics(r_cur, r_bench_or_None)`, with the same for optimized, and
      rf = 0 as in `main`.
    - `metrics["forward_looking"]`:
      - It is only present for `max_sharpe_capm`, as
        `compute_forward_looking_metrics(target_F_only, exp_ret, returns, rf=rf)`. That covers the
        fitted holdings only, which is fine: the UI labels it.
      - It is `None` for every other mode.
    - `capm_expected_returns` is `exp_ret` for CAPM, and `None` otherwise.

## Out of scope

- The endpoint, schemas, bar loading, the risk-free fetch and the tilt endpoint belong to 0106.
- Don't port `compute_tilt` usage here.

## Fixtures (literal)

```python
from datetime import date, timedelta
import numpy as np, pandas as pd

DATES = [d.date() for d in pd.bdate_range("2024-01-02", "2024-12-31")]   # 261 dates
a, b = 0.01, 0.02
RA = np.tile([a, -a, a, -a], 65)          # 260 returns
RB = np.tile([b, b, -b, -b], 65)
def px(r):
    return pd.Series(100 * np.concatenate([[1], np.cumprod(1 + r)]), index=DATES)
A, B = px(RA), px(RB)                      # the fit returns reproduce UNCORR exactly: cov(A, B) = 0
Y = pd.Series(50.0, index=[d for d in DATES if d >= date(2024, 6, 3)])   # young: listed 2024-06-03
SPY = A.copy()                             # beta(A) = 1, beta(B) = 0
CLOSES = {"A": A, "B": B, "Y": Y}
```

With `lookback_days=365`, `end = 2024-12-31` and `lookback_start = 2024-01-01`. A and B start on
2024-01-02, inside the grace, so they are fitted. Y starts on 2024-06-03, so it is pinned. The fit
returns have 260 rows from 2024-01-03.

I checked these in a scratch run against the real `app.optimizer` and `app.portfolio_series`:
- `optimize_min_variance` on the fit returns gives A .80 / B .20. With `max_weight=.6` it gives
  .60 / .40.
- CAPM gives betas A 1.0 and B 0.0, and `exp_ret` A .09 and B .04 at rf .04. `optimize_max_sharpe_capm`
  gives A 1.0 / B 0.0.
- `optimize_target_volatility(vol_target=.01)` raises.
- `backtest_series({"A": .25, "B": .25, "Y": .5}, CLOSES)` starts on 2024-06-03 with 152 dates.

## Acceptance criteria

Tolerance is **±0.01** unless stated. Never assert float equality.

1. `(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q)` passes. The count is **581 + at
   least 15**. Paste the before and after counts. The existing tests pass unmodified.
2. `grep -n "^from app.db\|^import app.db\|sqlalchemy\|fastapi\|yfinance\|today()" backend/app/optimize_run.py`
   prints nothing.
3. **No pin, analytic.** Use `run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, lookback_days=365)`.
   It is min_variance by default. Expect:
   - `target_weights` A .80 / B .20
   - `pinned == []` and `score_limited_by is None`
   - `fit_start == date(2024, 1, 3)` and `fit_end == date(2024, 12, 31)`
   - `feasible is True`
   - `curves.current[0]`, `curves.optimized[0]` and `curves.benchmark[0]` each 100
   - `len(curves.dates) == 261`
4. **Pinning.** Use `run_optimize({"A": 1, "B": 1, "Y": 2}, CLOSES, SPY, lookback_days=365)`. Expect:
   - `current_weights` A .25 / B .25 / Y .50
   - `target_weights` A .40 / B .10 / Y .50
   - `pinned == [PinnedHolding("Y", date(2024, 6, 3), 0.5, False)]`. Compare the weight with approx.
   - `score_start == date(2024, 6, 3)`, `score_limited_by == "Y"` and `len(curves.dates) == 152`
   - `fit_start == date(2024, 1, 3)`. Y does **not** shorten the fit.
5. **Bounds scale to final weights.** The same call as 4 with `max_weight=.3` gives:
   - `target_weights` A .30 / B .20 / Y .50
   - `pinned[0].exceeds_max is True`
6. **Feasibility.** The same call with `max_weight=.2` raises `OptimizeInputError`, and the message
   contains `"after pinning"`. `run_optimize({"A": 1, "B": 1}, …, max_weight=.4, lookback_days=365)`
   raises `OptimizeInputError`, since .4 < 1/2. `min_weight=.6` on the no-pin call raises it too.
7. **Too few fitted.** `run_optimize({"A": 1, "Y": 1}, CLOSES, SPY, lookback_days=365)` raises
   `OptimizeInputError` containing `"at least 2 holdings with full history"`.
8. **Equal weight with pin.** With `mode="equal_weight"` on the call in 4, `target_weights` is
   A .25 / B .25 / Y .50.
9. **CAPM.** Use `mode="max_sharpe_capm"`, `rf=.04` on the no-pin call. Expect:
   - `capm_expected_returns` A .09 / B .04
   - `target_weights` A 1.0 / B 0.0
   - `metrics["forward_looking"]` has the keys `expected_return`, `vol` and `sharpe`

   The same call with `benchmark=None` raises `OptimizeInputError` containing `"SPY"`.
10. **Views and κ.**
    - With `mode="max_sharpe"`, `conviction_views={"A": 20}` and `kappa=.05` on the no-pin call:
      `views_applied is True` and `delta_mu == {"A": .01, "B": 0.0}`, with approx.
    - The same views with `mode="min_variance"`: `views_applied is False` and `delta_mu == {}`.
11. **Non-convergence fallback.** Use `mode="target_volatility"`, `vol_target=.01` on
    `run_optimize({"A": 3, "B": 1}, …)`. Expect:
    - `feasible is False`
    - `target_weights` A .75 / B .25
    - a warning starting `"Optimizer did not converge"`
12. **Scoring uses `backtest_series`.** On the call in 4, `curves.current` equals
    `backtest_series({"A": .25, "B": .25, "Y": .5}, CLOSES).total`, and `curves.optimized` equals
    `backtest_series({"A": .4, "B": .1, "Y": .5}, CLOSES).total`, elementwise ±1e-6. Also,
    `rebalance="monthly"` changes `curves.optimized[-1]`, and the test asserts it differs from the
    `"none"` value by more than 1e-6.
13. **Identical portfolios score identically.** With `mode="equal_weight"` on
    `run_optimize({"A": 1, "B": 1}, …)`:
    - `curves.current == curves.optimized` (±1e-9)
    - `metrics["current"]["cagr"] == metrics["optimized"]["cagr"]` (±1e-9)
    - both metrics dicts contain `beta` and `alpha`
14. **Benchmark handling.**
    - `benchmark=None` on a non-CAPM call gives `curves.benchmark is None`, a warning containing
      `"SPY is not stored"`, and metrics without a `beta` key.
    - A benchmark whose first date is after `score_start` (use `SPY[SPY.index >= date(2024, 7, 1)]`)
      gives `curves.benchmark is None` and a warning containing `"SPY"`.
15. **Short warning.** `allow_short=True` appends `main`'s verbatim short warning, and the target
    weights still sum to 1 (±1e-6).
16. **Input errors.** Each of these raises `OptimizeInputError`:
    - `{}`
    - a zero weight
    - an unknown mode
    - `lookback_days=400`
    - `rebalance="weekly"`
    - a ticker absent from `closes`

If a criterion can't be met as written, for example because a scratch-verified number doesn't
reproduce, **report `BLOCKED` with the value you got**. Don't adjust a fixture, a tolerance or an
expected value.

## Verification to run and paste

Run each from the repo root. Paste the **complete, verbatim** output.

```bash
(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q 2>&1 | tail -3)
(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q tests/test_optimize_run.py -v 2>&1 | tail -40)
grep -n "^from app.db\|^import app.db\|sqlalchemy\|fastapi\|yfinance\|today()" backend/app/optimize_run.py
grep -n "PIN_GRACE_DAYS\|LOOKBACK_DAYS\|class OptimizeInputError" backend/app/optimize_run.py
git status --short
```

## Tooltips — required for any contract adding interactive elements

This is a backend-only contract with no interactive elements.

## Human verification — does Gunnar need to run anything?

No. The first visible result comes with the UI contract.

## Open questions

None. The pinning rules come from Gunnar's 2026-09-24 decision in REBUILD.md.
