# Contract 0010 — Widen `UniverseEntry` with market cap, P/E and yield

**Status:** open
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

`GET /universe` returns `market_cap`, `trailing_pe` and `dividend_yield` for every row, so the
Universe table's existing columns stop rendering em dashes for every ticker.

## Why

Planner defect, found during the contract 0009 audit. The approved mockup
(`mockup-universe.html`) was built from a **`UniverseDetail`** response — the body returned by
`POST /universe` — but the Universe table is populated by **`GET /universe`**, which returns
`UniverseEntry`, and that model has only ten fields. So contract 0009 specified a table with Mkt Cap,
P/E and Yield columns *and* a type that cannot supply them. The 0009 coder rendered them honestly
empty and flagged it rather than inventing backend behaviour — correct, and this contract is the fix.

The columns belong in the list. A comparison table whose only numeric column is price is not a
comparison table; market cap, P/E and yield are exactly what you scan a universe for.

**This is nearly free.** `universe.list_all()` already queries `ticker_fundamentals` for
`short_name`, `sector`, `quote_type` and `regular_market_price`. Three more columns join the same
projection — **no additional query, no N+1.**

**No frontend change is needed.** The columns already exist in `UniverseTable.tsx` and render `—`
for null. They light up on their own once the API supplies values.

**Depends on contract 0008.** If `backend/app/schemas.py` has no `UniverseEntry`, stop and report
`BLOCKED`.

## Environment

Venv at `backend/.venv`. Prepend it to `PATH` on every command — never activate, never bare
`python`, never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**No database, no network.** `tests/conftest.py` strips `DATABASE_URL` via an autouse fixture —
do not remove or weaken it.

## Files

Modify:
- `backend/app/schemas.py` — three fields onto `UniverseEntry`
- `backend/app/universe.py` — include them in `list_all`'s projection
- `backend/tests/test_universe.py` — extend existing coverage
- `backend/tests/test_api_universe.py` — assert the fields are present in the list response

**Touch nothing else.** No migration — the columns already exist in `ticker_fundamentals`
(contract 0004). Do not modify `app/models.py`, `app/cache.py`, `app/market_data.py`,
`app/freshness.py`, `app/routers/`, `tests/conftest.py`, `tests/test_cache.py`, or anything under
`frontend/`. No new dependencies. If the work appears to require a file not on this list, stop and
report `BLOCKED`.

## Interface

### `schemas.py`

Add to `UniverseEntry`, positioned after `regular_market_price`:

```python
market_cap: int | None
trailing_pe: float | None
dividend_yield: float | None
```

**All three nullable, and this is not optional.** ETFs genuinely lack `market_cap` and `forward_pe`
— measured across SPY, QQQ and VTI — and non-dividend payers such as TSLA and BRK-B omit
`dividendYield` entirely rather than returning zero. QQQ is already in the live database and will
be a runtime validation error if any of these is non-optional.

`UniverseDetail` inherits from `UniverseEntry`, so it must **not** redeclare these three. If it
currently declares `market_cap`, `trailing_pe` or `dividend_yield` itself, remove those lines —
duplicated declarations across a base and subclass drift apart.

`forward_pe` stays on `UniverseDetail` only. The table shows trailing P/E.

### `universe.py`

Add the three columns to whatever projection `list_all` already selects from
`ticker_fundamentals`. **One query per table, unchanged** — the 0008 audit verified `list_all` stays
flat at two queries for ten tickers, and that property must survive.

`dividend_yield` passes through **untouched**. The API returns `0.33` meaning 0.33%, already in
percent units. Do not multiply, do not divide, do not default an absent value to `0`.

## Out of scope

- No migration. The columns exist in `ticker_fundamentals` already.
- No frontend changes at all. `UniverseTable.tsx` already has the columns.
- No new fields beyond these three. `beta`, `forward_pe`, `average_volume` and the 52-week range
  stay detail-only.
- No sorting, filtering, or pagination.
- No changes to `get_one`, `add`, or `refresh`.
- Do not add a delete endpoint or a bulk refresh.

## Acceptance criteria

0. Every file in the Files list was modified; nothing else was.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 99.
2. `UniverseEntry` declares all three fields, each `| None`.
3. `UniverseDetail` does **not** redeclare them:
   `grep -cE '^\s+(market_cap|trailing_pe|dividend_yield)\s*:' backend/app/schemas.py` prints `3`,
   not `6`.
4. A test asserts `list_all` returns the three fields with real values for an equity.
5. A test asserts an **ETF-shaped** row returns `market_cap is None` with a non-null
   `regular_market_price` — `assert ... is None`, not `assert not ...`, which passes for `0` too.
6. A test asserts `dividend_yield` passes through unscaled: `0.33` in, `0.33` out.
7. A `TestClient` test asserts `GET /universe` includes all three keys in each row.
8. `list_all`'s query count is unchanged — the existing 0008 query-count test still passes.
9. `git diff --stat backend/app/models.py backend/app/cache.py backend/app/market_data.py backend/app/freshness.py backend/tests/conftest.py backend/requirements.txt`
   is empty.
10. `ls backend/migrations/versions/` shows exactly the three existing revisions — no new migration.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string, so an
> unprefixed script talks to the **production database**. `conftest.py` covers `pytest` only.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -cE '^\s+(market_cap|trailing_pe|dividend_yield)\s*:' backend/app/schemas.py ; echo "(must print 3)"
grep -nE 'market_cap|trailing_pe|dividend_yield' backend/app/universe.py
ls -1 backend/migrations/versions/
git diff --stat backend/app/models.py backend/app/cache.py backend/app/market_data.py backend/app/freshness.py backend/tests/conftest.py backend/requirements.txt ; echo "(empty = untouched)"
cd backend && PATH="$PWD/.venv/bin:$PATH" DATABASE_URL="" python -c "
from app.schemas import UniverseEntry
f = UniverseEntry.model_fields
for k in ('market_cap','trailing_pe','dividend_yield'):
    print(k, '->', f[k].annotation, '| required:', f[k].is_required())"
```

## Human verification — does Gunnar need to run anything?

**Yes — both halves, and it is quick.** With the backend restarted and the frontend running:

```bash
curl -s localhost:8000/universe | python3 -m json.tool | head -20
```

MSFT should now show `market_cap` around `3.6e12`, `trailing_pe` near 38, and `dividend_yield`
near 0.6. Then reload `http://localhost:5173/universe` — the **Mkt Cap, P/E and Yield columns
should fill in**, with QQQ still showing `—` under Mkt Cap because ETFs genuinely have none.

If QQQ shows a number under Mkt Cap, something is fabricating data.

## Open questions — do NOT resolve these yourself

- **Whether the list should carry `beta` or the 52-week range too.** Deliberately not included;
  the table has no column for them and width is already tight at 375px.
- **Sorting the table by any of these columns.** Open; the list is ticker-ordered.
