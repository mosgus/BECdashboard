# Contract 0144 — Monte Carlo simulation backend for the Outlook tab

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`POST /portfolio/montecarlo` exists. It takes a portfolio (tickers, weights and cash) and simulates
many future value paths from the portfolio's own historical daily returns. It returns percentile bands
over the horizon and terminal-value statistics. The logic lives in a new pure module,
`app/montecarlo_run.py`. There is no calibration score in this contract (see Out of scope).

## Why

REBUILD.md, entry "The Outlook tab is a port of `main`'s Outlook page, all three sections"
(2026-09-24). Gunnar, 2026-10-01: "lets do the Monte Carlo tab of the Outlook tab next." This is the
backend; the section UI and its guide are the next contract.

The source is `main:backend/routers/portfolios_optimize.py`, `monte_carlo_sim` (around lines 663–860).
Read it with `git show 'main:backend/routers/portfolios_optimize.py' | sed -n 655,870p`. These are
**deliberate differences** from `main`. Each one is a decision, not an oversight:

| `main` | this contract | why |
|---|---|---|
| reads positions from the database by portfolio id | takes `tickers` + `weights` + `cash` in the body, like `/capm` and `/series` | rebuild portfolios live in localStorage |
| ignores cash: weights are renormalised over the holdings | cash is part of the portfolio and earns 0% | a 30%-cash portfolio is not a 0%-cash portfolio. This matches `/portfolio/series`, where cash is a flat value |
| `pos.weight or 1.0`: a zero weight silently becomes 1 | weights must be finite and above zero, using the existing `_normalise_request` | no silent substitution |
| one model: daily returns drawn from a normal distribution fitted to history | two models. **`bootstrap` (default)** resamples the portfolio's actual historical daily returns. `normal` is `main`'s model | a normal fit understates crash days, and the 5th-percentile outcome is the number people read this tab for. Bootstrap keeps the real fat tails. `normal` stays for comparison with `main` |
| `dropna` across all holdings with no message | same common window, but it **warns** when a holding's history is shorter than the lookback | the user should know when "5Y" actually means 9 months |
| no minimum history | fewer than 60 daily returns is an error | resampling 20 days is not a distribution |
| a "Brier score" `mean((prob_above − 0.5)²)` plus coverage of one hold-out path | **not ported** | that formula is not a Brier score: it scores no outcome, and it is minimised by predicting 50/50. Coverage measured over one autocorrelated path is close to one observation. A real calibration check is a separate decision (Out of scope) |
| rounds outputs | full precision | matches `/capm` and `/optimize` |

**Kept from `main`:**
- returns are compounded daily, `value[t] = value[t−1] × (1 + r_t)`, with a fixed seed of 42;
- the path grid steps every `max(1, horizon // 60)` days and always includes the last day;
- p5/p25/p50/p75/p95 bands;
- the terminal statistics, including the probability of loss.

**The portfolio is simulated at constant weights.** Each simulated day applies one portfolio-level
daily return, which implies daily rebalancing back to today's weights. That is `main`'s behaviour
too. Holdings drifting apart over a one-year horizon is a second-order effect, and simulating each
holding separately would multiply the cost by the number of holdings. The guide (next contract) states
this.

## Files

Create:
- `backend/app/montecarlo_run.py` — pure computation. No database, HTTP or network.
- `backend/tests/test_montecarlo_run.py`
- `backend/tests/test_api_montecarlo.py`

Modify:
- `backend/app/schemas.py` — add the four models listed under Interface, directly after
  `CapmResponse`. Change nothing else.
- `backend/app/routers/portfolio.py` — add the `/montecarlo` route directly after `/capm`, and extend
  the import lines. Change nothing else.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. `BLOCKED` with a reason is a valid, complete answer to this
contract.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. `.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it. The same applies to `main`: read it with
`git show`, and never check it out.

## Interface

### `app/montecarlo_run.py`

The module docstring is one line: `"""Pure Monte Carlo simulation for the Outlook tab."""`

Import `LOOKBACK_DAYS` and `PIN_GRACE_DAYS` from `app.optimize_run`. Define no copy of either. Import
nothing else from `app`. Do not edit `optimize_run.py` or `optimizer.py`.

```python
MODELS = ("bootstrap", "normal")
MAX_HORIZON_DAYS = 756
MIN_RETURNS = 60


class MonteCarloInputError(ValueError):
    """The request cannot be simulated as asked. The router maps it to HTTP 422 with str(exc) as the detail."""


@dataclass(frozen=True)
class PathPoint:
    day: int
    p5: float
    p25: float
    p50: float
    p75: float
    p95: float


@dataclass(frozen=True)
class TerminalStats:
    mean: float
    median: float
    p5: float
    p25: float
    p75: float
    p95: float
    prob_loss: float        # fraction of paths ending below initial_value
    mean_return: float      # mean / initial_value - 1
    median_return: float    # median / initial_value - 1


@dataclass(frozen=True)
class MonteCarloResult:
    tickers: list[str]                # request order
    weights: dict[str, float]         # fraction of the whole portfolio, cash included
    cash_weight: float                # fraction of the whole portfolio
    model: str
    seed: int
    horizon_days: int
    num_simulations: int
    initial_value: float
    lookback_days: int
    fit_start: date                   # first date of the historical returns used
    fit_end: date
    n_returns: int
    daily_mean: float                 # of the historical portfolio daily returns
    daily_vol: float                  # sample std, ddof=1
    paths: list[PathPoint]
    terminal: TerminalStats
    warnings: list[str]


def run_monte_carlo(
    weights: dict[str, float],
    cash: float,
    closes: dict[str, pd.Series],
    *,
    initial_value: float,
    horizon_days: int = 252,
    num_simulations: int = 1000,
    lookback_days: int = 1825,
    model: str = "bootstrap",
    seed: int = 42,
) -> MonteCarloResult: ...
```

`weights` and `cash` are in the same units, whatever they are (percent, or dollars): only their
ratios matter, as in `/portfolio/series`.

### The algorithm, in order

Every error is `raise MonteCarloInputError(<exact message>)`. The messages are exact, and the tests
assert them.

1. **Validate inputs**, in this order:
   - `lookback_days not in LOOKBACK_DAYS` → `f"lookback_days must be one of {LOOKBACK_DAYS}"`
   - `model not in MODELS` → `'model must be "bootstrap" or "normal"'`
   - `not 1 <= horizon_days <= MAX_HORIZON_DAYS` → `f"horizon_days must be between 1 and {MAX_HORIZON_DAYS}"`
   - `not 100 <= num_simulations <= 10000` → `"num_simulations must be between 100 and 10000"`
   - `not (math.isfinite(initial_value) and initial_value > 0)` → `"initial_value must be finite and greater than zero"`
   - `weights` empty, or any weight not finite or ≤ 0 → `"weights must be finite and greater than zero"`
   - `not (math.isfinite(cash) and cash >= 0)` → `"cash must be finite and zero or more"`
   - a holding missing from `closes`, or with empty closes, checked in `weights` order →
     `f"missing closes for weighted ticker {t!r}"`
2. **Weights.** `total = sum(weights.values()) + cash`. Each holding's fraction is `weight / total`,
   and `cash_weight = cash / total`.
3. **Window.** `end` is the minimum of every holding's last close date.
   `lookback_start = end - timedelta(days=lookback_days)`. Build one DataFrame with one column per
   holding, in request order. Keep rows with `lookback_start <= index <= end`, then `sort_index()`,
   `ffill()`, `pct_change()` and `dropna()`. The result is the historical returns.
   - `n_returns = len(returns)`. If `n_returns < MIN_RETURNS`, raise
     `f"Need at least {MIN_RETURNS} daily returns to simulate, but the holdings share only {n_returns}."`
   - `fit_start` and `fit_end` are the first and last index of the returns.
4. **Short-history warning.** Find the holding with the latest `closes[t].index[0]`. On a tie, take
   the first in request order. If that date is after `lookback_start + timedelta(days=PIN_GRACE_DAYS)`,
   the warning is
   `f"The simulation uses returns from {fit_start} onward: {t} has prices only from {first_bar}."`
   That is the only warning, so a run with full history returns `[]`.
5. **Portfolio returns.** `port = returns.values @ w`, where `w` holds the holdings' fractions from
   step 2 in request order. Cash contributes 0. `daily_mean = port.mean()` and
   `daily_vol = port.std(ddof=1)`.
6. **Simulate.**
   - `rng = np.random.default_rng(seed)`.
   - `bootstrap`: `draws = rng.choice(port, size=(num_simulations, horizon_days), replace=True)`.
   - `normal`: `draws = daily_mean + daily_vol * rng.standard_normal((num_simulations, horizon_days))`.
   - `values = initial_value * np.cumprod(np.maximum(1 + draws, 0.0), axis=1)`. The floor stops a
     normal draw below −100% from making a value negative.
   - `paths = np.hstack([np.full((num_simulations, 1), initial_value), values])`, with shape
     `(num_simulations, horizon_days + 1)`. Column `d` is day `d`.
7. **Path grid.** `step = max(1, horizon_days // 60)`, `days = list(range(0, horizon_days + 1, step))`,
   and append `horizon_days` if it is not already the last entry. For each day,
   `np.percentile(paths[:, day], [5, 25, 50, 75, 95])` (numpy's default linear method) gives the
   `PathPoint`.
8. **Terminal statistics** are over `paths[:, -1]`:
   - `mean` and `median`;
   - `p5`, `p25`, `p75` and `p95` from `np.percentile`;
   - `prob_loss = mean(terminal < initial_value)`;
   - `mean_return = mean / initial_value − 1` and `median_return = median / initial_value − 1`.
9. Convert every numpy scalar to `float` (or `int`, for `day`), so the result is plain Python.

### Schemas (`app/schemas.py`, directly after `CapmResponse`)

```python
class MonteCarloRequest(BaseModel):
    tickers: list[str]
    weights: list[float]
    cash: float = 0.0
    initial_value: float
    horizon_days: int = 252
    num_simulations: int = 1000
    lookback_days: int = 1825
    model: str = "bootstrap"


class MonteCarloPathPointOut(BaseModel):
    day: int
    p5: float
    p25: float
    p50: float
    p75: float
    p95: float


class MonteCarloTerminalOut(BaseModel):
    mean: float
    median: float
    p5: float
    p25: float
    p75: float
    p95: float
    prob_loss: float
    mean_return: float
    median_return: float


class MonteCarloResponse(BaseModel):
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
    daily_mean: float
    daily_vol: float
    paths: list[MonteCarloPathPointOut]
    terminal: MonteCarloTerminalOut
    warnings: list[str]
```

### Route (`app/routers/portfolio.py`, directly after `/capm`)

```python
@router.post("/montecarlo", response_model=MonteCarloResponse)
def montecarlo_portfolio(body: MonteCarloRequest) -> dict:
```

1. `_require_database()`, then `tickers, weights = _normalise_request(body.tickers, body.weights)`.
2. `closes = _load_stored_closes(tickers)`. A missing holding keeps that helper's existing 404.
3. Call `run_monte_carlo(dict(zip(tickers, weights, strict=True)), body.cash, closes,
   initial_value=body.initial_value, horizon_days=body.horizon_days,
   num_simulations=body.num_simulations, lookback_days=body.lookback_days, model=body.model)`. Do not
   pass `seed`: the route always uses the default 42. `MonteCarloInputError` → HTTP 422 with `str(exc)`.
4. Return `asdict(result)`. `asdict` is already imported in this router.

## Test fixtures (literal — use exactly these)

Both test files define these. `test_api_montecarlo.py` seeds `A` and `C` the way
`tests/test_api_capm.py` does: copy its `db_mode`, `client` and `_insert`, and use the database file
name `test_api_montecarlo.db`.

```python
DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=261)]   # 2024-01-02 … 2024-12-31


def prices(returns, index=DATES, start=100.0):
    return pd.Series(start * np.concatenate([[1], np.cumprod(1 + returns)]), index=index)


C = prices(np.full(260, 0.001))                  # +0.1% every day: no randomness at all
A = prices(np.tile([0.01, -0.01], 130))          # alternating +1% / -1%, mean 0
K = DATES.index(date(2024, 6, 3))                # 109
Y = prices(np.tile([0.01, -0.01], 130)[K:], index=DATES[K:], start=50.0)   # young: first bar 2024-06-03
S = prices(np.full(39, 0.001), index=DATES[-40:])                         # 40 bars, 39 returns
```

`test_montecarlo_run.py` calls `run_monte_carlo` with `initial_value=1000.0` and `lookback_days=365`
unless a test says otherwise. With these fixtures, the lookback start is 2024-12-31 − 365 days =
2024-01-01.

## Expected values (planner-verified in scratch with numpy 2, using the algorithm above)

Tolerances are `pytest.approx(abs=…)`, as given. The statistical tolerances were checked across
seeds 1, 2, 3 and 42, so they do not depend on the exact order of random draws.

`test_montecarlo_run.py` has exactly **24** tests, counting each parametrize case:

1. **`test_constant_growth_is_deterministic`** — parametrize `model` over `"bootstrap"` and
   `"normal"` (2 cases). Use `{"C": 1}`, cash 0, `horizon_days=63`, `num_simulations=100`:
   - `terminal.median`, `terminal.p5` and `terminal.p95` are each 1064.99331 (1e-4). That is
     1000 × 1.001⁶³.
   - `terminal.prob_loss == 0.0`
   - `daily_mean` is 0.001 (1e-12) and `daily_vol` is 0 (1e-12)
   - `fit_start == date(2024, 1, 3)`, `fit_end == date(2024, 12, 31)`, `n_returns == 260`,
     `warnings == []`
2. **`test_cash_earns_nothing`** — `{"C": 1}`, `cash=1`, `horizon_days=63`, `num_simulations=100`:
   - `weights == {"C": 0.5}` and `cash_weight == 0.5`
   - `daily_mean` is 0.0005 (1e-12)
   - `terminal.median` is 1031.99325 (1e-4). That is 1000 × 1.0005⁶³.
3. **`test_bootstrap_draws_only_observed_returns`** — `{"A": 1}`, `horizon_days=2`,
   `num_simulations=10000`, model `bootstrap`. Every path ends at 980.1, 999.9 or 1020.1, with
   probabilities ¼, ½ and ¼:
   - `terminal.p5` is 980.1, `terminal.median` is 999.9 and `terminal.p95` is 1020.1 (each 1e-6)
   - `terminal.prob_loss` is 0.75 (0.02); `terminal.mean` is 1000 (1.0)
4. **`test_normal_matches_its_moments`** — `{"A": 1}`, `horizon_days=252`, `num_simulations=10000`,
   model `normal`:
   - `daily_mean` is 0 (1e-12); `daily_vol` is 0.0100193 (1e-6). That is 0.01 × √(260/259).
   - `terminal.mean_return` is 0 (0.01)
   - `terminal.median_return` is −0.0125 (0.01). That is the volatility drag, about −252σ²/2.
   - `terminal.prob_loss` is 0.53 (0.03); `terminal.p5` is 761 (15)
5. **`test_same_seed_same_result`** — `{"A": 1}`, model `normal`, `horizon_days=63`,
   `num_simulations=1000`:
   - two calls with the default seed give `dataclasses.asdict` results that compare `==`;
   - a call with `seed=7` gives a different `terminal.mean` (`!=`).
6. **`test_path_grid`** — parametrize `horizon_days` over 63, 125 and 252 (3 cases). Use `{"A": 1}`
   and `num_simulations=100`. In each case:
   - `len(paths) == 64`, `paths[0].day == 0` and `paths[-1].day == horizon_days`;
   - the days are strictly increasing.

   For 125 the grid is 0, 2, …, 124, 125. For 252 it is 0, 4, …, 252.
7. **`test_bands_are_ordered_and_start_at_initial_value`** — `{"A": 1}`, model `normal`,
   `horizon_days=252`, `num_simulations=1000`:
   - at `paths[0]`, all five values `== 1000.0`;
   - at every point, `p5 <= p25 <= p50 <= p75 <= p95`.
8. **`test_young_holding_limits_the_window`** — `{"A": 1, "Y": 1}` with `closes={"A": A, "Y": Y}`,
   `num_simulations=100`:
   - `fit_start == date(2024, 6, 4)`, `n_returns == 151`
   - `warnings == ["The simulation uses returns from 2024-06-04 onward: Y has prices only from 2024-06-03."]`
9. **`test_lookback_longer_than_history_warns`** — `{"A": 1}`, `lookback_days=1825`,
   `num_simulations=100`:
   - `warnings == ["The simulation uses returns from 2024-01-03 onward: A has prices only from 2024-01-02."]`
   - `n_returns == 260`
10. **`test_too_few_returns_is_an_error`** — `{"S": 1}` with `closes={"S": S}` →
    `MonteCarloInputError` with the message
    `"Need at least 60 daily returns to simulate, but the holdings share only 39."`
11. **`test_input_errors`** — one `pytest.mark.parametrize` with exactly these **11** cases. Each uses
    `pytest.raises(MonteCarloInputError, match=re.escape(message))`. Unless the case says otherwise,
    it uses `{"A": 1}`, `closes={"A": A}` and cash 0:

    | case | message |
    |---|---|
    | `lookback_days=400` | `lookback_days must be one of (365, 730, 1095, 1825)` |
    | `model="garch"` | `model must be "bootstrap" or "normal"` |
    | `horizon_days=0` | `horizon_days must be between 1 and 756` |
    | `horizon_days=757` | `horizon_days must be between 1 and 756` |
    | `num_simulations=99` | `num_simulations must be between 100 and 10000` |
    | `num_simulations=10001` | `num_simulations must be between 100 and 10000` |
    | `initial_value=0.0` | `initial_value must be finite and greater than zero` |
    | `initial_value=float("nan")` | `initial_value must be finite and greater than zero` |
    | weights `{"A": 0}` | `weights must be finite and greater than zero` |
    | `cash=-1` | `cash must be finite and zero or more` |
    | `closes={}` | `missing closes for weighted ticker 'A'` |

`test_api_montecarlo.py` has exactly **6** tests. Seed `A` and `C`:

1. **`test_montecarlo_requires_database`** — no `db_mode`: POST
   `{"tickers": ["A"], "weights": [1], "initial_value": 1000}` → 503.
2. **`test_lowercase_tickers_and_cash`** — body
   `{"tickers": ["c"], "weights": [1], "cash": 1, "initial_value": 1000, "horizon_days": 63, "num_simulations": 100, "lookback_days": 365}`
   gives 200, and:
   - `tickers == ["C"]`, `weights == {"C": 0.5}`, `cash_weight == 0.5`
   - `model == "bootstrap"`, `seed == 42`
   - `len(paths) == 64` and `paths[-1]["day"] == 63`
   - `terminal["median"]` is 1031.99325 (1e-4); `warnings == []`
3. **`test_defaults`** — body `{"tickers": ["A"], "weights": [1], "initial_value": 1000}` gives 200,
   and:
   - `model == "bootstrap"`, `horizon_days == 252`, `num_simulations == 1000`, `lookback_days == 1825`
   - `warnings == ["The simulation uses returns from 2024-01-03 onward: A has prices only from 2024-01-02."]`
4. **`test_fixed_seed_is_reproducible`** — the same body as test 3 plus `"model": "normal"`, posted
   twice, gives `response.json()` values that compare `==`.
5. **`test_missing_holding_is_404`** — tickers `["A", "Z"]`, weights `[1, 1]` → 404, detail
   `"No stored price history for Z"`.
6. **`test_input_error_is_422`** — test 3's body plus `"horizon_days": 0` → 422, detail
   `"horizon_days must be between 1 and 756"`.

## Out of scope

- **Any frontend change.** The Monte Carlo section, its chart and its Help guide are the next
  contract.
- **Calibration or backtest scoring.** `main`'s "Brier score" is not ported (see Why). Whether to
  build a real one, such as rolling-origin coverage of the p5–p95 band over many historical start
  dates, is an open question for Gunnar. It is not this contract's to decide.
- **`main`'s efficient-frontier chart**, which `main` shows inside its Monte Carlo section. Whether
  it comes across is an open question for Gunnar.
- A user-settable seed, per-holding simulation, or any model besides `bootstrap` and `normal`.

## Acceptance criteria

1. **Before any edit:** `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)`
   reports N passed, with no failures. When this contract was written, N was 672. Record the N you
   see. If anything fails before you edit, stop and report `BLOCKED` with the output.
2. **After:** it reports N + 30 passed, with no failures and no errors.
3. `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_montecarlo_run.py tests/test_api_montecarlo.py 2>&1 | tail -1)`
   reports `30 passed`.
4. **Purity:** `grep -nE "^from app\.(db|models|routers|rates|cache|market_data|optimizer)|import (requests|yfinance|sqlalchemy|fastapi)" backend/app/montecarlo_run.py`
   prints nothing.
5. `grep -c "LOOKBACK_DAYS = \|PIN_GRACE_DAYS = " backend/app/montecarlo_run.py` prints `0`. The
   constants are imported, not copied.
6. `grep -ni "brier" backend/app/montecarlo_run.py backend/app/schemas.py backend/app/routers/portfolio.py`
   prints nothing.
7. `grep -n "default_rng(seed)" backend/app/montecarlo_run.py` prints exactly one line.
8. `grep -n '"/montecarlo"' backend/app/routers/portfolio.py` prints one line, and
   `grep -n '"/capm"' backend/app/routers/portfolio.py` still prints one line.
9. `grep -c "^class MonteCarlo" backend/app/schemas.py` prints `4`, and
   `grep -c "^class Capm" backend/app/schemas.py` still prints `6`.
10. The OpenAPI check below prints
    `['/portfolio/capm', '/portfolio/montecarlo', '/portfolio/optimize', '/portfolio/series']`.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string — so any script run without that prefix talks to the **production database**.
> `tests/conftest.py` strips the variable for `pytest` only; it does not cover scripts.
>
> **`DATABASE_URL=""` is the only ambient value that works.** Setting it to a real throwaway URL
> raises at import, because `config.py`'s conflict guard (contract 0041) rejects any *non-empty*
> ambient value that differs from `.env`. Use the pytest fixtures if you need a database.

Run each of these from the repo root and paste the **complete, verbatim** output into the report,
including failures. Do not summarize, trim or clean up.

```bash
# before editing
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)
# after editing
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_montecarlo_run.py tests/test_api_montecarlo.py 2>&1 | tail -1)
grep -nE "^from app\.(db|models|routers|rates|cache|market_data|optimizer)|import (requests|yfinance|sqlalchemy|fastapi)" backend/app/montecarlo_run.py; echo "exit=$?"
grep -c "LOOKBACK_DAYS = \|PIN_GRACE_DAYS = " backend/app/montecarlo_run.py
grep -ni "brier" backend/app/montecarlo_run.py backend/app/schemas.py backend/app/routers/portfolio.py; echo "exit=$?"
grep -n "default_rng(seed)" backend/app/montecarlo_run.py
grep -n '"/montecarlo"\|"/capm"' backend/app/routers/portfolio.py
grep -c "^class MonteCarlo" backend/app/schemas.py
grep -c "^class Capm" backend/app/schemas.py
(cd backend && DATABASE_URL="" .venv/bin/python -W ignore -c "from app.main import app; print(sorted(p for p in app.openapi()['paths'] if p.startswith('/portfolio')))")
```

## Human verification — does Gunnar need to run anything?

**Nothing to run.** This contract has no visible surface. The SQLite-backed API tests exercise the
same `_load_stored_closes` query that production runs against Postgres, which `/capm` already relies
on. The real check is the next contract's UI on real portfolios.

## Open questions

None for the coder. If any expected value above does not reproduce, report `BLOCKED` with the actual
value. Do not loosen a tolerance or change a fixture to make it pass.

## Report

<Coder: paste your report in chat. Include every verification command's verbatim output.>

## Audit

**Accepted** (planner, 2026-10-01). Renumbered from 0143 to 0144 after a collision with the second planner session's `0143-expand-each-chart-pane`.

- Re-ran every verification command: 702 passed (672 + 30); the two new files give 30 passed; the purity, constant, brier, rng, route, schema-count and OpenAPI checks all match.
- Read `montecarlo_run.py` against the algorithm. Validation order and messages, window, warning tie-break (`max` returns the first on ties), the `ffill → pct_change → dropna` order, the draw calls, the floor, the grid and the statistics all match. The route passes no seed.
- The tests assert the contract's values at its tolerances. Nothing is skipped or loosened.
- Worst case (20 holdings, 10,000 sims, 756 days) runs in under 0.1 s locally.
