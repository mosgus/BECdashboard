# Report — Contract 0089 (Indicators endpoint and shared adjustment)

**Verdict: accepted.** 508 tests. The extraction is proved, not asserted.

## Verified independently

`grep "adj_close / close"` in the router is **empty** and `adjust_bars` is used at both call sites —
line 239 (signals) and 381 (indicators). One definition, two consumers.

**Criterion 4 held exactly**: diffing
`test_get_signals_uses_adjusted_close_and_adjusted_high_low` against `HEAD` returns **exit 0**, so the
signals route's behaviour is unchanged by the extraction. That file is committed, which is what makes
the diff meaningful — the lesson from contract 0080, applied.

The sample response is internally consistent on inspection: 25 dates, all four series length 25
(criterion 10), Bollinger middle rising 109.5 → 114.5 which is `mean(100…119)` → `mean(105…124)`, and
the band width `121.332 − 109.5 = 11.832` is the same `2 × 5.916` sample std of twenty consecutive
integers that contract 0088 produced. OBV runs 0 → 2400: first bar zero, 24 rises at 100.

## The database-guard claim is correct this time

The report says a temp-SQLite probe was stopped by the environment guard. **It was**, and that is a
change from contract 0082, where the same-shaped claim was wrong and I corrected it. Verified both:

```
DATABASE_URL=""                      -> imports cleanly        (deliberate opt-out)
DATABASE_URL="sqlite:////tmp/x.db"   -> guard raises           (ambient conflicts with .env)
```

Both are contract 0041 working as designed: an explicitly-empty value is an opt-out, any *different*
non-empty value is a conflict. The coder fell back to the pytest fixture, which is the right answer.

**But the boilerplate only documents the empty case**, so a coder wanting a real throwaway database
hits a wall with no stated remedy — and has now guessed at whether it is a bug twice in eight
contracts. Added to `contracts/TEMPLATE-contract.md` and `REBUILD.md`.

## Status

Accepted and archived. Contract 0090 — the toggles and the overlays — is the last piece of slice 2.
