# Contract 0005 — Add `adj_close` to the price schema

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

`price_bars` stores `adj_close` alongside raw OHLCV, and the DataFrame contract becomes six
canonical columns that are always present, so a frame read from the TTL cache and one read from the
database are identical regardless of what the caller supplied.

## Why

`REBUILD.md` decided 2026-09-13 to store raw OHLC **and** `adj_close`, fetching with
`auto_adjust=False`. Raw OHLC is an invariant — a raw close that changes means genuine corruption or
a vendor correction, never a corporate action. `adj_close` is the restatement-prone value: a split
or dividend rewrites it across the entire stored history.

This matters because the freshness rule cannot see restatement. It asks "is the newest bar current
through the last completed session?", which stays `True` after a 4:1 split while every adjusted
price before the split date is wrong by a factor of four. Contract 0006 detects that by re-fetching
a historical anchor and comparing stored `adj_close` against fresh — **which is impossible without
this column.**

Contract 0004 shipped without it. This contract corrects that **before anything fetches**, because
rows written without `adj_close` can never be integrity-checked afterwards.

**Depends on contract 0004.** If `backend/app/models.py` or `backend/migrations/versions/` does not
exist, stop and report `BLOCKED`.

## Environment

The venv at `backend/.venv` already exists. Prepend it to `PATH` on every command — never activate,
never bare `python`, never name the interpreter by path (the tool sandbox rejects path-named
executables):

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**No database required.** Tests run against SQLite in-memory / `tmp_path`, as in 0004.

## Files

Create:
- `backend/migrations/versions/0002_add_adj_close.py` — `revision = "0002"`, `down_revision = "0001"`

Modify:
- `backend/app/models.py` — add `adj_close` to `PriceBar`
- `backend/app/cache.py` — six canonical columns, always present
- `backend/tests/test_cache_backend.py` — update fixtures, add two cases
- `backend/tests/test_models.py` — cover the new column

**Touch nothing else.** Do not modify `app/main.py`, `app/db.py`, `app/config.py`,
`requirements*.txt`, `backend/tests/test_cache.py`, or anything under `frontend/`. No new
dependencies. If the work appears to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `app/models.py`

Add one column to `PriceBar`, positioned after `close`:

```python
adj_close: Mapped[float | None] = mapped_column(Float)
```

Nullable, like the other price columns. No foreign keys, no other schema changes.

### `app/cache.py` — the part that needs care

`_OHLCV_COLUMNS` becomes six, in this exact order:

```python
_OHLCV_COLUMNS = ("open", "high", "low", "close", "adj_close", "volume")
```

**`_normalize_ohlcv()` must now guarantee all six columns exist**, filling any the caller omitted
with NA at the correct dtype — `float64` for the five price columns, `Int64` for `volume`. Today it
selects only columns that happen to be present:

```python
out = out[[col for col in _OHLCV_COLUMNS if col in out.columns]]   # current — insufficient
```

That is the bug this contract must not reintroduce. `_read_from_db()` always returns six columns
because they always exist as table columns. So if a caller stores a five-column frame and
normalization preserves five, the TTL read gives five and the database read gives six —
**exactly the divergence the 0004 audit rejected**, in a new disguise. Fill, don't filter.

Column **order** must also be identical on both paths: `assert_frame_equal` compares order, not
just membership.

Also handle yfinance's naming: `auto_adjust=False` returns a column literally named `Adj Close`.
Lowercasing yields `adj close`, not `adj_close`. Map it — space and hyphen both to underscore — so
that a real `yf.download(..., auto_adjust=False)` frame normalizes correctly. A test covers this.

`_write_to_db` and `_read_from_db` follow from `_OHLCV_COLUMNS`; if they are written in terms of
that constant they need little or no change. Verify rather than assume.

`get_cached`, `store`, and `clear` keep their exact signatures. The `_looks_like_ohlcv` guard stays
as-is — `REBUILD.md` records it as debt to clear after 0006, not here.

### Migration `0002_add_adj_close.py`

```python
revision = "0002"
down_revision = "0001"

def upgrade() -> None:
    op.add_column("price_bars", sa.Column("adj_close", sa.Float(), nullable=True))

def downgrade() -> None:
    op.drop_column("price_bars", "adj_close")
```

Hand-written, mirroring `0001_initial.py`'s style. Do **not** run `alembic upgrade` against a
real database — generating a valid revision is the deliverable.

## Out of scope

- **No yfinance.** No network calls. Fetching, drift detection, and `auto_adjust=False` are
  contract 0006. This contract only makes the column exist and the shape consistent.
- No split/dividend detection logic. 0006.
- No changes to `ticker_fundamentals`.
- No new dependencies, no `requirements*.txt` edits.
- Do not remove or modify the `_looks_like_ohlcv` guard.
- Do not modify `backend/tests/test_cache.py` — contract 0001's tests must pass untouched, which
  they will, because non-OHLCV frames still pass through unnormalized.
- No connection to a real Postgres instance.

## Acceptance criteria

0. Every file in the Files list exists.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes. Test count **increases**
   from 20 — a run that still reports 20 means the new cases were not added.
2. `backend/tests/test_cache.py` is unmodified: `git diff --stat backend/tests/test_cache.py` is
   empty.
3. **Shape consistency, the criterion this contract exists for.** A test stores a frame *without*
   `adj_close`, reads once from the TTL cache and once from the database after `clear()`, and
   asserts `assert_frame_equal(from_ttl, from_db)`. Both must have all six columns in canonical
   order, with `adj_close` all-NA.
4. **yfinance column naming.** A test stores a frame with a column literally named `Adj Close`
   (plus `Open/High/Low/Close/Volume`, index named `Date` at `datetime64[s]`, volume `int64` — real
   `auto_adjust=False` output shape) and asserts the normalized result has lowercase `adj_close`
   carrying those values, with TTL and database reads identical.
5. `grep -n "adj_close" backend/app/models.py backend/app/cache.py backend/migrations/versions/0002_add_adj_close.py` matches in all three files.
6. The migration declares `revision = "0002"` and `down_revision = "0001"`, and `downgrade()` drops
   the column — body is not `pass`.
7. `grep -rn "ForeignKey" backend/app/models.py` matches nothing (exit 1).
8. `grep -rnE "DELETE|delete\(\)" backend/app/cache.py` matches nothing (exit 1).
9. With `DATABASE_URL` unset the app still imports and `/health` returns 200 (degraded mode
   unbroken).

## Verification to run and paste

Run each and paste the **complete, verbatim** output, including failures.

```bash
ls -1 backend/migrations/versions/
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
git diff --stat backend/tests/test_cache.py ; echo "(empty = 0001 tests untouched)"
grep -n "adj_close" backend/app/models.py backend/app/cache.py backend/migrations/versions/0002_add_adj_close.py
grep -n "revision\|down_revision" backend/migrations/versions/0002_add_adj_close.py
grep -rn "ForeignKey" backend/app/models.py ; echo "exit=$? (1 means clean)"
grep -rnE "DELETE|delete\(\)" backend/app/cache.py ; echo "exit=$? (1 means clean)"
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "from fastapi.testclient import TestClient; from app.main import app; r = TestClient(app).get('/health'); assert r.status_code == 200; print('health 200, degraded mode intact')"
```

State in the report: the exact before/after of `_normalize_ohlcv`'s column handling, and how you
map `Adj Close` to `adj_close`.

## Open questions — do NOT resolve these yourself

- **Whether `auto_adjust` is `True` or `False` at the fetch site.** Decided (`False`), but the fetch
  site does not exist yet and is contract 0006's. Do not add fetching here.
- **What the drift-detection anchor date should be**, or how often it is checked. 0006.
- **Whether raw `close` and `adj_close` disagreeing should surface to the user.** Undecided.
- **Backfilling `adj_close` for rows already stored.** No rows exist yet — nothing has fetched. Do
  not write a backfill.
