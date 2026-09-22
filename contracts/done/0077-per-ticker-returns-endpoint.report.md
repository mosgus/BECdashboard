# Report — Contract 0077 (Per-ticker returns endpoint)

**Verdict: accepted.** Clean run, no deviations, and the two criteria that could have been faked were
not.

## Verified independently

`467 passed` — 460 plus seven new endpoint tests, with the ten moved pure tests accounted for rather
than duplicated. Route at `universe.py:132`, above `/{ticker}` at `190`. Frontend untouched.
`grep -rn "def pct_return" app/` prints exactly one line.

**The extraction is provably behaviour-preserving.** I diffed the ten moved tests against their
committed originals:

```
git show HEAD:backend/tests/test_strip.py | sed -n '/pct_return_none.../,/bar_window_start_always.../p'
diff  →  IDENTICAL — no assertion changed
```

The contract said the moved tests passing unchanged is the proof. That proof now exists as a diff
rather than an assurance, which is the difference between an audit and a reading.

**Criterion 10 discriminates properly**, which was the criterion most at risk of being satisfied
vacuously. The fixture seeds `close` and `adj_close` deliberately apart — `200+i` against `100+i` —
and then asserts both directions:

```python
assert returned["five_day"] == pytest.approx(4.0)                               # adj_close answer
assert returned["five_day"] != pytest.approx((230.0 - 225.0) / 225.0 * 100)     # close answer, 2.22
```

Checked the arithmetic by hand: latest `adj_close` 130 against 125 five sessions back is `4.0`; the
close-derived figure is `2.22`. A `close`-based implementation fails this test. That is what makes it
a test of the dividend-adjustment decision rather than a test that merely runs it.

`resolve_display_name` correctly stayed in `strip.py` — naming, not return math.

## The sample response is right, including the null

```json
{"returns": [{"ticker": "AAA", "five_day": 4.95, "thirty_day": null, "ytd": 6.0},
             {"ticker": "ORPHAN", "five_day": null, "thirty_day": null, "ytd": null}],
 "as_of": "2026-01-08"}
```

`ORPHAN` is present with three nulls rather than omitted, so the array still lines up with the
request. `AAA`'s `thirty_day` is null because the fixture is shorter than 31 sessions — the documented
behaviour of `nth_prior_close`, not a gap.

## Unverified, and accepted as such

No 100-ticker benchmark against production data. The implementation issues one bounded `PriceBar`
query regardless of ticker count, which is the property that matters, and the strip's own
windowing measurement (55,917 rows → 3,914) is the precedent. If a Holdings page on a large portfolio
ever feels slow, measure before assuming this is why.

## Status

Accepted and archived. Contract 0078 — the Holdings table — will be written against this endpoint as
it actually shipped.
