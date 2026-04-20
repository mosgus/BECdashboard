"""positions.position_type — distinguish equity vs cash/equivalent positions

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-20

Changes:
  positions table: add position_type TEXT NOT NULL DEFAULT 'stock'
  Allowed values: 'stock' | 'cash'
  Cash positions (e.g. TTTXX money-market funds) are excluded from optimization
  and signal analysis but included in portfolio notional value.
"""
from alembic import op
import sqlalchemy as sa


revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "positions",
        sa.Column(
            "position_type",
            sa.Text,
            nullable=False,
            server_default="stock",
        ),
    )


def downgrade() -> None:
    op.drop_column("positions", "position_type")
