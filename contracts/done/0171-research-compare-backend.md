# Contract 0171 — Research backend: `POST /portfolio/compare` (8 modes, in-sample + holdout, frontier, correlation)

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

After this contract the backend can compare all eight optimizer modes on one portfolio in a single
request. Each mode gets:
- **in-sample** metrics, fit and scored on the same lookback, exactly as Historical Optimize does it today;
- **holdout** metrics, fit on the same-length lookback ending 365 days before the last bar, then
  scored on those last 365 days, which the fit never saw.

The response also carries the efficient frontier, with every mode's position on it, and a
correlation matrix of the holdings in cluster order.

There is no frontend change. The Research tab and the Portfolio pill are contracts 0172 and 0173.

## Why

This is step 1 of the Research tab (REBUILD.md, "Next: a Research tab inside Portfolios", and the
2026-10-26 entry under it). `main`'s Portfolio Research page compared the eight modes **in-sample
only**, so every mode won on its own objective. Max Sharpe was guaranteed the best Sharpe, and the
page coloured that green as a finding.

On the real BEC portfolio, fit on four years and scored on the next twelve months, the ranking
came out reversed:

| mode | in-sample Sharpe | next-12-months Sharpe |
|---|---|---|
| Max Sharpe | 1.91 (best) | −0.10 (worst) |
| Equal Weight | 1.32 (worst) | 0.38 (best) |

Gunnar chose in-sample **plus** a holdout (2026-10-26). The holdout is a single fold of what
Robustness's walk-forward will later do with several.

**Reuse, don't port.** `main`'s endpoint (`git show main:backend/routers/research.py | sed -n 120,196p`)
called a separate optimizer dispatcher. The rebuild's `run_optimize` already handles pinning of
young holdings, the risk-free rate, weight limits, convergence failure and warnings. Every number
in this contract comes from calling `run_optimize`, so the in-sample columns match what Historical
Optimize shows for the same settings, row for row. All 16 runs on BEC took about 1 second, so
there are no threads.

**Correlation fixes against `main`** (`git show main:backend/routers/research.py | sed -n 229,272p`):
- `main` called `returns.corr()` on holdings with different start dates. pandas then uses a
  different date range for each pair, so the cells aren't comparable and the matrix need not be
  positive semi-definite. Here, every pair is measured over **one common window**.
- `main` ran Ward linkage on `1 − ρ`. Ward assumes Euclidean distances, and `1 − ρ` is not one.
  Here: distance `√(½(1 − ρ))` with **average** linkage and `optimal_ordering=True`.
- `main` fell back silently on any exception (`except Exception: logger.debug`). Here nothing is
  caught: a zero-variance holding is excluded up front, so a failure from scipy is a real bug.

## Files

Create:
- `backend/app/compare_run.py`: the pure orchestration (`run_compare`) and `correlation_matrix`.
- `backend/tests/test_compare_run.py`
- `backend/tests/test_api_compare.py`

Modify:
- `backend/app/schemas.py`: add the request and response models below.
- `backend/app/routers/portfolio.py`: add `POST /portfolio/compare`.

**Touch nothing else.** In particular, `app/optimize_run.py`, `app/optimizer.py` and
`app/portfolio_series.py` are **called, never edited**. If the work appears to need a change to
them, stop and report `BLOCKED`.

`reference files/` and the `main` branch are read-only.

## Interface

### `app/compare_run.py`

```python
HOLDOUT_DAYS = 365
MODES: tuple[Mode, ...] = (
    "equal_weight", "min_variance", "max_sharpe", "risk_parity",
    "max_sortino", "min_cvar", "max_diversification", "target_volatility",
)  # import Mode from app.optimize_run; this order is the response order


@dataclass(frozen=True)
class CompareMetrics:
    cagr: float | None
    vol: float | None
    sharpe: float | None
    max_dd: float | None


@dataclass(frozen=True)
class ModeRow:
    mode: str
    error: str | None                       # str(OptimizeInputError) from the in-sample run, else None
    feasible: bool | None                   # in-sample run's .feasible; None when error is set
    target_weights: dict[str, float] | None # in-sample run's .target_weights
    traded: float | None                    # sum(abs(v) for v in run.implied_trades.values())
    in_sample: CompareMetrics | None        # from run.metrics["optimized"]
    point: tuple[float, float] | None       # run.frontier.optimized (vol, ret), None if no frontier
    holdout_weights: dict[str, float] | None
    holdout: CompareMetrics | None
    holdout_error: str | None


@dataclass(frozen=True)
class CurrentRow:
    in_sample: CompareMetrics               # equal_weight in-sample run's metrics["current"]
    holdout: CompareMetrics | None
    point: tuple[float, float] | None       # equal_weight run's frontier.current


@dataclass(frozen=True)
class HoldoutWindow:
    fit_start: date
    fit_end: date
    score_start: date                       # == fit_end: the last fitted bar is the first scored price
    score_end: date
    tickers: list[str]                      # eligible holdings, in request order
    excluded: list[str]                     # holdings with no bar on or before the cut, in request order


@dataclass(frozen=True)
class CorrelationResult:
    tickers: list[str]                      # cluster order
    matrix: list[list[float]]               # rows and columns in `tickers` order
    start: date                             # first return date in the common window
    end: date
    n_returns: int
    limited_by: str | None
    excluded: list[str]                     # zero-variance holdings, in input order


@dataclass(frozen=True)
class CompareFrontier:
    points: list[tuple[float, float]]
    cloud: list[tuple[float, float]]
    tickers: list[str]
    excluded: list[str]


@dataclass(frozen=True)
class CompareResult:
    tickers: list[str]
    current_weights: dict[str, float]
    pinned: list[str]
    lookback_days: int
    rebalance: str
    rf: float
    fit_start: date
    fit_end: date
    score_start: date
    current: CurrentRow
    modes: list[ModeRow]                    # len 8, MODES order
    holdout: HoldoutWindow | None
    holdout_unavailable: str | None         # set exactly when holdout is None
    frontier: CompareFrontier | None
    correlation: CorrelationResult | None
    warnings: list[str]


def run_compare(
    weights: dict[str, float],
    closes: dict[str, pd.Series],
    benchmark: pd.Series | None,
    *,
    lookback_days: int = 1825,
    max_weight: float = 1.0,
    min_weight: float = 0.0,
    vol_target: float = 0.10,
    rebalance: Rebalance = "none",
    rf: float = 0.0427,
) -> CompareResult: ...


def correlation_matrix(
    closes: dict[str, pd.Series], tickers: list[str], start: date, end: date,
) -> CorrelationResult | None: ...
```

### Algorithm: `run_compare`

All `run_optimize` calls pass `lookback_days`, `max_weight`, `min_weight`, `vol_target`,
`rebalance` and `rf` through unchanged. They never pass `allow_short` (long-only), and never pass
`mode` from the request. There is no mode in the request.

1. **In-sample, equal_weight first.** Call `run_optimize(weights, closes, benchmark, mode="equal_weight", …)`.
   If it raises `OptimizeInputError`, **let it propagate**: equal weight has no mode-specific
   failure, so this is a shared input error (bad lookback, fewer than 2 full-history holdings, …),
   and the router turns it into a 422. From this run take `tickers`, `current_weights`, `pinned`
   (tickers only), `fit_start`, `fit_end`, `score_start`, `warnings`, `current.in_sample`
   (`metrics["current"]`), `current.point` (`frontier.current`) and `frontier` (`points`, `cloud`,
   `tickers`, `excluded`; `None` if the run's frontier is `None`).
2. **In-sample, the other seven.** Call `run_optimize` once per mode, in `MODES` order. Catch
   **`OptimizeInputError` only**: it becomes `ModeRow.error`, every other field is `None`, and the
   row stays in the list. Anything else propagates. Never write `except Exception`.
3. **Holdout cut.** `end = min(closes[t].index[-1] for t in weights)`; `cut = end - timedelta(days=HOLDOUT_DAYS)`.
   A holding is **eligible** if `closes[t].index[0] <= cut`. With fewer than 2 eligible holdings,
   `holdout = None`, `holdout_unavailable = f"The holdout needs at least 2 holdings with prices on or before {cut}; {n} have them."`,
   and every row's `holdout_weights`, `holdout` and `holdout_error` stay `None`.
4. **Holdout fits.** `fit_closes = {t: closes[t].loc[closes[t].index <= cut] for t in eligible}`,
   `fit_weights = {t: weights[t] for t in eligible}`. Run equal_weight first with
   `benchmark=None`. If it raises `OptimizeInputError`, `holdout = None` and
   `holdout_unavailable = f"Holdout fit: {exc}"`. Otherwise run the same way every other mode whose **in-sample** row has `error is None`. A mode that errored in-sample gets no holdout run, and its holdout fields stay `None`. A
   mode whose holdout run raises `OptimizeInputError` gets `holdout_error = str(exc)`. A mode
   whose holdout run returns `feasible=False` gets
   `holdout_error = "The optimizer did not converge on the holdout fit."`. In both cases
   `holdout_weights` and `holdout` are `None`. Holdout run warnings are discarded.
5. **Holdout scoring.** `hfit_end` = the equal_weight holdout run's `fit_end`.
   `scored = {t: closes[t].loc[(closes[t].index >= hfit_end) & (closes[t].index <= end)] for t in eligible}`.
   For each mode with holdout weights: `backtest_series(holdout_weights, scored, rebalance)`.
   For the current row: `backtest_series(fit_weights, scored, rebalance)`. Metrics are
   `compute_metrics(pd.Series(curve.total).pct_change().dropna(), None, rf=rf)`. `HoldoutWindow`:
   `fit_start`/`fit_end` from the equal_weight holdout run, `score_start` = that curve's first
   date, `score_end` = its last date, plus `tickers` and `excluded`.
6. **Correlation.** `correlation_matrix(closes, tickers, end - timedelta(days=lookback_days), end)`.
7. **Metrics conversion.** `CompareMetrics` takes `cagr`, `vol`, `sharpe` and `max_dd` from a
   `compute_metrics` dict. A missing key, or a value that is not a finite float, becomes `None`.
   (`compute_metrics` returns `{}` for fewer than two returns.)

### Algorithm: `correlation_matrix`

1. Restrict each ticker's closes to `[start, end]`. A ticker with no bar in that range raises
   `ValueError` (callers only pass tickers `run_optimize` has already accepted).
2. `common_start = max(first bar in range, over tickers)`. Build one DataFrame from the bars on
   or after `common_start`, `ffill()` it, then `compute_returns` (from `app.optimizer`).
3. Exclude tickers whose return standard deviation is `< 1e-12`, recording them in `excluded`.
   If fewer than 2 tickers remain, or there are fewer than 2 returns, return `None`.
4. `rho = returns.corr()`. Distance `d = sqrt(clip(0.5 * (1 - rho), 0, None))`. Then set the
   diagonal to 0, symmetrise it with `(d + d.T) / 2`, and run
   `linkage(squareform(d, checks=False), method="average", optimal_ordering=True)`.
   `leaves_list` gives the order.
5. `limited_by` = the ticker whose in-range first bar equals `common_start`, **only if**
   `common_start > start + timedelta(days=PIN_GRACE_DAYS)` (import from `app.optimize_run`);
   otherwise `None`. If several tie, use the first in input order.
6. `start` = first return date, `end` = last return date, `n_returns = len(returns)`.

### Schemas (`app/schemas.py`)

```python
class CompareRequest(BaseModel):
    tickers: list[str]
    weights: list[float]
    lookback_days: int = 1825
    max_weight: float = 1.0
    min_weight: float = 0.0
    vol_target: float = 0.10
    rebalance: str = "none"

class CompareMetricsOut(BaseModel):
    cagr: float | None
    vol: float | None
    sharpe: float | None
    max_dd: float | None

class CompareModeOut(BaseModel):
    mode: str
    error: str | None
    feasible: bool | None
    target_weights: dict[str, float] | None
    traded: float | None
    in_sample: CompareMetricsOut | None
    point: FrontierPointOut | None
    holdout_weights: dict[str, float] | None
    holdout: CompareMetricsOut | None
    holdout_error: str | None

class CompareCurrentOut(BaseModel):
    in_sample: CompareMetricsOut
    holdout: CompareMetricsOut | None
    point: FrontierPointOut | None

class HoldoutWindowOut(BaseModel):
    fit_start: date
    fit_end: date
    score_start: date
    score_end: date
    tickers: list[str]
    excluded: list[str]

class CompareFrontierOut(BaseModel):
    points: list[FrontierPointOut]
    cloud: list[FrontierPointOut]
    tickers: list[str]
    excluded: list[str]

class CorrelationOut(BaseModel):
    tickers: list[str]
    matrix: list[list[float]]
    start: date
    end: date
    n_returns: int
    limited_by: str | None
    excluded: list[str]

class CompareResponse(BaseModel):
    tickers: list[str]
    current_weights: dict[str, float]
    pinned: list[str]
    lookback_days: int
    rebalance: str
    rf: float
    rf_source: str
    fit_start: date
    fit_end: date
    score_start: date
    current: CompareCurrentOut
    modes: list[CompareModeOut]
    holdout: HoldoutWindowOut | None
    holdout_unavailable: str | None
    frontier: CompareFrontierOut | None
    correlation: CorrelationOut | None
    warnings: list[str]
```

`FrontierPointOut` already exists (`{vol, ret}`). Reuse it rather than redefining it. Tuples
become `{"vol": v, "ret": r}` in the router, as `/optimize` does it.

### Route (`app/routers/portfolio.py`)

`POST /portfolio/compare`, `response_model=CompareResponse`. The prelude matches `optimize_portfolio`:
- `_require_database()`;
- `_normalise_request`;
- `_load_stored_closes`;
- the SPY benchmark fallback;
- `fetch_risk_free_rate_with_source()`.

Then call `run_compare`. `OptimizeInputError` → HTTP 422 with `str(exc)` as `detail`.

## Out of scope

- No frontend, and no change to `frontend/` at all.
- No short selling, no `allow_short`/`max_short` in the request.
- No `mode` parameter, and no subset of modes. It is always all eight.
- No configurable holdout length. `HOLDOUT_DAYS` is a constant.
- No multi-fold walk-forward. That is step 3 (Robustness) and will generalise this.
- No transaction-cost math on the backend. The frontend derives the one-time cost from `traded`
  (contract 0172).
- No risk-contribution output. Gunnar dropped it from this pill on 2026-10-26, because it
  duplicates Risk & Perf → Health.
- Do not refactor `optimize_portfolio` to share code with the new route, and do not touch
  `run_optimize`.
- No new dependencies. `scipy` is already in `requirements.txt`.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written, not only to an
undecided design question. Do not find a clever way to pass a criterion that conflicts with
another one. Report it.

**Fixture for `test_compare_run.py`.** Use these values literally:

```python
DATES = [d.date() for d in pd.bdate_range("2023-01-02", "2024-12-31")]   # 522 bars


def prices(pattern, dates=DATES):
    returns = np.resize(np.asarray(pattern, dtype=float), len(dates) - 1)
    return pd.Series(100 * np.concatenate([[1], np.cumprod(1 + returns)]), index=dates)


A = prices([0.01, -0.01, 0.01, -0.01])
A2 = prices([0.02, -0.02, 0.02, -0.02])            # returns are exactly 2 × A's: rho(A, A2) = 1
B = prices([0.02, 0.02, -0.02, -0.02])
C = prices([0.005, 0.003, -0.004, 0.001, -0.002])
LATE = [d for d in DATES if d >= date(2024, 1, 5)]
E = prices([0.02, 0.02, -0.02, -0.02], LATE)
F = prices([0.004, -0.003], LATE)
Y = pd.Series(50.0, index=DATES)                    # zero variance
SPY = A.copy()
ABC = {"A": A, "B": B, "C": C}
```

With `lookback_days=365`, `end` is 2024-12-31 and the cut is **2024-01-01**. E and F start
after the cut, but within the in-sample pin grace. So they are fitted in-sample and ineligible
for the holdout.

`test_compare_run.py` contains at least these tests:

1. `run_compare({"A": 1, "B": 1, "C": 1}, ABC, SPY, lookback_days=365)`:
   `[row.mode for row in result.modes] == list(MODES)`, and every row has `error is None`.
2. With the same call, the `min_variance` row's `target_weights` equals
   `run_optimize({"A": 1, "B": 1, "C": 1}, ABC, SPY, mode="min_variance", lookback_days=365).target_weights`
   (`pytest.approx`, `abs=1e-12`). Its `in_sample.sharpe` equals that run's `metrics["optimized"]["sharpe"]`.
3. **No lookahead.** Build `ABC_LATER` = `ABC` with B's prices strictly after 2024-01-01
   multiplied by `1.5`. For every mode, `holdout_weights` from the `ABC_LATER` run equal those from
   the `ABC` run (`abs=1e-12`). They also equal
   `run_optimize({"A": 1, "B": 1, "C": 1}, {t: s.loc[s.index <= date(2024, 1, 1)] for t, s in ABC.items()}, None, mode=<mode>, lookback_days=365).target_weights`.
   And `result.current.holdout.cagr` differs between the two runs.
4. With the call from (1), `result.holdout.fit_end == date(2024, 1, 1)`,
   `result.holdout.score_start == date(2024, 1, 1)` and `result.holdout.score_end == date(2024, 12, 31)`.
5. `run_compare({"A": 1, "B": 1, "E": 1}, {"A": A, "B": B, "E": E}, SPY, lookback_days=365)`:
   `result.holdout.tickers == ["A", "B"]` and `result.holdout.excluded == ["E"]`. The
   `equal_weight` row's `target_weights` has the keys `{"A", "B", "E"}`.
6. `run_compare({"A": 1, "E": 1, "F": 1}, {"A": A, "E": E, "F": F}, SPY, lookback_days=365)`:
   `result.holdout is None`, `result.holdout_unavailable` is a non-empty string, every row has
   `holdout is None`, and every row has `in_sample is not None`.
7. The call from (1) with `vol_target=0.01`: the `target_volatility` row has an `error`
   containing `"Vol target"`, and `in_sample`, `target_weights` and `holdout` all `None`.
   The other seven rows have `error is None`.
8. `run_compare({"A": 1}, {"A": A}, SPY, lookback_days=365)` raises `OptimizeInputError`.
9. With the call from (1), every row's `traded` equals
   `sum(abs(row.target_weights[t] - result.current_weights[t]) for t in result.tickers)`
   (`abs=1e-12`). The `equal_weight` row's `traded` is `pytest.approx(0, abs=1e-12)`, because
   the portfolio is already equal-weighted.
10. `correlation_matrix({"A": A, "B": B, "A2": A2, "C": C}, ["A", "B", "A2", "C"], date(2024, 1, 1), date(2024, 12, 31))`:
    A and A2 are adjacent in `tickers` (their indices differ by exactly 1). The matrix is
    symmetric within `1e-12`, its diagonal is `1` within `1e-12`, ρ(A, A2) is `1` within `1e-9`,
    and |ρ(A, B)| < `0.05`.
11. `correlation_matrix({"A": A, "B": B, "F": F}, ["A", "B", "F"], date(2023, 12, 1), date(2024, 12, 31))`:
    `limited_by == "F"` and `start == date(2024, 1, 8)`. That is the first return after F's first
    bar on 2024-01-05, a Friday. The window starts 2023-12-01 on purpose: from 2024-01-01, F's
    start would fall inside the 7-day grace, and `limited_by` would correctly be `None`.
12. `correlation_matrix({"A": A, "B": B, "Y": Y}, ["A", "B", "Y"], date(2024, 1, 1), date(2024, 12, 31))`:
    `excluded == ["Y"]` and `sorted(tickers) == ["A", "B"]`.
13. `correlation_matrix({"A": A, "Y": Y}, ["A", "Y"], date(2024, 1, 1), date(2024, 12, 31))` is `None`.

`test_api_compare.py` follows `test_api_optimize.py`'s SQLite fixture pattern, with its own
two-year `DATES` and the A/B/C patterns above. It contains at least these tests:

14. A request with `lookback_days: 365` gets a 200 response with 8 `modes`, a non-null `holdout`, `correlation` and `frontier`, and
    every `point` serialised as `{"vol": …, "ret": …}`.
15. Lowercase tickers are accepted (with `lookback_days: 365`) (`["a", "b", "c"]` → `tickers == ["A", "B", "C"]`).
16. A single ticker → 422.
17. A ticker with no stored history → 404 (inherited from `_load_stored_closes`).

Global:

18. `cd backend && .venv/bin/pytest -q` passes. The count is **840 plus the number of tests you
    added**. Report both numbers. No existing test is edited.
19. `grep -n "except Exception" backend/app/compare_run.py` prints nothing.
20. `grep -c "run_optimize(" backend/app/compare_run.py` is at least 1. The module must call
    `run_optimize` and not reimplement any optimizer.
21. State in the report the full list of files you created or modified.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string, so any script run without that prefix talks to the **production database**.
> `tests/conftest.py` strips the variable for `pytest` only.

Run each of these and paste the **complete, verbatim** output into the report.

```bash
cd backend && .venv/bin/pytest -q tests/test_compare_run.py tests/test_api_compare.py
cd backend && .venv/bin/pytest -q
grep -n "except Exception" backend/app/compare_run.py
grep -c "run_optimize(" backend/app/compare_run.py
```

## Human verification — does Gunnar need to run anything?

- **Nothing to run for this contract.** It has no visible surface. The planner will hit the
  endpoint against the real BEC portfolio during the audit, and check that the in-sample rows
  match Historical Optimize for the same settings.

## Open questions — do not resolve yourself

- None known. If `run_optimize`'s actual behaviour contradicts anything in the Algorithm
  section (for example, an exception type other than `OptimizeInputError` for a shared-input
  problem), stop and report `BLOCKED` with the traceback. Do not work around it.
