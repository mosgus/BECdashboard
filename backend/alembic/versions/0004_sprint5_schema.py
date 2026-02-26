"""sprint5 schema — alert_events columns + job_runs table

Revision ID: 0004
Revises: 0003
Create Date: 2026-02-25

Changes:
  alert_events:
    + ticker        TEXT (denormalized, indexed)
    + fingerprint   TEXT (dedup key, indexed with triggered_at)
    + status        TEXT NOT NULL DEFAULT 'new'
    + updated_at    TIMESTAMP WITH TIME ZONE

  job_runs (new table):
    id, job_name, asof_date, status, started_at, finished_at,
    duration_ms, details_json
    UNIQUE(job_name, asof_date) for idempotency
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── alert_events: add Sprint 5 columns ────────────────────────────────────
    op.add_column("alert_events", sa.Column("ticker",      sa.Text(),                  nullable=True))
    op.add_column("alert_events", sa.Column("fingerprint", sa.Text(),                  nullable=True))
    op.add_column("alert_events", sa.Column("status",      sa.Text(),                  nullable=False, server_default=sa.text("'new'")))
    op.add_column("alert_events", sa.Column("updated_at",  sa.DateTime(timezone=True), nullable=True))

    op.create_index("ix_alert_events_ticker",       "alert_events", ["ticker"])
    op.create_index("ix_alert_events_status",       "alert_events", ["status"])
    op.create_index("ix_alert_events_asof_date",    "alert_events", ["asof_date"])
    # Composite index for fingerprint dedup lookups
    op.create_index("ix_alert_events_fingerprint",  "alert_events", ["fingerprint", "triggered_at"])

    # ── job_runs (new) ────────────────────────────────────────────────────────
    op.create_table(
        "job_runs",
        sa.Column("id",           postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("job_name",     sa.Text(),                     nullable=False),
        sa.Column("asof_date",    sa.Date(),                     nullable=False),
        sa.Column("status",       sa.Text(),                     nullable=False),   # success | failure | partial
        sa.Column("started_at",   sa.DateTime(timezone=True),    nullable=True),
        sa.Column("finished_at",  sa.DateTime(timezone=True),    nullable=True),
        sa.Column("duration_ms",  sa.Integer(),                  nullable=True),
        sa.Column("details_json", postgresql.JSONB(),            nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_name", "asof_date", name="uq_job_runs_job_name_asof_date"),
    )
    op.create_index("ix_job_runs_started_at", "job_runs", ["started_at"])


def downgrade() -> None:
    # Drop job_runs
    op.drop_index("ix_job_runs_started_at", table_name="job_runs")
    op.drop_table("job_runs")

    # Drop alert_events additions (reverse order)
    op.drop_index("ix_alert_events_fingerprint", table_name="alert_events")
    op.drop_index("ix_alert_events_asof_date",   table_name="alert_events")
    op.drop_index("ix_alert_events_status",      table_name="alert_events")
    op.drop_index("ix_alert_events_ticker",      table_name="alert_events")
    op.drop_column("alert_events", "updated_at")
    op.drop_column("alert_events", "status")
    op.drop_column("alert_events", "fingerprint")
    op.drop_column("alert_events", "ticker")
