# Report — Contract 0004

**Outcome:** COMPLETE
**Agent:** sonnet

## What I did

- `backend/app/config.py:8` — added `self.database_url: str | None = os.getenv("DATABASE_URL") or None` to `Settings`. Empty string is folded to `None`; nothing raises at import.
- `backend/app/db.py` (new) — `get_engine()`, `is_enabled()`, `session()` per the interface. The engine is cached, keyed by the *current* `database_url` string (`_engine_url_key`), and rebuilt (old one disposed) whenever that value changes — this is what lets tests flip `DATABASE_URL` via `monkeypatch` between database mode and degraded mode without any manual reset hook, while still being "lazy, created once" from a caller's perspective. `normalize_database_url()` rewrites `postgres://` → `postgresql+psycopg://`. `pool_pre_ping=True` is set unconditionally on the one `create_engine` call.
- `backend/app/models.py` (new) — `PriceBar` and `TickerFundamentals`, declarative style, no `ForeignKey` anywhere, index on `price_bars.date`, all fundamentals columns nullable except `ticker`/`fetched_at`.
- `backend/app/cache.py` (rewritten in place, same three public signatures) — `get_cached`/`store` check the TTL cache first, then fall through to Postgres only when `is_enabled()`; `clear()` untouched in spirit, still only calls `_cache.clear()`. `_write_to_db` builds a dialect-aware upsert (see Gaps below) keyed on `(ticker, date)`; `_read_from_db` reconstructs the DatetimeIndex-named-`date`, lowercase-OHLCV DataFrame shape.
- `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/script.py.mako`, `backend/migrations/versions/0001_initial.py` (new) — standard Alembic scaffold via `alembic init`, then hand-edited. `env.py` reads `DATABASE_URL` from `os.environ` at runtime and normalizes it through the same `app.db.normalize_database_url` cache.py uses, so migrations and the app never disagree on the driver string. `alembic.ini`'s `sqlalchemy.url` line is commented out, not left as the generated placeholder, with a comment pointing at `env.py`. The revision file is named `0001_initial.py` with `revision = "0001"` — I generated it via `alembic revision` first (which names files by hash) and then rewrote/renamed by hand to match the contract's required filename, since the auto-generated name doesn't match what's specified.
- `backend/tests/test_models.py`, `backend/tests/test_cache_backend.py` (new) — see Testing below.
- `backend/requirements.txt` — added `sqlalchemy==2.0.52`, `psycopg[binary]==3.3.5`.
- `backend/requirements-dev.txt` — added `alembic==1.20.0`.
- `backend/.env.example` — appended (could not read the existing file first; see Gaps). Exact text appended:
  ```
  # Postgres connection string for the price/fundamentals cache (contract 0004).
  # Optional: when unset, the app runs in degraded mode (in-process TTL cache only, no persistence).
  # Render supplies the short "postgres://" form; app/db.py rewrites it to "postgresql+psycopg://" automatically.
  # DATABASE_URL=postgres://user:password@host:5432/dbname
  ```

## Commands run

```
$ PATH="$PWD/backend/.venv/bin:$PATH" python -m pip install -r backend/requirements-dev.txt
[... dependency resolution ...]
Installing collected packages: sqlalchemy, psycopg-binary, psycopg, MarkupSafe, Mako, alembic
Successfully installed Mako-1.4.1 MarkupSafe-3.0.3 alembic-1.20.0 psycopg-3.3.5 psycopg-binary-3.3.5 sqlalchemy-2.0.52

$ cat backend/requirements.txt backend/requirements-dev.txt
fastapi==0.141.1
uvicorn[standard]==0.52.4
pandas==3.0.5
cachetools==7.1.8
sqlalchemy==2.0.52
psycopg[binary]==3.3.5
-r requirements.txt
pytest==9.1.1
httpx==0.28.1
alembic==1.20.0

$ grep -cE '^(sqlalchemy|psycopg\[binary\])==' backend/requirements.txt ; echo "(must print 2)"
2
(must print 2)

$ grep -nE '^alembic==' backend/requirements.txt ; echo "exit=$? (1 means alembic correctly absent from runtime deps)"
exit=1 (1 means alembic correctly absent from runtime deps)

$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
...................                                                      [100%]
19 passed in 0.45s

$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "from fastapi.testclient import TestClient; from app.main import app; r = TestClient(app).get('/health'); assert r.status_code == 200, r.status_code; print('health 200 with no DATABASE_URL')"
[StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead. — pre-existing, unrelated to this contract]
health 200 with no DATABASE_URL

$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "import app.models; from app.db import is_enabled, get_engine; assert is_enabled() is False; assert get_engine() is None; print('degraded mode confirmed')"
degraded mode confirmed

$ grep -nE 'print\(|logger\.|logging\.|raise .*(url|dsn|database_url)' backend/app/db.py ; echo "(inspect each match in the report)"
(no output — zero matches)

$ grep -rn "ForeignKey" backend/app/models.py ; echo "exit=$? (1 means clean)"
exit=1 (1 means clean)

$ grep -rnE "DELETE|delete\(\)" backend/app/cache.py ; echo "exit=$? (1 means clean)"
exit=1 (1 means clean)

$ grep -rn "def upgrade\|def downgrade" backend/migrations/versions/
backend/migrations/versions/0001_initial.py:23:def upgrade() -> None:
backend/migrations/versions/0001_initial.py:66:def downgrade() -> None:

$ ls -1 backend/app/db.py backend/app/models.py backend/alembic.ini backend/migrations/env.py backend/migrations/script.py.mako backend/tests/test_models.py backend/tests/test_cache_backend.py
backend/app/db.py
backend/app/models.py
backend/alembic.ini
backend/migrations/env.py
backend/migrations/script.py.mako
backend/tests/test_models.py
backend/tests/test_cache_backend.py

$ ls -1 backend/migrations/versions/
0001_initial.py
```

**Criterion 10 (db.py logging/print/raise scan) — required to be inspected, not just pass/fail:** the grep produced **zero matches** in `backend/app/db.py`. There is no `print(`, no `logger.`/`logging.` call, and the file's only `raise` is `raise RuntimeError("No database configured")` in `session()` — a static string with no variable interpolation, so it cannot leak the connection string under any input.

## Deviations from the contract

1. **`price_bars.volume` uses `BigInteger`, not a plain `Integer`.** The contract only mandated `BigInteger` explicitly for `market_cap` and `average_volume` (with measured justification). It said nothing about the width of `price_bars.volume` beyond `int | None`. Daily share volume for a single ticker is very unlikely to exceed 32-bit range, but since the two fields the contract *did* call out are the same class of problem (large integer counts), I used `BigInteger` here too for internal consistency rather than leaving one integer column narrower than the others for no stated reason. This is a real choice, not something the contract dictated — flagging it in case there's a reason to keep it as plain `Integer` I'm not aware of.
2. **The initial revision file was generated then renamed.** `alembic revision -m "initial"` names files by content hash (`75a707be585a_initial.py`); I deleted that file and hand-wrote `0001_initial.py` with `revision = "0001"` to match the contract's required filename exactly. The upgrade/downgrade bodies are hand-written `op.create_table`/`op.drop_table` calls mirroring `app/models.py` column-for-column, not autogenerated — autogenerate needs a live target to diff against, and the contract says not to connect to a real database.
3. **`db.py`'s engine cache is keyed by the current `DATABASE_URL` value, not a one-time flag.** The contract's docstring says "created lazily on first call," which I read as describing the common case (one process, one URL, created once) rather than forbidding a URL-keyed cache. I chose this because without it, tests that flip between database mode and degraded mode via `monkeypatch.setenv`/`delenv` would silently reuse a stale engine from a previous test — there's no other hook in the specified interface for a caller to force re-evaluation. If this reading is wrong, the fix is confined to `db.py`'s private module state; nothing about the public `get_engine()`/`is_enabled()`/`session()` signatures would change.
4. **`alembic.ini`'s `sqlalchemy.url` line is commented out** rather than left as the auto-generated `driver://user:pass@localhost/dbname` placeholder, to avoid it looking like a real, intended default. `env.py` sets it programmatically from `DATABASE_URL` at runtime either way.

## Not done

Nothing from the contract's Files/Interface/Acceptance-criteria lists.

## Gaps and uncertainty

- **`.env.example` — I could not read the file before appending to it**, per the contract's own note that this path is denied to me. I used a pure append (`>>`, no read), so I'm confident I didn't clobber existing content, but I have not visually confirmed the final file reads cleanly (e.g., that there's exactly one blank line of separation, no duplicate `DATABASE_URL` mention already present under a different name). Worth a quick look on your end.
- **No test skipped.** The contract anticipated `pytest.mark.skipif` for "anything genuinely Postgres-specific." I didn't need one — the upsert logic branches on `db.get_bind().dialect.name` at runtime and exercises the real SQLite `ON CONFLICT DO UPDATE` path (via `sqlalchemy.dialects.sqlite.insert`) in tests, which is a legitimate stand-in for the Postgres dialect's identical API (`sqlalchemy.dialects.postgresql.insert`) — same method calls, different dialect-specific SQL rendered underneath. This means **the Postgres-specific `on_conflict_do_update` codepath itself is never exercised against real Postgres by these tests** — only the structurally-identical SQLite equivalent. I'm confident in the SQLAlchemy Core API being dialect-symmetric here (it's a documented, intentional parity between the two `insert()` variants), but this is the one place where "tests pass without a database" and "tests prove the Postgres behavior" are not quite the same claim. Worth a smoke test against a real Postgres instance once Gunnar's Render database exists.
- **Datetime resolution required an explicit fix I hadn't anticipated.** `pd.to_datetime()` on a list of date strings and `pd.to_datetime()` on a `Series` of `datetime.date` objects from SQLite produced different index dtypes (`datetime64[us]` vs `datetime64[s]`) under this pandas version (3.0.5), which broke `assert_frame_equal` until I forced `.astype("datetime64[us]")` on the read path (`app/cache.py`, in `_read_from_db`). I don't know whether this resolution mismatch would also appear against real Postgres (where the driver, not SQLite's date affinity, controls what Python type comes back) — worth watching for once real Postgres round-trips are exercised.
- **I did not test what happens if `store()` is called with a DataFrame missing one of the five OHLCV columns**, or with extra columns. `_write_to_db` uses `row.get(...)`, so a missing column silently becomes `None` rather than raising — this seems like reasonable behavior but wasn't specified and isn't tested.
- **Connection pool behavior under `pool_pre_ping=True` is untested** — by design, since that requires a real, occasionally-idle database connection to observe, which is out of scope here.

## Files changed

```
$ git status --short backend/
 M backend/.env.example
 M backend/app/cache.py
 M backend/app/config.py
 M backend/requirements-dev.txt
 M backend/requirements.txt
?? backend/alembic.ini
?? backend/app/db.py
?? backend/app/models.py
?? backend/migrations/
?? backend/tests/test_cache_backend.py
?? backend/tests/test_models.py
```

(`backend/tests/test_cache.py` — contract 0001's tests — is untouched; I only read it.)

---

## Fix applied (round 2) — addresses Finding 1

`store()` (`app/cache.py:33-48`) now normalizes once via a new `_normalize_ohlcv()` helper and
caches the **normalized** frame — the same helper `_read_from_db` calls, so both paths are
provably identical rather than coincidentally identical. `_normalize_ohlcv` also restricts/reorders
to exactly the canonical `open/high/low/close/volume` columns (dropping anything else, e.g.
yfinance's `Adj Close`) — not just fixing dtype/index-name/index-dtype as the finding described,
because a caller's extra column would have reopened the identical class of bug (present in the TTL
copy, absent from a DB-reconstructed one) the moment contract 0005 passes real `yf.download()`
output through.

Normalization only applies when the frame has at least one recognizable OHLCV column
(`_looks_like_ohlcv`); frames with none pass through unchanged. This was necessary, not
stylistic — normalizing unconditionally breaks `test_cache.py`'s two round-trip tests
(`test_store_and_get_round_trips_dataframe`, `test_lookup_is_case_insensitive`), which store
arbitrary non-OHLCV DataFrames (a `date` column + a `price` column, no DatetimeIndex at all) and
assert exact passthrough. I caught this by actually running the full suite after the first version
of the fix, rather than only running the new test — the first version passed the new test and
silently broke two existing ones (confirmed via `git status` that I had not edited
`test_cache.py`; the frames really were being mangled by normalization, not a stale assertion).

Added `test_ttl_and_database_reads_are_structurally_identical`
(`tests/test_cache_backend.py`) — a realistic yfinance-shaped frame (index named `Date` at
`datetime64[s]`, Capitalized columns, `volume` `int64`), asserting
`assert_frame_equal(from_ttl, from_db)` after `store()` then `clear()` then a second
`get_cached()`. This is a stronger shape than the audit's minimum ask (capitalized columns too,
not just index name/dtype), since the same bug class would reopen for column casing.

```
$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
....................                                                     [100%]
20 passed in 0.52s

$ git status --short backend/tests/test_cache.py
(no output — unmodified)

$ grep -rn "ForeignKey" backend/app/models.py ; echo "exit=$?"
exit=1

$ grep -rnE "DELETE|delete\(\)" backend/app/cache.py ; echo "exit=$?"
exit=1

$ grep -nE 'print\(|logger\.|logging\.|raise .*(url|dsn|database_url)' backend/app/db.py
(no output — zero matches)

$ python -c "...TestClient(app).get('/health')..."
health 200 with no DATABASE_URL

$ python -c "...is_enabled() is False; get_engine() is None..."
degraded mode confirmed
```

---

## Audit — Planner only

**Verdict: one required fix, then accepted. The persistence layer is well built and the boundary
claim it was testing held. But `store()` caches the *un-normalized* input while the database
returns a normalized frame, so `get_cached()` returns structurally different DataFrames depending
on cache timing — with exactly the input shape yfinance produces. That breaks contract 0005 before
it is written.**

**Verification I re-ran myself** (planner, against disk, not from the report)

| check | result |
|---|---|
| All 7 Files-list files + migration | present ✅ |
| `pytest -q`, no database running | `19 passed in 0.48s` ✅ |
| `test_cache.py` (0001) modified? | **No** — not in `git status`. Criterion 4 holds ✅ |
| `app/main.py` modified? | **No** — the boundary held ✅ |
| `/health` with no `DATABASE_URL` | 200, `{"status":"ok","python":"3.13.15"}` ✅ |
| `is_enabled()` False / `get_engine()` None | confirmed ✅ |
| `ForeignKey` in `models.py` | exit 1 ✅ |
| `DELETE`/`delete()` in `cache.py` | exit 1 ✅ |
| `sqlalchemy` + `psycopg[binary]` pinned in runtime | count 2 ✅ |
| `alembic` absent from runtime deps | exit 1 ✅ |
| migration `upgrade()`/`downgrade()` | both real; `downgrade` drops index then both tables ✅ |
| connection string in logs/exceptions | no `print`/`logger` in `db.py` at all; `RuntimeError("No database configured")` carries no URL ✅ |

### Finding 1 — REQUIRED FIX. `store()` caches the raw frame; the database returns a normalized one.

`store()` (`app/cache.py:33-40`) puts the caller's DataFrame into the TTL cache verbatim, then
normalizes separately on the way to the database. `_read_from_db` (`:73-77`) reconstructs with
`datetime64[us]`, index name `date`, `Int64` volume. So the two read paths disagree.

Measured against live yfinance output (`yf.download`, yfinance 1.7.0 / pandas 3.0.5):

| | yfinance gives | storage layer returns |
|---|---|---|
| index dtype | `datetime64[s]` | `datetime64[us]` |
| index name | `Date` | `date` |
| volume dtype | `int64` | `Int64` |

Reproduced end-to-end through the real code path with a SQLite `DATABASE_URL`:

```
TTL  -> index Date datetime64[s]  | volume int64
DB   -> index date datetime64[us] | volume Int64
DIVERGENT: DataFrame.index are different
```

The contract required "Normalize on write, reconstruct on read, and make the round trip lossless
for dtypes." Normalizing on the write-to-database path only is half of that. The consequence is
the worst shape a bug can take: intermittent, correct-looking, and dependent on cache timing rather
than on inputs — `df.index.name` is `Date` for 24 hours after a fetch and `date` afterwards.

**Why the tests missed it, which is the more useful lesson:** the `_ohlcv_df` fixture
(`test_cache_backend.py:35-47`) constructs frames already in `float64`/`Int64` with a `date` index
— precisely the shape `_read_from_db` emits. So the round-trip assertions compare the
implementation against itself and cannot fail. This is the "asserts against the implementation
rather than the requirement" pattern. My acceptance criteria enabled it: I asked for a round-trip
test without requiring that its input differ in shape from its output.

**Required:**
1. `store()` normalizes once, then caches the **normalized** frame, so both read paths return
   identical structures.
2. A test that feeds a yfinance-shaped frame — index named `Date`, `datetime64[s]`, `volume`
   `int64` — and asserts `assert_frame_equal(from_ttl, from_db)`.

### Finding 2 — `get_engine()` is not thread-safe. Accepted, recorded.

`db.py:22-36` mutates `_engine`/`_engine_url_key` globals with no lock, and calls `dispose()` on
the old engine when the URL changes. FastAPI runs sync endpoints in a threadpool, so two concurrent
first-calls can each build an engine and one gets disposed while potentially in use. In practice
the URL only changes under test monkeypatching, so production risk is limited to a startup race
that leaks one engine. Not worth fixing now; worth knowing before anything else caches globals.

### What is good, specifically

- **The boundary claim held.** `app/main.py` untouched, `test_cache.py` untouched, all three public
  signatures unchanged. `REBUILD.md`'s months-old bet that `get_cached`/`store` would absorb
  persistence as a one-module change was correct.
- **The upsert test is the real thing** (`test_cache_backend.py:94-129`): overlapping writes, asserts
  three rows rather than four, asserts the overlap took the second write's values *and* that the
  non-overlapping first-write row survived. That is the partial-bar guard tested properly.
- **`test_clear_leaves_database_rows_intact`** proves the negative the contract cared about by
  storing, clearing, and reading back *from the database*.
- **Dialect-aware upsert** (`cache.py:101-106`) exercises real `ON CONFLICT DO UPDATE` in tests
  rather than a mock, and `set_["updated_at"] = func.now()` means `updated_at` actually moves on
  upsert — the model's `server_default` alone would not have done that.
- **Per-test `tmp_path` SQLite files**, so tests cannot share state or order-depend.
- The coder flagged three things unprompted that I would otherwise have had to find: the
  Postgres-branch-untested gap, the `BigInteger` judgment call on `volume`, and the blind append to
  `.env.example`.

### Not verified by the audit

- **The Postgres code path has never run against Postgres.** Only its SQLite dialect twin. The
  coder flagged this. Needs a smoke test once the Render instance exists — the first real use of
  `pg_insert`, `pool_pre_ping`, and the `postgres://` rewrite will be in production otherwise.
- `backend/.env.example` — planner cannot read it (`Read(.env.*)` denied). Appended blind by the
  coder, unverified by either of us. **Gunnar should eyeball it.**
- `alembic upgrade head` was never run. By design; deferred to the Render smoke test.

**Follow-up contracts filed:** none. Finding 1 is a two-part fix inside 0004's own scope — reopen
0004 rather than spending a number. Finding 2 and the Postgres smoke test are recorded in
`REBUILD.md`, not contracts.
