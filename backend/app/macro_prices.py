"""Constituent close prices for the Macro scorecard's Price Breadth metric and quadrant (contract 0203).

One row per ticker: its non-NaN closes as `{days, closes}`, days being integers since 1970-01-01. The
ticker is the unit of download and of resume, and about 1,800 rows are cheap to read in one query. JSON
lists rather than pickle (a code-execution path if the data were ever tampered with) or parquet (a new
dependency); Python floats round-trip exactly through JSON. `load_prices` rebuilds the frame
`macro_snapshot.build_snapshot` takes from the union of every ticker's dates.

Tier 2: app.db, app.models.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db import session
from app.models import MacroPriceSeries

# Rows per INSERT statement: each row is a few bind parameters, so this stays far under SQLite's
# variable limit while keeping a 1,800-ticker seed to a couple dozen statements.
_UPSERT_BATCH = 100


@dataclass(frozen=True)
class PriceCoverage:
    tickers: int
    oldest_fetched_at: datetime | None
    newest_fetched_at: datetime | None


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite (used in tests) hands a DateTime(timezone=True) column back naive; Postgres round-trips it
    tz-aware. Times are written here as UTC, so relabeling a naive read is a relabel, not a guess (the
    same pattern as autorefresh._as_utc)."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def store_series(series: Mapping[str, pd.Series], fetched_at: datetime) -> int:
    """Upsert one row per ticker from its finite closes, sorted by date. NaN and +/-inf are dropped (json
    would write Infinity, which Postgres's json type rejects, failing the whole insert batch). A series
    that is empty after that is skipped, writing nothing and leaving any existing row alone, so a failed
    download never erases good data. Returns the number of rows written."""
    fetched_at = _as_utc(fetched_at).astimezone(timezone.utc)
    rows = []
    for ticker, raw in series.items():
        closes = raw.replace([np.inf, -np.inf], np.nan).dropna().sort_index()
        if closes.empty:
            continue
        days = closes.index.values.astype("datetime64[D]").astype("int64")
        rows.append({"ticker": ticker, "days": days.tolist(),
                     "closes": closes.to_numpy(dtype="float64").tolist(), "fetched_at": fetched_at})
    if not rows:
        return 0
    with session() as db:
        insert_fn = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
        for start in range(0, len(rows), _UPSERT_BATCH):
            stmt = insert_fn(MacroPriceSeries).values(rows[start:start + _UPSERT_BATCH])
            stmt = stmt.on_conflict_do_update(
                index_elements=["ticker"],
                set_={column: getattr(stmt.excluded, column) for column in ("days", "closes", "fetched_at")})
            db.execute(stmt)
    return len(rows)


def load_prices() -> pd.DataFrame:
    """Every stored ticker as one float64 column (sorted), on the ascending union of their dates, NaN
    where a ticker has no close. The index is naive datetime64[ns]. No rows gives an empty frame."""
    with session() as db:
        stored = {ticker: (days, closes) for ticker, days, closes in
                  db.execute(select(MacroPriceSeries.ticker, MacroPriceSeries.days, MacroPriceSeries.closes))}
    if not stored:
        return pd.DataFrame(index=pd.DatetimeIndex([]))
    tickers = sorted(stored)
    all_days = np.unique(np.concatenate([np.asarray(stored[ticker][0], dtype="int64") for ticker in tickers]))
    values = np.full((len(all_days), len(tickers)), np.nan, dtype="float64")
    for column, ticker in enumerate(tickers):
        days, closes = stored[ticker]
        values[np.searchsorted(all_days, np.asarray(days, dtype="int64")), column] = closes
    index = pd.DatetimeIndex(all_days.astype("datetime64[D]").astype("datetime64[ns]"))
    return pd.DataFrame(values, index=index, columns=tickers)


def price_coverage() -> PriceCoverage:
    with session() as db:
        count, oldest, newest = db.execute(select(
            func.count(), func.min(MacroPriceSeries.fetched_at), func.max(MacroPriceSeries.fetched_at))).one()
    return PriceCoverage(count, _as_utc(oldest), _as_utc(newest))


def prices_version() -> str | None:
    """The newest fetched_at as an ISO string, or None with no rows. It goes in the snapshot build's input
    key, so new prices trigger a rebuild."""
    newest = price_coverage().newest_fetched_at
    return None if newest is None else newest.isoformat()
