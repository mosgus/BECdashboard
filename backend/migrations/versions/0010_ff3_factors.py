"""ff3_factors table (contract 0167).

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: Union[str, Sequence[str], None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ff3_factors",
        sa.Column("date", sa.Date(), primary_key=True),
        sa.Column("mkt_rf", sa.Float(), nullable=False),
        sa.Column("smb", sa.Float(), nullable=False),
        sa.Column("hml", sa.Float(), nullable=False),
        sa.Column("rf", sa.Float(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("ff3_factors")
