"""add adj_close to price_bars

Raw OHLC is an invariant; adj_close is the restatement-prone value a split or dividend
rewrites across stored history. Contract 0006's drift detection depends on this column
existing before anything fetches. See app/models.py and REBUILD.md.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("price_bars", sa.Column("adj_close", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("price_bars", "adj_close")
