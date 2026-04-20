"""SQLAlchemy ORM models.

Sprint 1 tables (keep untouched):
  audit_log  — request audit trail
  universe   — legacy seed ticker list

Sprint 2 tables:
  universe_tickers  — managed ticker universe
  watchlists        — named watchlists (kept for backward compat)
  watchlist_items   — watchlist ↔ ticker join (kept for backward compat)
  portfolios        — named portfolios
  positions         — portfolio ↔ ticker positions

Sprint 4 tables:
  portfolio_candidates       — tickers being considered for a portfolio
  portfolio_indicator_configs — indicator config per ticker per portfolio

Sprint 5 tables:
  job_runs     — nightly job run history (idempotent: UNIQUE on job_name+asof_date)
  email_config — single-row SMTP settings (id always 1), editable via Ops UI
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


# ── Sprint 1 (unchanged) ──────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_log"

    id:          Mapped[int]        = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts:          Mapped[datetime]   = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)
    actor:       Mapped[str | None] = mapped_column(Text, index=True)
    method:      Mapped[str]        = mapped_column(String(10), nullable=False)
    path:        Mapped[str]        = mapped_column(Text, nullable=False)
    status_code: Mapped[int]        = mapped_column(Integer, nullable=False)
    latency_ms:  Mapped[int]        = mapped_column(Integer, nullable=False)
    body_hash:   Mapped[str | None] = mapped_column(String(16))
    request_id:  Mapped[str | None] = mapped_column(String(8))


class Universe(Base):
    __tablename__ = "universe"

    ticker:   Mapped[str]      = mapped_column(Text, primary_key=True)
    added_by: Mapped[str]      = mapped_column(Text, nullable=False, default="seed")
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ── Sprint 2 (scaffolding — migrations in 0002) ───────────────────────────────

class UniverseTicker(Base):
    """Managed ticker universe — replaces the legacy universe table for Sprint 2+ features."""
    __tablename__ = "universe_tickers"

    ticker:               Mapped[str]           = mapped_column(Text, primary_key=True)
    name:                 Mapped[str | None]    = mapped_column(Text, nullable=True)
    active:               Mapped[bool]          = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at:           Mapped[datetime]      = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Sprint 4 enrichment columns (populated via yfinance on add)
    sector:               Mapped[str | None]    = mapped_column(Text, nullable=True)
    market_cap:           Mapped[int | None]    = mapped_column(BigInteger, nullable=True)
    pe_ratio:             Mapped[float | None]  = mapped_column(Float, nullable=True)
    dividend_yield:       Mapped[float | None]  = mapped_column(Float, nullable=True)
    fifty_two_week_high:  Mapped[float | None]  = mapped_column(Float, nullable=True)
    fifty_two_week_low:   Mapped[float | None]  = mapped_column(Float, nullable=True)
    last_enriched_at:     Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Watchlist(Base):
    __tablename__ = "watchlists"

    id:         Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name:       Mapped[str]       = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    watchlist_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("watchlists.id", ondelete="CASCADE"), primary_key=True)
    ticker:       Mapped[str]       = mapped_column(Text, ForeignKey("universe_tickers.ticker", ondelete="CASCADE"), primary_key=True)
    created_at:   Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Portfolio(Base):
    __tablename__ = "portfolios"

    id:                    Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name:                  Mapped[str]            = mapped_column(Text, nullable=False)
    created_at:            Mapped[datetime]       = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    notional_value:        Mapped[float | None]   = mapped_column(Numeric(18, 2), nullable=True)
    cash_value:            Mapped[float | None]   = mapped_column(Numeric(18, 2), nullable=True)
    cash_pct_target:       Mapped[float | None]   = mapped_column(Float, nullable=True)
    last_rebalance_date:   Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_target_set:       Mapped[str | None]     = mapped_column(Text, nullable=True)


class Position(Base):
    __tablename__ = "positions"

    portfolio_id:  Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), ForeignKey("portfolios.id", ondelete="CASCADE"), primary_key=True)
    ticker:        Mapped[str]          = mapped_column(Text, ForeignKey("universe_tickers.ticker", ondelete="CASCADE"), primary_key=True)
    weight:        Mapped[float | None] = mapped_column(Float, nullable=True)
    shares:        Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_basis:    Mapped[float | None] = mapped_column(Float, nullable=True)
    position_type: Mapped[str]          = mapped_column(Text, nullable=False, default="stock")  # 'stock' | 'cash'
    updated_at:    Mapped[datetime]     = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


# ── Sprint 4 (portfolio workspace) ────────────────────────────────────────────

class PortfolioCandidate(Base):
    """Tickers being considered for inclusion in a specific portfolio."""
    __tablename__ = "portfolio_candidates"

    portfolio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("portfolios.id", ondelete="CASCADE"), primary_key=True)
    ticker:       Mapped[str]       = mapped_column(Text, ForeignKey("universe_tickers.ticker", ondelete="CASCADE"), primary_key=True)
    created_at:   Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PortfolioIndicatorConfig(Base):
    """Indicator configuration per ticker per portfolio (infrastructure for future computation)."""
    __tablename__ = "portfolio_indicator_configs"

    id:             Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    portfolio_id:   Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False)
    ticker:         Mapped[str]          = mapped_column(Text, ForeignKey("universe_tickers.ticker", ondelete="CASCADE"), nullable=False)
    indicator_type: Mapped[str]          = mapped_column(Text, nullable=False)   # 'sma' | 'rsi' | 'macd' | 'atr'
    params_json:    Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
    enabled:        Mapped[bool]         = mapped_column(Boolean, nullable=False, default=True)
    created_at:     Mapped[datetime]     = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("portfolio_id", "ticker", "indicator_type", name="uq_pic_portfolio_ticker_indicator"),)


# ── Sprint 5 (ops + nightly jobs) ─────────────────────────────────────────────

class JobRun(Base):
    """Nightly job run history. UNIQUE(job_name, asof_date) ensures idempotency."""
    __tablename__ = "job_runs"

    id:           Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_name:     Mapped[str]          = mapped_column(Text, nullable=False)
    asof_date:    Mapped[date]         = mapped_column(Date, nullable=False)
    status:       Mapped[str]          = mapped_column(Text, nullable=False)   # success | failure | partial
    started_at:   Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms:  Mapped[int | None]   = mapped_column(Integer, nullable=True)
    details_json: Mapped[dict | None]  = mapped_column(JSONB, nullable=True)

    __table_args__ = (UniqueConstraint("job_name", "asof_date", name="uq_job_runs_job_name_asof_date"),)


# ── Sprint 6 (research suite) ─────────────────────────────────────────────────

class DecisionMemo(Base):
    """Research Suite decision memo — stores GO/NO-GO recommendation + scorecard."""
    __tablename__ = "decision_memos"

    id:              Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    portfolio_id:    Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False, index=True)
    status:          Mapped[str]            = mapped_column(Text, nullable=False, default="draft")          # draft | approved | rejected
    composite_score: Mapped[float | None]   = mapped_column(Float, nullable=True)
    recommendation:  Mapped[str | None]     = mapped_column(Text, nullable=True)                            # GO | NO-GO | CONDITIONAL
    rationale:       Mapped[str | None]     = mapped_column(Text, nullable=True)
    red_flags:       Mapped[dict | None]    = mapped_column(JSONB, nullable=True)                           # [{flag, severity, detail}]
    scorecard_json:  Mapped[dict | None]    = mapped_column(JSONB, nullable=True)                           # full scorecard snapshot
    monitoring_plan: Mapped[str | None]     = mapped_column(Text, nullable=True)
    created_by:      Mapped[str | None]     = mapped_column(Text, nullable=True)
    created_at:      Mapped[datetime]       = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at:      Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ── Sprint 6 (price history) ──────────────────────────────────────────────────

class PriceBar(Base):
    """Daily OHLCV bar per ticker. Populated by jobs/refresh_prices.py."""
    __tablename__ = "price_history"

    ticker:     Mapped[str]              = mapped_column(Text, ForeignKey("universe_tickers.ticker", ondelete="CASCADE"), primary_key=True)
    date:       Mapped[date]             = mapped_column(Date, primary_key=True)
    open:       Mapped[float | None]     = mapped_column(Float, nullable=True)
    high:       Mapped[float | None]     = mapped_column(Float, nullable=True)
    low:        Mapped[float | None]     = mapped_column(Float, nullable=True)
    close:      Mapped[float | None]     = mapped_column(Float, nullable=True)
    adj_close:  Mapped[float | None]     = mapped_column(Float, nullable=True)
    volume:     Mapped[int | None]       = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime]         = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_price_history_date", "date"),
    )
