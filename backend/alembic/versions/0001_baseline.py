"""baseline — audit_log + universe

Revision ID: 0001
Revises:
Create Date: 2026-02-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── audit_log ────────────────────────────────────────────────────────────
    op.create_table(
        "audit_log",
        sa.Column("id",          sa.Integer(),              nullable=False,  autoincrement=True),
        sa.Column("ts",          sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("actor",       sa.Text(),                 nullable=True),
        sa.Column("method",      sa.String(10),             nullable=False),
        sa.Column("path",        sa.Text(),                 nullable=False),
        sa.Column("status_code", sa.Integer(),              nullable=False),
        sa.Column("latency_ms",  sa.Integer(),              nullable=False),
        sa.Column("body_hash",   sa.String(16),             nullable=True),
        sa.Column("request_id",  sa.String(8),              nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_log_ts",    "audit_log", ["ts"])
    op.create_index("ix_audit_log_actor", "audit_log", ["actor"])

    # ── universe ─────────────────────────────────────────────────────────────
    op.create_table(
        "universe",
        sa.Column("ticker",   sa.Text(), nullable=False),
        sa.Column("added_by", sa.Text(), server_default=sa.text("'seed'"), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("ticker"),
    )

    # Seed default ticker universe
    op.execute("""
        INSERT INTO universe (ticker) VALUES
            ('AAPL'), ('MSFT'), ('GOOGL'), ('AMZN'), ('NVDA'),
            ('META'), ('TSLA'), ('BRK-B'), ('JPM'),  ('V'),
            ('SPY'),  ('QQQ'),  ('IWM'),   ('VT'),   ('GLD')
        ON CONFLICT DO NOTHING;
    """)


def downgrade() -> None:
    op.drop_table("universe")
    op.drop_index("ix_audit_log_actor", table_name="audit_log")
    op.drop_index("ix_audit_log_ts",    table_name="audit_log")
    op.drop_table("audit_log")
