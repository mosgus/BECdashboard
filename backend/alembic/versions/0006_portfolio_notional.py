"""portfolios.notional_value — portfolio dollar value for implementation worksheet

Revision ID: 0006
Revises: 0005
Create Date: 2026-02-26

Changes:
  portfolios table: add notional_value NUMERIC(18,2) nullable
  Allows user to record a total dollar value for the portfolio so the
  Implementation Worksheet can compute whole-share trade quantities.
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "portfolios",
        sa.Column("notional_value", sa.Numeric(18, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("portfolios", "notional_value")
