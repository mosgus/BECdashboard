"""Real yfinance shapes, captured live on 2026-09-13 against yfinance 1.7.0 (matching
REBUILD.md's measurements) so tests exercise actual API shapes rather than idealized ones.
No network access happens when this module is imported — these are plain literals."""

import pandas as pd

# yf.Ticker("AAPL").info — a full equity. 187 keys measured; only the ones
# extract_fundamentals() maps are reproduced here.
AAPL_INFO = {
    "shortName": "Apple Inc.",
    "longName": "Apple Inc.",
    "sector": "Technology",
    "industry": "Consumer Electronics",
    "currency": "USD",
    "exchange": "NMS",
    "quoteType": "EQUITY",
    "regularMarketPrice": 332.27,
    "previousClose": 326.57,
    "marketCap": 4849207869440,
    "trailingPE": 38.148106,
    "forwardPE": 34.703167,
    "dividendYield": 0.33,
    "fiftyTwoWeekHigh": 344.57,
    "fiftyTwoWeekLow": 235.03,
    "beta": 1.085,
    "averageVolume": 54055456,
    "currentPrice": 332.27,
}

# yf.Ticker("SPY").info — an ETF. 103 keys measured (vs ~180 for AAPL). sector, industry,
# marketCap, forwardPE, beta, and currentPrice are genuinely absent, not None-valued —
# omitted here to match, not set to None.
SPY_INFO = {
    "shortName": "State Street SPDR S&P 500 ETF T",
    "longName": "State Street SPDR S&P 500 ETF Trust",
    "currency": "USD",
    "exchange": "PCX",
    "quoteType": "ETF",
    "regularMarketPrice": 764.29,
    "previousClose": 757.83,
    "trailingPE": 24.69397,
    "dividendYield": 0.98,
    "fiftyTwoWeekHigh": 779.37,
    "fiftyTwoWeekLow": 629.28,
    "averageVolume": 47041785,
}

# yf.Ticker("TSLA").info — an equity with no dividendYield key at all (non-payer; the key
# is omitted, not set to 0).
TSLA_INFO = {
    "shortName": "Tesla, Inc.",
    "longName": "Tesla, Inc.",
    "sector": "Consumer Cyclical",
    "industry": "Auto Manufacturers",
    "currency": "USD",
    "exchange": "NMS",
    "quoteType": "EQUITY",
    "regularMarketPrice": 365.44,
    "previousClose": 363.56,
    "marketCap": 1443322658816,
    "trailingPE": 332.21817,
    "forwardPE": 169.29648,
    "fiftyTwoWeekHigh": 498.83,
    "fiftyTwoWeekLow": 297.38,
    "beta": 1.845,
    "averageVolume": 40482440,
    "currentPrice": 365.44,
}

# yf.Ticker("NOTAREALTICKER").info — an invalid symbol. Does not raise; logs an HTTP 404
# to stderr and returns exactly this.
INVALID_INFO = {"trailingPegRatio": None}


def _build_aapl_history_raw() -> pd.DataFrame:
    """yf.download("AAPL", start="2024-01-02", end="2024-01-10", auto_adjust=False,
    progress=False, threads=False) — captured live. MultiIndex columns (names
    ["Price", "Ticker"]), index named "Date" at datetime64[s], Volume as int64."""
    dates = pd.DatetimeIndex(
        ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09"],
        name="Date",
    ).astype("datetime64[s]")

    columns = pd.MultiIndex.from_tuples(
        [
            ("Adj Close", "AAPL"),
            ("Close", "AAPL"),
            ("High", "AAPL"),
            ("Low", "AAPL"),
            ("Open", "AAPL"),
            ("Volume", "AAPL"),
        ],
        names=["Price", "Ticker"],
    )

    data = {
        ("Adj Close", "AAPL"): [
            183.4040069580078,
            182.03074645996094,
            179.71896362304688,
            178.99774169921875,
            183.3249969482422,
            182.9100341796875,
        ],
        ("Close", "AAPL"): [
            185.63999938964844,
            184.25,
            181.91000366210938,
            181.17999267578125,
            185.55999755859375,
            185.13999938964844,
        ],
        ("High", "AAPL"): [
            188.44000244140625,
            185.8800048828125,
            183.08999633789062,
            182.75999450683594,
            185.60000610351562,
            185.14999389648438,
        ],
        ("Low", "AAPL"): [
            183.88999938964844,
            183.42999267578125,
            180.8800048828125,
            180.1699981689453,
            181.5,
            182.72999572753906,
        ],
        ("Open", "AAPL"): [
            187.14999389648438,
            184.22000122070312,
            182.14999389648438,
            181.99000549316406,
            182.08999633789062,
            183.9199981689453,
        ],
        ("Volume", "AAPL"): [82488700, 58414500, 71983600, 62379700, 59144500, 42841800],
    }

    df = pd.DataFrame(data, index=dates, columns=columns)
    df[("Volume", "AAPL")] = df[("Volume", "AAPL")].astype("int64")
    return df


AAPL_HISTORY_RAW = _build_aapl_history_raw()
