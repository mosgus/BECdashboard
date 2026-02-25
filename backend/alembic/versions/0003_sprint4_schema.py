"""Sprint 4 schema — portfolio workspace consolidation

Revision ID: 0003
Revises: 0002
Create Date: 2026-02-25

Adds Sprint 4 tables and enrichment columns:
  portfolio_candidates         — tickers being considered per portfolio
  portfolio_indicator_configs  — indicator config per ticker per portfolio
  universe_tickers             — 7 nullable enrichment columns (sector, market_cap, etc.)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── portfolio_candidates ───────────────────────────────────────────────────
    op.create_table(
        "portfolio_candidates",
        sa.Column("portfolio_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("portfolios.id", ondelete="CASCADE"),
                  primary_key=True, nullable=False),
        sa.Column("ticker", sa.Text,
                  sa.ForeignKey("universe_tickers.ticker", ondelete="CASCADE"),
                  primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )

    # ── portfolio_indicator_configs ────────────────────────────────────────────
    op.create_table(
        "portfolio_indicator_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  server_default=sa.text("gen_random_uuid()"),
                  primary_key=True, nullable=False),
        sa.Column("portfolio_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("portfolios.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("ticker", sa.Text,
                  sa.ForeignKey("universe_tickers.ticker", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("indicator_type", sa.Text, nullable=False),
        sa.Column("params_json", postgresql.JSONB, nullable=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("portfolio_id", "ticker", "indicator_type",
                            name="uq_pic_portfolio_ticker_indicator"),
    )

    # ── universe_tickers enrichment columns ───────────────────────────────────
    op.add_column("universe_tickers", sa.Column("sector", sa.Text, nullable=True))
    op.add_column("universe_tickers", sa.Column("market_cap", sa.BigInteger, nullable=True))
    op.add_column("universe_tickers", sa.Column("pe_ratio", sa.Float, nullable=True))
    op.add_column("universe_tickers", sa.Column("dividend_yield", sa.Float, nullable=True))
    op.add_column("universe_tickers", sa.Column("fifty_two_week_high", sa.Float, nullable=True))
    op.add_column("universe_tickers", sa.Column("fifty_two_week_low", sa.Float, nullable=True))
    op.add_column("universe_tickers", sa.Column("last_enriched_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("universe_tickers", "last_enriched_at")
    op.drop_column("universe_tickers", "fifty_two_week_low")
    op.drop_column("universe_tickers", "fifty_two_week_high")
    op.drop_column("universe_tickers", "dividend_yield")
    op.drop_column("universe_tickers", "pe_ratio")
    op.drop_column("universe_tickers", "market_cap")
    op.drop_column("universe_tickers", "sector")
    op.drop_table("portfolio_indicator_configs")
    op.drop_table("portfolio_candidates")
