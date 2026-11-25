"""macro_snapshots table (contract 0204).

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: Union[str, Sequence[str], None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "macro_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("built_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("inputs_key", sa.String(), nullable=False),
        sa.Column("body", sa.LargeBinary(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("macro_snapshots")
