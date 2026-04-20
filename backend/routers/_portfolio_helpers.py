"""Shared helpers, constants, and schemas for portfolio routers."""
from __future__ import annotations

import csv
import io
import uuid
from datetime import date, timedelta
from typing import Literal, Optional

import pandas as pd
from fastapi import HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from core.cache import fetch_prices_hybrid as fetch_prices
from db.models import Portfolio, Position, UniverseTicker

import logging
logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────

BENCHMARK = "SPY"
DEFAULT_LOOKBACK_DAYS = 1825  # 5 calendar years


# ── Shared Pydantic schema ───────────────────────────────────────────────────

class PositionUpsert(BaseModel):
    ticker: str
    weight: Optional[float] = None                          # percentage units (25 = 25%); set by targets page
    shares: Optional[float] = None                          # number of shares; set by holdings page
    cost_basis: Optional[float] = None                      # per-share cost basis for P&L
    position_type: Literal["stock", "cash"] = "stock"      # 'cash' = excluded from optimization

    @field_validator("ticker")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper().strip()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_bloomberg_format(content: str) -> list[dict] | None:
    """Parse Bloomberg holdings export format.

    Expected columns: Security, Position (shares), Price, Market Val, Cost Date, etc.
    Skips: <Search>, Totals, Cash rows.
    Returns synthetic cost_basis (market value) if cost data is missing.
    """
    try:
        reader = csv.DictReader(io.StringIO(content))
        fieldnames = [h.lower().strip() for h in (reader.fieldnames or [])]

        # Verify this is Bloomberg format by checking for required columns
        if not ("security" in fieldnames and "position" in fieldnames):
            return None

        def _row_get(row: dict, *keys: str) -> str:
            """Case-insensitive lookup across multiple possible column names."""
            lower_map = {k.lower().strip(): v for k, v in row.items()}
            for key in keys:
                val = lower_map.get(key)
                if val is not None:
                    return val
            return ""

        results = []
        for row in reader:
            security = _row_get(row, "security").strip()

            # Skip special rows
            if not security or security.startswith("<") or security.lower() in ("totals", "cash"):
                continue

            # Extract ticker from security (e.g., "BAESY US" -> "BAESY", "SHOP CN" -> "SHOP")
            ticker = security.split()[0].strip().upper() if security else ""
            # Skip invalid tickers (empty, "0", numeric-only, too short)
            if not ticker or ticker == "0" or len(ticker) < 1 or ticker.isdigit():
                continue
            if ticker in ("TICKER", "SYMBOL", "SECURITY"):  # Skip header-like entries
                continue

            # Extract shares (Position column)
            position_str = _row_get(row, "position").strip()
            shares = None
            if position_str:
                try:
                    shares = int(float(position_str))
                except (ValueError, TypeError):
                    try:
                        shares = float(position_str)
                    except (ValueError, TypeError):
                        pass

            # Extract current price
            price_str = _row_get(row, "price", "current price").strip()
            current_price = None
            if price_str:
                try:
                    current_price = float(price_str)
                except (ValueError, TypeError):
                    pass

            # Extract market value (current value)
            market_val_str = _row_get(row, "market val", "marketval", "market_val").strip()
            market_val = None
            if market_val_str:
                try:
                    market_val = float(market_val_str)
                except (ValueError, TypeError):
                    pass

            # Extract cost basis if available; otherwise use market value as synthetic cost
            cost_val_str = _row_get(row, "cost val", "costval", "cost_val").strip()
            cost_basis = None
            if cost_val_str:
                try:
                    cost_basis = float(cost_val_str)
                except (ValueError, TypeError):
                    pass

            # If cost basis is missing, calculate per-share cost from market value and shares
            # Otherwise use current price as synthetic cost per share
            if cost_basis is None:
                if market_val is not None and shares is not None and shares > 0:
                    # Calculate per-share cost: total market value / shares
                    cost_basis = market_val / shares
                elif current_price is not None:
                    # Fall back to current price as synthetic cost per share
                    cost_basis = current_price

            # Extract cost date if available
            cost_date_str = _row_get(row, "cost date", "costdate", "cost_date").strip()

            # Detect cash/money-market equivalents:
            # 1. Price is $1.00 +/- $0.01 (money-market fund NAV)
            # 2. shares ~ market_value (implies $1/share parity)
            # Either condition is sufficient.
            is_cash_price = current_price is not None and abs(current_price - 1.0) < 0.01
            is_cash_parity = (
                shares is not None and shares > 0
                and market_val is not None
                and abs(market_val / shares - 1.0) < 0.01
            )
            position_type = "cash" if (is_cash_price or is_cash_parity) else "stock"

            results.append({
                "ticker": ticker,
                "shares": shares,
                "price": current_price,
                "market_value": market_val,
                "cost_basis": cost_basis,
                "cost_date": cost_date_str or None,
                "weight": None,  # Will be calculated from shares/prices if needed
                "position_type": position_type,
            })

        return results if results else None

    except Exception:
        logger.debug("Bloomberg CSV parse failed", exc_info=True)
        return None


def _parse_portfolio_csv(content: str) -> list[dict]:
    """Parse portfolio CSV into [{ticker, shares, cost_basis, ...}] dicts.

    Accepted formats:
      1. Simple ticker list: header 'ticker' column; optional 'weight' column
      2. Time-series portfolio: columns like AAPL_Weight, MSFT_Weight, etc. (extracts latest weights)
      3. Bloomberg holdings export: Security, Position, Price, Market Val, Cost Date columns
      4. Headerless: first column = ticker, second column = optional weight

    Weights may be decimals (0.25) or percentages (25 or 25%); decimals <= 1
    are converted to percentage scale to match the Position model convention.

    For missing cost basis: uses market value or calculates from shares x price.
    """
    # First, detect Bloomberg format by looking for specific header patterns
    lines = content.strip().split('\n')
    if len(lines) > 10:
        # Bloomberg format has metadata rows (1-8), then a header description row,
        # then the actual column headers. Look for the row containing "Security" and "Position"
        header_idx = None
        for i in range(min(15, len(lines))):  # Look within first 15 rows
            lower_line = lines[i].lower()
            if "security" in lower_line and "position" in lower_line:
                header_idx = i
                break

        if header_idx is not None:
            # This is a Bloomberg format with headers at row (header_idx + 1)
            # Parse starting from that header row
            bloomberg_content = '\n'.join(lines[header_idx:])
            result = _parse_bloomberg_format(bloomberg_content)
            if result:
                return result

    reader = csv.DictReader(io.StringIO(content))
    fieldnames = [h.lower().strip() for h in (reader.fieldnames or [])]

    def _parse_weight(raw: str) -> float | None:
        raw = raw.strip().rstrip("%")
        if not raw:
            return None
        try:
            w = float(raw)
            return round(w * 100, 6) if 0 < w <= 1 else w
        except ValueError:
            return None

    def _row_get(row: dict, *keys: str) -> str:
        """Case-insensitive lookup across multiple possible column names."""
        lower_map = {k.lower().strip(): v for k, v in row.items()}
        for key in keys:
            val = lower_map.get(key)
            if val is not None:
                return val
        return ""

    # Format 1: Simple ticker list (ticker column present)
    if "ticker" in fieldnames or "symbol" in fieldnames:
        return [
            {
                "ticker": _row_get(row, "ticker", "symbol").strip().upper(),
                "weight": _parse_weight(_row_get(row, "weight", "weight_pct", "pct", "allocation")),
                "shares": _row_get(row, "shares", "quantity", "qty").strip() or None,
                "cost_basis": _row_get(row, "price", "cost_basis", "cost").strip() or None,
            }
            for row in reader
        ]

    # Format 2: Time-series portfolio (columns like AAPL_Weight, MSFT_Weight, etc.)
    # Detect by looking for columns with _weight, _share, _mktval suffixes
    weight_cols = [f for f in fieldnames if "_weight" in f]
    if weight_cols:
        # Extract tickers from column names (e.g. "aapl_weight" -> "AAPL")
        tickers_found = set()
        for col in weight_cols:
            ticker = col.replace("_weight", "").strip().upper()
            if ticker and ticker not in ("PORTFOLIO", "TOTAL"):
                tickers_found.add(ticker)

        if tickers_found:
            # Use the last row (most recent date) to get current weights, shares, and cost
            all_rows = list(reader)
            if all_rows:
                last_row = all_rows[-1]
                # Create case-insensitive lookup for the last row
                last_row_lower = {k.lower().strip(): v for k, v in last_row.items()}
                result = []
                for ticker in sorted(tickers_found):
                    weight_key = f"{ticker.lower()}_weight"
                    weight_val = last_row_lower.get(weight_key, "")
                    # Time-series weights are typically decimals (0.25) or percentages (25)
                    parsed_weight = _parse_weight(weight_val) if weight_val else None

                    # Try to extract shares (look for _shares, _share, _qty, _quantity columns)
                    shares_val = (last_row_lower.get(f"{ticker.lower()}_shares") or
                                 last_row_lower.get(f"{ticker.lower()}_share") or
                                 last_row_lower.get(f"{ticker.lower()}_qty") or
                                 last_row_lower.get(f"{ticker.lower()}_quantity") or "")
                    parsed_shares = None
                    if shares_val:
                        try:
                            parsed_shares = int(float(shares_val))
                        except (ValueError, TypeError):
                            pass

                    # Try to extract cost basis (look for _close, _price, _cost, _cost_basis columns)
                    cost_val = (last_row_lower.get(f"{ticker.lower()}_close") or
                               last_row_lower.get(f"{ticker.lower()}_price") or
                               last_row_lower.get(f"{ticker.lower()}_cost") or
                               last_row_lower.get(f"{ticker.lower()}_cost_basis") or "")
                    parsed_cost = None
                    if cost_val:
                        try:
                            parsed_cost = float(cost_val)
                        except (ValueError, TypeError):
                            pass

                    result.append({
                        "ticker": ticker,
                        "weight": parsed_weight,
                        "shares": parsed_shares,
                        "cost_basis": parsed_cost,
                    })
                return result

    # Format 3: Headerless (first column = ticker, second = optional weight)
    # Only use this format if there's no header row detected
    # Skip the first line to avoid treating header as data if any fieldnames were detected
    rows: list[dict] = []
    first_line = True
    for line in csv.reader(io.StringIO(content)):
        if not line:
            continue
        # Skip first line if it looks like a header (any fieldnames were read from DictReader)
        if first_line and (reader.fieldnames is not None):
            first_line = False
            continue
        first_line = False

        # Skip lines that look like dates (YYYY-MM-DD format) - protection against data corruption
        ticker = line[0].strip().upper()
        if ticker and ("^[0-9]{4}-[0-9]{2}-[0-9]{2}" in repr(ticker) or \
                      (len(ticker) == 10 and ticker[4] == '-' and ticker[7] == '-' and \
                       ticker[:4].isdigit() and ticker[5:7].isdigit() and ticker[8:10].isdigit())):
            # Skip date-like entries
            continue

        rows.append({
            "ticker": ticker,
            "weight": _parse_weight(line[1]) if len(line) > 1 else None,
            "shares": None,
            "cost_basis": None,
        })
    return rows


def _get_or_404(db: Session, portfolio_id: str) -> Portfolio:
    try:
        pid = uuid.UUID(portfolio_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    p = db.query(Portfolio).filter(Portfolio.id == pid).first()
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    return p


def _assert_universe(db: Session, ticker: str) -> None:
    ut = db.query(UniverseTicker).filter(
        UniverseTicker.ticker == ticker, UniverseTicker.active == True
    ).first()
    if not ut:
        raise HTTPException(
            status_code=422,
            detail=f"{ticker} is not in the active universe. Import it first.",
        )


def _pos_dict(pos: Position) -> dict:
    return {
        "ticker": pos.ticker,
        "weight": pos.weight,
        "shares": pos.shares,
        "cost_basis": pos.cost_basis,
        "position_type": pos.position_type,
        "updated_at": pos.updated_at.isoformat(),
    }


def _recompute_portfolio_from_shares(portfolio_id: uuid.UUID, db: Session) -> None:
    """Recompute all position weights and portfolio notional from shares x live price.

    Called after any add/update that sets shares. Only acts when at least one
    position in the portfolio has shares recorded.
    Weights are stored in percentage units (25.0 = 25 %) so the optimizer
    and existing analytics code continue to work without changes.

    Note: Cash is now stored at portfolio.cash_value; no cash position rows exist.
    """
    positions = db.query(Position).filter(Position.portfolio_id == portfolio_id).all()
    share_positions = [p for p in positions if p.shares is not None]
    if not share_positions:
        return

    market_values: dict[str, float] = {}

    # Fetch live prices for equity positions
    tickers_tuple = tuple(sorted(p.ticker for p in share_positions))
    today = date.today()
    start_str = (today - timedelta(days=10)).isoformat()
    try:
        prices_df = fetch_prices(tickers_tuple, start_str, today.isoformat())
    except Exception:
        logger.warning("Price fetch failed for portfolio recompute", exc_info=True)
        prices_df = None

    if prices_df is not None and not prices_df.empty:
        latest: dict[str, float] = {}
        for t in tickers_tuple:
            if t in prices_df.columns:
                s = prices_df[t].dropna()
                if len(s) > 0:
                    latest[t] = float(s.iloc[-1])
        for p in share_positions:
            if p.ticker in latest:
                market_values[p.ticker] = p.shares * latest[p.ticker]  # type: ignore[operator]

    total_mv = sum(market_values.values())
    if total_mv <= 0:
        return

    # Update weight (%) for all share-based positions; leave weight-only positions untouched
    for p in positions:
        if p.ticker in market_values:
            p.weight = round(market_values[p.ticker] / total_mv * 100, 4)

    # Auto-update portfolio notional value to reflect current equity market value only
    # (cash is tracked separately in portfolio.cash_value)
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if portfolio:
        portfolio.notional_value = round(total_mv, 2)

    db.commit()


def _fetch_position_prices(positions: list[Position]) -> dict[str, float]:
    """Return {ticker: latest_close} for all tickers in positions list. Never raises."""
    if not positions:
        return {}
    tickers_tuple = tuple(sorted(p.ticker for p in positions))
    today = date.today()
    start_str = (today - timedelta(days=10)).isoformat()
    try:
        prices_df = fetch_prices(tickers_tuple, start_str, today.isoformat())
        if prices_df is None or prices_df.empty:
            return {}
        out: dict[str, float] = {}
        for t in tickers_tuple:
            if t in prices_df.columns:
                s = prices_df[t].dropna()
                if len(s) > 0:
                    out[t] = round(float(s.iloc[-1]), 4)
        return out
    except Exception:
        logger.warning("Latest price extraction failed", exc_info=True)
        return {}


def _equity_records(
    port_equity: pd.Series, bench_equity: pd.Series | None = None
) -> list[dict]:
    records = []
    for d, v in port_equity.items():
        row: dict = {"date": str(d.date()), "portfolio": round(float(v), 6)}
        if bench_equity is not None and d in bench_equity.index:
            row["benchmark"] = round(float(bench_equity.loc[d]), 6)
        records.append(row)
    return records
