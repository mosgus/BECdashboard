"""Move cash positions to portfolio-level fields

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-20

Changes:
  portfolios table: add cash_value NUMERIC(18,2) NULL
  portfolios table: add cash_pct_target FLOAT NULL
  Data migration: Sum cash position market values → portfolio.cash_value
  positions table: DELETE all rows where position_type='cash'
"""
from alembic import op
import sqlalchemy as sa


revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add cash_value and cash_pct_target columns to portfolios
    op.add_column(
        "portfolios",
        sa.Column("cash_value", sa.Numeric(18, 2), nullable=True),
    )
    op.add_column(
        "portfolios",
        sa.Column("cash_pct_target", sa.Float, nullable=True),
    )

    # Data migration: sum cash positions into portfolio.cash_value
    # Note: This uses SQLAlchemy core to execute raw SQL
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE portfolios p
        SET cash_value = (
            SELECT SUM(shares * COALESCE(cost_basis, 1.0))
            FROM positions
            WHERE portfolio_id = p.id AND position_type = 'cash'
        )
        WHERE EXISTS (
            SELECT 1 FROM positions
            WHERE portfolio_id = p.id AND position_type = 'cash'
        )
    """))

    # Delete cash positions
    conn.execute(sa.text("""
        DELETE FROM positions WHERE position_type = 'cash'
    """))


def downgrade() -> None:
    op.drop_column("portfolios", "cash_pct_target")
    op.drop_column("portfolios", "cash_value")
