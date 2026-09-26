# Contract 0115 — CAPM optimizer backend for the Outlook tab

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`POST /portfolio/capm` exists. It takes a portfolio, per-holding views, freeze flags and weight
limits. It returns the max-Sharpe weights on CAPM expected returns, plus per-holding betas and
returns, expected portfolio statistics and parametric VaR. The logic lives in a new pure module,
`app/capm_run.py`.

## Why

REBUILD.md, entry "The Outlook tab is a port of `main`'s Outlook page, all three sections"
(2026-09-24). This is the first Outlook contract, and the CAPM UI (0116) and trades/Apply (0117) build
on it. The source is `main:backend/routers/portfolios_optimize.py`, `capm_optimize`, lines 451–662.
Read it with `git show 'main:backend/routers/portfolios_optimize.py' | sed -n 440,662p`.

It is ported with these **deliberate differences** from `main`. Each one is a decision, not an
oversight:

| `main` | this contract | why |
|---|---|---|
| reads positions and share counts from the database | takes `tickers` + `weights` in the body, like `/optimize` | rebuild portfolios live in localStorage |
| frozen weight = shares × price ÷ total, so 0 for a weights-only portfolio | frozen weight = the holding's current **weight** | works with or without share counts |
| `compute_returns` drops every row with any NaN, so one young holding silently shortens the whole fit | Optimize's pinning rule (REBUILD, "Young holdings are pinned") | the same decision Gunnar made for Optimize |
| a holding equal to `market_ticker` gets no beta (`compute_betas` skips it) and its expected return falls back to rf | its beta is exactly 1.0 | it is the market |
| builds the trade table (`action_table`) with `int()`-truncated shares, and frozen rows keep their dollars even when the target value differs | **no trade table**: the frontend builds it (0117) with Optimize's `tradeRows` | one trade-table implementation; fractional shares per REBUILD |
| returns the CAL leverage points | not returned | the frontend derives `rf + k·(E − rf)` itself |
| `rf: None` means live, and the UI sends nothing when you type 0 | `rf: null` means live (0114's `^IRX` rate, with source). An explicit `0` means 0 | a real 0% rate is expressible |
| market ticker default `"VT"` | default `"SPY"` | SPY is the rebuild's benchmark and is always in the universe |
| weight limits in percent (`min_pct`, `max_pct`) | fractions (`min_weight`, `max_weight`) | matches `/optimize` |
| Sharpe with zero vol = `0.0` | `None` | REBUILD rule: zero is a false claim |
| rounds every output | full precision | matches `/optimize` |
| an unsatisfiable max-weight set reaches SLSQP and surfaces as "did not converge" | explicit feasibility guards with plain messages | Optimize (0112) does the same |

**The expected-return formula is unchanged:** `E[R_i] = rf + β_i·MRP + MRP·view_i`, which is the
existing `optimizer.compute_capm_expected_returns`. It carries 0112's `FLAG(custom)`. Leave that
comment exactly as it is. `main`'s Outlook path applies each view **once**, with no κ, and this contract
must not add κ.

## Files

Create:
- `backend/app/capm_run.py` — pure orchestration. No database, HTTP or network.
- `backend/tests/test_capm_run.py`
- `backend/tests/test_api_capm.py`

Modify:
- `backend/app/schemas.py` — add the six models listed under Interface, after `OptimizeResponse`.
  Change nothing else.
- `backend/app/routers/portfolio.py` — add the `/capm` route after `/optimize`, and extend the two
  import lines. Change nothing else.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs — that is what it is for — but it is a snapshot of other working software kept so its behaviour
can be compared against this rebuild, and an edited reference stops being evidence of anything.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it. The same applies to `main`: read it with
`git show`, and never check it out.

## Interface

### `app/capm_run.py`

The module docstring is one line: `"""Pure orchestration for the Outlook tab's CAPM optimizer."""`

It imports from `app.optimizer` (`compute_betas`, `compute_capm_expected_returns`, `compute_returns`,
`optimize_max_sharpe_capm`) and from `app.optimize_run` (`LOOKBACK_DAYS`, `PIN_GRACE_DAYS`), plus
`scipy.stats.norm`. It defines no copy of either constant. Do not edit `optimizer.py` or
`optimize_run.py`.

```python
class CapmInputError(ValueError):
    """The request cannot be optimized as asked. The router maps it to HTTP 422 with str(exc) as the detail."""


@dataclass(frozen=True)
class HoldingConfig:
    freeze: bool = False
    view: float = 0.0          # fraction: -0.5 … 1.0
    min_weight: float = 0.0    # fraction of the invested portfolio
    max_weight: float = 1.0


@dataclass(frozen=True)
class CapmHolding:
    ticker: str
    current_weight: float
    target_weight: float
    beta: float
    capm_return: float         # rf + beta * mrp
    view: float
    expected_return: float     # capm_return + mrp * view
    vol: float                 # annualised, from the score-window covariance
    frozen: bool               # the config's freeze flag, as requested
    pinned: bool
    first_bar: date


@dataclass(frozen=True)
class CapmResult:
    tickers: list[str]                    # request order
    holdings: list[CapmHolding]           # request order
    current_weights: dict[str, float]
    target_weights: dict[str, float]      # sums to 1
    expected_return: float
    expected_vol: float
    expected_sharpe: float | None
    portfolio_beta: float
    var_95: dict[str, float]              # keys: daily, weekly, monthly, quarterly, annual
    rf: float
    mrp: float
    market_ticker: str
    lookback_days: int
    fit_start: date
    fit_end: date
    score_start: date
    warnings: list[str]


def run_capm(
    weights: dict[str, float],
    closes: dict[str, pd.Series],
    market: pd.Series,
    *,
    market_ticker: str,
    rf: float,
    mrp: float = 0.05,
    lookback_days: int = 1825,
    configs: dict[str, HoldingConfig] | None = None,
) -> CapmResult: ...
```

### The algorithm, in order

Every error is `raise CapmInputError(<exact message>)`. The messages below are exact, and the tests
assert them. `{x:.1%}` is Python formatting.

1. **Validate inputs**, in this order:
   - `lookback_days not in LOOKBACK_DAYS` → `f"lookback_days must be one of {LOOKBACK_DAYS}"`
   - `not (math.isfinite(rf) and 0 <= rf < 0.2)` → `"rf must be between 0 and 0.2"`
   - `not (math.isfinite(mrp) and 0 < mrp <= 0.2)` → `"mrp must be above 0 and at most 0.2"`
   - `weights` empty, or any weight not finite or ≤ 0 → `"weights must be finite and greater than zero"`
   - a `configs` key not in `weights`, checked in `configs` order →
     `f"configs names {ticker}, which is not a holding."`
   - for each holding in `weights` order (a missing config means `HoldingConfig()`):
     - either limit outside [0, 1] → `f"{t}: weight limits must be between 0% and 100%."`
     - `min_weight > max_weight` → `f"{t}: min weight ({min:.1%}) is above max weight ({max:.1%})."`
     - `not -0.5 <= view <= 1.0` → `f"{t}: view must be between -50% and +100%."`
   - a holding missing from `closes`, or with empty closes →
     `f"missing closes for weighted ticker {t!r}"`
2. **Current weights** are `weights` normalised to sum to 1. Cash is not an input: the CAPM optimizes
   the invested holdings, as Optimize does.
3. **Window.** `end` is the minimum of every holding's last close date and `market`'s last date.
   `lookback_start = end - timedelta(days=lookback_days)`. If `market.index[0] > lookback_start +
   timedelta(days=PIN_GRACE_DAYS)`, raise
   `f"Market ticker {market_ticker} has prices only from {market.index[0]}, after the lookback start ({lookback_start}). Choose a shorter lookback or another market ticker."`
4. **Pinning.** Use Optimize's rule exactly: a holding whose first close is after
   `lookback_start + timedelta(days=PIN_GRACE_DAYS)` is pinned. Its target weight equals its current
   weight, and its freeze flag and limits are ignored. Everything else is "fitted".
   - Fewer than 2 fitted holdings → `"Need at least 2 holdings with full history to optimize."`
   - Every fitted holding frozen → `"Nothing to optimize: every holding with full history is frozen."`
   - `scale = 1 - Σ pinned current weights`.
5. **Feasibility, in final-weight units.** Over the fitted holdings, a frozen holding contributes its
   current weight to both sums, and an unfrozen one contributes `min_weight` and `max_weight`:
   - `Σ lower > scale + 1e-9` →
     `f"Minimum and frozen weights add up to {lower:.1%}, more than the {scale:.1%} available to optimize. Lower some minimums or unfreeze a holding."`
   - `Σ upper < scale - 1e-9` →
     `f"Maximum and frozen weights add up to {upper:.1%}, less than the {scale:.1%} that must be allocated. Raise some maximums or unfreeze a holding."`
6. **Betas.** Build one DataFrame with a column per holding plus `market_ticker`. If the market is also
   a holding, it is the same single column. Restrict it to `lookback_start <= index <= end`, sort,
   `ffill()`, then `.pct_change()`. Do not `dropna()` the frame: `compute_betas` drops NaNs per pair,
   so each holding's beta uses its own history. Call `compute_betas(frame, market_ticker)`. If the
   market is a holding, set its beta to exactly `1.0`.
   - A NaN beta → `f"{t} has fewer than 2 days of prices overlapping {market_ticker}; its beta cannot be estimated."`
7. **Expected returns:** `compute_capm_expected_returns(betas, rf=rf, mrp=mrp, views={t: view})`, over
   every holding, including pinned ones. Pinned holdings show their CAPM figures but are not optimized.
8. **Fit.**
   - Take the fitted holdings' closes over the same window, `ffill()`, and apply `compute_returns`
     (this one does `dropna`). That gives `fit_returns`, with `fit_start` and `fit_end` as its first
     and last index.
   - If `len(fit_returns) < 60`, append the warning
     `"Fewer than 60 trading days of history — optimization results may be unreliable."`
   - The bounds are in fitted-sleeve units. A frozen holding gets `(c/scale, c/scale)`. An unfrozen one
     gets `(min_weight/scale, min(1.0, max_weight/scale))`.
   - Call `optimize_max_sharpe_capm(fit_returns, expected_returns, rf=rf, asset_bounds=bounds)`.
   - A `RuntimeError` becomes `CapmInputError(str(exc))`.
   - Target weight = fitted weight × `scale`. A pinned holding's target = its current weight.
9. **Score window and statistics.**
   - Take all holdings' closes over the window, `ffill()`, and apply `compute_returns` (so it starts
     where every holding has prices). Call the result `score_returns`; `score_start` is its first
     index. `cov = score_returns.cov().values * 252`.
   - If `score_start > fit_start`, append the warning
     `f"Volatility, Sharpe and VaR use prices from {score_start} onward, the first date every holding has prices."`
   - `w` is the target weights in request order.
   - `expected_return = w · E`
   - `expected_vol = sqrt(max(w·cov·w, 0))`
   - `expected_sharpe = (expected_return - rf) / expected_vol` if `expected_vol > 1e-12`, else `None`
   - `portfolio_beta = w · β`
   - each holding's `vol = sqrt(cov[i, i])`
10. **VaR (95%, parametric normal):** `z = norm.ppf(0.05)`. For `(key, n)` in
    `(("daily", 252), ("weekly", 52), ("monthly", 12), ("quarterly", 4), ("annual", 1))`, the value is
    `expected_return / n + z * expected_vol / sqrt(n)`. This is `main`'s formula.
11. **Warnings order:** first one pinned warning per pinned holding, in request order, then the
    60-day warning, then the score-window warning. The pinned warning is
    `f"{t} has prices only from {first_bar}; it is held at its current weight ({w:.1%}) and not optimized. Its min/max limits and freeze setting do not apply."`
    There are no other warnings, so a clean run returns `[]`.

### Schemas (`app/schemas.py`)

```python
class CapmHoldingConfigIn(BaseModel):
    freeze: bool = False
    view: float = 0.0
    min_weight: float = 0.0
    max_weight: float = 1.0


class CapmRequest(BaseModel):
    tickers: list[str]
    weights: list[float]
    lookback_days: int = 1825
    rf: float | None = None
    mrp: float = 0.05
    market_ticker: str = "SPY"
    configs: dict[str, CapmHoldingConfigIn] = {}


class CapmHoldingOut(BaseModel):
    ticker: str
    current_weight: float
    target_weight: float
    beta: float
    capm_return: float
    view: float
    expected_return: float
    vol: float
    frozen: bool
    pinned: bool
    first_bar: date


class CapmMetricsOut(BaseModel):
    expected_return: float
    expected_vol: float
    expected_sharpe: float | None
    portfolio_beta: float


class CapmVarOut(BaseModel):
    daily: float
    weekly: float
    monthly: float
    quarterly: float
    annual: float


class CapmResponse(BaseModel):
    tickers: list[str]
    holdings: list[CapmHoldingOut]
    current_weights: dict[str, float]
    target_weights: dict[str, float]
    metrics: CapmMetricsOut
    var_95: CapmVarOut
    rf: float
    rf_source: str          # "live" | "fallback" | "manual"
    mrp: float
    market_ticker: str
    lookback_days: int
    fit_start: date
    fit_end: date
    score_start: date
    warnings: list[str]
```

### Route (`app/routers/portfolio.py`)

```python
@router.post("/capm", response_model=CapmResponse)
def capm_portfolio(body: CapmRequest) -> dict:
```

1. `_require_database()`, then `tickers, weights = _normalise_request(body.tickers, body.weights)`.
2. `market_ticker = body.market_ticker.strip().upper()`.
3. `closes = _load_stored_closes(tickers)`. A missing holding keeps that helper's existing 404.
4. `market = closes.get(market_ticker)`. If it is `None`, use
   `_load_stored_closes([market_ticker], required=False).get(market_ticker)`. If it is still `None`,
   raise HTTP 422 with `f"No stored price history for market ticker {market_ticker}. Add it to the Universe first."`
   Use `is None`: a pandas Series has no truth value, so `or` must not be used.
5. rf: if `body.rf is None`, then `rf, rf_source = fetch_risk_free_rate_with_source()`. Otherwise
   `rf, rf_source = body.rf, "manual"`. Do not call the network when rf is given.
6. `configs = {key.strip().upper(): HoldingConfig(**value.model_dump()) for key, value in body.configs.items()}`
7. Call `run_capm(dict(zip(tickers, weights, strict=True)), closes, market, market_ticker=…, rf=…, mrp=body.mrp, lookback_days=body.lookback_days, configs=configs)`.
   `CapmInputError` → HTTP 422 with `str(exc)`.
8. Return a dict:
   - `holdings` is `[asdict(h) for h in result.holdings]`.
   - `metrics` is the four statistics.
   - `rf_source` is the value from step 5.
   - Every other field comes from `result` by name.

## Test fixtures (literal — use exactly these)

These go in `test_capm_run.py`. `test_api_capm.py` uses the same `DATES`, `A`, `B` and `M`, and
seeds them the same way `tests/test_api_optimize.py` does: copy its `db_mode`, `client` and `_insert`.

```python
DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=261)]   # 2024-01-02 … 2024-12-31
m  = np.tile([0.01, -0.01, 0.01, -0.01], 65)
e1 = np.tile([0.01, 0.01, -0.01, -0.01], 65)
e2 = np.tile([0.01, -0.01, -0.01, 0.01], 65)


def prices(returns, index=DATES, start=100.0):
    return pd.Series(start * np.concatenate([[1], np.cumprod(1 + returns)]), index=index)


M = prices(m)                       # the market
A = prices(1.5 * m + e1)            # beta 1.5
B = prices(0.5 * m + e2)            # beta 0.5
K = DATES.index(date(2024, 6, 3))   # 109
Y = prices((0.8 * m + 0.5 * e1 + 0.5 * e2)[K:], index=DATES[K:], start=50.0)   # young: first bar 2024-06-03
```

`m`, `e1` and `e2` are orthogonal with zero mean, so the betas are exact. Unless a test says
otherwise, it runs with `market=M, market_ticker="M", rf=0.04, mrp=0.05, lookback_days=365`, and
the lookback start is 2024-01-01.

## Expected values (planner-verified in scratch against numpy, closed-form tangency and grid search)

Tolerances are `pytest.approx(abs=…)`, as given.

1. **`test_two_holdings_match_the_analytic_tangency`** — `weights={"A": 1, "B": 1}`:
   - `current_weights == {"A": 0.5, "B": 0.5}`; `target_weights` A 0.75, B 0.25 (1e-4); their sum 1 (1e-9)
   - betas 1.5 and 0.5, `capm_return` 0.115 and 0.065, `expected_return` the same (all 1e-9)
   - `expected_return` 0.1025 (1e-4), `expected_vol` 0.235240 (1e-4), `expected_sharpe` 0.265686 (1e-3),
     `portfolio_beta` 1.25 (1e-4)
   - `var_95["daily"]` −0.0239679 (1e-4), `var_95["annual"]` −0.284435 (1e-3)
   - holding `vol` A 0.286734, B 0.177825 (1e-6)
   - `fit_start == score_start == date(2024, 1, 3)`, `fit_end == date(2024, 12, 31)`, `warnings == []`
   - `tickers == ["A", "B"]`; every holding has `pinned` False and `frozen` False
2. **`test_view_changes_expected_return_not_capm_return`** — the same, with
   `configs={"A": HoldingConfig(view=-0.2)}`:
   - A's `capm_return` 0.115, `view` −0.2, `expected_return` 0.105 (1e-9)
   - targets A 0.657895, B 0.342105 (1e-4); `expected_return` 0.0913158 (1e-4)
3. **`test_market_as_holding_has_beta_one_and_freeze_holds_its_weight`** —
   `weights={"A": 20, "B": 30, "M": 50}`, `configs={"M": HoldingConfig(freeze=True)}`:
   - M's beta `== 1.0` exactly, and `frozen` True
   - M target 0.5 (1e-9); A 0.3125, B 0.1875 (1e-4)
4. **`test_unconstrained_with_the_market_held_is_all_market`** — `weights={"A": 1, "B": 1, "M": 1}`,
   no configs: M ≈ 1.0, A ≈ 0, B ≈ 0 (1e-3). With pure CAPM returns, the market is the tangency
   portfolio.
5. **`test_max_weight_caps_a_holding`** — `weights={"A": 1, "B": 1}`,
   `configs={"A": HoldingConfig(max_weight=0.6)}`: A 0.6, B 0.4 (1e-6).
6. **`test_young_holding_is_pinned_and_scored_on_the_common_window`** —
   `weights={"A": 40, "B": 40, "Y": 20}`, `closes` includes `Y`:
   - Y target 0.2 (1e-9), `pinned` True; A 0.6, B 0.2 (1e-4)
   - Y beta 0.793333 (1e-6); `fit_start == date(2024, 1, 3)`, `score_start == date(2024, 6, 4)`
   - `expected_return` 0.0979333 (1e-4), `expected_vol` 0.219962 (1e-4), `portfolio_beta` 1.158667 (1e-4)
   - holding `vol` A 0.286243, B 0.177594, Y 0.169006 (1e-4)
   - `warnings ==` these two strings, in this order:
     - `"Y has prices only from 2024-06-03; it is held at its current weight (20.0%) and not optimized. Its min/max limits and freeze setting do not apply."`
     - `"Volatility, Sharpe and VaR use prices from 2024-06-04 onward, the first date every holding has prices."`
7. **`test_input_errors`** — one `pytest.mark.parametrize` with exactly these **12** cases. Each uses
   `pytest.raises(CapmInputError, match=re.escape(message))`, with `weights={"A": 1, "B": 1}` and
   `closes={"A": A, "B": B}` unless the case says otherwise:

   | case | message |
   |---|---|
   | configs A `max_weight=0.3`, B `max_weight=0.3` | `Maximum and frozen weights add up to 60.0%, less than the 100.0% that must be allocated. Raise some maximums or unfreeze a holding.` |
   | configs A `min_weight=0.6`, B `min_weight=0.6` | `Minimum and frozen weights add up to 120.0%, more than the 100.0% available to optimize. Lower some minimums or unfreeze a holding.` |
   | configs A `min_weight=0.5, max_weight=0.4` | `A: min weight (50.0%) is above max weight (40.0%).` |
   | configs A `max_weight=1.2` | `A: weight limits must be between 0% and 100%.` |
   | configs A `view=1.5` | `A: view must be between -50% and +100%.` |
   | configs A and B `freeze=True` | `Nothing to optimize: every holding with full history is frozen.` |
   | `weights={"A": 1, "Y": 1}`, `closes={"A": A, "Y": Y}` | `Need at least 2 holdings with full history to optimize.` |
   | configs `{"Z": HoldingConfig()}` | `configs names Z, which is not a holding.` |
   | `lookback_days=400` | `lookback_days must be one of (365, 730, 1095, 1825)` |
   | `rf=0.25` | `rf must be between 0 and 0.2` |
   | `mrp=0` | `mrp must be above 0 and at most 0.2` |
   | `market=Y, market_ticker="Y"` | `Market ticker Y has prices only from 2024-06-03, after the lookback start (2024-01-01). Choose a shorter lookback or another market ticker.` |
8. **`test_non_convergence_is_an_input_error`** — monkeypatch `app.capm_run.optimize_max_sharpe_capm`
   to raise `RuntimeError("CAPM optimizer did not converge: test")`. Expect `CapmInputError` with
   exactly that message.
9. **`test_short_history_warns`** — *(amended 2026-09-26: the original 50-daily-bar fixture cannot
   reach this path, because 50 daily bars never cover a 365-day lookback, so the market guard fires first.
   Sonnet's BLOCKED report was correct.)* Use **weekly** bars that span the lookback but give
   fewer than 60 returns:
   ```python
   WEEKS = [d.date() for d in pd.date_range("2024-01-05", periods=55, freq="W-FRI")]   # … 2025-01-17
   Mw = prices(m[:54], index=WEEKS)
   Aw = prices((1.5 * m + e1)[:54], index=WEEKS)
   Bw = prices((0.5 * m + e2)[:54], index=WEEKS)
   ```
   `run_capm({"A": 1, "B": 1}, {"A": Aw, "B": Bw}, Mw, market_ticker="M", rf=0.04, mrp=0.05, lookback_days=365)`:
   - `warnings == ["Fewer than 60 trading days of history — optimization results may be unreliable."]`
   - `fit_start == score_start == date(2024, 1, 26)`, `fit_end == date(2025, 1, 17)`
   - betas 1.5 and 0.5 (1e-9); A 0.75, B 0.25 (1e-4); neither holding pinned

`test_api_capm.py` has exactly **6** tests. Seed `A`, `B` and `M`, but not `SPY`:
1. **`test_capm_requires_database`** — no `db_mode`: POST → 503.
2. **`test_manual_rf_and_lowercase_inputs`** — body
   `{"tickers": ["a", "b"], "weights": [1, 1], "lookback_days": 365, "rf": 0.04, "mrp": 0.05, "market_ticker": "m", "configs": {"a": {"view": -0.2}}}`:
   - 200; `rf_source == "manual"`; `rf == 0.04`
   - `target_weights["A"]` 0.657895 (1e-4); `market_ticker == "M"`
   - `holdings[0]["ticker"] == "A"`; `var_95` has the 5 keys
3. **`test_live_rf_when_rf_omitted`** — monkeypatch `app.routers.portfolio.fetch_risk_free_rate_with_source`
   to `lambda: (0.04, "live")`, and omit `rf` → `rf_source == "live"` and A 0.75 (1e-4). Also, a
   second call with `"rf": 0.04` must not call the patched function: have it record calls, and
   assert the count is 1 after both requests.
4. **`test_missing_market_ticker_is_422`** — `market_ticker: "VT"` → 422, detail
   `"No stored price history for market ticker VT. Add it to the Universe first."`
5. **`test_missing_holding_is_404`** — tickers `["A", "Z"]` → 404, detail `"No stored price history for Z"`.
6. **`test_input_error_is_422`** — `"lookback_days": 400` → 422, detail
   `"lookback_days must be one of (365, 730, 1095, 1825)"`.

## Out of scope

- **Do not touch `/optimize`, `run_optimize` or `OptimizeRequest`.** Removing their
  `max_sharpe_capm`, `conviction_views` and `kappa` path is a later contract, after the CAPM UI works.
- No frontend changes. `api/client.ts` types come in 0116.
- No trade table, no CAL leverage points, no share math.
- Do not edit `optimizer.py`, including its `FLAG(custom)` comments.
- No new dependencies. scipy is already in `requirements.txt`.
- Do not edit `REBUILD.md`, `README.md` or anything in `contracts/done/`.

## Acceptance criteria

1. **Before any edit:** `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)`
   reports `633 passed`. A different count means stop and report `BLOCKED`, with the output.
2. **After:** it reports `659 passed` (633 + 20 + 6), with no failures and no errors.
3. `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_capm_run.py tests/test_api_capm.py 2>&1 | tail -1)` reports `26 passed`.
4. `grep -nE "^from app\.(db|models|routers|rates|cache|market_data)|import (requests|yfinance|sqlalchemy|fastapi)" backend/app/capm_run.py` prints nothing. This is the purity check.
5. `grep -c "LOOKBACK_DAYS = \|PIN_GRACE_DAYS = " backend/app/capm_run.py` prints `0`. The constants are imported, not copied.
6. `grep -n "kappa\|delta_mu" backend/app/capm_run.py` prints nothing. There is no κ.
7. `git diff --stat -- backend/app/optimizer.py backend/app/optimize_run.py` prints nothing.
8. `git diff -- backend/app/schemas.py | grep '^-' | grep -v '^---'` prints nothing: schemas only adds lines.
9. `git diff -- backend/app/routers/portfolio.py | grep '^-' | grep -v '^---'` prints exactly one line,
   the old line 15: `-from app.schemas import OptimizeRequest, OptimizeResponse, PortfolioSeriesResponse`.
   The only other changes are additions: the extended schemas import, a new
   `from app.capm_run import CapmInputError, HoldingConfig, run_capm` line in alphabetical position,
   `from dataclasses import asdict`, and the route.
10. `git status --short` shows no changes beyond the 5 files listed under Files, this contract, its
    report, and whatever the pre-edit `git status --short` already showed. Run that before editing and
    paste it; `frontend/src/pages/analysis/OptimizePage.tsx` may already be modified by Gunnar, so leave it alone.
11. `(cd backend && DATABASE_URL="" .venv/bin/python -W ignore -c "from app.main import app; print(sorted(p for p in app.openapi()['paths'] if p.startswith('/portfolio')))")`
    prints `['/portfolio/capm', '/portfolio/optimize', '/portfolio/series']`.

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
git status --short
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)
# after editing
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_capm_run.py tests/test_api_capm.py 2>&1 | tail -1)
grep -nE "^from app\.(db|models|routers|rates|cache|market_data)|import (requests|yfinance|sqlalchemy|fastapi)" backend/app/capm_run.py; echo "exit=$?"
grep -c "LOOKBACK_DAYS = \|PIN_GRACE_DAYS = " backend/app/capm_run.py
grep -n "kappa\|delta_mu" backend/app/capm_run.py; echo "exit=$?"
git diff --stat -- backend/app/optimizer.py backend/app/optimize_run.py
git diff -- backend/app/schemas.py | grep '^-' | grep -v '^---'; echo "exit=$?"
git diff -- backend/app/routers/portfolio.py | grep '^-' | grep -v '^---'
git status --short
(cd backend && DATABASE_URL="" .venv/bin/python -W ignore -c "from app.main import app; print(sorted(p for p in app.openapi()['paths'] if p.startswith('/portfolio')))")
```

## Human verification — does Gunnar need to run anything?

- **Nothing to run yet.** There is no UI until 0116. The tests use SQLite and a patched rate. The live
  `^IRX` fetch is 0114's code, already exercised there. The real check against stored Postgres data
  happens when 0116 puts a button on it.

## Open questions

None for the coder. **If** any expected value above does not reproduce, report `BLOCKED` with the
actual number. Do not adjust the fixture or the tolerance: the values were verified independently
of the code under test, so a mismatch means the implementation differs from this spec.
