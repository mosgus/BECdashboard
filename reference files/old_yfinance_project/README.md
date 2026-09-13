# YF DataGrabber

YF DataGrabber is a CLI utility that downloads historical stock price data (OHLCV + Adj Close) from Yahoo Finance and maintains a local CSV cache in the `yf/` directory. It minimizes unnecessary API calls by only fetching data you don't already have.

**Usage**
```bash
# Single ticker
python YF.py AAPL                           # YTD start date (default)
python YF.py AAPL 2020-01-01               # custom start date

# Multiple tickers
python YF.py AAPL,MSFT,GOOG               # comma-separated
python YF.py AAPL MSFT GOOG               # space-separated

# Ticker file (one ticker per line or CSV with Ticker column)
python YF.py ./argfiles/sp500_tickers.txt              # YTD start
python YF.py ./argfiles/sp500_tickers.txt 2020-01-01  # custom start
python YF.py ./argfiles/DJIA_constituents.csv 2020-01-01
```

The end date is always yesterday. Start dates are flexible — `YYYY-MM-DD`, `YY-MM-DD`, or with `/` separators all work. All dates are snapped to the nearest NYSE trading day so weekends and holidays are handled automatically.

**How the caching works**

When you request a ticker, the script checks whether `yf/<TICKER>.csv` already exists:

*No existing CSV* — A fresh download is performed for the full requested date range and saved to `yf/<TICKER>.csv`.

*Existing CSV* — The script reads the cached date range and only fetches what's missing:
- **No start date given:** Appends from the day after the last cached date through the most recent trading day. If the cache is already up to date, it's a no-op.
- **Start date within cached range:** Skips the ticker entirely (data already covered).
- **Start date before cached range:** Prepends the earlier data and appends any newer data, then stitches `[prepend + existing + append]` into a single file, deduplicating by date.

**Ticker input formats**
- Single ticker: `AAPL`
- Multiple tickers (comma or space separated): `AAPL,MSFT,GOOG` or `AAPL MSFT GOOG`
- TXT file: One ticker per line (e.g. `argfiles/sp500_tickers.txt`)
- CSV file: Must have a `Ticker` column header; if none is found, all cell values are used (e.g. `argfiles/DJIA_constituents.csv`)

Tickers containing a `.` (e.g. `BRK.B`) are automatically converted to `-` (e.g. `BRK-B`) for Yahoo Finance compatibility. The saved CSV uses the converted name.

All tickers are validated against Yahoo Finance before any data is fetched. Invalid symbols are reported and skipped.

**Included argfiles**
| File | Contents |
|------|----------|
| `argfiles/sp500_tickers.txt` | S&P 500 tickers, one per line |
| `argfiles/DJIA_constituents.csv` | Dow Jones 30 tickers with company names |
| `argfiles/test.txt` | Single ticker (`SPY`) for quick testing |

**Output**
- CSVs are written to `yf/` as `<TICKER>.csv` with columns: `Date, Open, High, Low, Close, Adj Close, Volume`.
- Float values are stored with high precision (`%.14f`) to survive round-trip reads without drift.

**Requirements**
- Python 3.12+
- `yfinance`, `pandas`, `numpy`, `pandas_market_calendars`

**Install**
```bash
pip install yfinance pandas numpy pandas_market_calendars
```
