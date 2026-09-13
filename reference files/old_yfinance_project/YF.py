# YF.py
"""
    Conceived on Mon Sep 8 2025
    Birthed on
    @author: Gunnar B.

    This script prompts the user to input stock ticker symbols separated by commas.
    Each individual ticker is extracted and used to fetch stock data from Yahoo Finance.
    Stock data is processed and saved as CSV files for further analysis.
"""

import datetime
import yfinance as yf
import pandas as pd
import os
import shutil
import numpy as np
import time # for sleep() aesthetic pauses
import argparse
import io
import contextlib
''' ticker inputs'''
def get_tickers():
    tickers = input ("Enter stock ticker(s) separated by commas: ").upper()
    ticker_list = [t.strip() for t in tickers.split(',') if t.strip()] # Separate tickers based on comma
    return ticker_list
''' date inputs '''
def t0_interpret(t0_str):
    t0_str = t0_str.replace('/', '-').replace(' ', '-')
    parts = t0_str.split('-')
    if len(parts) == 3 and len(parts[0]) == 2:
        year = int(parts[0])
        if year > 25:
            year += 1900
        else:
            year += 2000
        t0_str = f"{year:04d}-{parts[1]}-{parts[2]}"
    return datetime.datetime.strptime(t0_str, "%Y-%m-%d")
def get_dates(prompt=""):
    while True:
        t0_str = input(prompt)
        try:
            t0 = t0_interpret(t0_str) # Interpret the input date
            tn = datetime.datetime.today() - datetime.timedelta(days=1)
            if t0 > tn:
                print("Invalid date. Can't look into the future bub.")
                continue
            return t0.strftime("%Y-%m-%d"), tn.strftime("%Y-%m-%d")
            # remove .strftime("%Y-%m-%d") to also return time, but yfinance only needs date
        except ValueError:
            print("Bad format. Use YYYY-MM-DD.")
''' validate symbols/tickers'''
def validate_ticker(ticker):
    try:
        hist = yf.Ticker(ticker).history(period="5d", auto_adjust=False)
        return not hist.empty
    except Exception as e:
        print(f"{ticker}: validation failed ({type(e).__name__}: {e})")
        return False
def validate_tickers(symbols):
    print("Validating all ticks")
    valid_ticks = []
    invalid_ticks = []
    for symbol in symbols:
        if validate_ticker(symbol):
            valid_ticks.append(symbol)
        else:
            invalid_ticks.append(symbol)
    if invalid_ticks:
        print(f"ERROR: Invalid symbol(s) --> {invalid_ticks}")
    if valid_ticks:  # If we have at least one valid symbol, proceed
        print(f"Accepted symbols: {valid_ticks}\n")
    else:
        print("No valid symbols entered. Please try again.")
    return valid_ticks, invalid_ticks
''' Check if ticker data EXISTS in /yf '''
def has_data(symbol):
    return os.path.isfile(os.path.join("yf", f"{symbol}.csv"))
''' Fetch date range for EXISTING ticker '''
def get_CSV_dates(symbol):
    filename = os.path.join("yf", f"{symbol}.csv")
    df = pd.read_csv(filename)
    df['Date'] = pd.to_datetime(df['Date'])
    t0 = df['Date'].min().strftime("%Y-%m-%d")
    tn = df['Date'].max().strftime("%Y-%m-%d")
    return t0, tn
''' Fetch data for NEW ticker '''
def fetch_data(symbol, t0, tn):
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        df = yf.download(symbol, start=t0, end=tn, auto_adjust=False, progress=False)
    yf_output = captured.getvalue()
    if df.empty and "PricesMissingError" in yf_output:
        # Ticker likely IPO'd after t0 — no data in requested range
        print(f"{symbol}: No data from {t0} to {tn} (likely not listed yet). Retrying for earliest available...")
        captured2 = io.StringIO()
        with contextlib.redirect_stdout(captured2), contextlib.redirect_stderr(captured2):
            df = yf.download(symbol, end=tn, auto_adjust=False, progress=False)
        if not df.empty:
            first_date = df.index.min().strftime("%Y-%m-%d")
            print(f"{symbol}: Found data starting from {first_date}.")
        else:
            print(f"{symbol}: No data available before {tn}.")
    elif df.empty:
        # Some other failure — print yfinance's original output so it's not lost
        if yf_output.strip():
            print(yf_output.strip())
    return df
''' Save data as NEW CSV file '''
def save_data(df, symbol):
    if not df.empty:
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)  # flatten

        # Only reset index if Date is still in the index (not already a column)
        if "Date" not in df.columns:
            df = df.reset_index()
        if "Price" in df.columns and "Date" not in df.columns:
            df = df.rename(columns={"Price": "Date"})
        expected = ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]
        keep = [c for c in expected if c in df.columns]
        df = df[keep]

        os.makedirs("yf", exist_ok=True)
        filename = os.path.join("yf", f"{symbol}.csv")
        tmpname = os.path.join("yf", f".{symbol}.csv.tmp")

        # Write with high precision so 1e-5 deltas survive round-trip
        df.to_csv(tmpname, index=False, header=True, float_format="%.14f")

        os.replace(tmpname, filename)  # atomic on POSIX
        print(f"{filename} saved...")
    else:
        print(f"No data found for {symbol}, in given date range.")
''' Handling EXISTING data '''
def cp_del(csv_path: str, symbol: str) -> str:
    """
    Copy csv_path to a timestamped *_OLD.csv, then delete the original.
    Returns the backup file path.
    """
    folder = os.path.dirname(csv_path)
    backup_name = f"{symbol}_OLD.csv"
    backup_path = os.path.join(folder, backup_name)
    if not os.path.isfile(csv_path):
        raise FileNotFoundError(f"Source CSV not found: {csv_path}") # Make sure source exists
    shutil.copy2(csv_path, backup_path)  # Copy with metadata
    os.remove(csv_path) # Remove original
    return backup_path
def validate_CSV_data(dateA, dateZ, symbol):
    """
    Compares CSV close and adj close prices for all quarters between
    dateA and dateZ with current Yahoo Finance data for the same quarters.
    Practically speaking Adj Close is the only one that matters, but Close
    does rarely get corrupted or edited too, so it's worth as a safeguard.
    """
    csv_path = os.path.join("yf", f"{symbol}.csv")
    print(f"Validating data in {csv_path} from {dateA} to {dateZ}...\n")
    start_date = pd.to_datetime(dateA)
    end_date = pd.to_datetime(dateZ)
    # Just check one date in the range
    check_date = pd.to_datetime(dateA).normalize()
    check_dates = pd.DatetimeIndex([check_date])

    # --- CSV Data ---
    csv_df = pd.read_csv(csv_path, parse_dates=["Date"])
    csv_df.set_index("Date", inplace=True)
    print(f"Prices in {symbol}.csv:")
    csv_data = csv_df.loc[csv_df.index.intersection(check_dates), ["Close", "Adj Close"]]
    print(csv_data) # 🖨️

    # --- Yahoo Finance Data ---
    yf_df = yf.download(symbol,start=start_date,end=end_date,auto_adjust=False,group_by="column", progress=False)
    # Just for formatting aesthetics. Removes ticker row if present
    if isinstance(yf_df.columns, pd.MultiIndex):
        try: # Prefer cross-section by ticker; if level name differs, use level index -1
            yf_df = yf_df.xs(symbol, axis=1, level=1)
        except Exception:
            yf_df.columns = yf_df.columns.get_level_values(0)
    yf_df = yf_df[["Close", "Adj Close"]].copy()
    yf_df.index = pd.to_datetime(yf_df.index).normalize()
    yf_df = yf_df.sort_index()
    print(f"Current {symbol} YF prices:")
    yf_data = yf_df.loc[yf_df.index.intersection(check_dates)]
    print(yf_data) # 🖨️

    # --- Check if data matches ---
    csv_data = csv_data.sort_index()
    yf_data = yf_data.sort_index()
    csv_adj = csv_data["Adj Close"].astype(float)
    yf_adj = yf_data["Adj Close"].astype(float)

    tolerance = 0.000001  # tighten as needed 🔑
    comparison = np.isclose(csv_adj, yf_adj, atol=tolerance, rtol=0.0)
    all_match = bool(comparison.all())

    if all_match:
        print(f"\nAdj_Price in {symbol}.csv is VALID by +/- {tolerance} minimum.")
        return True
    else: # Copy's old date as "<symbol>OLD.csv" and prepares new file.
        print(f"\nAdj_Price in {symbol}.csv is OUTDATED by +/- {tolerance} minimum.")
        return False
''' Return today if after NYSE close (4 PM ET), else yesterday '''
def get_effective_end_date():
    from zoneinfo import ZoneInfo
    et_now = datetime.datetime.now(ZoneInfo("America/New_York"))
    if et_now.hour >= 16:
        return et_now.date()
    return (et_now - datetime.timedelta(days=1)).date()

''' Get next trading day after given date '''
import pandas_market_calendars as mcal
nyse = mcal.get_calendar("NYSE")
def get_next_trading_day(date):
    d = pd.to_datetime(date)                          # convert str -> Timestamp
    schedule = nyse.schedule(start_date=d, end_date=d + pd.Timedelta(days=7))
    if schedule.empty:
        raise ValueError(f"No trading days on or after {date}")
    return schedule.index.min().date()                # or .strftime("%Y-%m-%d")
def get_last_trading_day(date):
    d = pd.to_datetime(date)
    schedule = nyse.schedule(start_date=d - pd.Timedelta(days=7), end_date=d)
    if schedule.empty:
        raise ValueError(f"No trading days on or before {date}")
    return schedule.index.max().date()
''' Handle data prepending and/or appending '''
def datapend(dateA, dateZ, tDateA, tDateZ, symbol):
    """
    Given the current CSV range [dateA, dateZ] and the desired trading-day-aligned
    range [tDateA, tDateZ], fetch only the missing edges and stitch them onto the
    existing CSV in /yf/<symbol>.csv.

    Cases:
      - If dateA == tDateA and dateZ == tDateZ -> nothing to do (should be handled earlier).
      - If dateA == tDateA -> append only.
      - If dateZ == tDateZ -> prepend only.
      - Else -> prepend and append.
    """
    csv_path = os.path.join("yf", f"{symbol}.csv")
    if not os.path.isfile(csv_path):
        raise FileNotFoundError(f"Expected existing CSV at {csv_path}")

    # Load existing file
    csv_df = pd.read_csv(csv_path, parse_dates=["Date"])
    csv_df = csv_df.sort_values("Date").reset_index(drop=True)

    # Normalize inputs to strings (YYYY-MM-DD)
    dateA = pd.to_datetime(dateA).strftime("%Y-%m-%d")
    dateZ = pd.to_datetime(dateZ).strftime("%Y-%m-%d")
    tDateA = pd.to_datetime(tDateA).strftime("%Y-%m-%d")
    tDateZ = pd.to_datetime(tDateZ).strftime("%Y-%m-%d")

    need_prepend = (dateA != tDateA)
    need_append  = (dateZ != tDateZ)

    prepend_df = pd.DataFrame()
    append_df  = pd.DataFrame()

    #   yfinance 'end' is exclusive.
    #   PREPEND: [tDateA, dateA-1]  -> fetch_data(symbol, tDateA, end_exclusive=dateA)
    #   APPEND:  [dateZ+1, tDateZ]  -> fetch_data(symbol, start_inclusive=dateZ_plus1, end_exclusive=tDateZ_plus1)

    if need_prepend:
        end_exclusive = pd.to_datetime(dateA).strftime("%Y-%m-%d")
        prepend_df = fetch_data(symbol, tDateA, end_exclusive)

    if need_append:
        start_inclusive = (pd.to_datetime(dateZ) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        end_exclusive = (pd.to_datetime(tDateZ) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        append_df = fetch_data(symbol, start_inclusive, end_exclusive)

    # Normalize fetched frames to match CSV schema
    def _tidy(df):
        if df is None or df.empty:
            return pd.DataFrame()
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df.reset_index()
        if "Price" in df.columns and "Date" not in df.columns:
            df = df.rename(columns={"Price": "Date"})
        cols = ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]
        keep = [c for c in cols if c in df.columns]
        return df[keep]

    prepend_df = _tidy(prepend_df)
    append_df  = _tidy(append_df)

    if prepend_df.empty and append_df.empty:
        print(f"No new data to stitch for {symbol}. CSV is already up to date.")
        return

    # Concatenate [prepend, existing, append], drop dups, sort, save back to /yf/<symbol>.csv
    combined = pd.concat([prepend_df, csv_df, append_df], ignore_index=True)
    # Drop duplicate dates if any overlap occurred
    if "Date" in combined.columns:
        combined["Date"] = pd.to_datetime(combined["Date"])
        combined = combined.sort_values("Date").drop_duplicates(subset=["Date"], keep="last")

    # Enforce canonical column order and precision (same as save_data)
    expected = ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]
    keep = [c for c in expected if c in combined.columns]
    combined = combined[keep]

    os.makedirs("yf", exist_ok=True)
    combined.to_csv(csv_path, index=False, float_format="%.14f")
    print(f"Stitched 'cached data' with 'new/additional data'\nsaved @ {csv_path}")

''' Setup for updating EXISTING csv data'''
def update_setup(dateA, dateZ, newDateA, newDateZ, symbol, is_valid_cached):
    print(f"\nHandling {symbol}.csv...")
    tDateA = get_next_trading_day(newDateA)
    tDateZ = get_last_trading_day(newDateZ)
    tDateA_str = pd.to_datetime(tDateA).strftime("%Y-%m-%d")
    tDateZ_str = pd.to_datetime(tDateZ).strftime("%Y-%m-%d")

    if is_valid_cached:
        ''' VALID CSV DATA '''
        if (dateA == tDateA_str and dateZ == tDateZ_str):
            print(f"No update needed for {symbol}.csv. Dates match.")
            return
        else:
            print(f"\nGetting more data...")
            print(f"Next trade day from {newDateA} = {tDateA_str}.\nLast trade day from {newDateZ} = {tDateZ_str}.")
            # Only stitch if the cache exists and is valid
            datapend(dateA, dateZ, tDateA_str, tDateZ_str, symbol)
    else:
        ''' INVALID or NO CSV DATA → full data grab '''
        print(f"Fetching NEW {symbol} data from {tDateA_str} to {tDateZ_str}...")
        end_exclusive = (pd.to_datetime(tDateZ_str) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        df_new = fetch_data(symbol, tDateA_str, end_exclusive)

        if df_new is None or df_new.empty:
            print(f"New fetch for {symbol} returned no rows. Aborting replace; keeping existing files.")
            return

        # Keep previous CSV in memory for a precise delta print
        csv_path = os.path.join("yf", f"{symbol}.csv")
        old_df = None
        if os.path.exists(csv_path):
            try:
                old_df = pd.read_csv(csv_path, parse_dates=["Date"]).set_index("Date")
            except Exception:
                old_df = None

        # Back up AFTER a successful fetch
        if os.path.exists(csv_path):
            backup_path = cp_del(csv_path, symbol)
            print(f"Backed up old CSV to {backup_path}")

        # Save new with high precision (save_data uses float_format="%.9f")
        save_data(df_new, symbol)

        # --- Post-save verification at the anchor date ---
        try:
            new_df = pd.read_csv(csv_path, parse_dates=["Date"]).set_index("Date")
            # Use the same anchor you validated on: the cached file’s dateA if it existed,
            # otherwise the new tDateA (for the first file ever).
            anchor = pd.to_datetime(dateA) if old_df is not None else pd.to_datetime(tDateA_str)

            if anchor in new_df.index:
                new_adj = float(new_df.loc[anchor, "Adj Close"])
                if old_df is not None and anchor in old_df.index:
                    old_adj = float(old_df.loc[anchor, "Adj Close"])
                    delta = new_adj - old_adj
                    print(f"\nPost-save check @ {anchor.date()}: old Adj={old_adj:.9f}, new Adj={new_adj:.9f}, Δ={delta:.9f}")
                else:
                    print(f"\nPost-save check @ {anchor.date()}: new Adj={new_adj:.9f}")
            else:
                print(f"\nPost-save check: anchor {anchor.date()} is not in the new CSV (start date changed).")
        except Exception as e:
            print(f"\nPost-save check skipped: {e}")
''' 
             Le CLI entrypoint        
'''

def m_ytd_start_today():
    today = datetime.datetime.today().date()
    ytd_start = datetime.date(today.year, 1, 1)
    end = today - datetime.timedelta(days=1)
    return ytd_start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

def m_normalize_start_date(start_date_str):
    dt = t0_interpret(start_date_str)
    return dt.strftime("%Y-%m-%d")

def m_load_tickers_from_file(file_path):
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"Ticker file not found: {file_path}")
    if file_path.lower().endswith(".txt"):
        ticks = []
        with open(file_path, "r") as f:
            for line in f:
                s = line.strip()
                if s:
                    ticks.append(s.upper())
        return ticks
    # CSV path: look for a "Ticker" column, else read all values
    df = pd.read_csv(file_path)
    ticker_col = None
    for col in df.columns:
        if str(col).strip().lower() == "ticker":
            ticker_col = col
            break
    if ticker_col is not None:
        raw = df[ticker_col].tolist()
    else:
        raw = df.stack().tolist()
    ticks = []
    for v in raw:
        if pd.isna(v):
            continue
        s = str(v).strip()
        if not s:
            continue
        ticks.append(s.upper())
    return ticks

def m_cli_update_one(ticker, start_date_opt, prevalidated=False):
    if prevalidated:
        symbol = ticker.upper()
    else:
        valid, invalid = validate_tickers([ticker.upper()])
        if not valid:
            print("No valid symbols. Exiting.")
            return
        symbol = valid[0]

    csv_exists = has_data(symbol)
    if csv_exists:
        # Existing CSV: only append from last CSV date + 1 to last trading day
        dateA, dateZ = get_CSV_dates(symbol)
        is_valid_cached = True  # leverage your existing CSV validation upstream if desired

        if start_date_opt: # when base date given
            newDateA = m_normalize_start_date(start_date_opt)
            if dateA <= newDateA <= dateZ:
                # Requested start is inside the existing range — no prepend needed,
                # but still append any data newer than dateZ.
                print(
                    f"\nRequested start {newDateA} overlaps existing {symbol}.csv range "
                    f"[{dateA}..{dateZ}]. Checking for newer data to append..."
                )
                newDateA = (pd.to_datetime(dateZ) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
            newDateZ = get_effective_end_date().strftime("%Y-%m-%d")
            m_update_setup(dateA, dateZ, newDateA, newDateZ, symbol, is_valid_cached)
        else:
            # No explicit start given: append only from last CSV date to latest trading day
            last_trading_day = get_last_trading_day(get_effective_end_date())
            if pd.to_datetime(dateZ).date() >= last_trading_day:
                print(f"No update needed for {symbol}.csv. Already up to last trading day ({last_trading_day}).")
                return
            newDateA = (pd.to_datetime(dateZ) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
            newDateZ = get_effective_end_date().strftime("%Y-%m-%d")
            m_update_setup(dateA, dateZ, newDateA, newDateZ, symbol, is_valid_cached)
    else:
        # No CSV yet: use start_date if provided; else YTD
        if start_date_opt:
            newDateA = m_normalize_start_date(start_date_opt)
        else:
            newDateA, _ytdZ = m_ytd_start_today()
        newDateZ = get_effective_end_date().strftime("%Y-%m-%d")

        # No cached file exists, so tell updater to do a full grab
        # We pass dateA/dateZ as equal to newDateA so m_update_setup treats as fresh
        m_update_setup(newDateA, newDateA, newDateA, newDateZ, symbol, is_valid_cached=False)

def m_update_setup(dateA, dateZ, newDateA, newDateZ, symbol, is_valid_cached):
    """
    Safer wrapper that only prepends when new target start < existing dateA,
    and only appends when new target end > existing dateZ.
    """
    print(f"\nHandling {symbol}.csv...")
    tDateA = get_next_trading_day(newDateA)
    tDateZ = get_last_trading_day(newDateZ)
    tDateA_str = pd.to_datetime(tDateA).strftime("%Y-%m-%d")
    tDateZ_str = pd.to_datetime(tDateZ).strftime("%Y-%m-%d")

    if is_valid_cached:
        if (dateA == tDateA_str and dateZ == tDateZ_str):
            print(f"No update needed for {symbol}.csv. Dates match.")
            return
        else:
            print(f"\nGetting more data...")
            print(f"Next trade day from {newDateA} = {tDateA_str}.\nLast trade day from {newDateZ} = {tDateZ_str}.")
            m_datapend(dateA, dateZ, tDateA_str, tDateZ_str, symbol)
    else:
        print(f"Fetching NEW {symbol} data from {tDateA_str} to {tDateZ_str}...")
        end_exclusive = (pd.to_datetime(tDateZ_str) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        df_new = fetch_data(symbol, tDateA_str, end_exclusive)

        if df_new is None or df_new.empty:
            print(f"No data returned for {symbol} in requested range. Nothing saved.")
            return

        save_data(df_new, symbol)

def m_datapend(dateA, dateZ, tDateA, tDateZ, symbol):
    """
    Safer datapend:
      - Only prepend if tDateA < dateA
      - Only append  if tDateZ > dateZ
    Prevents reversed ranges like start > end.
    """
    csv_path = os.path.join("yf", f"{symbol}.csv")
    if not os.path.isfile(csv_path):
        raise FileNotFoundError(f"Expected existing CSV at {csv_path}")

    csv_df = pd.read_csv(csv_path, parse_dates=["Date"]).sort_values("Date").reset_index(drop=True)

    dateA = pd.to_datetime(dateA)
    dateZ = pd.to_datetime(dateZ)
    tDateA = pd.to_datetime(tDateA)
    tDateZ = pd.to_datetime(tDateZ)

    need_prepend = tDateA < dateA
    need_append  = tDateZ > dateZ

    prepend_df = pd.DataFrame()
    append_df  = pd.DataFrame()

    if need_prepend:
        end_exclusive = (dateA).strftime("%Y-%m-%d")
        prepend_df = fetch_data(symbol, tDateA.strftime("%Y-%m-%d"), end_exclusive)

    if need_append:
        start_inclusive = (dateZ + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        end_exclusive   = (tDateZ + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        append_df = fetch_data(symbol, start_inclusive, end_exclusive)

    def _tidy(df):
        if df is None or df.empty:
            return pd.DataFrame()
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df.reset_index()
        if "Price" in df.columns and "Date" not in df.columns:
            df = df.rename(columns={"Price": "Date"})
        cols = ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]
        keep = [c for c in cols if c in df.columns]
        return df[keep]

    prepend_df = _tidy(prepend_df)
    append_df  = _tidy(append_df)

    if prepend_df.empty and append_df.empty:
        print(f"No new data to stitch for {symbol}. CSV is already up to date.")
        return

    # Merge parts
    combined = pd.concat([prepend_df, csv_df, append_df], ignore_index=True)
    if "Date" in combined.columns:
        combined["Date"] = pd.to_datetime(combined["Date"])
        combined = combined.sort_values("Date").drop_duplicates(subset=["Date"], keep="last")

    # Enforce canonical column order and precision (same as save_data)
    expected = ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]
    keep = [c for c in expected if c in combined.columns]
    combined = combined[keep]

    os.makedirs("yf", exist_ok=True)
    combined.to_csv(csv_path, index=False, float_format="%.14f")
    print(f"Stitched 'cached data' with 'new/additional data'\nsaved @ {csv_path}")

def m_main_cli():
    import sys
    if len(sys.argv) <= 1:
        return

    def _is_date_arg(s):
        try:
            _ = t0_interpret(s)
            return True
        except Exception:
            return False

    argv = sys.argv[1:]
    start_date_opt = None
    if argv and _is_date_arg(argv[-1]):
        start_date_opt = argv[-1]
        argv = argv[:-1]

    if not argv:
        print("No tickers provided. Exiting.")
        return

    if len(argv) == 1 and (argv[0].lower().endswith(".csv") or argv[0].lower().endswith(".txt") or os.path.isfile(argv[0])):
        input_arg = argv[0]
        try:
            tickers = m_load_tickers_from_file(input_arg)
        except Exception as e:
            print(e)
            return
        if not tickers:
            print("No tickers found in file. Exiting.")
            return
        # Replace dots with dashes for YF compatibility (e.g. BRK.B -> BRK-B)
        tickers = [t.replace('.', '-') for t in tickers]
        valid = []
        invalid = []
        for t in tickers:
            if validate_ticker(t):
                valid.append(t)
            else:
                invalid.append(t)
        if invalid:
            print(f"Skipping invalid ticker(s): {invalid}")
        if not valid:
            print("No valid symbols. Exiting.")
            return
        print(f"Processing {len(valid)} valid ticker(s)...\n")
        for t in valid:
            m_cli_update_one(t, start_date_opt, prevalidated=True)
    else:
        # Support comma-separated and/or space-separated tickers
        tickers = []
        for tok in argv:
            parts = [p.strip() for p in tok.split(",") if p.strip()]
            for p in parts:
                tickers.append(p.upper())
        if not tickers:
            print("No tickers provided. Exiting.")
            return
        valid, invalid = validate_tickers(tickers)
        if not valid:
            print("No valid symbols. Exiting.")
            return
        for t in valid:
            m_cli_update_one(t, start_date_opt, prevalidated=True)
if __name__ == "__main__":
    m_main_cli()
