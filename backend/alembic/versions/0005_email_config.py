"""email_config table — in-app SMTP configuration

Revision ID: 0005
Revises: 0004
Create Date: 2026-02-26

Changes:
  New table: email_config
    - Single-row table (id always 1, enforced by unique index)
    - Stores SMTP settings editable via the Ops UI
    - Password stored in plaintext (same security model as .env)
    - At startup, backend loads this row into memory to override env vars
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_config",
        sa.Column("id",         sa.Integer(),                       nullable=False, default=1),
        sa.Column("smtp_host",  sa.Text(),                          nullable=True),
        sa.Column("smtp_port",  sa.Integer(),                       nullable=True, default=587),
        sa.Column("smtp_user",  sa.Text(),                          nullable=True),
        sa.Column("smtp_pass",  sa.Text(),                          nullable=True),
        sa.Column("email_from", sa.Text(),                          nullable=True),
        sa.Column("recipients", sa.Text(),                          nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True),         nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    # Enforce single-row: only id=1 is allowed
    op.create_index("uq_email_config_single", "email_config", ["id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_email_config_single", table_name="email_config")
    op.drop_table("email_config")
