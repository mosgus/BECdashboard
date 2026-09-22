# Contract 0082 — Technical signals: SMA cross, RSI, MACD, and ATR, served per ticker

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`GET /universe/signals?tickers=A,B,C` returns, per ticker, three signal states (SMA cross, RSI, MACD)
with their last trigger date, plus ATR as a percentage of price.

## Why

The Holdings tab gains a `Signal` column (contract 0083). This is the computation.

Ported in substance from `main:backend/core/indicators.py` and `main:backend/core/signals.py`, with
**three deliberate departures**, each decided 2026-09-22:

- **ATR is a number, not a signal.** Gunnar's call. The reference lists `ATR` in its frontend dropdown
  but `compute_all_signals` never produces one — `grep -in "atr" signals.py` returns nothing — so
  selecting it in the reference app shows an empty cell. ATR measures how much price moves, not which
  direction, so it has no bullish or bearish reading. It is returned as `atr_pct` with no state.
- **One query for all tickers.** The reference fetches per row (`SignalCell` runs its own `useQuery`).
  `REBUILD.md` records that concurrent fan-out is what got Render's shared IP rate-limited by Yahoo,
  and contract 0077 already established the bounded-single-query shape for `/universe/returns`.
- **Insufficient history returns `state: null`, not `NEUTRAL`.** The reference returns `NEUTRAL` when
  RSI is empty, conflating *"computed, and it is neutral"* with *"could not compute."* Those are
  different answers and the column will render them differently.

**This is the first numerical feature in the rebuild.** `REBUILD.md`: *"Any backend module doing math
or data transformation ships with pytest tests. That's where silent wrongness lives — a wrong Sharpe
ratio looks entirely plausible."* A wrong RSI looks entirely plausible too. The known-value tests in
the criteria are the point of this contract, not an afterthought.

## Files

Create:
- `backend/app/indicators.py` — pure indicator math. No I/O, no clock, no app-internal imports.
- `backend/app/signals.py` — pure signal derivation over indicators.
- `backend/tests/test_indicators.py`, `backend/tests/test_signals.py`.

Modify:
- `backend/app/schemas.py` — the response models.
- `backend/app/routers/universe.py` — the route.
- `backend/tests/test_api_universe.py` — endpoint tests.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**No frontend file.** The column is contract 0083.

Do not change `returns.py`, `strip.py`, `cache.py`, or `market_data.py`.

**`reference files/` is read-only and never belongs on a file list.** Read `main` in place with
`git show main:backend/core/indicators.py` — it is a reference, not a template, and three of its
behaviours are deliberately not carried over.

> **Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string, so an
> unprefixed script talks to the **production database**.

## Interface

`pandas` is already a dependency and is the right tool for `rolling`/`ewm`. Both new modules may
import it. They remain *pure* in this project's sense: no database, no network, no clock, no
`app.*` imports.

### `app/indicators.py`

```python
def compute_sma(series: pd.Series, window: int) -> pd.Series
def compute_ema(series: pd.Series, window: int) -> pd.Series
def compute_rsi(series: pd.Series, window: int = 14) -> pd.Series
def compute_macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[pd.Series, pd.Series, pd.Series]
def compute_atr(high: pd.Series, low: pd.Series, close: pd.Series, window: int = 14) -> pd.Series
```

Port these from the reference's implementations — Wilder EWM smoothing for ATR
(`ewm(com=window - 1, min_periods=window)`), the standard MACD triple. Do not invent variants.

### `app/signals.py`

```python
SIGNAL_STATES = ("BULLISH", "BEARISH", "NEUTRAL", "OVERBOUGHT", "OVERSOLD")

def signal_sma_cross(prices: pd.Series, fast: int = 20, slow: int = 50) -> dict
def signal_rsi_threshold(prices: pd.Series, overbought: int = 70, oversold: int = 30) -> dict
def signal_macd_cross(prices: pd.Series) -> dict
def compute_all_signals(prices: pd.Series) -> list[dict]
```

Each returns `{"signal": str, "label": str, "state": str | None, "last_trigger_date": date | None}`.

- `label` is human-facing and fixed: `"SMA 20/50"`, `"RSI 14"`, `"MACD 12/26/9"`.
- **`state` is `None` when there is not enough history to compute the indicator at all** — fewer than
  `slow` bars for SMA, fewer than 15 for RSI, fewer than 35 for MACD. `NEUTRAL` means computed and
  no signal. Do not collapse them.
- `last_trigger_date` is the date of the most recent crossover, or `None`. RSI has no crossover; its
  trigger date is the date the current over/oversold condition began, or `None` when neutral.

### Two data decisions that are load-bearing

**1. Signals are computed on `adj_close`, never raw `close`.** A 4:1 split leaves raw close with a
75% single-day drop, which manufactures a fake bearish SMA crossover and a fake RSI oversold reading
out of nothing. `REBUILD.md` records that `adj_close` is the split-restated series precisely so
downstream analysis is continuous — this is what that is for.

**2. ATR needs high and low, and they must be adjusted to match.** `price_bars` stores raw
`high`/`low` alongside both `close` and `adj_close`. Mixing raw highs with adjusted closes is wrong
across any split. Scale them:

```
ratio     = adj_close / close        # per bar; skip the bar when close is 0 or either is null
adj_high  = high * ratio
adj_low   = low  * ratio
```

Then compute ATR from `adj_high`, `adj_low`, `adj_close`.

**`atr_pct` is ATR divided by the latest adjusted close, times 100.** Raw ATR in dollars is not
comparable between a $5 stock and a $500 one, and the column shows several tickers side by side.

### The route

```python
@router.get("/signals", response_model=SignalsResponse)
def get_signals(tickers: str = "") -> dict:
```

**Declare it beside `/strip` and `/returns`, above `/{ticker}`.** `/universe/signals` matches that
dynamic route, and the wrong order resolves it as a ticker named "signals" and 404s — recorded in
`REBUILD.md` for `/strip`, `/quotes/refresh` and `/returns`.

- Same `tickers` handling as `/universe/returns`: split, trim, uppercase, drop empties, de-duplicate
  preserving first-seen order; empty gives `{"signals": [], "as_of": null}`; over 100 gives **400**.
- A ticker with no stored bars is **present with `signals: []` and `atr_pct: null`**, not omitted.
- **Do not reuse `bar_window_start`.** It bounds to `min(1 January, today − 75 days)` — roughly 52
  sessions — and a 20/50 SMA crossover needs 50 sessions *plus* history before them to detect a
  cross. In early January that window silently yields `state: null` for every ticker. Use a dedicated
  constant: **`SIGNAL_WINDOW_DAYS = 400`** calendar days, ~275 sessions. Still bounded; contract
  0073's 55,917-row measurement is why it stays bounded rather than unbounded.
- One query for all tickers. **No N+1.**
- Never fetches from yfinance. Stored data only.
- `_require_database()`, as the other routes do.

```python
class SignalOut(BaseModel):
    signal: str
    label: str
    state: str | None
    last_trigger_date: date | None

class TickerSignals(BaseModel):
    ticker: str
    signals: list[SignalOut]
    atr_pct: float | None

class SignalsResponse(BaseModel):
    signals: list[TickerSignals]
    as_of: date | None
```

## Out of scope

- **No frontend.** The column, the badge and the selector are 0083.
- **No ATR signal state.** It is a number. Decided; do not add a bullish/bearish reading for it.
- Do not port Bollinger, ADX, Donchian, Stochastic or OBV. The reference has them; nothing uses them
  here and unused numerical code is unverified numerical code.
- Do not port `simulate_email_alert`, watchlists, or alerts — all on the cut list.
- No per-user thresholds or configurable parameters. The defaults are the defaults.
- Do not add caching. Measure first.
- No new dependency. `pandas` is already present; `numpy` comes with it.

## Acceptance criteria

Known-value tests. Each must be checkable by hand — that is the whole point.

1. `compute_sma` over `[1..10]` with `window=5`: assert the last value is `8.0` and the first four are
   `NaN`.
2. `compute_rsi` over a **strictly rising** series of 30 points: assert the last value is `100.0`
   (Wilder RSI saturates when there are no down moves). Over a strictly **falling** series: `0.0`.
3. `compute_macd` over a **constant** series: assert all three outputs are `0.0` where defined — a
   flat series has no momentum.
4. `compute_atr` over bars where `high == low == close` for every day: assert `0.0`. True range is
   zero when nothing moves.
5. `compute_atr` over bars with a constant daily range of exactly `2.0` and no gaps: assert the
   settled value is `2.0`.
6. `signal_sma_cross` on a series engineered so the 20-SMA crosses **above** the 50-SMA on a known
   date: assert `state == "BULLISH"` and `last_trigger_date` is that date. Then the mirror case for
   `BEARISH`.
7. `signal_rsi_threshold` on a rising series: `state == "OVERBOUGHT"`. On a falling one: `"OVERSOLD"`.
   On a series that oscillates in a narrow band: `"NEUTRAL"`.
8. **A test asserts `state is None`, not `"NEUTRAL"`, for each of the three signals when given fewer
   bars than the indicator needs** — 49 bars for SMA 20/50, 14 for RSI, 34 for MACD. This is the
   departure from the reference and the one most likely to be silently "fixed" back.
9. **A test proves signals use `adj_close`, not `close`.** Seed a ticker whose raw `close` contains a
   4:1 split drop while `adj_close` is continuous, and assert the SMA signal is **not** `BEARISH` —
   a close-based implementation produces a fake bearish cross here. The same discrimination contract
   0077's criterion 10 used.
10. **A test proves ATR uses split-adjusted high/low.** Seed bars where `adj_close != close` and
    assert `atr_pct` matches the adjusted calculation, not the raw one.
11. A test asserts `atr_pct` is ATR over the latest adjusted close × 100 — not raw ATR — by checking
    two tickers with identical volatility at different price levels return the **same** `atr_pct`.
12. A test asserts `/universe/signals` resolves as its own route, not as a ticker named "signals".
13. A test asserts a ticker with no bars is present with `signals: []` and `atr_pct: null`.
14. A test asserts empty `tickers` gives `{"signals": [], "as_of": null}`, and 101 tickers gives
    **400**.
15. A test asserts the endpoint makes no network call — `block_network` satisfied with no
    `allow_network` marker.
16. `grep -n "bar_window_start" backend/app/routers/universe.py` shows it is **not** used by
    `get_signals`. Quote the window the signals route uses.
17. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; it was
    **475**.
18. `git status --porcelain frontend/` — confirm you changed nothing there.
19. State exactly which files you created and edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest tests/test_indicators.py tests/test_signals.py -q
grep -n "@router.get" app/routers/universe.py
grep -n "bar_window_start\|SIGNAL_WINDOW_DAYS" app/routers/universe.py
grep -in "atr" app/signals.py ; echo "atr-not-a-signal exit: $?"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/
```

Also paste one response body for a three-ticker request against the test database — **not**
production — including one ticker with no bars.

## Tooltips

Not applicable — backend only.

## Human verification — does Gunnar need to run anything?

**Yes, and this is the one feature so far where the numbers can be plausibly wrong.**

**Restart the backend first** — `uvicorn` without `--reload` serves the code it was launched with;
`REBUILD.md` records a strip verification that ran against a stale process and produced a misleading
404. `lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound port.

```bash
curl -s "http://localhost:8000/universe/signals?tickers=MU,ORCL,VOO" | python3 -m json.tool
```

1. **Check one RSI against a public source** — TradingView, StockCharts, Yahoo's own chart. A 14-day
   RSI is standard enough that any two implementations should agree within about a point. **Ours will
   read slightly differently because we use dividend-adjusted prices**, which is correct, but a gap of
   more than a few points means something is wrong.
2. **Check one SMA crossover date.** If we say MU turned bullish on a date, the 20- and 50-day lines
   should visibly cross there on any charting site. This is the easiest of the four to falsify.
3. **Sanity-check `atr_pct`.** A large-cap index ETF should read roughly 0.5–1.5%; a volatile
   single name several percent. If everything reads the same, the percentage conversion is wrong.
4. Confirm a ticker you added recently — with under 50 sessions of history — returns
   `state: null` for the SMA signal rather than `NEUTRAL`.

Nothing visual changes. The column is contract 0083.

## Open questions — do not resolve these yourself

None. ATR-as-a-number and the single selector were decided by Gunnar on 2026-09-22. If you find
another, report `BLOCKED` and stop.
