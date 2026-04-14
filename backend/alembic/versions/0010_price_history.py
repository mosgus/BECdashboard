"""price_history table for nightly yfinance ingestion

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "price_history",
        sa.Column("ticker", sa.Text, sa.ForeignKey("universe_tickers.ticker", ondelete="CASCADE"), primary_key=True),
        sa.Column("date", sa.Date, primary_key=True),
        sa.Column("open", sa.Float, nullable=True),
        sa.Column("high", sa.Float, nullable=True),
        sa.Column("low", sa.Float, nullable=True),
        sa.Column("close", sa.Float, nullable=True),
        sa.Column("adj_close", sa.Float, nullable=True),
        sa.Column("volume", sa.BigInteger, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_price_history_date", "price_history", ["date"])


def downgrade() -> None:
    op.drop_index("ix_price_history_date", table_name="price_history")
    op.drop_table("price_history")
