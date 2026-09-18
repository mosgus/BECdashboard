# Report — Contract 0054

## Audit

**Verdict:** rejected

The new quote-on-add path and the crumb-free sources are present, and the schema has no duplicate
fields. But the tier-1.5 functions violate their own contract: malformed or non-finite provider data
can raise or return `inf` instead of degrading to `None`.

## What I found

- `UniverseEntry` has one each of `current_price`, `last_close`, `prior_close`, and
  `quote_fetched_at`. The duplicate fields recorded during the earlier 0055 audit were transient
  worktree state and are gone.
- `refresh_quote_for` is market/database gated before fetch, uses the existing single-ticker quote
  path, and does not access `QUOTE_ATTEMPT_KEY`. `add()` calls it after membership is written and
  catches an exception so a quote failure does not fail an add.
- `fetch_valuation_measures` checks `pd.isna(value)`, which rejects `NaN` but not positive or
  negative infinity. `int(float('inf'))` raises `OverflowError`.
- `fetch_trailing_yield` accepts infinite dividend totals and returns `inf`.
- Both functions catch only `YFException` and `CurlRequestException`; a malformed provider result
  that raises `ValueError` escapes despite their documented `None on any failure` behavior.

## Independent verification

```text
PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q
449 passed, 2 warnings in 3.35s

grep -n 'period="max"\\|\\.dividends' backend/app/market_data.py  -> exit 1
git status --porcelain -- backend/migrations/                     -> empty

# With DATABASE_URL="" and mocked downloaders, no network or database:
fetch_valuation_measures(infinite market cap)
-> OverflowError: cannot convert float infinity to integer

fetch_trailing_yield(infinite dividends)
-> inf

fetch_valuation_measures(download raises ValueError)
-> ValueError: malformed response

fetch_trailing_yield(download raises ValueError)
-> ValueError: malformed response
```

The contract's frontend-diff check is non-empty in the shared uncommitted worktree, but those files
match the later accepted 0055/0056 change path; that aggregate check cannot attribute them to 0054.

The prescribed live probe itself needs `cd backend` (or `PYTHONPATH=backend`) in this checkout;
from the repository root, `python -c 'from app...'` raises `ModuleNotFoundError`. With the corrected
working directory and `DATABASE_URL=""`, this audit environment could not resolve Yahoo DNS; every
live call correctly degraded to `None`. The prior reported successful live probe remains useful
deployment evidence but is not independently reproducible here.

## Required correction

Contract 0057 adds finite-value and expected malformed-data handling with focused, hermetic tests.
Do not accept or archive 0054 until 0057 is reported and audited successfully.

## Follow-up audit — Contracts 0057 and 0058

**Final verdict:** accepted

The two follow-ups now reject `NaN`, positive infinity, and negative infinity; return `None` for
malformed downloader exceptions; and explicitly return `None` when the valuation downloader returns
a dict, list, or string instead of a DataFrame. The full backend suite passes independently with
459 tests, the focused market-data suite passes with 56 tests, no broad catch was added, and no
migration exists. The frontend diff remains attributable to the already-accepted 0055/0056 work.

The actual Render behavior remains the contract's required human deployment check. This audit
environment cannot resolve Yahoo DNS, so it verified safe degradation rather than endpoint success.
