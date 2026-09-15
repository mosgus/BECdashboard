"""Renders a stored OHLCV price-history frame as CSV text, byte-compatible with what
`reference files/old_yfinance_project/YF.py` produced — same header names, same column order,
same 14-decimal float precision — so exported files are interchangeable with whatever already
exists on disk. Pure: no I/O, no network, no database."""

import io
import zipfile

import pandas as pd

CSV_COLUMNS = ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]

_RENAME = {
    "open": "Open",
    "high": "High",
    "low": "Low",
    "close": "Close",
    "adj_close": "Adj Close",
    "volume": "Volume",
}


def history_to_csv(df: pd.DataFrame) -> str:
    """Render a stored OHLCV frame as YF.py-compatible CSV text.

    date leaves the index and becomes the first column, formatted YYYY-MM-DD with no time
    component. Prices render at YF.py's own %.14f precision; Volume is nullable Int64 and must
    not be touched by that float formatting — to_csv only applies float_format to float-typed
    columns, so leaving Volume as Int64 all the way to to_csv is what keeps it a plain integer.
    Nulls render as empty fields via to_csv's own default na_rep, never "nan" or "None"."""
    out = pd.DataFrame({"Date": df.index.strftime("%Y-%m-%d")})
    for column, header in _RENAME.items():
        out[header] = df[column].values
    out = out[CSV_COLUMNS]
    return out.to_csv(index=False, header=True, float_format="%.14f")


# A fixed zip-entry timestamp — not "when this ran". writestr's default timestamp is
# time.localtime(), which would make the same input produce different bytes on every call;
# a constant date_time is what makes the archive byte-for-byte reproducible.
_ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)


def build_universe_zip(histories: dict[str, pd.DataFrame]) -> bytes:
    """Zip one CSV per ticker. Keys are uppercase tickers; each becomes TICKER.csv.

    Pure: takes already-loaded frames, returns bytes — no get_cached call, no database, no
    network. Entries are sorted case-insensitively by ticker so the archive is deterministic
    regardless of the caller's dict insertion order, and an empty dict returns a valid,
    empty zip rather than raising or returning b""."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as archive:
        for ticker in sorted(histories, key=str.upper):
            info = zipfile.ZipInfo(f"{ticker.upper()}.csv", date_time=_ZIP_EPOCH)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, history_to_csv(histories[ticker]).encode("utf-8"))
    return buffer.getvalue()
