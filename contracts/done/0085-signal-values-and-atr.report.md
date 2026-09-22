# Report — Contract 0085 (Signal values and ATR in price units)

**Verdict: accepted.** 493 tests. The printed block is exactly right:

```
sma_cross        state=BEARISH     value=None
rsi_threshold    state=OVERSOLD    value=29.86
macd_cross       state=BEARISH     value=-0.0936
```

`sma_cross` null as specified, RSI a real reading, and the MACD histogram **negative with a bearish
state** — sign and state agree, which is criterion 3.

## The corrected test expectation is genuinely correct

The one deviation is the shape worth checking hardest: a test failed and the coder changed the
*expectation* rather than the code. Verified independently rather than taken on trust.

The fixture alternates `100.0, 100.1, 100.0, 100.1 …` over 40 points and **ends on a gain**:

```
series ends: [100.0, 100.1, 100.0, 100.1]
last move  : +0.1          -> RSI must sit ABOVE 50
RSI        : 52.07
mirror series ending on a DOWN move -> 47.93
```

52.07 and 47.93 are symmetric about 50, which is what an alternating series should produce. The
coder's original `48.15` had the direction backwards; `52.07` is the right answer and no implementation
changed to reach it.

**That symmetry is incidental evidence the indicator is sound** — an RSI that did not mirror cleanly
around 50 for a mirrored input would be suspect.

`grep "round("` in `indicators.py` is empty: the maths keeps full precision and only the signal dict
rounds, so nothing downstream can recompute from a rounded value.

## What this closes

Gunnar's question from 2026-09-22 — *"every holding shows grey Neutral for RSI, is this correct?"* —
is now answerable by him rather than by me. The `value` on each `rsi_threshold` entry is the number
the 30/70 thresholds are read against.

## Status

Accepted and archived. The `/ticker` page is contract 0086.
