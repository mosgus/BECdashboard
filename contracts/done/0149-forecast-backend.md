# Contract 0149 — Forecast backend: EWMA, GARCH, ARIMA and Ensemble

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Add `POST /portfolio/forecast`, which forecasts the value of a constant-mix portfolio over a
horizon with one of four models: `ewma`, `garch`, `arima` or `ensemble`.

Every model simulates paths from the **same daily series and lookback as Monte Carlo**, and returns:
- P5/P25/P50/P75/P95 bands and terminal stats, in Monte Carlo's shapes;
- a volatility forecast path;
- the realised-volatility history;
- the portfolio's value history.

Backend only. The frontend is 0150, and Prophet is 0151.

## Why

`REBUILD.md` → Outlook → "Forecast: five methods, fixed rather than ported" (Gunnar, 2026-10-01).
`main:backend/core/forecast.py` has wrong math, and this contract fixes it:

| `main` | This contract |
|---|---|
| EWMA drift extrapolates the last month | Lookback-mean drift |
| ARIMA(1,1,0) with no constant | AR(1) with a constant |
| P10/P90 labels on a 90% interval | Real simulated percentiles |
| The Ensemble takes the min and max of bands | The Ensemble pools paths |

Read `main`'s file **for contrast only**. Don't port it.

The tab's value over Monte Carlo is that its **volatility reacts to the current market**. A calm
lookback that ends in a storm gets wide bands now. That property is what the regime test checks.

## Files

Create:
- `backend/app/forecast_run.py` — the pure models plus `run_forecast`.
- `backend/tests/test_forecast_run.py`
- `backend/tests/test_api_forecast.py`

Modify:
- `backend/app/montecarlo_run.py` — extract two shared helpers (see Refactor). **No behaviour
  change.**
- `backend/app/schemas.py` — `ForecastRequest`, `ForecastResponse` and their parts.
- `backend/app/routers/portfolio.py` — the `/forecast` route, next to `/montecarlo`.

**Touch nothing else.** In particular, don't edit `backend/tests/test_montecarlo_run.py` or
`test_api_montecarlo.py`: they're the proof the refactor changed nothing. No new dependencies:
numpy, pandas and scipy only. Don't import statsmodels, which isn't installed.
`reference files/` is read-only.

## Refactor in `montecarlo_run.py`

Move code that `run_monte_carlo` already contains into two public functions, then call them from
`run_monte_carlo`. The logic and messages stay identical.

```python
@dataclass(frozen=True)
class PortfolioSeries:
    tickers: list[str]
    weights: dict[str, float]        # normalized over holdings + cash
    cash_weight: float
    returns: pd.Series               # daily simple portfolio returns (cash earns 0), date-indexed
    fit_start: date
    fit_end: date
    warnings: list[str]              # the existing short-history warning, if any

def portfolio_series(weights: dict[str, float], cash: float, closes: dict[str, pd.Series], *, lookback_days: int) -> PortfolioSeries:
    """Validate weights, cash, closes and lookback, then build the constant-mix daily return series."""

def summarize_paths(paths_array: np.ndarray, initial_value: float, horizon_days: int) -> tuple[list[PathPoint], TerminalStats]:
    """paths_array is (n_paths, horizon_days + 1) with column 0 == initial_value. This is the existing day-thinning and percentile code."""
```

- **`portfolio_series`** raises `MonteCarloInputError` with the existing messages: lookback,
  weights, cash and missing closes.
- **The `MIN_RETURNS` check stays in `run_monte_carlo`**, because the forecast models need
  different minimums.
- **`model`, `horizon`, `num_simulations` and `initial_value`** are still validated in
  `run_monte_carlo`, in the same order as today. If moving the checks would change which error a
  bad request gets, keep that check where it is.

## Interface — `forecast_run.py`

```python
MODELS = ("ewma", "garch", "arima", "ensemble")
EWMA_LAMBDA = 0.94
MIN_RETURNS = {"ewma": 60, "arima": 60, "garch": 250, "ensemble": 250}
MODEL_LABELS = {"ewma": "EWMA", "garch": "GARCH", "arima": "ARIMA", "ensemble": "Ensemble"}

class ForecastInputError(ValueError): ...       # router → 422, str(exc) as the detail
class ForecastFitError(RuntimeError): ...       # a model could not be fitted

@dataclass(frozen=True)
class GarchFit:
    omega: float
    alpha: float
    beta: float
    next_variance: float     # σ² for the first forecast day

@dataclass(frozen=True)
class Ar1Fit:
    c: float
    phi: float
    sigma: float             # residual std, ddof=2

def ewma_variance(x: np.ndarray, lam: float = EWMA_LAMBDA) -> float: ...
def fit_garch(x: np.ndarray) -> GarchFit: ...
def fit_ar1(x: np.ndarray) -> Ar1Fit: ...

@dataclass(frozen=True)
class VolPoint:
    date: date
    vol: float

@dataclass(frozen=True)
class VolForecastPoint:
    day: int
    vol: float

@dataclass(frozen=True)
class HistoryPoint:
    date: date
    value: float

@dataclass(frozen=True)
class ForecastResult:
    tickers: list[str]
    weights: dict[str, float]
    cash_weight: float
    model: str
    seed: int
    horizon_days: int
    num_simulations: int
    initial_value: float
    lookback_days: int
    fit_start: date
    fit_end: date
    n_returns: int
    daily_drift: float                    # μ, the mean daily log return
    current_vol: float                    # annualized forecast vol for day 1
    lookback_vol: float                   # annualized sample std of the log returns
    params: dict[str, float]
    members: list[str]                    # [model], or the ensemble members actually used
    member_medians: dict[str, float]      # terminal median per member; {} unless ensemble
    paths: list[PathPoint]                # reuse montecarlo_run.PathPoint
    terminal: TerminalStats               # reuse montecarlo_run.TerminalStats
    vol_forecast: list[VolForecastPoint]
    vol_history: list[VolPoint]
    history: list[HistoryPoint]
    warnings: list[str]

def run_forecast(
    weights: dict[str, float],
    cash: float,
    closes: dict[str, pd.Series],
    *,
    initial_value: float,
    horizon_days: int = 252,
    num_simulations: int = 1000,
    lookback_days: int = 1825,
    model: str = "garch",
    seed: int = 42,
) -> ForecastResult: ...
```

### The math

Every model works on `x = np.log1p(series.returns.values)`, the daily log returns.
- `μ = x.mean()`.
- Annualized vol is `sqrt(252 · daily variance)`. `lookback_vol = x.std(ddof=1) · sqrt(252)`.
- Path values are `initial_value · exp(cumsum(simulated x))`, with column 0 equal to
  `initial_value`. They are never clamped, because they can't go negative.

**`ewma_variance`:**
- Start from `s2 = x.var(ddof=1)`.
- For each `v` in `x`, in order, set `s2 = lam·s2 + (1−lam)·(v − x.mean())²`.
- Return `s2`.
- **EWMA model:** simulate `x̃ = μ + sqrt(s2)·z`, so the vol is flat. `vol_forecast` is constant at
  `sqrt(252·s2)`, and `params = {"lambda": 0.94}`.

**`fit_garch`:** GARCH(1,1) on `ε = x − μ`, by Gaussian MLE with **variance targeting**.
- Set `v = ε.var(ddof=1)` and `ω = (1−α−β)·v`.
- The recursion is `σ²₀ = v`, then `σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁`.
- Minimize `Σ (log σ²ₜ + ε²ₜ/σ²ₜ)` over `(α, β)` with `scipy.optimize.minimize(method="SLSQP")`:
  - start at `x0 = (0.05, 0.90)`;
  - bounds `α ∈ [1e-6, 0.5]` and `β ∈ [0, 0.999]`;
  - the inequality `0.999 − α − β ≥ 0`.
- **Vectorize the recursion.** `scipy.signal.lfilter` works: `σ²[1:] = lfilter([1], [1, −β], ω + α·ε[:-1]², zi=[β·v])`.
  A Python loop over the returns inside the objective is too slow.
- If `not res.success`, or if any parameter is non-finite, raise
  `ForecastFitError("GARCH could not be fitted")`.
- Set `next_variance = ω + α·ε[-1]² + β·σ²[-1]`.
- **GARCH model:** simulate with the recursion. Start at `s2 = next_variance` for every path, then
  for each day:
  - `e = sqrt(s2)·z`;
  - `x̃ = μ + e`;
  - `s2 = ω + α·e² + β·s2`.

  Loop over days and vectorize across paths.
- **GARCH `vol_forecast`** is the expected path
  `sqrt(252 · (v + (α+β)^(d−1) · (next_variance − v)))` for day `d ≥ 1`. It reverts to
  `lookback_vol`, because `v` is the targeted long-run variance.
- **GARCH `params`:**
  - `omega`, `alpha`, `beta` and `persistence = α+β`;
  - `half_life_days = log(0.5)/log(α+β)`, or `inf` if `α+β ≥ 1` (that can't happen under the bound;
    still guard it).

  JSON can't carry `inf`, so if you hit it, omit the key and say so.

**`fit_ar1`:** OLS of `x[1:]` on a constant and `x[:-1]`.
- `phi = cov(x[:-1], x[1:]) / var(x[:-1])`, using ddof=1 for both. `c = mean(x[1:]) − phi·mean(x[:-1])`.
  `sigma` = the residual std with ddof=2.
- If `abs(phi) >= 1`, raise `ForecastFitError("ARIMA could not be fitted")`.
- **ARIMA model:** simulate `x̃ₜ = c + phi·x̃ₜ₋₁ + sigma·z`, starting from `x̃₀ = x[-1]`, the last
  real return. `vol_forecast` is constant at `sigma·sqrt(252)`.
- **ARIMA `params`:** `{"c", "phi", "sigma"}`.
- In docstrings and comments, call it "ARIMA(1,1,0) on log prices with drift, i.e. AR(1) with a
  constant on log returns".

**Degenerate series:** if `x.var(ddof=1) < 1e-18`, for example constant returns:
- skip every fit;
- every model simulates `x̃ = μ` with zero vol;
- `vol_forecast` is all 0, `current_vol = 0`, and `params = {}`.

Without this rule, GARCH and AR(1) divide by zero.

**Ensemble:**
- **Members, in order:** `ewma`, `garch`, `arima`.
- **Path counts:** `N//3`, `N//3` and `N − 2·(N//3)`. The pool is exactly `N` paths. It is
  **not** 3N, which keeps memory the same as Monte Carlo's at N = 10,000 and a 504-day horizon.
- **Seeds:** `seed`, `seed+1` and `seed+2`, in member order.
- **A member raising `ForecastFitError`** is dropped. Append
  `f"{MODEL_LABELS[m]} could not be fitted, so the ensemble uses {' and '.join(labels of the rest)} only."`,
  and give its paths to the remaining members, split by the same rule. If every member fails, raise
  `ForecastInputError("No forecast model could be fitted to this lookback.")`.
- **Results:**
  - `paths` and `terminal` come from the pooled array, via `summarize_paths`.
  - `member_medians[m]` is the median terminal value of member `m`'s own paths.
  - `vol_forecast` at day `d` is `sqrt(mean over members of vol_d²)`.
  - `current_vol` is `vol_forecast[day 1]`.
  - `params` holds the members' params with keys prefixed `"garch.alpha"`, `"ewma.lambda"`, and
    so on.

**A single model** uses `seed`, and its `ForecastFitError` becomes
`ForecastInputError(f"{MODEL_LABELS[model]} could not be fitted to this lookback. Try a longer lookback or the EWMA model.")`.

**Validation in `run_forecast`**, in this order:
1. `model not in MODELS` raises `'model must be one of "ewma", "garch", "arima" or "ensemble"'`.
2. Horizon, simulations and initial value use Monte Carlo's bounds and messages. Reuse
   `MAX_HORIZON_DAYS`.
3. `portfolio_series(...)`. Re-raise its `MonteCarloInputError` as `ForecastInputError` with the
   same message.
4. If `len(returns) < MIN_RETURNS[model]`, raise
   `f"{MODEL_LABELS[model]} needs at least {MIN_RETURNS[model]} daily returns, but the holdings share only {n}. Choose a longer lookback."`.

**Outputs:**
- **`vol_forecast`** has one point per day in the thinned `paths` day list. Day 0 takes the day-1
  value.
- **`vol_history`** is the 21-day rolling `std(ddof=1)·sqrt(252)` of `x`, dated, with NaNs
  dropped.
- **`history`** is the portfolio value on each return date, scaled so the **last** point equals
  `initial_value`: `value_d = initial_value / prod_{s > d}(1 + r_s)`.
  - Thin it with `step = max(1, ceil(n/250))`, taking indices `n−1, n−1−step, …` and returning them
    in ascending date order, so the last date is always included.

## Schemas and route

`schemas.py`:
- `ForecastRequest` has the same fields as `MonteCarloRequest`, with `model: str = "garch"`.
- `ForecastResponse` mirrors `ForecastResult`:
  - reuse `MonteCarloPathPointOut` and `MonteCarloTerminalOut`;
  - add `ForecastVolPointOut {date, vol}`, `ForecastVolForecastPointOut {day, vol}` and
    `ForecastHistoryPointOut {date, value}`;
  - `params: dict[str, float]`, `members: list[str]`, `member_medians: dict[str, float]`.

`routers/portfolio.py`: `@router.post("/forecast", response_model=ForecastResponse)`, a copy of the
`/montecarlo` route that calls `run_forecast` and maps `ForecastInputError` to 422.

## Tests — `test_forecast_run.py`

Copy `DATES`, `prices`, `C`, `A`, `K` and `Y` from `test_montecarlo_run.py` verbatim. They're
literal fixtures.

Add these extra fixtures:

```python
def from_log(x, start="2023-01-02"):
    index = [d.date() for d in pd.bdate_range(start, periods=len(x) + 1)]
    return prices(np.expm1(x), index=index)

_r = np.random.default_rng(1)
REGIME = from_log(np.concatenate([0.005 * _r.standard_normal(500), 0.025 * _r.standard_normal(40)]))
```

The planner computed these from the stated algorithms, outside the app:
- `REGIME`: GARCH current ≈ 0.441 annualized, lookback ≈ 0.144, EWMA ≈ 0.444 and AR(1) σ ≈ 0.144;
- the literal EWMA value in test 2;
- the GARCH and AR(1) recoveries in tests 3–4.

Use `lookback_days=800` with `REGIME`, which covers all 541 dates.

1. **Constant growth,** parametrized over all four models: `run({"C": 1}, closes={"C": C}, model=m, horizon_days=63, num_simulations=100, lookback_days=365)`.
   - `terminal.median`, `p5` and `p95` are all ≈ `1064.99331`, abs 1e-4. That's the same number as
     Monte Carlo's test.
   - `current_vol == 0`, and every `vol_forecast` vol is 0.
2. **`ewma_variance(np.log1p(np.array([0.01, -0.02, 0.015, 0.0, -0.005, 0.03])))`** is ≈
   `0.00028392138592321`, rel 1e-9.
3. **GARCH recovery:** simulate with `rng = np.random.default_rng(7)`, `α=0.08`, `β=0.90`,
   `v=1e-4`, `ω=(1−α−β)·v` and `n=3000`.
   - Start with `s2=v`. Each step: `e = sqrt(s2)·rng.standard_normal()`, `x = 0.0003 + e`, then
     `s2 = ω + α·e² + β·s2`.
   - `fit_garch(x)` gives `alpha` within 0.04 of 0.08 and `beta` within 0.05 of 0.90. The planner
     got 0.0719 and 0.9103.
4. **AR(1) recovery:** `rng = np.random.default_rng(3)` and `x = [0.0]`. Then 1999 times, append
   `0.0005 + 0.3·x[-1] + 0.01·rng.standard_normal()`.
   - `fit_ar1` gives `phi` within 0.05 of 0.3. The planner got 0.317.
5. **The regime is visible**, which is the point of the tab. With `REGIME`, `horizon_days=63`
   and `num_simulations=1000`:
   - `ewma.current_vol` and `garch.current_vol` are each `> 2 × arima.current_vol`.
   - The GARCH `vol_forecast` vols are non-increasing (tolerance 1e-12). The last one is
     `< garch.current_vol` and `> garch.lookback_vol`.
   - Width `p95 − p5` of the terminal: EWMA's is greater than ARIMA's.
   - `abs(arima.lookback_vol − 0.144) < 0.005`.
6. **Ensemble:** `REGIME` with `num_simulations=1000`.
   - `members == ["ewma", "garch", "arima"]`.
   - `terminal.median` is within `[min(member_medians.values()) − 5, max(...) + 5]` (in dollars,
     with `initial_value` 1000).
   - `len(member_medians) == 3`.
7. **Ensemble drops a failed member:** monkeypatch `app.forecast_run.fit_garch` to raise
   `ForecastFitError("GARCH could not be fitted")`.
   - The ensemble has `members == ["ewma", "arima"]`, and the warning
     `"GARCH could not be fitted, so the ensemble uses EWMA and ARIMA only."` is in `warnings`.
   - The same patch on `model="garch"` raises `ForecastInputError`, and the message contains
     `"GARCH could not be fitted to this lookback."`.
8. **Minimum returns:** a 101-date series, e.g. `from_log(0.01 * np.random.default_rng(2).standard_normal(100))`
   with `lookback_days=365`.
   - `garch` raises `ForecastInputError` with
     `"GARCH needs at least 250 daily returns, but the holdings share only 100. Choose a longer lookback."`.
   - `ewma` succeeds.
9. **Determinism:** two identical `garch` runs on `REGIME` give equal `terminal` and `paths`.
10. **The short-history warning carries over:** `run({"A": 1, "Y": 1}, closes={"A": A, "Y": Y}, model="ewma")`
    has the same warning text as `run_monte_carlo` gives for those inputs. Call both and compare.
11. **Validation:** `model="prophet"` raises with the exact `MODELS` message. `num_simulations=99`
    raises.
12. **History:** with `C`, `history[-1].value ≈ 1000` and `history[-1].date == C.index[-1]`. The
    dates strictly ascend, and `len(history) <= 251`.

## Tests — `test_api_forecast.py`

Copy the DB fixtures and `_insert` from `test_api_montecarlo.py`.

13. A `POST /portfolio/forecast` for `C` with `model="ewma"` and `lookback_days=365` returns 200.
    The JSON has `paths`, `terminal`, `vol_forecast`, `vol_history`, `history`, `params`,
    `members` and `member_medians`.
14. `model="nope"` returns 422 with the `MODELS` message as `detail`.

## Out of scope

- The frontend, the guide and Prophet.
- Calibration.
- Any change to Monte Carlo's behaviour, its messages or its tests.

## Acceptance criteria

Run them in bash from the repo root.

1. **Backend tests:** `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)` passes. Run
   it **before you start** and at the end, and paste both summary lines. "After" = "before" + the
   number of test cases you added; state that number. A parametrized test counts once per
   parameter.
2. **Monte Carlo is unchanged:** `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_montecarlo_run.py tests/test_api_montecarlo.py)`
   gives the same pass count before and after.
3. `grep -n "statsmodels\|prophet\|import arch" backend/app/forecast_run.py` prints nothing.
4. `grep -n "def portfolio_series\|def summarize_paths" backend/app/montecarlo_run.py` prints two
   lines, and `grep -c "portfolio_series(\|summarize_paths(" backend/app/forecast_run.py` prints
   at least `2`.
5. `grep -n "@router.post(\"/forecast\"" backend/app/routers/portfolio.py` prints one line.
6. **Timing:** write a throwaway script in `/tmp`, not committed, and run it with `DATABASE_URL=""`.
   - **Inputs:** 30 holdings, 1300 business days of random closes (seed 0), `lookback_days=1825`,
     `horizon_days=504` and `num_simulations=10000`.
   - Time `run_forecast` for each of the four models, and paste the times.
   - **The limit:** each must be ≤ **3.0 s**, with `ensemble` included.
7. **Sanity on real data:** if Gunnar's backend is running on `localhost:8000`, run
   `curl -s -X POST localhost:8000/portfolio/forecast -H 'content-type: application/json' -d '{"tickers":["XLK","MS","GLD","SPY"],"weights":[0.25,0.25,0.25,0.25],"initial_value":10000,"horizon_days":252,"model":"ensemble"}'`.
   - Paste `members`, `current_vol`, `lookback_vol`, `terminal` and `params`.
   - It is read-only. If the server is not running, or it hasn't reloaded, say so.

`BLOCKED` is the right answer to a criterion that cannot be satisfied. If a planner-computed
number in tests 2–5 doesn't reproduce, report your number and stop. **Don't change the algorithm
to hit it.** Don't find a clever way to pass a criterion.

## Verification to run and paste

Paste the complete, verbatim output.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)            # before AND after
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_montecarlo_run.py tests/test_api_montecarlo.py)   # before AND after
grep -n "statsmodels\|prophet\|import arch" backend/app/forecast_run.py
grep -n "def portfolio_series\|def summarize_paths" backend/app/montecarlo_run.py
grep -c "portfolio_series(\|summarize_paths(" backend/app/forecast_run.py
grep -n "@router.post(\"/forecast\"" backend/app/routers/portfolio.py
```

Also paste the timing script and its output, and the curl output (or why it was skipped).

## Human verification — does Gunnar need to run anything?

**No.** There's no UI yet. If your backend is running when the report comes in, the planner
re-runs the curl.

## Open questions

None.

## Planner audit (2026-10-02) — ACCEPTED

The planner re-ran everything:
- **Backend:** 727 passed (baseline 717).
- **Timing:** ewma 0.084 s, garch 0.084 s, arima 0.075 s, ensemble 0.093 s.
- **Real data:** the curl ran against the live local server with XLK/MS/GLD/SPY ensemble.
  - members: all three.
  - GARCH α 0.092, β 0.880, half-life 24 d.
  - Vol: current 0.161, lookback 0.174.
  - Median terminal return: +18.6%, from the 5-year lookback-mean drift.

**Deviations the report did not disclose:** the 14 specified tests were merged into 7 functions
(10 cases), and four assertions were dropped or weakened:
- Test 5: `garch.vol_forecast[-1].vol < garch.current_vol > garch.lookback_vol` is a chained
  comparison. It checks current > lookback, **not** last > lookback.
- Test 5: the `arima.lookback_vol ≈ 0.144` check is missing.
- Test 6: the ensemble median within the member-median range is missing.
- Test 12: the strictly ascending history dates check is missing.

The planner verified all four by hand, and they hold:
- last 0.202 > lookback 0.144;
- ARIMA lookback 0.14407;
- ensemble median 987.1 within [974.7, 1006.8];
- the dates ascend.

Also verified: the `vol_forecast` days equal the `paths` days for horizons 1, 5, 63, 500 and 756.
The behaviour is correct, so this is accepted. The missing assertions are restored as task 0 of 0150.
