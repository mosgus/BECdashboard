"""Ken French's daily Fama-French 3 factors, stored in ff3_factors (contract 0167).

The file is downloaded in the background (never inside a request), validated, and replaces the
table in one transaction, so a bad download leaves the previous rows in place."""

from __future__ import annotations

import io
import logging
import math
import threading
import urllib.request
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import pandas as pd
from sqlalchemy import delete, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db import is_enabled, session
from app.jobrun import record_run
from app.models import AppState, FF3Factor

logger = logging.getLogger(__name__)

FF3_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip"
FF3_START = date(2000, 1, 1)
FF3_REFRESH_KEY = "ff3_refresh"  # app_state key
FF3_JOB_NAME = "ff3_refresh"  # job_runs.job_name
MIN_ROWS = 5000
MAX_STALENESS_DAYS = 120
RETRY_AFTER = timedelta(days=1)
REFRESH_EVERY = timedelta(days=7)

_LOCK = threading.Lock()


class FF3DataError(ValueError):
    """The downloaded factor file is missing, malformed or implausible."""


@dataclass(frozen=True)
class FactorRow:
    date: date
    mkt_rf: float
    smb: float
    hml: float
    rf: float


def download_ff3_zip() -> bytes:
    request = urllib.request.Request(FF3_URL, headers={"User-Agent": "blue-eagle/1.0"})
    return urllib.request.urlopen(request, timeout=30).read()


def extract_ff3_csv(zip_bytes: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if not names:
            raise FF3DataError("The Fama-French download contains no .csv file.")
        return archive.read(names[0]).decode("latin-1")


def parse_ff3_csv(text: str) -> list[FactorRow]:
    rows: list[FactorRow] = []
    for line in text.splitlines():
        fields = [field.strip() for field in line.strip().split(",")]
        if len(fields) < 5 or len(fields[0]) != 8 or not fields[0].isascii() or not fields[0].isdigit():
            continue
        day = date(int(fields[0][:4]), int(fields[0][4:6]), int(fields[0][6:]))
        if day < FF3_START:
            continue
        mkt_rf, smb, hml, rf = (float(value) / 100 for value in fields[1:5])
        rows.append(FactorRow(day, mkt_rf, smb, hml, rf))
    rows.sort(key=lambda row: row.date)
    return rows


def validate_rows(rows: list[FactorRow], today: date) -> None:
    if len(rows) < MIN_ROWS:
        raise FF3DataError(f"Only {len(rows)} factor rows; expected at least {MIN_ROWS}.")
    newest = rows[-1].date
    if (today - newest).days > MAX_STALENESS_DAYS:
        raise FF3DataError(f"Factor data ends on {newest}, more than {MAX_STALENESS_DAYS} days ago.")
    for row in rows:
        for value in (row.mkt_rf, row.smb, row.hml, row.rf):
            if not math.isfinite(value) or abs(value) >= 0.5:
                raise FF3DataError(f"Implausible factor value {value} on {row.date}.")


def store_rows(rows: list[FactorRow]) -> None:
    with session() as db:
        db.execute(delete(FF3Factor))
        db.execute(
            insert(FF3Factor),
            [{"date": r.date, "mkt_rf": r.mkt_rf, "smb": r.smb, "hml": r.hml, "rf": r.rf} for r in rows],
        )


def load_factors() -> pd.DataFrame:
    columns = ["mkt_rf", "smb", "hml", "rf"]
    with session() as db:
        found = db.execute(
            select(FF3Factor.date, FF3Factor.mkt_rf, FF3Factor.smb, FF3Factor.hml, FF3Factor.rf).order_by(
                FF3Factor.date
            )
        ).all()
    if not found:
        return pd.DataFrame(columns=columns, dtype=float)
    return pd.DataFrame(
        [[row.mkt_rf, row.smb, row.hml, row.rf] for row in found],
        index=[row.date for row in found],
        columns=columns,
        dtype=float,
    )


def needs_ff3_refresh(last_claim_at: datetime | None, has_rows: bool, now_utc: datetime) -> bool:
    if last_claim_at is None:
        return True
    if now_utc - last_claim_at < RETRY_AFTER:
        return False
    if not has_rows:
        return True
    return now_utc - last_claim_at >= REFRESH_EVERY


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite hands a DateTime(timezone=True) column back naive; value_at is always written as UTC,
    so relabelling is safe (same reasoning as app/autorefresh.py)."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _get_state(key: str) -> datetime | None:
    with session() as db:
        row = db.get(AppState, key)
        return _as_utc(row.value_at) if row is not None else None


def _set_state(key: str, value_at: datetime) -> None:
    with session() as db:
        dialect = db.get_bind().dialect.name
        insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
        stmt = insert_fn(AppState).values(key=key, value_at=value_at)
        stmt = stmt.on_conflict_do_update(index_elements=["key"], set_={"value_at": stmt.excluded.value_at})
        db.execute(stmt)


def run_ff3_refresh_if_due(now_utc: datetime, *, download: Callable[[], bytes] = download_ff3_zip) -> None:
    """Triggered from GET /universe/strip. Claims app_state["ff3_refresh"] before any work, so a
    failed download waits RETRY_AFTER rather than being retried on every page load. Never raises:
    record_run stores the failure and re-raises, and a background task must not."""
    if not _LOCK.acquire(blocking=False):
        return
    try:
        if not is_enabled():
            return
        with session() as db:
            has_rows = db.execute(select(FF3Factor.date).limit(1)).first() is not None
        if not needs_ff3_refresh(_get_state(FF3_REFRESH_KEY), has_rows, now_utc):
            return
        _set_state(FF3_REFRESH_KEY, now_utc)
        try:
            with record_run(FF3_JOB_NAME, now_utc) as detail:
                rows = parse_ff3_csv(extract_ff3_csv(download()))
                validate_rows(rows, now_utc.date())
                store_rows(rows)
                detail["rows"] = len(rows)
                detail["last_date"] = rows[-1].date.isoformat()
        except Exception:
            logger.exception("app.ff3: Fama-French refresh failed")
    finally:
        _LOCK.release()
