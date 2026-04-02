"""Research Suite — decision_memos table

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "decision_memos",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("portfolio_id", UUID(as_uuid=True), sa.ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("status", sa.Text, nullable=False, server_default="draft"),
        sa.Column("composite_score", sa.Float, nullable=True),
        sa.Column("recommendation", sa.Text, nullable=True),
        sa.Column("rationale", sa.Text, nullable=True),
        sa.Column("red_flags", JSONB, nullable=True),
        sa.Column("scorecard_json", JSONB, nullable=True),
        sa.Column("monitoring_plan", sa.Text, nullable=True),
        sa.Column("created_by", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("decision_memos")
