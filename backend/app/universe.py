"""Universe membership: orchestrates market_data + cache into a curated, queryable list.

This is orchestration, not new market-data logic. Every hard problem — partial bars,
restatement, dtype normalization, degraded mode — is already solved in freshness.py,
market_data.py, and cache.py; nothing here reimplements any of it."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func as sa_func, select

from app.cache import evict, get_cached, get_fundamentals, get_quotes
from app.db import session
from app.market_data import fetch_fundamentals, fetch_history, refresh_ticker, symbol_has_history
from app.models import PriceBar, TickerFundamentals, TickerQuote, UniverseTicker
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


class HistoryUnavailable(Exception):
    """Raised when a symbol validates but its history fetch returned no bars."""


def _history_start(today: date) -> date:
    return HISTORY_START


def _live_quote(quote: dict | None) -> tuple[float | None, datetime | None]:
    """(current_price, quote_fetched_at) — always null together, by construction: both come
    from the same branch, so a timestamp can never appear beside a price that isn't a live
    quote. None when the market is closed or the stored quote is older than the TTL — the
    backend decides this, not the frontend, so the client has no market-hours logic to
    duplicate."""
    if quote is None:
        return None, None

    now_et = datetime.now(ZoneInfo("America/New_York"))
    if not is_market_open(now_et):
        return None, None

    now_utc = datetime.now(timezone.utc)
    if now_utc - quote["fetched_at"] > timedelta(minutes=QUOTE_TTL_MINUTES):
        return None, None

    return quote["price"], quote["fetched_at"]


def add(ticker: str) -> dict:
    """Add ticker to the universe. Order matters: validate before writing, so an unknown
    symbol — or a symbol whose history fetch came back empty — leaves no membership row
    behind.

    1. An active row already existing raises AlreadyPresent; an inactive row is
       reactivated rather than rejected.
    2. symbol_has_history(ticker) is the only thing that decides whether the symbol exists —
       raises UnknownSymbol if False. Nothing is written before this succeeds. (If Yahoo's
       price-history endpoint itself is unreachable, symbol_has_history raises
       UpstreamUnavailable instead of False, and that propagates uncaught here — "we don't
       know" must never be treated as "confirmed no.")
    3. fetch_history pulls HISTORY_YEARS of daily bars, not market_data's bare default
       (~22 bars with no start date), which is useless for covariance or volatility. A symbol
       that validates but returns no bars (contract 0042: one transient Yahoo hiccup is
       enough) raises HistoryUnavailable instead of writing a membership row nothing could
       ever repair — refresh() cannot first-fetch a member with no stored history at all.
       evict(key) clears the empty frame fetch_history unconditionally cached, so a same-day
       retry does not get served that empty frame back from memory.
    4. fetch_fundamentals is best-effort — None is not an error and blocks nothing. A ticker
       added while Yahoo's fundamentals endpoint is down still gets its price history; the
       name and sector fill in later via refresh().
    5. refresh_ticker catches the new membership up to the last *completed* session before the
       row is written (contract 0042) — added after the 16:00 ET cutoff, `end=None` above
       stops at yesterday, and without this the ticker would sit one session behind the rest
       of the universe until the next scheduled sweep. Reuses the same 16:00 cutoff
       refresh_ticker/_cached_last_session already apply; nothing here recomputes it.
    6. The membership row is inserted or reactivated only after all of the above succeeds.
    """
    key = ticker.upper()

    with session() as db:
        existing = db.get(UniverseTicker, key)
        if existing is not None and existing.active:
            raise AlreadyPresent(f"{key} is already in the universe")

    if not symbol_has_history(key):
        raise UnknownSymbol(f"Unknown symbol: {key}")

    start = _history_start(date.today())
    stored = fetch_history(key, start=start, end=None)
    if stored is None or stored.empty:
        evict(key)
        raise HistoryUnavailable(f"No price history returned for {key}; not added")

    fetch_fundamentals(key)  # best-effort; None is not an error, nothing to check here

    refresh_ticker(key, history_start=HISTORY_START)

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

    A member with no stored history at all (contract 0042 — e.g. a pre-existing zero-bar row
    from before add() refused those) gets one first-fetch here before refresh_ticker runs:
    missing_range(None, ...) returns None by design ("a first fetch is the caller's job, not a
    repair"), so without this refresh_ticker would fall straight into its no-op branch forever.
    A failed heal is not raised — it falls through into refresh_ticker, which reports an honest
    bars_after: 0; this is called from the auto-refresh sweep, which already logs per-ticker
    exceptions without fixing anything, so raising here would just add log noise.

    Backfills fundamentals, best-effort, if none exist yet — this is how a ticker added
    during a fundamentals outage heals itself later. Never refetches fundamentals that
    already exist; staleness there is a separate, unscoped question."""
    key = ticker.upper()

    with session() as db:
        row = db.get(UniverseTicker, key)
        if row is None or not row.active:
            raise NotInUniverse(f"{key} is not in the universe")

    stored = get_cached(key)
    if stored is None or stored.empty:
        fetch_history(key, start=_history_start(date.today()), end=None)

    result = refresh_ticker(key, history_start=HISTORY_START)

    if get_fundamentals(key) is None:
        fetch_fundamentals(key)

    return {**result, "detail": get_one(key)}


def remove(ticker: str) -> dict:
    """Permanently delete a ticker's membership and every row of its stored market data —
    deliberately overriding this file's own no-cascade design note. Gunnar chose full
    deletion on 2026-09-17, knowing the cost: the old app's failure was that deletion was
    silent and implicit, whereas this is explicit, confirmed, and reachable only through a
    two-step frontend dialog. No foreign key, no ON DELETE CASCADE — every delete below is an
    explicit statement here, inside one transaction, so a failure partway rolls back all of
    it rather than leaving the four tables disagreeing.

    news_articles is deliberately untouched. source_ticker there is provenance — which
    ticker's feed surfaced an article first — not subject matter (contract 0030 measured a
    ticker's own feed regularly returning stories that aren't about it), so deleting by
    source_ticker would remove legitimate feed content that has nothing to do with the
    ticker being deleted. The 14-day pub_date prune already ages articles out on its own
    schedule, unrelated to universe membership.

    Raises NotInUniverse when there is no active membership row — the same check refresh()
    does."""
    key = ticker.upper()

    with session() as db:
        row = db.get(UniverseTicker, key)
        if row is None or not row.active:
            raise NotInUniverse(f"{key} is not in the universe")

        bars_deleted = db.execute(delete(PriceBar).where(PriceBar.ticker == key)).rowcount
        fundamentals_deleted = db.execute(
            delete(TickerFundamentals).where(TickerFundamentals.ticker == key)
        ).rowcount
        quotes_deleted = db.execute(delete(TickerQuote).where(TickerQuote.ticker == key)).rowcount
        db.execute(delete(UniverseTicker).where(UniverseTicker.ticker == key))

    # Only after the transaction above has committed (session()'s context manager commits on
    # clean exit) — evicting first and then having the delete roll back on some later error
    # would leave memory and storage disagreeing in the opposite direction from the bug this
    # ordering exists to prevent.
    evict(key)

    return {
        "ticker": key,
        "bars_deleted": bars_deleted,
        "fundamentals_deleted": fundamentals_deleted,
        "quotes_deleted": quotes_deleted,
    }


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
        current_price, quote_fetched_at = _live_quote(quotes_by_ticker.get(ticker))
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
                "current_price": current_price,
                "last_close": last_close_by_ticker.get(ticker),
                "quote_fetched_at": quote_fetched_at,
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
    current_price, quote_fetched_at = _live_quote(quote)

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
        "current_price": current_price,
        "last_close": last_close,
        "quote_fetched_at": quote_fetched_at,
    }
