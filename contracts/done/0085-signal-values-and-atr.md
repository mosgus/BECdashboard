# Contract 0085 — Surface the signal's underlying number, and ATR in price units

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`GET /universe/signals` returns each signal's current scalar reading where one exists, and ATR in
price units alongside the existing percentage.

## Why

**Gunnar could not tell a correct answer from a broken one, 2026-09-22.** Every holding showed a grey
`Neutral` for RSI and there was no way to check it: the response carries only `state`, never the
number behind it. So "RSI is 54, correctly neutral" and "RSI is stuck" look identical in the UI.

I verified the indicator is healthy — eight realistic random-walk series produced RSI between 29.9 and
58.9, and a series ending in a 15-day run-up produced 89.7 / `OVERBOUGHT` — so all-neutral across a
small basket is the expected result rather than a defect. **But that check should have been available
to him, not to me.** The reference's signal dict carries `current_rsi` and contract 0082's schema
dropped it; that was a planner omission.

The `/ticker` page (contract 0086) needs both fields anyway: its Signal States panel shows the current
RSI, and its ATR card shows ATR in dollars rather than as a percentage.

## Files

Modify:
- `backend/app/signals.py` — a `value` on each signal dict.
- `backend/app/schemas.py` — `value` on `SignalOut`, `atr` on `TickerSignals`.
- `backend/app/routers/universe.py` — return `atr`.
- `backend/tests/test_signals.py`, `backend/tests/test_api_universe.py` — the tests below.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not change `indicators.py`. The numbers are correct and tested; this contract exposes them, it does
not recompute them.

**No frontend file.** The page and the tooltip are contract 0086.

**`reference files/` is read-only and never belongs on a file list.**

> **Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** It works and is honoured as a
> deliberate opt-out. `app/config.py` calls `load_dotenv()` at import and `backend/.env` holds a live
> Render connection string, so an unprefixed script talks to the **production database**.

## Interface

### `value` on each signal

```python
class SignalOut(BaseModel):
    signal: str
    label: str
    state: str | None
    last_trigger_date: date | None
    value: float | None      # the indicator's current scalar reading, where one exists
```

Per signal:

| signal | `value` | why |
|---|---|---|
| `rsi_threshold` | the current RSI, rounded to 2dp | The number the 30/70 thresholds are read against. |
| `macd_cross` | the current histogram (MACD line − signal line), 4dp | A single scalar whose sign is the signal. |
| `sma_cross` | **`null`** | A crossover is a relationship between two lines. There is no one number, and inventing one — the gap, say — would imply a meaning the signal does not have. |

`value` is `null` whenever `state` is `null`. If there is not enough history to determine a state
there is not enough to report a reading.

**Round at the edge, not in the computation.** `compute_rsi` and `compute_macd` keep returning full
precision; only the dict rounds. Anything else recomputing from a rounded value would drift.

### ATR in price units

```python
class TickerSignals(BaseModel):
    ticker: str
    signals: list[SignalOut]
    atr: float | None        # ATR(14) in the ticker's price units
    atr_pct: float | None    # unchanged
```

`atr` is the same ATR already computed, before the division by price — **not** recovered from
`atr_pct`. They are both `null` together, since they come from the same calculation.

Keep `atr_pct`. It is what the Holdings column shows and it is what makes tickers comparable; `atr`
is for the `/ticker` page's card, where one ticker is in view and dollars are the natural unit.

## Out of scope

- **No frontend.** Contract 0086.
- Do not add `trigger_values`. The reference has them; they are a per-signal shape with different
  meanings per signal and they earn their own decision later.
- Do not change any state logic, threshold, or window.
- Do not change `indicators.py`, `returns.py`, or the strip.
- Do not add an ATR signal state. ATR is a number; decided 2026-09-22.
- No new dependency.

## Acceptance criteria

1. A test asserts `signal_rsi_threshold` on a series with a known RSI returns that RSI as `value`,
   rounded to 2dp, and that it sits between the 30/70 thresholds when `state == "NEUTRAL"`.
   **This is the criterion that would have let Gunnar check his own column.**
2. A test asserts a strictly rising series gives `value == 100.0` with `state == "OVERBOUGHT"`, and a
   flat series gives `value == 50.0` with `state == "NEUTRAL"` — the contract 0083 fix, now visible in
   the payload.
3. A test asserts `signal_macd_cross` returns a non-null `value` whose **sign matches the state** —
   positive histogram with `BULLISH`, negative with `BEARISH`.
4. A test asserts `signal_sma_cross` returns `value is None` always, including when its state is
   `BULLISH`. No invented scalar.
5. A test asserts `value is None` wherever `state is None`, for all three signals, on a series too
   short to compute.
6. A test asserts `atr` and `atr_pct` are consistent for a known fixture: `atr_pct` equals
   `atr / latest_adj_close * 100` within a small tolerance. They must not be able to disagree.
7. A test asserts `atr` and `atr_pct` are **both null together** for a ticker with no bars.
8. `grep -n "round(" backend/app/indicators.py` prints nothing — rounding happens in `signals.py`, at
   the edge, not in the maths.
9. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; it was
   **491**.
10. `git status --porcelain frontend/` — confirm you changed nothing there.
11. State exactly which files you edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest tests/test_signals.py -q
cd backend && DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "
import pandas as pd, numpy as np
from app.signals import compute_all_signals
rng = np.random.default_rng(7)
px = pd.Series(100*np.exp(np.cumsum(rng.normal(0.0005,0.015,250))),
               index=pd.date_range('2025-09-01', periods=250, freq='D'))
for s in compute_all_signals(px):
    print(f\"{s['signal']:16} state={str(s['state']):11} value={s['value']}\")
"
grep -n "round(" app/indicators.py ; echo "no-rounding-in-maths exit: $?"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/
```

The printed block must show a numeric `value` for `rsi_threshold` and `macd_cross`, and `None` for
`sma_cross`.

## Tooltips

Not applicable — backend only.

## Human verification — does Gunnar need to run anything?

**Optional, and it answers the question that prompted this contract.**

**Restart the backend first** — `uvicorn` without `--reload` serves the code it was launched with.
`lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound port.

```bash
curl -s "http://localhost:8000/universe/signals?tickers=MU,ORCL,VOO" | python3 -m json.tool
```

Look at the `value` on each `rsi_threshold` entry. If your holdings are all showing grey `Neutral`,
those numbers should be spread somewhere between roughly 35 and 65 — different per ticker. **If every
one reads the same number, that is the bug you suspected**; if they differ and sit inside 30–70, the
column was telling the truth and now you can see why.

Nothing visual changes yet. The `/ticker` page is contract 0086.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
