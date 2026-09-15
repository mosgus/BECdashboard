"""ticker_quotes table

Live intraday quotes: a different lifecycle from price_bars (expires in minutes, not
sessions), so it gets its own table rather than a row shape mixed into price_bars. No
foreign key to universe_tickers — same rule as price_bars: cached market data must not
depend on a curated list. See app/models.py and contracts/0024-live-quotes.md.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ticker_quotes",
        sa.Column("ticker", sa.String(), primary_key=True, nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("ticker_quotes")
