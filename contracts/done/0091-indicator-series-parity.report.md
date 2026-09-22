# Report — Contract 0091 (Indicator series parity)

**Verdict: accepted.** 512 tests. All three guards verified independently rather than read.

## The stochastic change is provably Full, not Fast

```
three bars at the high -> %K: 100.0
one  bar  at the high -> %K:  33.33
```

`33.33` is exactly `SMA([0, 0, 100], 3)` — the two prior bars sit at the window low with a raw %K of
zero. Not approximately smoothed: arithmetically exact, and **Fast would have printed 100**. Confirmed
the relationship directly too:

```
%K == SMA(raw %K, 3) at last index : True
zero-range still NaN               : nan
```

The zero-range guard surviving matters — the smoothing layer was a fresh chance to lose it.

## The MACD identity holds exactly

```
max |histogram - (line - signal)| : 0.0
```

Zero, not approximately zero. That is the guard against swapping signal and histogram, which both
oscillate around zero and would have produced a chart that looked entirely plausible while being
wrong.

Nine series returned for `include=sma,rsi,macd,donchian` — 2 + 1 + 3 + 3 — all length 60 against 60
dates.

## The test edit was the authorised one

Contract 0088's criterion-5 test asserted `%K == 100` with a single bar at the window high. That was
correct for Fast and is false for Full. The contract named this as the one place editing an existing
test was right, and the coder edited exactly that and said so. Everything else was additive.

The self-corrected `NameError` — a missing `pandas` import in a new test — was reported verbatim
including the failing output.

## Status

Accepted and archived. Contract 0092 draws these; 0093 is the Help sidebar.
