"""Universe membership: orchestrates market_data + cache into a curated, queryable list.

This is orchestration, not new market-data logic. Every hard problem — partial bars,
restatement, dtype normalization, degraded mode — is already solved in freshness.py,
market_data.py, and cache.py; nothing here reimplements any of it."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func as sa_func, select

from app.cache import get_cached, get_fundamentals, get_quotes
from app.db import session
from app.market_data import fetch_fundamentals, fetch_history, refresh_ticker, symbol_has_history
from app.models import PriceBar, TickerFundamentals, UniverseTicker
from app.quotes import QUOTE_TTL_MINUTES, is_market_open, refresh_quotes_if_stale

HISTORY_START = date(2016, 1, 1)


class UnknownSymbol(Exception):
    """Raised when market_data.symbol_has_history finds no price history for the ticker.
    Price history, not fundamentals, is the authority on whether a symbol exists — Yahoo's
    fundamentals endpoint (quoteSummary) needs a crumb token that the price-history endpoint
    doesn't, so fundamentals can fail for reasons that have nothing to do with the symbol."""


class AlreadyPresent(Exception):
    """Raised when add() is called for a ticker that already has an active membership row."""


class NotInUniverse(Exception):
    """Raised when an operation targets a ticker with no active membership row."""


def _history_start(today: date) -> date:
    return HISTORY_START


def _current_price(quote: dict | None) -> float | None:
    """None when the market is closed or the stored quote is older than the TTL — the backend
    decides this, not the frontend, so the client has no market-hours logic to duplicate."""
    if quote is None:
        return None

    now_et = datetime.now(ZoneInfo("America/New_York"))
    if not is_market_open(now_et):
        return None

    now_utc = datetime.now(timezone.utc)
    if now_utc - quote["fetched_at"] > timedelta(minutes=QUOTE_TTL_MINUTES):
        return None

    return quote["price"]


def add(ticker: str) -> dict:
    """Add ticker to the universe. Order matters: validate before writing, so an unknown
    symbol leaves no membership row behind.

    1. An active row already existing raises AlreadyPresent; an inactive row is
       reactivated rather than rejected.
    2. symbol_has_history(ticker) is the only thing that decides whether the symbol exists —
       raises UnknownSymbol if False. Nothing is written before this succeeds. (If Yahoo's
       price-history endpoint itself is unreachable, symbol_has_history raises
       UpstreamUnavailable instead of False, and that propagates uncaught here — "we don't
       know" must never be treated as "confirmed no.")
    3. fetch_history pulls HISTORY_YEARS of daily bars, not market_data's bare default
       (~22 bars with no start date), which is useless for covariance or volatility.
    4. fetch_fundamentals is best-effort — None is not an error and blocks nothing. A ticker
       added while Yahoo's fundamentals endpoint is down still gets its price history; the
       name and sector fill in later via refresh().
    5. The membership row is inserted or reactivated only after step 3 succeeds.
    """
    key = ticker.upper()

    with session() as db:
        existing = db.get(UniverseTicker, key)
        if existing is not None and existing.active:
            raise AlreadyPresent(f"{key} is already in the universe")

    if not symbol_has_history(key):
        raise UnknownSymbol(f"Unknown symbol: {key}")

    start = _history_start(date.today())
    fetch_history(key, start=start, end=None)

    fetch_fundamentals(key)  # best-effort; None is not an error, nothing to check here

    with session() as db:
        row = db.get(UniverseTicker, key)
        if row is None:
            db.add(UniverseTicker(ticker=key, active=True))
        else:
            row.active = True

    return get_one(key)


def refresh(ticker: str) -> dict:
    """Bring ticker's stored history current, or repair it if drift was detected. Returns
    market_data.refresh_ticker's summary verbatim, merged with the current detail view — the
    action/session/bar counts are never recomputed here.

    Backfills fundamentals, best-effort, if none exist yet — this is how a ticker added
    during a fundamentals outage heals itself later. Never refetches fundamentals that
    already exist; staleness there is a separate, unscoped question."""
    key = ticker.upper()

    with session() as db:
        row = db.get(UniverseTicker, key)
        if row is None or not row.active:
            raise NotInUniverse(f"{key} is not in the universe")

    result = refresh_ticker(key, history_start=HISTORY_START)

    if get_fundamentals(key) is None:
        fetch_fundamentals(key)

    return {**result, "detail": get_one(key)}


def list_all() -> list[dict]:
    """Active rows, ordered by ticker. Quotes are refreshed (if stale) for the active set
    before rows are built, then joined in — refresh_quotes_if_stale is the only entry point
    that can trigger a live-quote fetch; get_one() only reads.

    Exactly one query per table (universe_tickers, ticker_fundamentals, price_bars), plus one
    for the most recent non-null close and one for quotes — a bounded handful regardless of
    how many tickers are active, not one per ticker."""
    with session() as db:
        universe_rows = db.execute(
            select(UniverseTicker)
            .where(UniverseTicker.active.is_(True))
            .order_by(UniverseTicker.ticker)
        ).scalars().all()

        tickers = [row.ticker for row in universe_rows]
        added_at_by_ticker = {row.ticker: row.added_at for row in universe_rows}

        fundamentals_by_ticker: dict[str, dict] = {}
        bar_stats_by_ticker: dict[str, object] = {}
        last_close_by_ticker: dict[str, float] = {}

        if tickers:
            fundamentals_rows = db.execute(
                select(TickerFundamentals).where(TickerFundamentals.ticker.in_(tickers))
            ).scalars().all()
            # Extracted to plain dicts while the session is still open — the row-building loop
            # below runs after this session closes (it needs to, to call refresh_quotes_if_stale
            # without nesting sessions), and a detached ORM instance re-raises on any attribute
            # access it didn't already materialize.
            fundamentals_by_ticker = {
                row.ticker: {
                    "short_name": row.short_name,
                    "sector": row.sector,
                    "quote_type": row.quote_type,
                    "regular_market_price": row.regular_market_price,
                    "market_cap": row.market_cap,
                    "trailing_pe": row.trailing_pe,
                    "dividend_yield": row.dividend_yield,
                    "fetched_at": row.fetched_at,
                }
                for row in fundamentals_rows
            }

            bar_stats_rows = db.execute(
                select(
                    PriceBar.ticker,
                    sa_func.count().label("bar_count"),
                    sa_func.min(PriceBar.date).label("first_bar"),
                    sa_func.max(PriceBar.date).label("last_bar"),
                )
                .where(PriceBar.ticker.in_(tickers))
                .group_by(PriceBar.ticker)
            ).all()
            bar_stats_by_ticker = {row.ticker: row for row in bar_stats_rows}

            # The most recent bar and the most recent bar WITH A CLOSE are not the same row
            # once a null-close bar exists (the AAPL bug) — rank only over non-null closes so
            # this is resilient to that row without needing it deleted first.
            latest_close_subq = (
                select(
                    PriceBar.ticker,
                    PriceBar.close,
                    sa_func.row_number()
                    .over(partition_by=PriceBar.ticker, order_by=PriceBar.date.desc())
                    .label("rn"),
                )
                .where(PriceBar.ticker.in_(tickers), PriceBar.close.isnot(None))
                .subquery()
            )
            latest_close_rows = db.execute(
                select(latest_close_subq.c.ticker, latest_close_subq.c.close).where(
                    latest_close_subq.c.rn == 1
                )
            ).all()
            last_close_by_ticker = {row.ticker: row.close for row in latest_close_rows}

    refresh_quotes_if_stale(tickers)
    quotes_by_ticker = get_quotes(tickers) if tickers else {}

    entries = []
    for ticker in tickers:
        fundamentals = fundamentals_by_ticker.get(ticker)
        stats = bar_stats_by_ticker.get(ticker)
        entries.append(
            {
                "ticker": ticker,
                "short_name": fundamentals["short_name"] if fundamentals else None,
                "sector": fundamentals["sector"] if fundamentals else None,
                "quote_type": fundamentals["quote_type"] if fundamentals else None,
                "regular_market_price": (
                    fundamentals["regular_market_price"] if fundamentals else None
                ),
                "market_cap": fundamentals["market_cap"] if fundamentals else None,
                "trailing_pe": fundamentals["trailing_pe"] if fundamentals else None,
                "dividend_yield": fundamentals["dividend_yield"] if fundamentals else None,
                "has_fundamentals": fundamentals is not None,
                "bar_count": stats.bar_count if stats else 0,
                "first_bar": stats.first_bar if stats else None,
                "last_bar": stats.last_bar if stats else None,
                "fetched_at": fundamentals["fetched_at"] if fundamentals else None,
                "added_at": added_at_by_ticker[ticker],
                "current_price": _current_price(quotes_by_ticker.get(ticker)),
                "last_close": last_close_by_ticker.get(ticker),
            }
        )

    return entries


def get_one(ticker: str) -> dict:
    """The active row's full detail, or NotInUniverse. Uses get_cached() directly (rather
    than list_all()'s aggregate-query approach) since this is always exactly one ticker —
    no fan-out concern to design around. Reads the stored quote but never refreshes it —
    list_all() is the only entry point that can trigger a live-quote fetch."""
    key = ticker.upper()

    with session() as db:
        row = db.get(UniverseTicker, key)
        if row is None or not row.active:
            raise NotInUniverse(f"{key} is not in the universe")
        added_at = row.added_at

    raw_fundamentals = get_fundamentals(key)
    fundamentals = raw_fundamentals or {}
    prices = get_cached(key)
    has_prices = prices is not None and not prices.empty

    last_close = None
    if has_prices:
        non_null_closes = prices["close"].dropna()
        if not non_null_closes.empty:
            last_close = float(non_null_closes.iloc[-1])

    quote = get_quotes([key]).get(key)

    return {
        "ticker": key,
        "has_fundamentals": raw_fundamentals is not None,
        "short_name": fundamentals.get("short_name"),
        "long_name": fundamentals.get("long_name"),
        "sector": fundamentals.get("sector"),
        "industry": fundamentals.get("industry"),
        "currency": fundamentals.get("currency"),
        "exchange": fundamentals.get("exchange"),
        "quote_type": fundamentals.get("quote_type"),
        "regular_market_price": fundamentals.get("regular_market_price"),
        "previous_close": fundamentals.get("previous_close"),
        "market_cap": fundamentals.get("market_cap"),
        "trailing_pe": fundamentals.get("trailing_pe"),
        "forward_pe": fundamentals.get("forward_pe"),
        "dividend_yield": fundamentals.get("dividend_yield"),
        "fifty_two_week_high": fundamentals.get("fifty_two_week_high"),
        "fifty_two_week_low": fundamentals.get("fifty_two_week_low"),
        "beta": fundamentals.get("beta"),
        "average_volume": fundamentals.get("average_volume"),
        "fetched_at": fundamentals.get("fetched_at"),
        "bar_count": len(prices) if has_prices else 0,
        "first_bar": prices.index.min().date() if has_prices else None,
        "last_bar": prices.index.max().date() if has_prices else None,
        "added_at": added_at,
        "current_price": _current_price(quote),
        "last_close": last_close,
    }
