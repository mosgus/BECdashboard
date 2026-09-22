# Report — Contract 0082 (Technical signals backend)

**Verdict: accepted**, with a defect found in the audit and filed as contract 0083. Every stated
criterion was met; the defect is in a case the contract never specified.

## Verified independently

488 tests (475 + 13). Route at `universe.py:194`, above `/{ticker}` at 283.
`SIGNAL_WINDOW_DAYS = 400` used only by `get_signals` at 205; `bar_window_start` stays exclusive to
returns at 153. `grep -in "atr" app/signals.py` empty — ATR is not a signal. Frontend untouched.

**Both discriminating tests are real, and I checked their arithmetic rather than their names.**

`test_get_signals_uses_adjusted_close_and_adjusted_high_low` seeds `SPLIT` with a flat `adj_close` of
100 against a raw `close` that drops 400 → 100 at bar 60. A close-based implementation produces a
bearish 20/50 crossover there; the test asserts `!= "BEARISH"` and the observed state is `NEUTRAL`.

`ATRADJ` seeds `high 104 / low 96 / close 100 / adj_close 50`, so the ratio is 0.5 and the adjusted
range is 4 on a price of 50 → `atr_pct == 8.0`. A raw-high implementation gives 16.0. The test asserts
8.0.

`test_get_signals_atr_pct_normalizes_for_price_level` is the strongest of the set: two tickers with
proportionally identical volatility at prices 100 and 200 both return `2.0`. That cannot pass without
the percentage conversion being right.

## Defect: RSI reads OVERBOUGHT on a flat price series

```
compute_rsi(pd.Series([50.0] * 30)).iloc[-1]  ->  100.0
```

A price that has not moved has no momentum in either direction. RSI on a constant series is
conventionally 50, or undefined — never 100. The consequence is a false `OVERBOUGHT` badge for any
ticker whose stored closes are unchanged across the window: illiquid names, halted names, or any
data gap that repeats a value.

**The evidence was in the report's own sample response and neither of us caught it on first read.**
`ATRADJ` is seeded with a constant close of 50 and comes back `"state": "OVERBOUGHT"`. That is
precisely the "looks entirely plausible" failure this contract's Why section was written about,
appearing in the contract that warned about it.

**This is not a criterion violation.** My criterion 2 specified strictly-rising and strictly-falling
series; criterion 7 specified a narrow oscillating band. **Neither covers the degenerate flat case**,
which is the one that produces a confidently wrong answer. A planner gap, not a coder error — and the
reference almost certainly behaves the same way, since the implementation was ported from it.

Filed as contract **0083**. The Holdings column moves to **0084**; 0082's own text calls the column
"contract 0083", which is now wrong and is noted here rather than edited into the archive.

## The reported `DATABASE_URL=""` blocker is incorrect

The report states an ad-hoc `DATABASE_URL="" python -c` check was *"blocked by the project's
production-connection conflict guard."* It was not. Verified:

```
DATABASE_URL="" python -c "import app.config"   ->  imports cleanly
```

`REBUILD.md` is explicit that an explicitly-empty `DATABASE_URL` is honoured as a deliberate opt-out,
and it still is. Something else failed and the cause was misattributed.

**Worth correcting in the record rather than letting stand**, because that prefix is the only thing
keeping ad-hoc scripts off the production database. A future agent believing it is blocked would stop
using it. No harm occurred here — the coder used the isolated pytest fixture instead, which was the
right fallback.

## Minor, not filed

`signal_rsi_threshold` raises `TypeError` when the series index is not dates, via an `_as_date` guard.
Deliberate and correct — it refuses to fabricate a trigger date — but the interface spec did not say
the functions require a `DatetimeIndex`. Worth knowing before 0084 calls them from anywhere new.

## Status

Accepted and archived. The numbers still need checking against a public chart; nothing here can judge
whether a 14-day RSI is right in the world, only that it is self-consistent.
