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

_GROUP_LABELS = {"INDEX": "Indices", "ETF": "ETFs"}
_GROUP_ORDER = ["Indices", "ETFs", "Equities"]

# Calendar days, not sessions — see bar_window_start. 75 days ≈ 52 trading sessions, against the
# 31 that nth_prior_close(bars, 30) requires.
_MIN_WINDOW_DAYS = 75


def pct_return(latest: float | None, earlier: float | None) -> float | None:
    """Percent return between two prices. None when either is None or `earlier` is 0."""
    if latest is None or earlier is None or earlier == 0:
        return None
    return (latest - earlier) / earlier * 100


def nth_prior_close(bars: list[tuple[date, float]], sessions: int) -> float | None:
    """The adj_close `sessions` trading sessions before the latest. None when short.

    bars[-1] is the latest session, so `sessions` sessions before it is bars[-1 - sessions] —
    a 5-day return passes sessions=5 and reads index -6, a 5-session gap from the latest."""
    if len(bars) <= sessions:
        return None
    return bars[-1 - sessions][1]


def ytd_base_close(bars: list[tuple[date, float]], year: int) -> float | None:
    """The first adj_close on or after 1 January of `year`. None when absent."""
    cutoff = date(year, 1, 1)
    for bar_date, close in bars:
        if bar_date >= cutoff:
            return close
    return None


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


def bar_window_start(today: date, year: int) -> date:
    """The earliest bar date build_strip_response needs. Pure — `today` is an argument.

    The strip derives only five things from stored bars: the newest close, the one before it,
    and the 5-, 30-session and YTD anchors. Reading full history to compute those transferred
    55,917 rows for 22 tickers when 3,914 sufficed — measured 2026-09-18, a 14.3x over-fetch on
    the one endpoint that runs on every page load.

    Two lower bounds have to hold simultaneously, hence the min():
    - YTD needs the first session on or after 1 January, so the window must reach that far back.
    - nth_prior_close(bars, 30) needs 31 sessions, which 1 January does *not* guarantee in early
      January — on 5 January only three sessions exist in the year. _MIN_WINDOW_DAYS covers it:
      75 calendar days is roughly 52 sessions, comfortably above 31.

    Widening this is safe; narrowing it fails **silently**, because five_day/thirty_day/ytd are
    computed and returned but not yet rendered (contracts 0028, 0033). A too-narrow window drops
    them to None with nothing on screen to notice.
    """
    return min(date(year, 1, 1), today - timedelta(days=_MIN_WINDOW_DAYS))


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
