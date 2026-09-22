# Report — Contract 0083 (RSI on a flat series)

**Verdict: accepted.** 491 tests, and the three printed values are `50.0 / 100.0 / 0.0` exactly.

## Verified independently

`indicators.py:20-28`:

```python
rs = avg_gain / avg_loss.replace(0.0, np.nan)
rsi = 100.0 - (100.0 / (1.0 + rs))
rsi = rsi.where(avg_loss != 0, other=100.0)
flat = (avg_gain == 0) & (avg_loss == 0)
return rsi.where(~flat, other=50.0)
```

**The ordering is the part that had to be right**, and is. The conventional `avg_loss == 0 → 100`
rule is applied first; the flat case then overrides it to 50. Reversing those would make every rising
series read 50.

No epsilon — `replace(0.0, np.nan)` dodges the division and each case is then handled explicitly,
which is cleaner than the epsilon the contract forbade and achieves the same thing without shifting
any other value.

Confirmed end to end rather than at the indicator alone:

```
signal_rsi_threshold(flat 30-bar series)
  -> {'signal': 'rsi_threshold', 'label': 'RSI 14', 'state': 'NEUTRAL', 'last_trigger_date': None}
```

That is the production path — a flat ticker no longer shows a false OVERBOUGHT badge.

## Criterion 7 fired on a prediction that was wrong, harmlessly

I warned that `test_get_signals_uses_adjusted_close_and_adjusted_high_low` might break because its
`ATRADJ` fixture is flat. It did not: that test asserts `signals[0]["state"]` — which is `sma_cross`,
not RSI — plus `atr_pct` and the `NOBARS` shape. None of them touch the RSI reading.

Over-cautious rather than wrong-in-effect, and the instruction attached to it still mattered: *report
it, do not edit the fixture.* Worth keeping that shape even when the prediction misses.

## The `Header.tsx` change is Gunnar's

```
- Portfolio Analytics
+ Portfolio Dashboard
```

A one-word copy edit that appeared mid-execution. The coder did not touch it, left it alone, and
reported it without speculating — exactly right. `REBUILD.md` records contract 0035, where a contract
written from a report rather than from disk instructed a revert of one of Gunnar's hand-edits; the
defence against that is what happened here.

## Status

Accepted and archived. The Holdings Signal column is contract 0084.
