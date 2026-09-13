"""universe_tickers table

Curated universe membership, tracked as a flag rather than presence-in-a-table. No foreign
keys in either direction: price_bars and ticker_fundamentals must not reference this table,
so a future de-listing (flipping active — not implemented here) can never cascade into
deleting price history. See app/models.py and REBUILD.md.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "universe_tickers",
        sa.Column("ticker", sa.String(), primary_key=True, nullable=False),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "active", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    )
    op.create_index("ix_universe_tickers_active", "universe_tickers", ["active"])


def downgrade() -> None:
    op.drop_index("ix_universe_tickers_active", table_name="universe_tickers")
    op.drop_table("universe_tickers")
