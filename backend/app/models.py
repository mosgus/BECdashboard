from datetime import date as date_, datetime

from sqlalchemy import BigInteger, Date, DateTime, Float, Index, String, func
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
