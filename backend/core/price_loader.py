"""yfinance OHLCV ingestion into the price_history table.

Functions:
  fetch_ohlcv          — download OHLCV+Adj Close from yfinance
  upsert_price_bars    — bulk upsert into price_history (PostgreSQL ON CONFLICT)
  get_price_coverage   — min/max dates stored for a ticker
  read_price_bars      — read adjusted close prices for analytics (DB-backed)
  refresh_all_prices   — orchestrate incremental or backfill refresh
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import pandas as pd
import yfinance as yf
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from db.models import PriceBar, UniverseTicker

BATCH_SIZE = 10


# ── yfinance fetch ────────────────────────────────────────────────────────────

def fetch_ohlcv(
    tickers: list[str],
    start: str,
    end: str,
) -> dict[str, pd.DataFrame]:
    """Download OHLCV + Adj Close for each ticker from yfinance.

    Returns a dict {ticker: DataFrame[open, high, low, close, adj_close, volume]}.
    Missing/failed tickers are omitted.
    """
    if not tickers:
        return {}

    try:
        raw = yf.download(
            list(tickers),
            start=start,
            end=end,
            auto_adjust=False,    # so we get both Close + Adj Close
            progress=False,
            threads=True,
            group_by="ticker" if len(tickers) > 1 else "column",
        )
    except Exception:
        return {}

    if raw is None or raw.empty:
        return {}

    out: dict[str, pd.DataFrame] = {}

    if len(tickers) == 1:
        t = tickers[0]
        # Single ticker returns flat columns
        df = pd.DataFrame({
            "open":      raw.get("Open"),
            "high":      raw.get("High"),
            "low":       raw.get("Low"),
            "close":     raw.get("Close"),
            "adj_close": raw.get("Adj Close"),
            "volume":    raw.get("Volume"),
        })
        df = df.dropna(how="all")
        if not df.empty:
            out[t] = df
        return out

    # Multi-ticker: raw has MultiIndex columns (ticker, field) when group_by="ticker"
    for t in tickers:
        if t not in raw.columns.get_level_values(0):
            continue
        sub = raw[t]
        df = pd.DataFrame({
            "open":      sub.get("Open"),
            "high":      sub.get("High"),
            "low":       sub.get("Low"),
            "close":     sub.get("Close"),
            "adj_close": sub.get("Adj Close"),
            "volume":    sub.get("Volume"),
        })
        df = df.dropna(how="all")
        if not df.empty:
            out[t] = df

    return out


# ── DB upsert ────────────────────────────────────────────────────────────────

def upsert_price_bars(db: Session, records: list[dict]) -> int:
    """Bulk upsert OHLCV bars. Records must have: ticker, date, open, high, low, close, adj_close, volume.

    Returns number of rows processed.
    """
    if not records:
        return 0

    stmt = pg_insert(PriceBar).values(records)
    stmt = stmt.on_conflict_do_update(
        index_elements=["ticker", "date"],
        set_={
            "open":      stmt.excluded.open,
            "high":      stmt.excluded.high,
            "low":       stmt.excluded.low,
            "close":     stmt.excluded.close,
            "adj_close": stmt.excluded.adj_close,
            "volume":    stmt.excluded.volume,
        },
    )
    db.execute(stmt)
    db.commit()
    return len(records)


def df_to_records(ticker: str, df: pd.DataFrame) -> list[dict]:
    """Convert a yfinance OHLCV DataFrame into insert-ready dicts."""
    records: list[dict] = []
    for idx, row in df.iterrows():
        d = idx.date() if hasattr(idx, "date") else idx
        rec = {
            "ticker": ticker,
            "date": d,
            "open":      _safe_float(row.get("open")),
            "high":      _safe_float(row.get("high")),
            "low":       _safe_float(row.get("low")),
            "close":     _safe_float(row.get("close")),
            "adj_close": _safe_float(row.get("adj_close")),
            "volume":    _safe_int(row.get("volume")),
        }
        if rec["close"] is None and rec["adj_close"] is None:
            continue
        records.append(rec)
    return records


def _safe_float(v) -> float | None:
    try:
        if v is None or pd.isna(v):
            return None
        return float(v)
    except Exception:
        return None


def _safe_int(v) -> int | None:
    try:
        if v is None or pd.isna(v):
            return None
        return int(v)
    except Exception:
        return None


# ── DB queries ───────────────────────────────────────────────────────────────

def get_price_coverage(db: Session, ticker: str) -> tuple[Optional[date], Optional[date]]:
    """Return (min_date, max_date) stored for a ticker, or (None, None)."""
    row = db.execute(
        select(func.min(PriceBar.date), func.max(PriceBar.date))
        .where(PriceBar.ticker == ticker)
    ).one_or_none()
    if not row or row[0] is None:
        return (None, None)
    return (row[0], row[1])


def read_price_bars(
    db: Session,
    tickers: list[str],
    start: str,
    end: str,
) -> pd.DataFrame:
    """Read adjusted close prices from DB. Returns DataFrame[date x ticker].

    Mirrors the shape returned by core/cache.py::fetch_prices.
    """
    if not tickers:
        return pd.DataFrame()

    rows = db.execute(
        select(PriceBar.ticker, PriceBar.date, PriceBar.adj_close, PriceBar.close)
        .where(PriceBar.ticker.in_(tickers))
        .where(PriceBar.date >= start)
        .where(PriceBar.date <= end)
        .order_by(PriceBar.date)
    ).all()

    if not rows:
        return pd.DataFrame()

    # Prefer adj_close; fall back to close
    data = [
        {
            "ticker": r.ticker,
            "date": r.date,
            "price": r.adj_close if r.adj_close is not None else r.close,
        }
        for r in rows
    ]
    df = pd.DataFrame(data)
    pivot = df.pivot(index="date", columns="ticker", values="price")
    pivot.index = pd.to_datetime(pivot.index)
    return pivot.sort_index()


# ── Refresh orchestrator ─────────────────────────────────────────────────────

def _active_tickers(db: Session) -> list[str]:
    rows = (
        db.query(UniverseTicker.ticker)
        .filter(UniverseTicker.active == True)
        .order_by(UniverseTicker.ticker)
        .all()
    )
    return [r[0] for r in rows]


def _determine_start(db: Session, ticker: str, backfill_years: Optional[int]) -> date:
    """Decide how far back to start for a ticker.

    If backfill_years given → today - N years (force backfill, overwrite existing).
    Else → max_stored_date + 1 day (incremental). This picks up ALL missed days
    since the last run, so a 4-day gap (laptop off) gets backfilled in full.
    If no data yet → 10 years back.
    """
    today = date.today()
    if backfill_years:
        return today - timedelta(days=backfill_years * 365)

    _, max_date = get_price_coverage(db, ticker)
    if max_date is None:
        return today - timedelta(days=10 * 365)
    return max_date + timedelta(days=1)


def refresh_all_prices(
    db: Session,
    tickers: Optional[list[str]] = None,
    backfill_years: Optional[int] = None,
    progress_cb=None,
) -> dict:
    """Refresh price_history for active universe tickers.

    Gap-aware: starts from max_stored_date + 1 per ticker, so any missed days
    (e.g. laptop off for 4 days) are filled automatically on the next run.

    Args:
        tickers:         override ticker list; None = all active
        backfill_years:  force a full N-year refetch; None = incremental only
        progress_cb:     optional callable(batch_index, batch_tickers, msg) for logging

    Returns:
        {tickers_processed, batches, rows_upserted, errors, elapsed_s}
    """
    import time
    t_start = time.monotonic()
    today = date.today()

    ticker_list = tickers if tickers else _active_tickers(db)
    if not ticker_list:
        return {
            "tickers_processed": 0,
            "batches": 0,
            "rows_upserted": 0,
            "errors": [],
            "elapsed_s": 0.0,
        }

    total_rows = 0
    errors: list[str] = []
    batches = 0

    for i in range(0, len(ticker_list), BATCH_SIZE):
        batch = ticker_list[i:i + BATCH_SIZE]
        batch_starts = {t: _determine_start(db, t, backfill_years) for t in batch}

        # Skip fully up-to-date batches (all tickers have today's bar already)
        if all(s >= today for s in batch_starts.values()):
            if progress_cb:
                progress_cb(i, batch, "already up to date")
            continue

        batch_start = min(batch_starts.values())
        batch_end = today + timedelta(days=1)  # yfinance end is exclusive
        batches += 1

        if progress_cb:
            progress_cb(i, batch, f"fetching from {batch_start}")

        try:
            ohlcv_map = fetch_ohlcv(batch, batch_start.isoformat(), batch_end.isoformat())
        except Exception as exc:
            errors.append(f"Batch fetch failed for {batch}: {exc}")
            continue

        batch_rows = 0
        for t in batch:
            if t not in ohlcv_map:
                continue
            df = ohlcv_map[t]
            df = df[df.index.date >= batch_starts[t]]
            records = df_to_records(t, df)
            if not records:
                continue
            try:
                n = upsert_price_bars(db, records)
                batch_rows += n
            except Exception as exc:
                errors.append(f"Upsert failed for {t}: {exc}")
                db.rollback()

        total_rows += batch_rows
        if progress_cb:
            progress_cb(i, batch, f"upserted {batch_rows} rows")

    return {
        "tickers_processed": len(ticker_list),
        "batches": batches,
        "rows_upserted": total_rows,
        "errors": errors,
        "elapsed_s": round(time.monotonic() - t_start, 2),
    }
