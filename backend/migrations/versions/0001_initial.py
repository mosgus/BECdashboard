"""initial

Creates price_bars and ticker_fundamentals — cache tables only, no foreign keys to any
universe/curated-ticker table. See app/models.py and REBUILD.md.

Revision ID: 0001
Revises:
Create Date: 2026-09-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "price_bars",
        sa.Column("ticker", sa.String(), primary_key=True, nullable=False),
        sa.Column("date", sa.Date(), primary_key=True, nullable=False),
        sa.Column("open", sa.Float(), nullable=True),
        sa.Column("high", sa.Float(), nullable=True),
        sa.Column("low", sa.Float(), nullable=True),
        sa.Column("close", sa.Float(), nullable=True),
        sa.Column("volume", sa.BigInteger(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_price_bars_date", "price_bars", ["date"])

    op.create_table(
        "ticker_fundamentals",
        sa.Column("ticker", sa.String(), primary_key=True, nullable=False),
        sa.Column("short_name", sa.String(), nullable=True),
        sa.Column("long_name", sa.String(), nullable=True),
        sa.Column("sector", sa.String(), nullable=True),
        sa.Column("industry", sa.String(), nullable=True),
        sa.Column("currency", sa.String(), nullable=True),
        sa.Column("exchange", sa.String(), nullable=True),
        sa.Column("quote_type", sa.String(), nullable=True),
        sa.Column("regular_market_price", sa.Float(), nullable=True),
        sa.Column("previous_close", sa.Float(), nullable=True),
        sa.Column("market_cap", sa.BigInteger(), nullable=True),
        sa.Column("trailing_pe", sa.Float(), nullable=True),
        sa.Column("forward_pe", sa.Float(), nullable=True),
        sa.Column("dividend_yield", sa.Float(), nullable=True),
        sa.Column("fifty_two_week_high", sa.Float(), nullable=True),
        sa.Column("fifty_two_week_low", sa.Float(), nullable=True),
        sa.Column("beta", sa.Float(), nullable=True),
        sa.Column("average_volume", sa.BigInteger(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("ticker_fundamentals")
    op.drop_index("ix_price_bars_date", table_name="price_bars")
    op.drop_table("price_bars")
