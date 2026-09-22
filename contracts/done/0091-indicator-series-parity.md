# Contract 0091 — SMA, RSI and MACD series, Donchian mid, and Full stochastic

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

The indicators endpoint serves every series the reference's ticker chart draws, and `%K` is smoothed
the way the reference smooths it.

## Why

Gunnar compared `/ticker` against the reference on the deployed app, 2026-09-22, and asked for parity.
Five gaps are on this side of the API; the chart work is contract 0092 and the Help sidebar 0093.

**Four are missing series.** The reference's price panel always draws SMA 20 and SMA 50, and it always
renders an RSI pane and a MACD pane below. We compute all three — `compute_sma`, `compute_rsi`,
`compute_macd` have existed since contract 0082 — but the indicators endpoint never exposed them,
because contract 0089's `include` table was written from the *toggle list* rather than from everything
the chart draws. Donchian's middle line was missed the same way.

**The fifth is a real numerical difference and Gunnar could not have seen it.** The reference computes
the **Full** stochastic; contract 0088 shipped the **Fast** one, because the signature I specified
omitted the smoothing parameter:

```python
# reference
smooth_k: int = 3
raw_k = 100 * (close - lowest_low) / range_
k     = raw_k.rolling(smooth_k).mean()      # ours returns raw_k here
d     = k.rolling(d_window).mean()
```

That is what the reference's `(14, 3, 3)` label means. Our `%K` is unsmoothed and visibly noisier.
Planner omission, not a coder error.

## Files

Modify:
- `backend/app/indicators.py` — `smooth_k` on `compute_stochastic`.
- `backend/app/schemas.py` — nothing structural; confirm no change is needed and say so.
- `backend/app/routers/universe.py` — four new `include` groups and `donchian_mid`.
- `backend/tests/test_indicators.py` — the stochastic change.
- `backend/tests/test_api_universe.py` — the new groups.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not change `signals.py`, `bars.py`, or `returns.py`. **No frontend file** — contract 0092.

**`reference files/` is read-only and never belongs on a file list.** Read the reference in place:
`git show main:backend/core/indicators.py` for the stochastic, and
`git show main:frontend/components/TechnicalsChart.tsx` for which series the chart actually draws.

> **Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** That exact value works — it is the
> deliberate opt-out. Any *other* non-empty value raises, including a temp SQLite path; use the pytest
> fixtures if you need a real database.

## Interface

### Full stochastic

```python
def compute_stochastic(high, low, close, k_window: int = 14, d_window: int = 3,
                       smooth_k: int = 3) -> tuple[pd.Series, pd.Series]:
    """Full Stochastic. raw %K → SMA(smooth_k) → %K; %D = SMA(%K, d_window)."""
```

The zero-range guard from contract 0088 stays: when `highest_high == lowest_low` the raw value is
`NaN`, never 50 and never 0.

**Contract 0088's criterion 5 no longer holds and its test must change.** It asserted `%K == 100` when
the last close equals the window's highest high — true for raw `%K`, false once smoothed unless the
*three* most recent raw values are all 100. Update that test to seed three consecutive bars at the
high, and say in the report what you changed and why. **This is the one place in this contract where
editing an existing test is correct**; everywhere else, report instead.

### Four new `include` groups

| include key | series keys | label |
|---|---|---|
| `sma` | `sma_fast`, `sma_slow` | `SMA 20`, `SMA 50` |
| `rsi` | `rsi` | `RSI 14` |
| `macd` | `macd_line`, `macd_signal`, `macd_histogram` | `MACD 12/26/9`, `Signal 9`, `Histogram` |
| *(extend)* `donchian` | add `donchian_mid` | `Donchian mid (20)` |

`donchian_mid` is `(upper + lower) / 2`, computed in the router from the two series
`compute_donchian` already returns. **Do not add a fourth return value to `compute_donchian`** — it is
a derived convenience, not a new indicator, and changing that signature would ripple into contract
0088's tests for no benefit.

Everything else about the endpoint is unchanged: shared `dates` axis, parallel `points` arrays of the
same length, `NaN` serialised as `null`, unknown keys ignored, empty `include` returns empty,
`SIGNAL_WINDOW_DAYS = 400`, no network.

**`compute_macd` returns three series** — line, signal, histogram. Map them in that order; getting
signal and histogram swapped produces a chart that looks plausible and is wrong, since both oscillate
around zero.

## Out of scope

- **No frontend.** Contract 0092 draws these; 0093 is the Help sidebar.
- Do not change which groups the *page* requests — that is 0092's decision.
- Do not add indicators beyond these. No Ichimoku, no VWAP, no parabolic SAR.
- Do not change the ATR card's data, the signals endpoint, or any threshold.
- Do not change `compute_donchian`'s signature or return arity.
- No new dependency.

## Acceptance criteria

1. A test asserts `compute_stochastic`'s `%K` is the **3-period SMA of raw %K**: build a series whose
   raw `%K` is known, and assert `%K` equals `compute_sma(raw_k, 3)` at the last index. Not an
   approximation of smoothing — the actual relationship.
2. A test asserts `%K == 100.0` when the **three most recent** bars all close at the window high, and
   **not** 100 when only the last one does. That pair is what distinguishes Full from Fast.
3. Contract 0088's criterion-5 test is updated, not deleted. State in the report what it asserted
   before and after.
4. The zero-range guard still returns `NaN` — assert it, since the smoothing layer is a new chance to
   lose it.
5. A test asserts `include=sma` returns exactly `sma_fast` and `sma_slow`, and that `sma_fast` equals
   `compute_sma(adj_close, 20)` at a known index.
6. A test asserts `include=rsi` returns one series whose last value matches `compute_rsi` on the same
   adjusted closes.
7. A test asserts `include=macd` returns exactly three series, and that
   `macd_histogram == macd_line - macd_signal` at every non-null index. **That identity is the guard
   against swapping them.**
8. A test asserts `include=donchian` returns **three** series, and that `donchian_mid` is the mean of
   upper and lower at a known index.
9. A test asserts every `series[].points` length still equals `dates` length for a multi-group request
   such as `include=sma,rsi,macd,donchian`.
10. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; it was
    **508**.
11. `git status --porcelain frontend/` — confirm you changed nothing there.
12. State exactly which files you edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest tests/test_indicators.py -q
cd backend && DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "
import pandas as pd
from app.indicators import compute_stochastic, compute_sma
h = pd.Series([10.0]*20); l = pd.Series([5.0]*20)
c = pd.Series([5.0]*17 + [10.0, 10.0, 10.0])
k, d = compute_stochastic(h, l, c)
print('three bars at the high -> %K:', round(k.iloc[-1], 2))
c2 = pd.Series([5.0]*19 + [10.0])
print('one bar at the high    -> %K:', round(compute_stochastic(h, l, c2)[0].iloc[-1], 2))
"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/
```

The first must print `100.0`; the second must print something well below it. Also paste one response
body for `include=sma,rsi,macd,donchian` against the test database — **not** production — with each
series' length beside `dates`.

## Tooltips

Not applicable — backend only.

## Human verification — does Gunnar need to run anything?

**Optional; nothing visual changes until 0092.**

**Restart the backend first.** `lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound port.

```bash
curl -s "http://localhost:8000/universe/MU/indicators?include=sma,rsi,macd" | python3 -m json.tool | head -30
```

The RSI series' last value should match the number the `/ticker` page's Signal States panel already
shows for RSI — two paths to the same figure, and a cheap check that the new series are wired to the
same data the signals use.

## Open questions — do not resolve these yourself

None. If you find a place where the reference's formula and the standard definition disagree, report
`BLOCKED` and say which, rather than choosing.
