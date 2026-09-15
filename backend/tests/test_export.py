import numpy as np
import pandas as pd

from app.export import CSV_COLUMNS, history_to_csv


def _frame(dates, opens=None, highs=None, lows=None, closes=None, adj_closes=None, volumes=None) -> pd.DataFrame:
    n = len(dates)
    index = pd.DatetimeIndex(pd.to_datetime(list(dates))).astype("datetime64[us]")
    index.name = "date"
    return pd.DataFrame(
        {
            "open": pd.array(opens if opens is not None else [100.0] * n, dtype="float64"),
            "high": pd.array(highs if highs is not None else [101.0] * n, dtype="float64"),
            "low": pd.array(lows if lows is not None else [99.0] * n, dtype="float64"),
            "close": pd.array(closes if closes is not None else [100.5] * n, dtype="float64"),
            "adj_close": pd.array(adj_closes if adj_closes is not None else [100.5] * n, dtype="float64"),
            "volume": pd.array(volumes if volumes is not None else [1_000_000] * n, dtype="Int64"),
        },
        index=index,
    )


def _empty_frame() -> pd.DataFrame:
    index = pd.DatetimeIndex([], name="date")
    return pd.DataFrame(
        {
            "open": pd.array([], dtype="float64"),
            "high": pd.array([], dtype="float64"),
            "low": pd.array([], dtype="float64"),
            "close": pd.array([], dtype="float64"),
            "adj_close": pd.array([], dtype="float64"),
            "volume": pd.array([], dtype="Int64"),
        },
        index=index,
    )


# --- 1. header row ----------------------------------------------------------------------


def test_header_row_is_exact():
    csv = history_to_csv(_frame(["2016-01-04"]))
    header = csv.splitlines()[0]
    assert header == "Date,Open,High,Low,Close,Adj Close,Volume"
    assert header == ",".join(CSV_COLUMNS)


# --- 2. row count and date format --------------------------------------------------------


def test_known_frame_renders_expected_rows_and_date_format():
    df = _frame(["2016-01-04", "2016-01-05", "2016-01-06"])
    lines = history_to_csv(df).splitlines()
    assert len(lines) == 4  # header + 3 data rows
    assert lines[1].startswith("2016-01-04,")
    assert "00:00:00" not in lines[1]


# --- 3. 14-decimal precision --------------------------------------------------------------


def test_prices_render_at_fourteen_decimal_places():
    # 100.5 is exactly representable in binary64, so this isolates the formatting behaviour
    # (14 digits after the decimal point) from float64's usual representation error.
    df = _frame(
        ["2016-01-04"], opens=[100.5], highs=[100.5], lows=[100.5], closes=[100.5], adj_closes=[100.5]
    )
    data_row = history_to_csv(df).splitlines()[1]
    assert "100.50000000000000" in data_row


# --- 4. Volume renders as a plain integer -------------------------------------------------


def test_volume_renders_as_plain_integer():
    df = _frame(["2016-01-04"], volumes=[1234567])
    data_row = history_to_csv(df).splitlines()[1]
    volume_field = data_row.split(",")[-1]
    assert volume_field == "1234567"
    assert "." not in volume_field


# --- 5. null price renders as an empty field ----------------------------------------------


def test_null_price_renders_as_empty_field():
    df = _frame(["2016-01-04"], opens=[np.nan])
    csv = history_to_csv(df)
    fields = csv.splitlines()[1].split(",")
    assert fields[1] == ""  # Open
    assert "nan" not in csv.lower()
    assert "none" not in csv.lower()


# --- 6. null volume renders as an empty field ---------------------------------------------


def test_null_volume_renders_as_empty_field():
    df = _frame(["2016-01-04"], volumes=[None])
    csv = history_to_csv(df)
    fields = csv.splitlines()[1].split(",")
    assert fields[-1] == ""
    assert "nan" not in csv.lower()


# --- 7. empty input returns only the header row -------------------------------------------


def test_empty_input_returns_only_header_row():
    lines = history_to_csv(_empty_frame()).splitlines()
    assert len(lines) == 1
    assert lines[0] == "Date,Open,High,Low,Close,Adj Close,Volume"
