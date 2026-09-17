"""app_state table

A deliberately generic key -> timestamp store for "when did X last happen" questions.
Contract 0036 writes the "auto_refresh" key; the next such question should reuse this table
rather than adding an eighth one. See app/models.py, app/autorefresh.py and
contracts/0036-scheduled-auto-refresh.md.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: Union[str, Sequence[str], None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_state",
        sa.Column("key", sa.String(), primary_key=True, nullable=False),
        sa.Column("value_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("app_state")
