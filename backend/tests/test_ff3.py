import io
import zipfile
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

import app.ff3 as ff3
from app.db import get_engine, session
from app.ff3 import (
    FF3DataError,
    FactorRow,
    extract_ff3_csv,
    load_factors,
    needs_ff3_refresh,
    parse_ff3_csv,
    run_ff3_refresh_if_due,
    validate_rows,
)
from app.models import Base, FF3Factor, JobRun

CSV = (
    "This file was created by using the 202608 CRSP database.\r\nThe Tbill return is the simple daily rate.\r\n\r\n"
    ",Mkt-RF,SMB,HML,RF\r\n19991231,    0.50,    0.10,   -0.20,    0.02\r\n"
    "20000103,   -0.71,    0.53,   -0.48,    0.02\r\n20260831,   -0.33,   -0.02,   -0.39,    0.01\r\n\r\n"
    "Copyright 2026 Eugene F. Fama and Kenneth R. French\r\n"
)
NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


def make_zip(name: str = "F-F_Research_Data_Factors_daily.csv", text: str = CSV) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(name, text)
    return buffer.getvalue()


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/ff3.db")
    Base.metadata.create_all(get_engine())


def seed(day: date, mkt_rf: float = 0.01) -> None:
    with session() as db:
        db.add(FF3Factor(date=day, mkt_rf=mkt_rf, smb=0.0, hml=0.0, rf=0.0001))


def latest_run() -> dict:
    with session() as db:
        row = db.execute(select(JobRun).order_by(JobRun.id.desc()).limit(1)).scalars().first()
        return {column.name: getattr(row, column.name) for column in JobRun.__table__.columns}


def claim():
    return ff3._get_state(ff3.FF3_REFRESH_KEY)


def test_parse_keeps_only_data_rows_from_2000():
    rows = parse_ff3_csv(CSV)
    assert [row.date for row in rows] == [date(2000, 1, 3), date(2026, 8, 31)]
    assert (rows[0].mkt_rf, rows[0].smb, rows[0].hml, rows[0].rf) == pytest.approx((-0.0071, 0.0053, -0.0048, 0.0002))
    assert (rows[1].mkt_rf, rows[1].smb, rows[1].hml, rows[1].rf) == pytest.approx((-0.0033, -0.0002, -0.0039, 0.0001))


def test_extract_round_trips_and_rejects_non_csv():
    assert extract_ff3_csv(make_zip()) == CSV
    with pytest.raises(FF3DataError):
        extract_ff3_csv(make_zip(name="readme.txt"))


def test_validate_rejects_too_few_rows():
    with pytest.raises(FF3DataError):
        validate_rows(parse_ff3_csv(CSV), date(2026, 10, 4))


def test_validate_rejects_stale_data(monkeypatch):
    monkeypatch.setattr(ff3, "MIN_ROWS", 1)
    with pytest.raises(FF3DataError):
        validate_rows(parse_ff3_csv(CSV)[:1], date(2026, 10, 4))


def test_validate_rejects_implausible_value(monkeypatch):
    monkeypatch.setattr(ff3, "MIN_ROWS", 1)
    with pytest.raises(FF3DataError):
        validate_rows([FactorRow(date(2026, 9, 30), 0.6, 0.0, 0.0, 0.0001)], date(2026, 10, 4))


@pytest.mark.parametrize(
    ("age", "has_rows", "expected"),
    [
        (None, True, True),
        (timedelta(hours=2), False, False),
        (timedelta(days=2), False, True),
        (timedelta(days=2), True, False),
        (timedelta(days=7), True, True),
        (timedelta(days=30), True, True),
    ],
)
def test_needs_refresh(age, has_rows, expected):
    last = None if age is None else NOW - age
    assert needs_ff3_refresh(last, has_rows, NOW) is expected


def test_refresh_success(db_mode, monkeypatch):
    monkeypatch.setattr(ff3, "MIN_ROWS", 1)
    run_ff3_refresh_if_due(NOW, download=make_zip)
    assert len(load_factors()) == 2
    assert claim() == NOW
    run = latest_run()
    assert run["job_name"] == "ff3_refresh" and run["status"] == "success"
    assert run["detail"] == {"rows": 2, "last_date": "2026-08-31"}


def test_refresh_not_due_does_nothing(db_mode):
    ff3._set_state(ff3.FF3_REFRESH_KEY, NOW - timedelta(days=3))
    seed(date(2026, 8, 1))

    def boom() -> bytes:
        raise AssertionError("download must not be called")

    run_ff3_refresh_if_due(NOW, download=boom)
    assert claim() == NOW - timedelta(days=3)
    assert len(load_factors()) == 1


def test_refresh_download_failure_keeps_rows(db_mode):
    seed(date(2026, 8, 1))

    def fail() -> bytes:
        raise OSError("network down")

    run_ff3_refresh_if_due(NOW, download=fail)
    assert len(load_factors()) == 1
    assert latest_run()["status"] == "failure"
    assert claim() == NOW


def test_refresh_invalid_data_keeps_rows(db_mode):
    seed(date(2026, 8, 1))
    run_ff3_refresh_if_due(NOW, download=make_zip)
    assert len(load_factors()) == 1
    assert latest_run()["status"] == "failure"


def test_refresh_replaces_rows_and_load_shape(db_mode, monkeypatch):
    monkeypatch.setattr(ff3, "MIN_ROWS", 1)
    seed(date(2000, 1, 3), mkt_rf=0.9)
    seed(date(2010, 6, 1))
    run_ff3_refresh_if_due(NOW, download=make_zip)
    frame = load_factors()
    assert len(frame) == 2
    assert list(frame.columns) == ["mkt_rf", "smb", "hml", "rf"]
    assert list(frame.index) == [date(2000, 1, 3), date(2026, 8, 31)]
    assert frame.loc[date(2000, 1, 3), "mkt_rf"] == pytest.approx(-0.0071)


def test_refresh_without_database_is_a_no_op():
    def boom() -> bytes:
        raise AssertionError("download must not be called")

    run_ff3_refresh_if_due(NOW, download=boom)
