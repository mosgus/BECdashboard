"""Ticker-strip return calculations for the launch page — computed entirely from stored
price_bars and ticker_quotes, never a new fetch. pct_return/nth_prior_close/ytd_base_close are
pure — no database, no clock, no network; bars arrive newest-last. The one impure function,
build_strip_response, is where the database reads and the market-open/TTL freshness check live —
the same split as quotes.py's pure logic plus refresh_quotes_if_stale.

Returns use adj_close, not close: adj_close includes dividends, and over a YTD window that is
material (IBM yields 2.78%, so a close-only YTD return understates it by roughly that much). Day
change (today's price/change/pct) uses plain close/current_price/last_close instead — those are
already-established fields elsewhere in the codebase with close-based semantics, and mixing
adj_close into one side of that comparison while the other stays close-based would be
inconsistent, not more correct."""

from datetime import date, datetime, timedelta

from sqlalchemy import select

from app.cache import get_quotes
from app.db import session
from app.models import PriceBar, TickerFundamentals, UniverseTicker
from app.quotes import QUOTE_TTL_MINUTES, is_market_open
from app.returns import bar_window_start, nth_prior_close, pct_return, ytd_base_close

_GROUP_LABELS = {"INDEX": "Indices", "ETF": "ETFs"}
_GROUP_ORDER = ["Indices", "ETFs", "Equities"]

def resolve_display_name(short_name: str | None, long_name: str | None, ticker: str) -> str:
    """Prefer short_name unless Yahoo's 31-character cap truncated it.

    The length check runs on the raw string, before stripping: XLK's short_name is 31 raw
    characters (truncated mid-word) but only 30 after stripping trailing whitespace, so
    stripping first would hide the truncation on exactly this one ticker."""
    if short_name is not None and len(short_name) < 31:
        return short_name.strip()
    if long_name:
        return long_name.strip()
    return ticker


def _group_label(quote_type: str | None) -> str:
    return _GROUP_LABELS.get(quote_type or "", "Equities")


def _quote_is_fresh(fetched_at: datetime | None, now_utc: datetime, now_et: datetime) -> bool:
    if fetched_at is None or not is_market_open(now_et):
        return False
    return now_utc - fetched_at <= timedelta(minutes=QUOTE_TTL_MINUTES)


def build_strip_response(now_utc: datetime, now_et: datetime) -> dict:
    """The impure composition: reads active tickers, their fundamentals (for grouping), their
    stored bars, and their stored quotes — a bounded, non-per-ticker set of queries — and
    assembles the strip response. Never fetches from yfinance; the router schedules quote refresh
    after this stored-data response has been returned."""
    with session() as db:
        tickers = (
            db.execute(
                select(UniverseTicker.ticker)
                .where(UniverseTicker.active.is_(True))
                .order_by(UniverseTicker.ticker)
            )
            .scalars()
            .all()
        )

        if not tickers:
            return {"groups": [], "as_of": None, "quotes_stale": False}

        fundamentals_by_ticker = {
            row.ticker: row
            for row in db.execute(
                select(
                    TickerFundamentals.ticker,
                    TickerFundamentals.quote_type,
                    TickerFundamentals.short_name,
                    TickerFundamentals.long_name,
                ).where(TickerFundamentals.ticker.in_(tickers))
            ).all()
        }

        bar_rows = db.execute(
            select(PriceBar.ticker, PriceBar.date, PriceBar.close, PriceBar.adj_close)
            .where(
                PriceBar.ticker.in_(tickers),
                PriceBar.date >= bar_window_start(now_et.date(), now_et.year),
            )
            .order_by(PriceBar.ticker, PriceBar.date)
        ).all()

    quotes_by_ticker = get_quotes(tickers)

    close_bars_by_ticker: dict[str, list[tuple[date, float]]] = {}
    adj_bars_by_ticker: dict[str, list[tuple[date, float]]] = {}
    for ticker, bar_date, close, adj_close in bar_rows:
        if close is not None:
            close_bars_by_ticker.setdefault(ticker, []).append((bar_date, close))
        if adj_close is not None:
            adj_bars_by_ticker.setdefault(ticker, []).append((bar_date, adj_close))

    year = now_et.year
    live_fetched_at: datetime | None = None
    market_open = is_market_open(now_et)
    quotes_stale = False

    groups: dict[str, dict[str, list]] = {}
    for ticker in tickers:
        fundamentals = fundamentals_by_ticker.get(ticker)
        quote_type = fundamentals.quote_type if fundamentals else None
        name = resolve_display_name(
            fundamentals.short_name if fundamentals else None,
            fundamentals.long_name if fundamentals else None,
            ticker,
        )
        label = _group_label(quote_type)
        group = groups.setdefault(label, {"today": [], "five_day": [], "thirty_day": [], "ytd": []})

        close_bars = close_bars_by_ticker.get(ticker, [])
        adj_bars = adj_bars_by_ticker.get(ticker, [])

        last_close = close_bars[-1][1] if close_bars else None
        prior_close = close_bars[-2][1] if len(close_bars) >= 2 else None

        quote = quotes_by_ticker.get(ticker)
        is_fresh = quote is not None and _quote_is_fresh(quote["fetched_at"], now_utc, now_et)

        if is_fresh:
            price = quote["price"]
            reference = last_close
            live_fetched_at = quote["fetched_at"]
        else:
            if market_open:
                quotes_stale = True
            price = last_close
            reference = prior_close

        change = None if price is None or reference is None else price - reference
        pct = pct_return(price, reference)
        group["today"].append(
            {
                "ticker": ticker,
                "name": name,
                "quote_type": quote_type,
                "price": price,
                "change": change,
                "pct": pct,
            }
        )

        latest_adj = adj_bars[-1][1] if adj_bars else None

        five_day_pct = pct_return(latest_adj, nth_prior_close(adj_bars, 5))
        if five_day_pct is not None:
            group["five_day"].append({"ticker": ticker, "pct": five_day_pct})

        thirty_day_pct = pct_return(latest_adj, nth_prior_close(adj_bars, 30))
        if thirty_day_pct is not None:
            group["thirty_day"].append({"ticker": ticker, "pct": thirty_day_pct})

        ytd_pct = pct_return(latest_adj, ytd_base_close(adj_bars, year))
        if ytd_pct is not None:
            group["ytd"].append({"ticker": ticker, "pct": ytd_pct})

    ordered_groups = [
        {"label": label, **groups[label]} for label in _GROUP_ORDER if groups.get(label, {}).get("today")
    ]

    return {"groups": ordered_groups, "as_of": live_fetched_at, "quotes_stale": quotes_stale}
