# Contract 0203 — Macro constituent-price storage, plus a one-time seed

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

**Depends on contract 0202.** Its migration is `0011`, and this contract's migration revises it.
Run 0202 first.

## Goal

After this contract, the backend stores the constituent close prices that the Price Breadth metric
and the quadrant need, about 1,800 tickers. They are stored as data, one row per ticker, and
loaded back into exactly the frame `build_snapshot` expects. A one-time script seeds the table from
the scorecard project's local price cache.

## Why

`build_snapshot` needs a price frame (contract 0201). With no prices, Price Breadth goes n/a in
every market. The planner confirmed on 2026-11-25 that the build then degrades cleanly. That would
still be a visible regression from today's page. So prices must be in the database before the
first server-side build.

The downloader that refreshes them comes in a later contract: button-triggered, resumable, with a
cooldown. Until then, a one-time seed from `prices_cache.pkl` fills the table. That file holds
Yahoo data, not licensed vendor data, and runs through 2026-11-09.

**Why one row per ticker.** The ticker is the unit of download and of resume. 1,809 rows is easy to
read in one query. A long `(ticker, date)` table would be about 700k rows to seed and read on every
build.

**Why JSON lists, not pickle or parquet.** Pickle from a database is a code-execution path if the
data is ever tampered with. Parquet would add `pyarrow`. JSON floats round-trip exactly in Python.
The planner checked on 2026-11-25 that storing each ticker's non-NaN closes as `{days, closes}` and
rebuilding the frame from the union of dates gives a `build_snapshot` identical to the original,
with zero differences.

## Files

Create:
- `backend/app/macro_prices.py`
- `backend/migrations/versions/0012_macro_price_series.py`: revision `"0012"`, revises `"0011"`.
- `backend/hard_data/seed_macro_prices.py`: the one-time seed script.
- `backend/tests/test_macro_prices.py`

Modify:
- `backend/app/models.py`: add `MacroPriceSeries`.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

```python
# app/models.py
class MacroPriceSeries(Base):
    __tablename__ = "macro_price_series"
    ticker: Mapped[str]          # String, primary key (Yahoo symbol, e.g. "0700.HK")
    days: Mapped[list]           # JSON: ints, days since 1970-01-01, ascending
    closes: Mapped[list]         # JSON: floats, same length as days, no NaN
    fetched_at: Mapped[datetime] # DateTime(timezone=True), not null
```

```python
# app/macro_prices.py — tier 2: app.db, app.models
def store_series(series: Mapping[str, pd.Series], fetched_at: datetime) -> int
def load_prices() -> pd.DataFrame
def prices_version() -> str | None

@dataclass(frozen=True)
class PriceCoverage:
    tickers: int
    oldest_fetched_at: datetime | None
    newest_fetched_at: datetime | None

def price_coverage() -> PriceCoverage
```

- **`store_series`** upserts one row per ticker, keeping that ticker's non-NaN closes sorted by
  date. A series that is empty after dropping NaN is **skipped**: no row is written and any
  existing row is left alone, so a failed download never erases good data. It returns the number
  of rows written. Floats are stored as Python `float`; dates become integer days since the epoch.
  Use dialect-aware upserts, the same way `autorefresh._set_state` does.
- **`load_prices`** returns a frame with:
  - a `DatetimeIndex` built from the union of every ticker's dates, naive, `datetime64[ns]`,
    ascending;
  - one `float64` column per ticker, in sorted order, with NaN where a ticker has no close.
  
  With no rows it returns `pd.DataFrame(index=pd.DatetimeIndex([]))`.
- **`prices_version`** returns the newest `fetched_at` as `isoformat()`, or `None` with no rows.
  Contract 0204 puts it in the build's input key, so new prices trigger a rebuild.
- **`hard_data/seed_macro_prices.py <path to prices_cache.pkl>`:**
  - It refuses to run, exiting non-zero with a clear message, when `Settings().database_url` is
    empty.
  - It loads the pickle (a trusted local file; the module docstring says so and says it must
    never be pointed at uploaded data).
  - It calls `store_series({t: frame[t] for t in frame.columns}, fetched_at)`, where `fetched_at`
    is the pickle's `date` at 16:00 America/New_York, converted to UTC.
  - It prints the number of rows written and `price_coverage()`.
  - It does not create tables; the migration does.

## Out of scope

- Downloading prices, and any yfinance import. A later contract covers that.
- The build job, routes and frontend.
- Deleting tickers that are no longer constituents. They do no harm, because breadth only reads
  current constituents.

## Acceptance criteria

1. Run `env -u DATABASE_URL .venv/bin/alembic upgrade 0011:0012 --sql` from `backend/`. It prints
   a `CREATE TABLE macro_price_series` and nothing for any other table.
2. **Planner-run.** From `backend/`:
   `DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py full-db` prints
   `full-db: IDENTICAL`. This mode stores the 15 real files through `macro_store.store_upload` and
   the cached prices through `store_series`, reads both back (`live_versions`, `load_prices`), and
   rebuilds into a throwaway SQLite file. Run it yourself. **Do not edit the tool.**
3. `backend/tests/test_macro_prices.py` uses a `db_mode` fixture and literal data only:
   - a. Store `{"AAA": pd.Series([1.0, float("nan"), 3.0], index=pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06"])), "BBB": pd.Series([float("nan")], index=pd.to_datetime(["2026-01-02"]))}`.
     It returns `1`. `load_prices()` has columns `["AAA"]`, index
     `pd.to_datetime(["2026-01-02", "2026-01-06"])`, and values `[1.0, 3.0]`.
   - b. Two tickers with different dates load into the union index, with NaN in the gaps. Write
     the expected frame out literally and compare with `pd.testing.assert_frame_equal`.
   - c. Storing `"AAA"` again with new values replaces its row. Storing an all-NaN `"AAA"` leaves
     the previous row untouched.
   - d. An empty table gives an empty frame with a `DatetimeIndex`, `prices_version()` is `None`,
     and `price_coverage()` is `PriceCoverage(0, None, None)`.
   - e. `prices_version()` equals the newest `fetched_at` in ISO form after two stores with
     different times.
   - f. The seed script exits non-zero when run with `DATABASE_URL=""`. Run it in a subprocess,
     with a nonexistent pickle path as its argument. The database check must come first, so the
     path never matters.
4. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q` passes. Report the count; the baseline is
   the count after 0202.

`BLOCKED` is the correct answer to a criterion that cannot be satisfied as written.

## Verification to run and paste

Paste the **complete, verbatim** output of each command.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/backend
env -u DATABASE_URL .venv/bin/alembic upgrade 0011:0012 --sql
DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py full-db
PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_macro_prices.py
PATH="$PWD/.venv/bin:$PATH" pytest -q
```

Report every file you edited or created. **Do not run the seed script against any real
database.** Gunnar runs it once, after deploy.

## Human verification — does Gunnar need to run anything?

**Yes, once, after 0202 and 0203 are deployed and the migrations have run.** From `backend/`, with
`.env` pointing at production:

```bash
.venv/bin/python hard_data/seed_macro_prices.py "../reference files/new integration/Scorecard_Project_2026-11-09/prices_cache.pkl"
```

It should report about 1,809 rows written, and coverage with both timestamps set to 2026-11-09
21:00 UTC.

## Open questions

None.
