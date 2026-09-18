from datetime import datetime, timezone

import pandas as pd
from cachetools import TTLCache
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db import is_enabled, session
from app.models import PriceBar, TickerFundamentals, TickerQuote

_cache = TTLCache(maxsize=512, ttl=86400)

_OHLCV_COLUMNS = ("open", "high", "low", "close", "adj_close", "volume")


def get_cached(ticker: str) -> pd.DataFrame | None:
    """Return cached price history for ticker, or None if absent or expired.
    Ticker lookup is case-insensitive; normalize to uppercase internally."""
    key = ticker.upper()

    cached = _cache.get(key)
    if cached is not None:
        return cached

    if not is_enabled():
        return None

    df = _read_from_db(key)
    if df is not None:
        _cache[key] = df
    return df


def store(ticker: str, df: pd.DataFrame) -> None:
    """Cache price history for ticker. Overwrites any existing entry.
    Writes through to the database (upsert) when one is configured.

    OHLCV-shaped frames are normalized once, up front, and the *normalized* result is what
    gets cached — not the raw input. Callers (e.g. yfinance) may hand us index name `Date`
    at datetime64[s] resolution with int64 volume; get_cached() must return the identical
    structure whether it's served from the TTL cache or reconstructed from the database,
    regardless of which shape the caller happened to pass in.

    Frames with none of the OHLCV columns pass through unchanged: this cache is generic
    (contract 0001's tests store arbitrary DataFrames with no date index at all), and only
    the OHLCV shape has a database table to normalize against.

    A row with a null close is dropped here, before either destination — an in-progress
    intraday bar fetched before the session's close is published, not a completed session.
    Filtering once, upstream of both the TTL cache and the database write, is what keeps them
    from ever disagreeing about which rows exist (contract 0004's audit found them diverge
    once already)."""
    key = ticker.upper()
    is_ohlcv = _looks_like_ohlcv(df)
    normalized = _normalize_ohlcv(df) if is_ohlcv else df
    if is_ohlcv:
        normalized = normalized[normalized["close"].notna()]
    _cache[key] = normalized

    if is_enabled():
        _write_to_db(key, normalized)


def clear() -> None:
    """Drop all cached entries. Exists for tests; do not call from app code.
    Clears only the in-process cache — never touches the database or fundamentals."""
    _cache.clear()


def evict(ticker: str) -> None:
    """Drop one ticker's in-process entry. Case-insensitive, no-op when absent. Never touches
    the database — app.universe.remove owns the storage side of deletion; this only owns the
    memory side. Without this, deleting a ticker's rows and re-adding it the same day would
    silently resurrect the pre-deletion history: get_cached would still serve the old
    DataFrame from memory, is_stale would say False, and no fetch would ever happen."""
    _cache.pop(ticker.upper(), None)


def store_fundamentals(ticker: str, data: dict, *, partial: bool = False) -> None:
    """Upsert one row into ticker_fundamentals. No-op when no database is configured —
    fundamentals have no TTL-cache tier, so with no database there is nowhere to put them.

    `partial=False` (the default) is today's behaviour, byte for byte: every column is
    overwritten unconditionally, including with None. An authoritative source (`.info`) is
    allowed to clear a field — a non-payer really can stop paying a dividend.

    `partial=True` (contract 0051) never overwrites a non-null stored value with None — only
    the keys whose incoming value is not None land in the UPDATE clause. `fetched_at` is
    always written regardless; it is `NOT NULL` and records the last time anything succeeded
    at all, not the last time everything did. A brand-new ticker with no row yet still gets
    one inserted, with every crumb-gated column `data` doesn't supply left `NULL` — the exact
    shape an ETF's row already has for genuinely-absent fields, so a partial write is
    indistinguishable from "not reported" rather than looking like data loss.

    `data` need not carry every column: a key absent entirely and a key present with value
    None are treated identically by `.get()`, which is what keeps a partial tier-1/tier-2
    merge (only ever supplying a handful of keys) safe to route through the exact same
    `record` construction the full `.info` path uses."""
    if not is_enabled():
        return

    key = ticker.upper()
    record = {col.name: data.get(col.name) for col in TickerFundamentals.__table__.columns}
    record["ticker"] = key

    with session() as db:
        dialect = db.get_bind().dialect.name
        insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
        stmt = insert_fn(TickerFundamentals).values(record)

        if partial:
            set_ = {
                col.name: getattr(stmt.excluded, col.name)
                for col in TickerFundamentals.__table__.columns
                if col.name != "ticker" and data.get(col.name) is not None
            }
            set_["fetched_at"] = stmt.excluded.fetched_at
        else:
            set_ = {
                col.name: getattr(stmt.excluded, col.name)
                for col in TickerFundamentals.__table__.columns
                if col.name != "ticker"
            }

        stmt = stmt.on_conflict_do_update(index_elements=["ticker"], set_=set_)
        db.execute(stmt)


def get_fundamentals(ticker: str) -> dict | None:
    """Read one row back, or None. Case-insensitive on ticker."""
    if not is_enabled():
        return None

    key = ticker.upper()
    with session() as db:
        row = db.get(TickerFundamentals, key)
        if row is None:
            return None
        return {col.name: getattr(row, col.name) for col in TickerFundamentals.__table__.columns}


def store_quotes(quotes: dict[str, tuple[float, datetime]], fetched_at: datetime) -> None:
    """Upsert every given quote in one statement. No-op for an empty dict or no database —
    mirrors store_fundamentals; quotes have no TTL-cache tier of their own, only the table."""
    if not is_enabled() or not quotes:
        return

    records = [
        {"ticker": ticker.upper(), "price": price, "as_of": as_of, "fetched_at": fetched_at}
        for ticker, (price, as_of) in quotes.items()
    ]

    with session() as db:
        dialect = db.get_bind().dialect.name
        insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
        stmt = insert_fn(TickerQuote).values(records)
        stmt = stmt.on_conflict_do_update(
            index_elements=["ticker"],
            set_={
                "price": stmt.excluded.price,
                "as_of": stmt.excluded.as_of,
                "fetched_at": stmt.excluded.fetched_at,
            },
        )
        db.execute(stmt)


def _fetched_at_as_utc(dt: datetime | None) -> datetime | None:
    """Postgres round-trips a DateTime(timezone=True) column as tz-aware; SQLite (used in
    tests) hands it back naive. fetched_at is always written as datetime.now(timezone.utc)
    (see store_quotes), so its wall-clock numbers are genuinely UTC even after SQLite drops
    the tzinfo — re-attaching UTC here is a safe relabel, not a guess. as_of is NOT put
    through this: it comes from yfinance's own bar timestamp, whose tz this module does not
    control, so relabeling a naive as_of as UTC could silently be wrong."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def get_quotes(tickers: list[str]) -> dict[str, dict]:
    """One query for every requested ticker's current quote. A ticker with no stored quote is
    simply absent from the returned dict, not an error."""
    if not is_enabled() or not tickers:
        return {}

    keys = [t.upper() for t in tickers]
    with session() as db:
        rows = db.execute(select(TickerQuote).where(TickerQuote.ticker.in_(keys))).scalars().all()
        return {
            row.ticker: {
                "price": row.price,
                "as_of": row.as_of,
                "fetched_at": _fetched_at_as_utc(row.fetched_at),
            }
            for row in rows
        }


def _looks_like_ohlcv(df: pd.DataFrame) -> bool:
    """True when df has at least one recognizable OHLCV column, lowercase or not."""
    lowered = {str(col).lower() for col in df.columns}
    return bool(lowered & set(_OHLCV_COLUMNS))


def _normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """Canonicalize any caller-shaped OHLCV frame to the DataFrame contract: a DatetimeIndex
    named 'date' at datetime64[us] resolution, and all six canonical columns — open, high,
    low, close, adj_close, volume — always present in that order, float64 for the five price
    columns and nullable Int64 for volume. A caller that omits adj_close (or any other
    column) gets it back filled with NA, not dropped: `_read_from_db` always returns six
    columns because they always exist as table columns, so filtering down to only the
    columns a caller happened to supply would make a TTL read and a database read disagree
    in shape — the exact bug the 0004 audit rejected, reintroduced one column later.

    yfinance's `auto_adjust=False` output uses index name 'Date' at datetime64[s], and names
    the adjusted-close column literally 'Adj Close' — lowercasing alone yields 'adj close',
    not 'adj_close', so both spaces and hyphens are mapped to underscores here."""
    out = df.copy()
    out.columns = [str(col).lower().replace(" ", "_").replace("-", "_") for col in out.columns]
    out.index = pd.DatetimeIndex(out.index).astype("datetime64[us]")
    out.index.name = "date"

    out = out.reindex(columns=list(_OHLCV_COLUMNS))

    for col in ("open", "high", "low", "close", "adj_close"):
        out[col] = out[col].astype("float64")
    out["volume"] = out["volume"].astype("Int64")

    return out


def _read_from_db(ticker: str) -> pd.DataFrame | None:
    with session() as db:
        rows = (
            db.execute(select(PriceBar).where(PriceBar.ticker == ticker).order_by(PriceBar.date))
            .scalars()
            .all()
        )
        if not rows:
            return None

        data = {
            "date": [row.date for row in rows],
            "open": [row.open for row in rows],
            "high": [row.high for row in rows],
            "low": [row.low for row in rows],
            "close": [row.close for row in rows],
            "adj_close": [row.adj_close for row in rows],
            "volume": [row.volume for row in rows],
        }

    df = pd.DataFrame(data).set_index("date")
    return _normalize_ohlcv(df)


def _write_to_db(ticker: str, df: pd.DataFrame) -> None:
    if df.empty:
        return

    records = []
    for idx, row in df.iterrows():
        bar_date = idx.date() if hasattr(idx, "date") else idx
        records.append(
            {
                "ticker": ticker,
                "date": bar_date,
                "open": _clean(row.get("open"), float),
                "high": _clean(row.get("high"), float),
                "low": _clean(row.get("low"), float),
                "close": _clean(row.get("close"), float),
                "adj_close": _clean(row.get("adj_close"), float),
                "volume": _clean(row.get("volume"), int),
            }
        )

    with session() as db:
        dialect = db.get_bind().dialect.name
        insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
        stmt = insert_fn(PriceBar).values(records)
        set_ = {col: getattr(stmt.excluded, col) for col in _OHLCV_COLUMNS}
        set_["updated_at"] = func.now()
        stmt = stmt.on_conflict_do_update(index_elements=["ticker", "date"], set_=set_)
        db.execute(stmt)


def _clean(value, cast):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return cast(value)
