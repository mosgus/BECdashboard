# Report — Contract 0057

## Audit

**Verdict:** rejected

The finite-number repair is correct, but the contract's malformed-DataFrame boundary is not met.
`fetch_valuation_measures` catches an exception from its downloader, then accesses `.empty` outside
the expected data-shape boundary. A downloader returning a malformed object still raises.

## What passed

- Full suite: 456 passed in 3.39s; focused market-data suite: 53 passed in 0.62s.
- `math.isfinite` now rejects non-finite valuation values, dividend totals, close prices, and the
  computed yield.
- There is no broad `except Exception`, no migration, and `git diff --check` is clean.
- The new tests correctly prove infinity and downloader-raised `ValueError` behavior.

## Independent failing reproduction

With `DATABASE_URL=""` and no network, each mocked return below must produce `None` under the
contract. Instead each leaks an exception before field-level coercion:

```text
_download_valuation_measures -> {}
AttributeError: 'dict' object has no attribute 'empty'

_download_valuation_measures -> []
AttributeError: 'list' object has no attribute 'empty'

_download_valuation_measures -> 'not-a-frame'
AttributeError: 'str' object has no attribute 'empty'
```

The agent's malformed-data test changed the downloader to *raise* `ValueError`; it did not test a
malformed returned shape. The distinction is material because the interface says a frame that cannot
be read in the documented DataFrame shape returns `None`.

## Required correction

Contract 0058 adds the explicit DataFrame-shape guard and a parameterized regression test. Do not
accept or archive 0057 until 0058 is reported and audited successfully.

## Follow-up audit — Contract 0058

**Final verdict:** accepted

0058 adds `isinstance(frame, pd.DataFrame)` before any DataFrame attribute access and covers all
three malformed returns. I independently reproduced `{}`, `[]`, and `"not-a-frame"` returning
`None`, and reran the full suite (459 passed) and focused market-data suite (56 passed).
