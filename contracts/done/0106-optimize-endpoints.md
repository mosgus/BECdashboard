# Contract 0106: `POST /portfolio/optimize` and `POST /portfolio/tilt`, with the risk-free rate

**Status:** accepted (amended 2026-09-24 after BLOCKED — see "Amendment 1")
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Build the thin HTTP layer over 0105's `run_optimize`:

1. **`POST /portfolio/optimize`** checks the request, loads the stored adjusted closes for the holdings
   and SPY, calls `run_optimize`, and returns JSON.
2. **`POST /portfolio/tilt`**, a port of `main`'s tilt endpoint, applies `compute_tilt` to an equal,
   current or optimizer baseline.
3. **`app/rates.py`**, a port of `main`'s `core/rates.py`, provides `fetch_risk_free_rate()` from ^TNX.
   It is cached for an hour, falls back to 4.27%, and is called **only** for `max_sharpe_capm`.
4. **Two text fixes in `app/optimize_run.py`** that the 0105 audit found. See
   `contracts/done/0105-optimize-run.report.md`, "Defects".

The frontend doesn't call any of this until the UI contract.

## Why

REBUILD.md, "The Backtest tab becomes Optimize", covers this. The rebuild keeps portfolios in the
browser (`frontend/src/lib/portfolioStore.ts`), so these routes take tickers and weights in the request
body. There is no portfolio id, unlike `main`'s `/portfolios/{id}/optimize`. That mirrors the existing
`GET /portfolio/series`.

References to read:
- `git show main:backend/routers/portfolios_optimize.py`: `TiltRequest` and `compute_portfolio_tilt`
- `git show main:backend/core/rates.py`
- `backend/app/routers/portfolio.py`: how `/portfolio/series` checks tickers and loads `PriceBar`

## Files

Create:
- `backend/app/rates.py`
- `backend/tests/test_rates.py`
- `backend/tests/test_api_optimize.py`

Modify:
- `backend/app/routers/portfolio.py`:
  - Add the two routes.
  - Extract the bar-loading code from `get_portfolio_series` into a shared helper that both
    endpoints use. `get_portfolio_series`'s behaviour must not change.
- `backend/app/schemas.py`: add the request and response models.
- `backend/app/optimize_run.py`: the two text fixes below **only**.
- `backend/tests/test_optimize_run.py`: **append** tests for the text fixes.

**Touch nothing else.** If the work appears to require it, stop and report `BLOCKED`.

**`reference files/` is read-only and never belongs on a file list.** The same applies to
`~/WebstormProjects/blue-eagle-reference`. Read `main` only through `git show main:<path>`.

**`backend/.env` holds the live production database URL.** Every ad-hoc `python -c` must be prefixed
with `DATABASE_URL=""`. The test suite blocks both the ambient DB and the network (`tests/conftest.py`).
**No test may reach yfinance.** Patch at the boundary instead.

**Take the before test count before editing anything.** Don't overwrite working files to recover it.
Every existing test must pass **unmodified**. That is the proof that `/portfolio/series` is unchanged.

## Part 1: text fixes in `app/optimize_run.py`

1. **Replace** the first warning, `"Optimization is simulated: current weights assumed constant baseline."`,
   with exactly:
   `"In-sample: the optimized weights were chosen using the same prices they are scored on."`
   The old text described `main`'s daily-rebalanced scoring, which this rebuild does not use.
2. **The feasibility messages state final-weight thresholds.** Let `s = fitted_scale` and `n = n_fitted`.
   - min_weight: `f"min_weight ({min_weight:.1%}) × N ({n}) = {min_weight * n:.2f} > {s:.2f} — infeasible. Reduce min weight or the number of positions."`,
     followed by the existing `pin_suffix`. Without pins, `s` is 1, so this reads `> 1.00`.
   - max_weight, without pins, keeps the current text, `"max_weight (…) < 1/N (…) — infeasible. Increase max weight."`.
   - max_weight, with pins, replaces `1/N` with `(1 − pinned)/N`, keeps the printed value `s / n`, and
     appends `pin_suffix`.

   Don't change any condition. Only the strings change.

## Part 2: `app/rates.py`

Port `main:backend/core/rates.py` with the same constant `_FALLBACK_RF = 0.0427`, the same 1-hour
`TTLCache(maxsize=1, ttl=3600)`, the same lock and the same sanity range `0.001 < rate < 0.20`. There
is one structural change: move the network call into a thin boundary function so tests can patch it.

```python
def _download_tnx() -> pd.DataFrame:
    return yf.Ticker("^TNX").history(period="1d")

def fetch_risk_free_rate() -> float: ...   # main's logic, calling _download_tnx()
```

## Part 3: schemas (`app/schemas.py`)

```python
class OptimizeRequest(BaseModel):
    tickers: list[str]
    weights: list[float]                  # one per ticker, positive, any scale; cash already removed by the caller
    mode: str = "min_variance"            # validated by run_optimize → 422
    lookback_days: int = 1825             # validated by run_optimize → 422
    max_weight: float = 1.0
    min_weight: float = 0.0
    vol_target: float = 0.10
    allow_short: bool = False
    conviction_views: dict[str, float] | None = None
    kappa: float = 0.05
    rebalance: str = "none"               # validated by run_optimize → 422

class TiltRequest(BaseModel):
    tickers: list[str]
    weights: list[float]
    baseline: str = "current"             # "equal" | "current" | "optimizer"
    optimizer_mode: str | None = None     # "equal_weight" | "min_variance" | "max_sharpe" | "risk_parity"; None → "min_variance"
    conviction: dict[str, float] = {}
    lam: float = 1.0
    u0: float = 20.0
    lookback_days: int = 1825             # used only by baseline="optimizer"; same values as OptimizeRequest
```

`mode`, `rebalance` and `lookback_days` are plain `str`/`int` on purpose. Every "you asked for
something invalid" error then comes back from one place (`OptimizeInputError`) with one shape, `{"detail": str}`.

The response models mirror `OptimizeResult`, `OptimizeCurves` and `PinnedHolding` field for field,
with the same names: `OptimizeResponse`, `OptimizeCurvesOut` and `PinnedHoldingOut`. Dates serialise as ISO
strings, as `PortfolioSeriesResponse` does. Type `metrics` as
`dict[str, dict[str, float | None] | None]`.

The tilt response is
`{"tilt_weights", "base_weights", "source": "tilt", "params": {baseline, optimizer_mode, conviction, lam, u0}}`,
as in `main`, with no rounding.

## Part 4: routes (`app/routers/portfolio.py`)

**Shared ticker checks** apply to both routes, as in `/portfolio/series`. Each of these is a **400**:
- the ticker list is empty after strip/upper
- more than 100 tickers
- a duplicate ticker
- `len(weights) != len(tickers)`
- a weight that is ≤ 0 or non-finite

Tickers are stripped and uppercased. The `conviction_views`/`conviction` keys are uppercased too.

### `POST /portfolio/optimize` → `OptimizeResponse`

1. If there is no database, return 503 with the existing `_DATABASE_NOT_CONFIGURED` detail.
2. Load the holdings' closes through the shared helper, using the same query, the same
   `adj_close IS NOT NULL` filter and the same **404** `"No stored price history for {ticker}"`.
3. Load SPY with the same query. If SPY has no stored bars, `benchmark = None`. That is **not** an
   error. If SPY is also a holding, use the same data for both.
4. `rf = fetch_risk_free_rate()` **only when** `mode == "max_sharpe_capm"`. Otherwise don't call it,
   and pass `run_optimize`'s default. Import it as `from app.rates import fetch_risk_free_rate`, so that
   tests can patch `app.routers.portfolio.fetch_risk_free_rate`. The 503 test pattern already exists in
   `tests/test_api_ops.py:44`.
5. Call `run_optimize(...)`. An `OptimizeInputError` becomes a **422** with `detail=str(exc)`.
6. **JSON safety.** Replace any non-finite float in `metrics` (a NaN beta, for example) with `None`
   before returning. `compute_metrics` returns `beta = nan` when the benchmark variance is 0, and
   Starlette's JSON encoder rejects NaN.

### `POST /portfolio/tilt`

Port `main`'s `compute_portfolio_tilt`:
- `baseline="equal"` gives `1/n` each.
- `baseline="current"` gives the weights normalised to sum 1.
- `baseline="optimizer"`:
  - Check `optimizer_mode` is in the four values listed above (`None` → `"min_variance"`). Anything
    else is a 422.
  - Then require the database (503) and load the closes and SPY as above.
  - The base weights are `run_optimize(weights, closes, benchmark, mode=optimizer_mode, lookback_days=body.lookback_days).target_weights`,
    so pinning applies here too.
  - An `OptimizeInputError` is a 422.
  - This departs from `main`, which ran a bare optimizer with no bounds or pinning and fell back to
    equal weight.
- An unknown `baseline` is a 422.
- **`equal` and `current` need no database.** They must work, and return 200, when the DB is
  unconfigured.
- Then `compute_tilt(base, conviction, lam, u0)`.

## Out of scope

- There is no frontend change, `lib/api.ts` client or type. The UI contract covers those.
- There is no action table, CSV or Apply.
- Don't port `capm_optimize`, `monte_carlo`, `efficient_frontier` or `/implementation`.

## Amendment 1 (2026-09-24, after the coder reported BLOCKED)

The planner made an error. Criterion 9 expected the optimizer-baseline tilt to fit A and B, but the
contract hard-coded `lookback_days=1825` against a fixture that holds only one year of data. Under
0105's pinning rule, that pins all three holdings and correctly raises "at least 2 holdings with full
history". The coder was right to block.

The fix:
- `TiltRequest` gains `lookback_days: int = 1825`, which is passed to `run_optimize`. This is also the
  better design, because the tilt baseline should use the lookback the user picked on the Optimize tab.
  An invalid value is a 422 through `OptimizeInputError`, as on `/optimize`.
- **Every API call in these tests that reaches `run_optimize` sends `"lookback_days": 365`.** That
  covers `/optimize`, and `/tilt` with `baseline="optimizer"`. The only exception is the one
  `lookback_days=400` error case.
- Add one test. `/tilt` with `baseline="optimizer"` on A/B with the **default** lookback (1825) returns
  **422** with a detail containing `"at least 2 holdings with full history"`. That proves the default
  is really passed through.
- The criterion 1 count becomes **603 + at least 19**.

Everything else stands. The work already done needs only the new field, the explicit 365 in the
tilt-optimizer test, and the extra test.

## Fixtures for `tests/test_api_optimize.py` (literal)

Reuse the 0105 fixture series exactly (`DATES`, `A`, `B`, `Y`, `SPY`), inserted as `PriceBar` rows
with `adj_close` set to each value, in a tmp-path SQLite DB. Copy the `db_mode` and `client` fixtures
from `tests/test_api_portfolio.py`.

## Acceptance criteria

Tolerance is **±0.01** unless stated.

1. `(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q)` passes. The count is **603 + at
   least 18**. Paste the before and after counts. The existing test files are unmodified, apart from
   the append to `test_optimize_run.py`.
2. **Text fixes** (appended to `test_optimize_run.py`):
   - No warning on any result contains `"constant baseline"`.
   - `warnings[0]` is the new in-sample text.
   - On the 0105 pinning call (`{"A": 1, "B": 1, "Y": 2}`, `lookback_days=365`), `min_weight=.3` raises
     a message containing `"> 0.50"` and `"after pinning"`.
   - On the same call, `max_weight=.2` raises a message containing `"(1 − pinned)/N"`.
   - On the no-pin call, `max_weight=.4` raises a message containing `"1/N"` and **not** `"pinned"`.
3. **rates.py.** Each test patches `app.rates._download_tnx` and clears `app.rates._cache` first.
   - A frame with `Close` [4.30] returns 0.043 (±1e-9).
   - An empty frame returns 0.0427.
   - `Close` [25.0], which is out of range, returns 0.0427.
   - A raising download returns 0.0427.
   - Two calls after a success call the download **once** (count the calls).
4. **Optimize, happy paths:**
   - `{"tickers": ["a", "b"], "weights": [1, 1], "lookback_days": 365}` returns 200:
     - `target_weights` A .80 / B .20
     - `pinned == []`
     - `curves.benchmark[0] == 100`
     - `fit_start == "2024-01-03"`
     - The lowercase tickers are accepted.
   - `{"tickers": ["A", "B", "Y"], "weights": [1, 1, 2], "lookback_days": 365}` returns:
     - `target_weights` A .40 / B .10 / Y .50
     - `pinned == [{"ticker": "Y", "first_bar": "2024-06-03", "weight": 0.5, "exceeds_max": False}]`,
       with the weight compared by approx
     - `score_limited_by == "Y"`
5. **CAPM and the risk-free rate.**
   - With `app.routers.portfolio.fetch_risk_free_rate` patched to return 0.04, `mode="max_sharpe_capm"`
     on A/B gives:
     - `capm_expected_returns` A .09 / B .04
     - `target_weights` A 1.0
     - `metrics.forward_looking` not null
   - On a non-CAPM call, the patched function **raises** if called, and the call still returns 200.
     That proves it is never fetched outside CAPM.
6. **No SPY stored** (seed only A and B):
   - min_variance returns 200 with `curves.benchmark is None`, a warning containing
     `"SPY is not stored"`, and no `beta` key in `metrics.current`.
   - `max_sharpe_capm` returns 422 with a detail containing `"SPY"`.
7. **Errors:**
   - 404 for an unstored ticker.
   - 400 for a duplicate (`["A", "a"]`).
   - 400 for a weight-count mismatch.
   - 400 for a zero weight.
   - 422 for `mode="nope"`, `lookback_days=400`, `rebalance="weekly"`, the pinned `max_weight=.2`
     case and the `["A", "Y"]` "at least 2 holdings" case.
   - 503 with no database: use a client without `db_mode`, where conftest removes `DATABASE_URL`.
8. **NaN safety.** Seed a constant SPY (`100.0` on every date) and call min_variance on A/B. It returns
   **200**, and `metrics.current.beta` is `None`.
9. **Tilt:**
   - `baseline="equal"`, `conviction={"a": 20}` on A/B gives `tilt_weights` A .6817 / B .3183, with the
     conviction key uppercased. It returns 200 **with no database configured**.
   - `baseline="current"`, weights [60, 40], `lam=2`, `conviction={"B": -10}` gives
     A .7908 / B .2092 and `base_weights` A .60 / B .40.
   - `baseline="optimizer"` on the pinned A/B/Y set with the default mode gives `base_weights`
     A .40 / B .10 / Y .50. With no conviction, `tilt_weights == base_weights`.
   - `optimizer_mode="max_sortino"` returns 422, and `baseline="nope"` returns 422.
10. **`/portfolio/series` unchanged.** `tests/test_api_portfolio.py` passes unmodified. It is part of
    criterion 1.
11. `grep -n "_download_tnx\|_FALLBACK_RF = 0.0427\|ttl=3600" backend/app/rates.py` prints at least three lines.

If a criterion can't be met as written, **report `BLOCKED` with the value you got**. Don't adjust a
fixture, a tolerance or an expected value.

## Verification to run and paste

Run each from the repo root. Paste the **complete, verbatim** output.

```bash
(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q 2>&1 | tail -3)
(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q tests/test_api_optimize.py tests/test_rates.py tests/test_optimize_run.py -v 2>&1 | tail -60)
grep -n "_download_tnx\|_FALLBACK_RF = 0.0427\|ttl=3600" backend/app/rates.py
grep -n "constant baseline\|In-sample: the optimized\|(1 − pinned)/N" backend/app/optimize_run.py
grep -n "@router.post" backend/app/routers/portfolio.py
git status --short
```

## Tooltips — required for any contract adding interactive elements

This is a backend-only contract with no interactive elements.

## Human verification — does Gunnar need to run anything?

Optional, and read-only against production. If you want to see it against real data before the UI
exists, restart the backend and run:
`curl -s -X POST localhost:8000/portfolio/optimize -H 'content-type: application/json' -d '{"tickers":["MU","<another>"],"weights":[74,26]}' | head -c 600`.
The response lists any pinned holdings. This is the check the other planner session asked for: which
of your holdings are young.

## Open questions

None.
