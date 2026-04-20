"""portfolios.last_rebalance_date — track when portfolio was last rebalanced

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-20

Changes:
  portfolios table: add last_rebalance_date TIMESTAMP WITH TIMEZONE nullable
  Stores the date/time when the portfolio was last rebalanced or when positions
  were imported. Used to calculate PnL accurately by knowing the baseline date.
"""
from alembic import op
import sqlalchemy as sa


revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "portfolios",
        sa.Column(
            "last_rebalance_date",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("portfolios", "last_rebalance_date")
