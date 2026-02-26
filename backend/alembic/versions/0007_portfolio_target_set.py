"""portfolios.last_target_set — persist most-recent target weight set

Revision ID: 0007
Revises: 0006
Create Date: 2026-02-26

Changes:
  portfolios table: add last_target_set TEXT nullable
  Stores the most recently saved target set (optimizer / tilt / manual)
  as a JSON blob so the Rebalance tab can read it across page refreshes.

JSON shape stored:
  {
    "source": "optimizer" | "tilt" | "manual",
    "weights": {"AAPL": 0.30, "MSFT": 0.25, ...},
    "mode": "max_sharpe" | null,
    "views_applied": false,
    "as_of_date": "2026-02-26",
    "created_at": "2026-02-26T14:30:00Z"
  }
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "portfolios",
        sa.Column("last_target_set", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("portfolios", "last_target_set")
