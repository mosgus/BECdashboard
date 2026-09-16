from datetime import date as date_, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, Index, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class PriceBar(Base):
    """A single day's OHLCV bar for a ticker. Cache data only — no relation to any
    universe/curated-ticker table, so de-listing a ticker never destroys its price history."""

    __tablename__ = "price_bars"
    __table_args__ = (Index("ix_price_bars_date", "date"),)

    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    date: Mapped[date_] = mapped_column(Date, primary_key=True)
    open: Mapped[float | None] = mapped_column(Float)
    high: Mapped[float | None] = mapped_column(Float)
    low: Mapped[float | None] = mapped_column(Float)
    close: Mapped[float | None] = mapped_column(Float)
    adj_close: Mapped[float | None] = mapped_column(Float)
    volume: Mapped[int | None] = mapped_column(BigInteger)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TickerFundamentals(Base):
    """Latest known fundamentals snapshot for a ticker. ETFs genuinely lack several of these
    fields (sector, industry, market_cap, beta, currentPrice) — all nullable except the key
    and fetched_at."""

    __tablename__ = "ticker_fundamentals"

    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    short_name: Mapped[str | None] = mapped_column(String)
    long_name: Mapped[str | None] = mapped_column(String)
    sector: Mapped[str | None] = mapped_column(String)
    industry: Mapped[str | None] = mapped_column(String)
    currency: Mapped[str | None] = mapped_column(String)
    exchange: Mapped[str | None] = mapped_column(String)
    quote_type: Mapped[str | None] = mapped_column(String)
    regular_market_price: Mapped[float | None] = mapped_column(Float)
    previous_close: Mapped[float | None] = mapped_column(Float)
    market_cap: Mapped[int | None] = mapped_column(BigInteger)
    trailing_pe: Mapped[float | None] = mapped_column(Float)
    forward_pe: Mapped[float | None] = mapped_column(Float)
    dividend_yield: Mapped[float | None] = mapped_column(Float)
    fifty_two_week_high: Mapped[float | None] = mapped_column(Float)
    fifty_two_week_low: Mapped[float | None] = mapped_column(Float)
    beta: Mapped[float | None] = mapped_column(Float)
    average_volume: Mapped[int | None] = mapped_column(BigInteger)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class NewsSummary(Base):
    """An LLM-generated market briefing over the currently stored headlines. No foreign key to
    news_articles, same rule as everywhere else in this codebase: cached/derived data never
    cascades. Kept as a short history (not a single row) so a failed regeneration still has a
    prior row to fall back to instead of the page going blank — see app/briefing.py."""

    __tablename__ = "news_summaries"
    __table_args__ = (Index("ix_news_summaries_created_at", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str | None] = mapped_column(String)
    article_count: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class UniverseTicker(Base):
    """Curated universe membership — a flag, not a cascade. Neither price_bars nor
    ticker_fundamentals reference this table in either direction: the old app's cascade
    meant de-listing a ticker silently destroyed its price history (REBUILD.md)."""

    __tablename__ = "universe_tickers"

    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)


class TickerQuote(Base):
    """The latest live intraday price per ticker — a different lifecycle from price_bars
    (expires in minutes, not sessions), which is why it is its own table rather than a row
    shape mixed into price_bars. No foreign key to universe_tickers, same rule as price_bars:
    cached market data must not depend on a curated list."""

    __tablename__ = "ticker_quotes"

    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class NewsArticle(Base):
    """Deduplicated news articles for the whole universe. Yahoo's own article id is the dedup
    key rather than (ticker, ...) because `.news` is associated with a ticker, not about it
    (contract 0030) — the same story regularly surfaces under more than one ticker's feed. No
    foreign key to universe_tickers, same rule as price_bars and ticker_quotes: cached market
    data must not depend on a curated list."""

    __tablename__ = "news_articles"
    __table_args__ = (Index("ix_news_articles_pub_date", "pub_date"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    publisher: Mapped[str | None] = mapped_column(String)
    url: Mapped[str | None] = mapped_column(String)
    thumbnail_url: Mapped[str | None] = mapped_column(String)
    pub_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_ticker: Mapped[str | None] = mapped_column(
        String,
        comment=(
            "Provenance only, not a relevance claim — the ticker whose feed surfaced this "
            "article first. Kept stable across refreshes: on conflict the existing value wins "
            "rather than the newest one."
        ),
    )
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
