"""macro_price_series table (contract 0203).

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "macro_price_series",
        sa.Column("ticker", sa.String(), primary_key=True),
        sa.Column("days", sa.JSON(), nullable=False),
        sa.Column("closes", sa.JSON(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("macro_price_series")
