# Report — Contract 0088 (Five overlay indicators)

**Verdict: accepted.** 501 tests, 16 in `test_indicators.py`. Every printed value hand-checks.

## Verified by arithmetic, not by name

I recomputed each figure in the report's probe block independently:

| printed | check |
|---|---|
| bollinger `161.332 / 149.5 / 137.668` | mid = mean(140…159) = **149.5**; sample std of 20 consecutive integers = **5.916**; 149.5 + 2×5.916 = **161.332** ✓ |
| donchian `160.0 / 139.0` | max(high) over 20 = 159+1; min(low) = 140−1 ✓ |
| stochastic `93.33` | (159 − 145) / (160 − 145) × 100 = 14/15 ✓ |
| obv `5900` | 60 bars, first contributes 0, 59 rises × 100 ✓ |
| adx `100.0` on a perfect monotonic trend | +DI 100, −DI 0, DX 100 — extreme but correct for a synthetic trend |
| stochastic zero-range | `nan`, not 50 and not 0 ✓ |

And the literal OBV fixtures, run independently:

```
rising 4-bar : 300.0      falling : -300.0
flat-day     : 200.0      first bar: 0.0
stoch at high: 100.0      at low   : 0.0
```

All six exact. The revised criteria were satisfiable and were satisfied.

## The three guards are in

Stochastic returns `NaN` on a zero range rather than borrowing RSI's 50 — the distinction the contract
argued for, since RSI has a conventional midpoint and a zero-range stochastic has no defined value.
ADX is finite-or-NaN on a flat series, never `inf`. OBV's flat day contributes zero.

## Noted for contract 0089

The split adjustment lives **inline** at `routers/universe.py:227-229`:

```python
ratio = adj_close / close
(bar_date, high * ratio, low * ratio, adj_close)
```

Only high and low — signals do not need volume. The indicators endpoint does, and **volume scales the
other way**: a 4:1 split makes `ratio` 0.25 for pre-split bars, prices multiply by it, and
`adj_volume = volume / ratio`. Getting that inverse backwards is invisible in the output and would
quietly corrupt OBV. 0089 extracts the adjustment rather than adding a second copy.

## Status

Accepted and archived.
