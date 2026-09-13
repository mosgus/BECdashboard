import pandas as pd
from cachetools import TTLCache
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db import is_enabled, session
from app.models import PriceBar

_cache = TTLCache(maxsize=512, ttl=86400)

_OHLCV_COLUMNS = ("open", "high", "low", "close", "volume")


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
    the OHLCV shape has a database table to normalize against."""
    key = ticker.upper()
    normalized = _normalize_ohlcv(df) if _looks_like_ohlcv(df) else df
    _cache[key] = normalized

    if is_enabled():
        _write_to_db(key, normalized)


def clear() -> None:
    """Drop all cached entries. Exists for tests; do not call from app code.
    Clears only the in-process cache — never touches the database."""
    _cache.clear()


def _looks_like_ohlcv(df: pd.DataFrame) -> bool:
    """True when df has at least one recognizable OHLCV column, lowercase or not."""
    lowered = {str(col).lower() for col in df.columns}
    return bool(lowered & set(_OHLCV_COLUMNS))


def _normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """Canonicalize any caller-shaped OHLCV frame to the DataFrame contract: a DatetimeIndex
    named 'date' at datetime64[us] resolution, lowercase open/high/low/close as float64, and
    volume as nullable Int64. yfinance, for example, hands back index name 'Date' at
    datetime64[s] with int64 volume — this is the one place that gets normalized, so every
    other codepath (TTL cache, database round trip) can assume the contract already holds."""
    out = df.copy()
    out.columns = [str(col).lower() for col in out.columns]
    out = out[[col for col in _OHLCV_COLUMNS if col in out.columns]]
    out.index = pd.DatetimeIndex(out.index).astype("datetime64[us]")
    out.index.name = "date"
    for col in ("open", "high", "low", "close"):
        if col in out.columns:
            out[col] = out[col].astype("float64")
    if "volume" in out.columns:
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
