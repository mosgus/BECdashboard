# Contract 0057 — Tier-1.5 data is finite or absent

**Status:** accepted — verified after contract 0058
**Assigned to:** haiku
**Author:** planner

## Goal

Make the two crumb-free tier-1.5 readers uphold their existing contract: they return only finite
values, or `None` when provider data is malformed or unavailable.

## Why

0054 correctly rejected `NaN`, but that is only one non-finite float. An infinite market cap raises
before the partial merge, and infinite dividends produce an `inf` yield that can reach storage and
the UI. The two functions also promise `None on any failure` while allowing ordinary malformed-data
`ValueError`s to escape. This is a degradation boundary: yfinance enrichment must never make a
valid, price-backed universe ticker fail.

## Files

Modify:

- `backend/app/market_data.py` — finite coercion and expected malformed-data boundary for the two
  tier-1.5 readers.
- `backend/tests/test_market_data.py` — hermetic regression tests.

**Touch nothing else.** No schema, cache, quote, router, frontend, dependency, migration, or
`REBUILD.md` change. Do not modify 0054's report or status.

## Interface

Keep both public signatures unchanged:

```python
def fetch_valuation_measures(ticker: str) -> dict | None: ...
def fetch_trailing_yield(ticker: str) -> float | None: ...
```

`fetch_valuation_measures` must keep its current per-field behavior: a row whose value cannot be
coerced to a finite float is omitted, while valid sibling rows are returned. `market_cap` is an
`int` only after the finite check; P/E values remain `float`. A frame that cannot be read in the
documented DataFrame shape returns `None`, not an exception.

`fetch_trailing_yield` returns a finite positive percent value only. It returns `None` if the
dividend total, latest close, or computed percentage is non-finite; non-positive; missing; or cannot
be coerced to a number.

Use `math.isfinite` after numeric coercion. Catch only expected provider/data-shape failures:
`YFException`, `CurlRequestException`, `AttributeError`, `KeyError`, `TypeError`, `ValueError`, and
`OverflowError`. Do not add `except Exception`, a silent broad catch, or logging-and-continue.

## Required tests

All new tests must monkeypatch the private download helpers; the suite must make no network call.

1. Parameterize valuation values `float('nan')`, `float('inf')`, and `float('-inf')`. Each bad
   row is omitted, while a finite `Trailing P/E` in the same `Current` frame is retained.
2. A dividend history with infinite dividends returns `None`; another with an infinite latest close
   returns `None`.
3. Parameterize both private download helpers to raise `ValueError('malformed response')`; each
   public function returns `None` and does not raise.
4. Preserve the existing finite happy paths and percent units. Do not weaken or replace their
   assertions.

## Out of scope

- No retry policy, network changes, or alteration to yfinance endpoint selection.
- No change to `.info` precedence, partial-write semantics, or `_fundamentals_incomplete`.
- No generic error swallowing beyond the explicit exception set above.
- No live-network verification: the unit tests are sufficient for this malformed-data boundary.

## Acceptance criteria

1. `PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q` passes, with 449 or more tests.
2. The four new regression categories above exist and pass without a network marker.
3. Neither function can return `NaN`, `inf`, or `-inf`; the tests prove every relevant source input
   degrades to `None` or omits only the bad valuation field.
4. `rg -n -U 'except Exception|except:\\s*$' backend/app/market_data.py` has no match in either
   function.
5. `git diff --check` is clean and `git status --porcelain backend/migrations/` is empty.

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

**Nothing to run.** This is a backend degradation-boundary fix. Hermetic regression tests cover the
only new behavior; the existing 0054 deployment probe remains the test of whether Yahoo's endpoint
works from Render.

## Agent prompt

You are the Haiku executor. Read `agent_prompts/executor-haiku.md`, `REBUILD.md`, and this contract
in full. Implement only this contract. Do not commit, push, stage, or edit a file outside the two
listed paths. Run every verification command and paste complete verbatim output in chat, including
failures or deviations. Set the contract status to `in-progress` before work and `reported` when
finished.
