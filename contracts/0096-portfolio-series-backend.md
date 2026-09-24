# Contract 0096 — Portfolio value series endpoint

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Add `GET /portfolio/series`. It returns a portfolio's buy-and-hold value line, anchored so the last
date equals 100, together with close-only indicator series and the three signals. The pure functions
that build the line go in a new module, and the indicator building in `get_indicators` moves into a
shared function that both routes call.

## Why

Holdings is getting the /tickers chart drawn for the whole portfolio (0098). The modelling decisions
are recorded in `REBUILD.md` under "**The portfolio value line is buy-and-hold, anchored at today,
cash included.**" Read that entry and its bullets before starting. In short:

- Units are chosen once from today's weights and held unchanged backwards. No rebalancing.
- Cash is a constant.
- Before a holding's first bar, its value is held flat at its first price.
- Only close-based indicators are allowed.
- `value_series` is kept separate from how the units are chosen. The future Backtest tab will choose
  units differently and reuse `value_series` unchanged, so keep that seam clean.

## Files

Create:
- `backend/app/portfolio_series.py`: **pure** functions (below). Imports only the stdlib, `pandas`
  and `dataclasses`. **No `app.` imports.**
- `backend/app/routers/portfolio.py`: the HTTP route.
- `backend/tests/test_portfolio_series.py`: unit tests for the pure module.
- `backend/tests/test_api_portfolio.py`: endpoint tests. Define its own `db_mode` and `client`
  fixtures, copied from `tests/test_api_universe.py` lines 55–66 with the SQLite file renamed
  `test_api_portfolio.db`, plus its own bar-insert helper.

Modify:
- `backend/app/indicators.py`: add `CLOSE_ONLY_INDICATORS` and `indicator_series` (below).
- `backend/app/routers/universe.py`: `get_indicators` builds its `series` by calling
  `indicator_series`. Delete its inner `add_series` and the per-group `if` chain. Remove any
  `compute_*` imports that become unused (`compute_atr` is still used by the signals route). **The
  route's behaviour must not change.**
- `backend/app/schemas.py`: add `PortfolioHolding` and `PortfolioSeriesResponse`.
- `backend/app/main.py`: import and `include_router` the new router, next to the existing three.
- `backend/tests/test_indicators.py`: add tests for `indicator_series` only.

**Touch nothing else.** In particular `tests/test_api_universe.py` must not change. Its
`get_indicators` tests are the proof that the refactor preserved behaviour. If one of them fails, the
refactor is wrong; do not change the test. If the work appears to require editing a file not on this
list, stop and report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. It is a snapshot of other working software kept so its behaviour can be compared against this
rebuild, and an edited reference stops being evidence of anything. `.claude/settings.json` denies
Edit and Write there. That deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

### `app/indicators.py`

```python
CLOSE_ONLY_INDICATORS = ("sma", "ema", "bollinger", "rsi", "macd")

def indicator_series(
    requested: set[str],
    close: pd.Series,
    high: pd.Series | None = None,
    low: pd.Series | None = None,
    volume: pd.Series | None = None,
) -> list[dict]:
    """[{"key", "label", "points": list[float | None]}, ...] with NaN → None."""
```

- Output order, keys and labels are **exactly** those `get_indicators` produces today (sma, ema,
  bollinger, donchian, rsi, macd, adx, stochastic, obv, in that order, with the same labels
  character for character). Move the code; don't rewrite it.
- Unknown keys in `requested` are ignored, as today.
- If `donchian`, `adx` or `stochastic` is requested and `high` or `low` is `None`, or `obv` is
  requested and `volume` is `None`, raise `ValueError` naming the key.

### `app/portfolio_series.py`

```python
@dataclass(frozen=True)
class PortfolioSeries:
    dates: list[date]
    total: list[float]                  # cash included
    by_holding: dict[str, list[float]]  # ticker -> value on each date, parallel to dates
    cash_value: float                   # constant across dates
    first_bar: dict[str, date]          # each holding's first stored date
    last_close: dict[str, float]        # each holding's price on the last date

def align_closes(closes: dict[str, pd.Series]) -> pd.DataFrame: ...
def units_from_weights(
    weights: dict[str, float], cash_weight: float, anchor_prices: dict[str, float],
    anchor_value: float = 100.0,
) -> tuple[dict[str, float], float]: ...
def value_series(units: dict[str, float], cash_value: float, prices: pd.DataFrame) -> tuple[pd.Series, pd.DataFrame]: ...
def build_portfolio_series(
    weights: dict[str, float], cash_weight: float, closes: dict[str, pd.Series],
) -> PortfolioSeries: ...
```

- `closes`: one adjusted-close Series per ticker, indexed by `datetime.date`, ascending. Each is
  non-empty.
- `align_closes`: index is the sorted **union** of all dates. Each column is forward-filled across
  gaps and then back-filled before its first bar (the flat fill). No NaN remains.
- `units_from_weights`: `total = Σ weights + cash_weight`.
  - `units[t] = weights[t] / total × anchor_value / anchor_prices[t]`
  - `cash_value = cash_weight / total × anchor_value`
  - Weights need not sum to 100. They are normalised with the cash.
- `value_series`: `by_holding = prices[tickers] × units` (column-wise) and
  `total = by_holding.sum(axis=1) + cash_value`. It has no idea how the units were chosen.
- `build_portfolio_series`: `first_bar` comes from the unaligned `closes`. It aligns, then anchors at
  the **last row** of the aligned frame (so `last_close` is that row), then calls `units_from_weights`,
  then `value_series`. The total's last value is therefore 100 (±1e-9).

### `app/schemas.py`

```python
class PortfolioHolding(BaseModel):
    ticker: str
    weight: float        # as sent, not normalised
    first_bar: date
    last_close: float

class PortfolioSeriesResponse(BaseModel):
    dates: list[date]
    value: list[float]
    cash_value: float
    holdings: list[PortfolioHolding]   # in request order
    series: list[IndicatorSeries]
    signals: list[SignalOut]
```

### `GET /portfolio/series`

`routers/portfolio.py`: `router = APIRouter(prefix="/portfolio", tags=["portfolio"])`. It keeps its own
`_DATABASE_NOT_CONFIGURED = "Database not configured"` and `_require_database()`, the same pattern as
`routers/news.py` and `routers/ops.py`. Do not import private names from `routers/universe.py`.

Query parameters: `tickers` (comma list), `weights` (comma list, parallel), `cash` (float, default 0),
`include` (comma list, default empty).

Example: `/portfolio/series?tickers=AAA,BBB&weights=60,40&cash=0&include=sma,rsi,macd`

The request is checked in this order. The first failure wins:

| condition | status | `detail` |
|---|---|---|
| database not configured | 503 | `Database not configured` |
| no tickers after trimming and uppercasing | 400 | `At least one ticker is required` |
| more than 100 tickers | 400 | `At most 100 tickers may be requested` |
| duplicate ticker | 400 | `Duplicate ticker: <T>` |
| `weights` count ≠ `tickers` count, or a weight that is not a number | 400 | `weights must be one number per ticker` |
| a weight ≤ 0 or not finite | 400 | `Every weight must be positive` |
| `cash` < 0 or not finite | 400 | `cash must be zero or positive` |
| an `include` key not in `CLOSE_ONLY_INDICATORS` | 400 | `<key> is not available for a portfolio: it needs a single security's high, low or volume` |
| a ticker with no stored bars whose `adj_close` is non-null | 404 | `No stored price history for <T>` (the first such ticker in request order) |

- Query `PriceBar.ticker, PriceBar.date, PriceBar.adj_close` for the requested tickers across **all
  stored history** (no `SIGNAL_WINDOW_DAYS` limit), skipping rows whose `adj_close` is None. The
  line uses adjusted closes, as the /tickers price line does.
- `series` is `indicator_series(include_set, total_as_series)`.
- `signals` is `compute_all_signals(pd.Series(total, index=pd.to_datetime(dates)))`.
- `value` is the `total` list. `by_holding` is **not** serialised (see REBUILD.md).

## Out of scope

- No frontend changes. The client function belongs to 0098.
- No POST body or persistence. Portfolios stay in localStorage.
- Don't change `SIGNAL_WINDOW_DAYS`, the signals route or the history route.
- No benchmark comparison, returns statistics, Sharpe or drawdown. Those are Backtest's.
- Don't add ATR or any high/low/volume indicator for portfolios.
- No new dependencies.

## Acceptance criteria

1. The full backend suite passes, with more tests than the 506 before this contract.
2. `grep -c "def test_" backend/tests/test_portfolio_series.py` prints **7 or more**, and the file
   contains tests asserting these literal cases. The dates are d1, d2 and d3 = 2024-01-02, 03 and 04.
   Values must be within ±0.01.
   - a. AAA `[10, 11, 12]`, BBB `[20, 20, 25]`, weights 60/40, cash 0 → total `[82, 87, 100]`.
   - b. The same prices, weights 45/30, cash 25 → total `[86.5, 90.25, 100]`, `cash_value` 25.
   - c. Flat fill: AAA `[10, 11, 12]` on d1–d3, NEWB `[30, 40]` on d2–d3 only, weights 50/50, cash 0
     → total `[79.17, 83.33, 100]`, NEWB's `by_holding[0]` = 37.5, `first_bar["NEWB"]` = d2.
   - d. Gap: AAA has bars on d1 and d3 only (`10`, `12`), BBB `[20, 20, 25]`, weights 60/40
     → total `[82, 82, 100]`.
   - e. Weights 30/20, cash 0, on case a's prices → total `[82, 87, 100]` (normalisation).
   - f. For case c, at every date `Σ by_holding + cash_value == total` within 1e-9.
   - g. `value_series` called directly with units `{"AAA": 2.0}`, cash 5, and prices AAA `[10, 20]`
     → total `[25, 45]`. This shows it doesn't depend on `units_from_weights`.
3. `grep -c "def test_" backend/tests/test_api_portfolio.py` prints **8 or more**. The tests cover:
   - case a over HTTP, asserting `value`, `cash_value`, and each holding's `first_bar` and
     `last_close`. Store `close` at **2 ×** `adj_close` so that using the wrong column fails.
   - `include=sma,rsi,macd` → series keys in the order `sma_fast, sma_slow, rsi, macd_line,
     macd_signal, macd_histogram`, each with `len(points) == len(dates)`.
   - `include=donchian` → 400, and `include=obv` → 400.
   - an unstored ticker → 404 with the exact detail above.
   - a duplicate ticker → 400.
   - a weights-count mismatch → 400.
   - `cash=-1` → 400.
   - `signals` is a list whose `signal` values are `["sma_cross", "rsi_threshold", "macd_cross"]`.
4. The router no longer computes indicators itself. This prints nothing:
   `grep -nE "compute_(sma|ema|bollinger|donchian|rsi|macd|adx|stochastic|obv)\b" backend/app/routers/universe.py`
5. `grep -c "indicator_series(" backend/app/routers/universe.py backend/app/routers/portfolio.py`
   shows **1** for each file.
6. The pure module stays pure. This prints nothing: `grep -nE "^(from|import) +app|^from \.+" backend/app/portfolio_series.py`
7. `grep -n "include_router(portfolio.router)" backend/app/main.py` prints exactly one line.
8. `git diff --stat -- backend/tests/test_api_universe.py` prints nothing. (The file is untouched and
   its `get_indicators` tests still pass as part of criterion 1.)
9. `backend/tests/test_indicators.py` gains at least two tests:
   - `indicator_series({"sma", "rsi"}, close)` returns keys `["sma_fast", "sma_slow", "rsi"]`.
   - `indicator_series({"donchian"}, close)` raises `ValueError`.

If any criterion cannot be met as written, for example because it contradicts another criterion or
the Files list, **report `BLOCKED` and name the conflict**. That is the correct answer. Don't bend the
code or the check to make it pass.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render connection
> string. Any script run without that prefix talks to the **production database**. `tests/conftest.py`
> strips the variable for `pytest` only; it does not cover scripts. **If you need a real database for
> a probe, use the pytest fixtures rather than an ad-hoc script.**

Run each of these and paste the **complete, verbatim** output into the report, including failures.
Don't summarise, trim or clean up.

```bash
(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q 2>&1 | tail -5)
(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q tests/test_portfolio_series.py tests/test_api_portfolio.py tests/test_indicators.py -v 2>&1 | tail -40)
grep -c "def test_" backend/tests/test_portfolio_series.py backend/tests/test_api_portfolio.py
grep -nE "compute_(sma|ema|bollinger|donchian|rsi|macd|adx|stochastic|obv)\b" backend/app/routers/universe.py
grep -c "indicator_series(" backend/app/routers/universe.py backend/app/routers/portfolio.py
grep -nE "^(from|import) +app|^from \.+" backend/app/portfolio_series.py
grep -n "include_router(portfolio.router)" backend/app/main.py
git diff --stat -- backend/tests/test_api_universe.py
git status --short
```

## Human verification — does Gunnar need to run anything?

**Nothing to run.** This contract has no visible surface. The endpoint gets exercised against real
data when 0098 draws it, and that contract's human check covers it.

## Open questions

None known. If you hit one, for instance a pandas alignment behaviour that makes case d come out other
than `[82, 82, 100]`, report `BLOCKED` with the actual numbers rather than choosing a different fill
rule.
