# Contract 0089 — `GET /universe/{ticker}/indicators`, and one split adjustment

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

An endpoint serves the overlay series a chart needs, and the split adjustment lives in one function
instead of being copied.

## Why

Contract 0088 landed Bollinger, Donchian, ADX, Stochastic and OBV as pure functions with nothing
calling them. This is the caller. Contract 0090 draws them.

**The adjustment must be extracted, not copied.** `routers/universe.py:227-229` does it inline for the
signals route:

```python
ratio = adj_close / close
(bar_date, high * ratio, low * ratio, adj_close)
```

A second copy here is the pattern contracts 0071 and 0072 spent two rounds removing for cash: one
concept, two definitions, drifting. It is also about to get harder, because this endpoint needs
**volume**, which scales the *other way*.

## The volume inversion — the one thing most likely to be silently wrong

On a 4:1 split Yahoo restates history downward: a pre-split bar with raw `close` 400 gets `adj_close`
100, so `ratio = adj_close / close = 0.25`.

- **Prices multiply by `ratio`**: `adj_high = high * 0.25`.
- **Volume divides by it**: 1M shares at $400 is 4M post-split-equivalent shares at $100, so
  `adj_volume = volume / ratio`.

Getting that backwards produces an OBV that is wrong by a factor of sixteen across a split and
**looks entirely plausible on a chart** — it is a cumulative line with no natural scale, so nothing
about the shape reveals it. Criterion 6 is the guard.

## Files

Create:
- `backend/app/bars.py` — the shared adjustment. Pure: no database, no clock, no `app.*` imports.
- `backend/tests/test_bars.py` — its tests.

Modify:
- `backend/app/schemas.py` — the response models.
- `backend/app/routers/universe.py` — the new route; the signals route uses the extracted helper.
- `backend/tests/test_api_universe.py` — endpoint tests.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not change `indicators.py`, `signals.py`, or `returns.py`. **No frontend file** — contract 0090.

**`reference files/` is read-only and never belongs on a file list.**

> **Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** It works and is honoured as a
> deliberate opt-out. `app/config.py` calls `load_dotenv()` at import and `backend/.env` holds a live
> Render connection string, so an unprefixed script talks to the **production database**.

## Interface

### `app/bars.py`

```python
@dataclass(frozen=True)
class AdjustedBar:
    date: date
    high: float
    low: float
    close: float          # the adjusted close
    volume: float | None  # adjusted; None when the row had no volume

def adjust_bars(rows: list[tuple]) -> list[AdjustedBar]:
    """Split-adjust raw OHLCV rows onto the adj_close basis.

    Prices scale by `adj_close / close`; volume divides by it. A row is skipped when `close`
    or `adj_close` is null, or `close` is zero — the ratio is undefined and a guessed bar is
    worse than a missing one.
    """
```

`rows` are `(date, high, low, close, adj_close, volume)` as read from `price_bars`. A row with a
null `high` or `low` still yields a bar with those fields `None`… **no** — simpler and stricter:
skip the row. A chart with a gap is honest; a bar with half its fields invented is not. Say in the
docstring that this is deliberate.

**The signals route must use this helper**, replacing its inline lines. Its behaviour must not change
— `test_get_signals_uses_adjusted_close_and_adjusted_high_low` passing unmodified is the proof, and
that test is committed, so diff it against `HEAD` to show it.

### The route

```python
@router.get("/{ticker}/indicators", response_model=IndicatorsResponse)
def get_indicators(ticker: str, include: str = "") -> dict:
```

Declared beside `/{ticker}/history`, which already resolves correctly — it is a two-segment path and
does not collide with `/{ticker}`.

```python
class IndicatorSeries(BaseModel):
    key: str                      # "bollinger_upper"
    label: str                    # "Bollinger upper (20, 2σ)"
    points: list[float | None]    # aligned index-for-index to `dates`

class IndicatorsResponse(BaseModel):
    ticker: str
    dates: list[date]
    series: list[IndicatorSeries]
```

**One shared date axis with parallel arrays**, not a list of `{date, value}` objects per series.
Eight series over 250 bars would otherwise repeat the date 2,000 times, and the chart has to join them
on date anyway.

`include` is a comma-separated set of group keys. Unknown keys are **ignored**, not an error — a
client asking for something this version does not serve should get the rest rather than nothing:

| include key | series keys | label |
|---|---|---|
| `ema` | `ema_fast`, `ema_slow` | `EMA 20`, `EMA 50` |
| `bollinger` | `bollinger_upper`, `bollinger_middle`, `bollinger_lower` | `Bollinger upper/middle/lower (20, 2σ)` |
| `donchian` | `donchian_upper`, `donchian_lower` | `Donchian upper/lower (20)` |
| `adx` | `adx` | `ADX 14` |
| `stochastic` | `stochastic_k`, `stochastic_d` | `Stochastic %K (14)`, `Stochastic %D (3)` |
| `obv` | `obv` | `OBV` |

- Empty or absent `include` → `{"ticker": ..., "dates": [], "series": []}`. **Not everything** — a
  caller that forgot the parameter should get nothing, not the most expensive response the endpoint
  can produce.
- `NaN` serialises as `null`. Pydantic will not do this for you; convert explicitly. A `NaN` in JSON
  is invalid and will break the client parse.
- Window: reuse `SIGNAL_WINDOW_DAYS = 400`, already defined for the signals route. Bollinger and
  Donchian need 20 sessions, ADX and Stochastic 14, and the chart shows a year — 400 calendar days
  covers all of it. **Do not use `bar_window_start`**, which bounds to ~52 sessions.
- A ticker with no stored bars → `dates: []`, `series: []`, HTTP **200**. Not a 404: the ticker may be
  in the Universe with no history yet, which is different from not existing.
- Never fetches from yfinance.
- `_require_database()`.

## Out of scope

- **No frontend.** Contract 0090.
- Do not add `start`/`end` parameters. The page filters client-side (contract 0086) and changing that
  is a separate decision.
- Do not add indicators beyond the six groups above.
- Do not change the signals endpoint's response, `SIGNAL_WINDOW_DAYS`, or any threshold.
- Do not add caching.
- No new dependency.

## Acceptance criteria

1. A test asserts `adjust_bars` scales prices **down** and volume **up** across a split: a row with
   `close=400, adj_close=100, high=404, low=396, volume=1_000_000` yields
   `high=101, low=99, close=100, volume=4_000_000`. **This is the inversion guard** and the criterion
   most worth getting right.
2. A test asserts `adjust_bars` skips a row whose `close` is `0`, and one whose `adj_close` is `None`,
   rather than emitting a bar.
3. A test asserts a row with `volume=None` yields a bar with `volume=None` and correct prices — a
   missing volume must not drop the bar, only OBV.
4. **The signals route's existing adjusted-close test passes unmodified.** Diff
   `tests/test_api_universe.py`'s `test_get_signals_uses_adjusted_close_and_adjusted_high_low` against
   `git show HEAD:backend/tests/test_api_universe.py` and paste the result; that function's body must
   be unchanged. *(That file is committed, so this diff is meaningful.)*
5. `grep -n "adj_close / close" backend/app/routers/universe.py` prints **nothing** — the inline
   adjustment is gone, not duplicated.
6. A test asserts OBV over a split-spanning fixture matches the **adjusted-volume** calculation and
   **not** the raw one. Seed bars where `adj_close != close` and the two answers differ; assert the
   adjusted figure. A test that cannot tell them apart does not test this.
7. A test asserts `include=bollinger` returns exactly three series with the specified keys, and
   `include=bollinger,obv` returns four.
8. A test asserts an unknown key is ignored: `include=bollinger,nonsense` returns the three Bollinger
   series and no error.
9. A test asserts empty and absent `include` both give `{"dates": [], "series": []}`.
10. A test asserts every `series[].points` has **the same length as `dates`**. Misaligned arrays are
    the failure mode this response shape exists to avoid, and they are invisible until a chart draws
    them wrong.
11. A test asserts a `NaN` becomes `null` in the JSON body — parse the response and assert the value
    is `None`. Use a fixture that produces one, such as a zero-range stochastic window.
12. A test asserts a ticker with no bars returns **200** with empty lists, not 404.
13. A test asserts the endpoint makes no network call — `block_network` satisfied with no
    `allow_network` marker.
14. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; it was
    **501**.
15. `git status --porcelain frontend/` — confirm you changed nothing there.
16. State exactly which files you created and edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest tests/test_bars.py -q
grep -n "adj_close / close" backend/app/routers/universe.py ; echo "inline-gone exit: $?"
grep -n "adjust_bars" backend/app/routers/universe.py
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git show HEAD:backend/tests/test_api_universe.py > /tmp/old_api.py && diff <(sed -n '/def test_get_signals_uses_adjusted_close_and_adjusted_high_low/,/^def /p' /tmp/old_api.py) <(sed -n '/def test_get_signals_uses_adjusted_close_and_adjusted_high_low/,/^def /p' backend/tests/test_api_universe.py) ; echo "signals-test-unchanged exit: $?"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/
```

Also paste one response body for `include=bollinger,obv` against the test database — **not**
production — showing the `dates` length and each series' length.

## Tooltips

Not applicable — backend only.

## Human verification — does Gunnar need to run anything?

**Optional; nothing visual changes until 0090.**

**Restart the backend first** — `uvicorn` without `--reload` serves the code it was launched with.
`lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound port.

```bash
curl -s "http://localhost:8000/universe/MU/indicators?include=bollinger,adx" | python3 -m json.tool | head -40
```

Two sanity checks worth thirty seconds each:

1. **Bollinger middle should sit near the price.** If the middle band is nowhere near MU's recent
   closes, the adjustment or the window is wrong.
2. **ADX should be between 0 and 100**, and for a real stock usually 10–40. A flat 100 means the
   synthetic-trend case leaked into real data.

If you hold a ticker that has split recently, its OBV is the one worth a closer look once 0090 draws
it — that is the calculation the volume inversion would corrupt.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
