# Contract 0058 — Malformed valuation frames degrade cleanly

**Status:** accepted
**Assigned to:** haiku
**Author:** planner

## Goal

Make `fetch_valuation_measures` return `None`, rather than raise, when yfinance returns something
other than its documented pandas DataFrame.

## Why

0057 correctly handles non-finite scalar values and downloader exceptions, but it assumes that any
successful downloader return has `.empty` and `.columns`. A malformed return such as `{}` raises
`AttributeError` before its existing per-field handling. The tier is best-effort enrichment: an
unexpected provider shape must not make a ticker add or refresh fail.

## Files

Modify:

- `backend/app/market_data.py` — validate the valuation result's DataFrame shape before accessing
  DataFrame attributes.
- `backend/tests/test_market_data.py` — parameterized hermetic regression test.

**Touch nothing else.** No new helper module, dependency, frontend, cache, database, migration, or
change to either public signature. Do not modify any prior contract or report.

## Interface

Keep this signature and all existing finite-value behavior:

```python
def fetch_valuation_measures(ticker: str) -> dict | None: ...
```

Immediately after the downloader returns and before accessing `.empty`, `.columns`, or `.index`,
require `isinstance(frame, pd.DataFrame)`. If false, return `None`. An actual empty DataFrame still
returns `None` exactly as it does now. Do not use `except Exception` as a substitute for this
explicit boundary.

## Required test

Add one parameterized test that monkeypatches `_download_valuation_measures` to return each of:

```python
{}, [], "not-a-frame"
```

For every value, `fetch_valuation_measures("AAPL") is None` and does not raise. The test must not
use an allow-network marker. Leave the 0057 downloader-raises-`ValueError` test intact.

## Out of scope

- No changes to `fetch_trailing_yield`; it receives a different provider shape and already handles
  its documented malformed paths.
- No broader exception types and no logging.
- No changes to finite coercion, row selection, endpoint selection, or tests unrelated to this
  boundary.

## Acceptance criteria

1. `PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q` passes, with 456 or more tests.
2. The new parameterized test proves all three malformed returned shapes produce `None`.
3. `fetch_valuation_measures` has an explicit `isinstance(frame, pd.DataFrame)` guard before any
   DataFrame attribute access.
4. `rg -n -U 'except Exception|except:\\s*$' backend/app/market_data.py` exits 1.
5. `git diff --check` is clean; `git status --porcelain backend/migrations/` is empty.

## Verification to run and paste

```bash
PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q 2>&1 | tail -10
PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests/test_market_data.py -q 2>&1 | tail -10
rg -n -U 'except Exception|except:\\s*$' backend/app/market_data.py ; echo "(exit $? — 1 = correct)"
git diff --check
git status --porcelain backend/migrations/ ; echo "(empty = no migration)"
git status --porcelain
```

## Human verification — does Gunnar need to run anything?

**Nothing to run.** This is an internal provider-shape guard with fully hermetic unit coverage.

## Agent prompt

You are the Haiku executor. Read `agent_prompts/executor-haiku.md`, `REBUILD.md`, and this contract
in full. Implement only this contract. Do not commit, push, stage, or edit any file outside the two
listed paths. Run every verification command and paste complete verbatim output in chat, including
failures or deviations. Set the contract status to `in-progress` before work and `reported` when
finished.
