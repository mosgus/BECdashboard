"""sprint2 schema — universe_tickers, watchlists, portfolios, alerts

Revision ID: 0002
Revises: 0001
Create Date: 2026-02-24

Adds Sprint 2 scaffolding tables (no UI/CRUD yet):
  universe_tickers  managed ticker universe
  watchlists        named watchlists
  watchlist_items   watchlist ↔ ticker join
  portfolios        named portfolios
  positions         portfolio ↔ ticker positions
  alerts            alert rule definitions
  alert_events      alert trigger history
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── universe_tickers ──────────────────────────────────────────────────────
    op.create_table(
        "universe_tickers",
        sa.Column("ticker",     sa.Text(),                     nullable=False),
        sa.Column("name",       sa.Text(),                     nullable=True),
        sa.Column("active",     sa.Boolean(),                  nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True),    nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("ticker"),
    )
    op.create_index("ix_universe_tickers_active", "universe_tickers", ["active"])

    # Seed from same 15-ticker set as legacy universe table
    op.execute("""
        INSERT INTO universe_tickers (ticker) VALUES
            ('AAPL'), ('MSFT'), ('GOOGL'), ('AMZN'), ('NVDA'),
            ('META'), ('TSLA'), ('BRK-B'), ('JPM'),  ('V'),
            ('SPY'),  ('QQQ'),  ('IWM'),   ('VT'),   ('GLD')
        ON CONFLICT DO NOTHING;
    """)

    # ── watchlists ────────────────────────────────────────────────────────────
    op.create_table(
        "watchlists",
        sa.Column("id",         postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name",       sa.Text(),                     nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),    nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── watchlist_items ───────────────────────────────────────────────────────
    op.create_table(
        "watchlist_items",
        sa.Column("watchlist_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ticker",       sa.Text(),                     nullable=False),
        sa.Column("created_at",   sa.DateTime(timezone=True),    nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("watchlist_id", "ticker"),
        sa.ForeignKeyConstraint(["watchlist_id"], ["watchlists.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ticker"],       ["universe_tickers.ticker"], ondelete="CASCADE"),
    )

    # ── portfolios ────────────────────────────────────────────────────────────
    op.create_table(
        "portfolios",
        sa.Column("id",         postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name",       sa.Text(),                     nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),    nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── positions ─────────────────────────────────────────────────────────────
    op.create_table(
        "positions",
        sa.Column("portfolio_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ticker",       sa.Text(),                     nullable=False),
        sa.Column("weight",       sa.Float(),                    nullable=True),
        sa.Column("shares",       sa.Float(),                    nullable=True),
        sa.Column("cost_basis",   sa.Float(),                    nullable=True),
        sa.Column("updated_at",   sa.DateTime(timezone=True),    nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("portfolio_id", "ticker"),
        sa.ForeignKeyConstraint(["portfolio_id"], ["portfolios.id"],             ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ticker"],       ["universe_tickers.ticker"],   ondelete="CASCADE"),
    )

    # ── alerts ────────────────────────────────────────────────────────────────
    op.create_table(
        "alerts",
        sa.Column("id",            postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("scope",         sa.Text(),                     nullable=False),
        sa.Column("scope_id",      postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("ticker",        sa.Text(),                     nullable=True),
        sa.Column("rule_type",     sa.Text(),                     nullable=False),
        sa.Column("params_json",   postgresql.JSONB(),            nullable=True),
        sa.Column("enabled",       sa.Boolean(),                  nullable=False, server_default=sa.text("true")),
        sa.Column("cooldown_days", sa.Integer(),                  nullable=False, server_default=sa.text("1")),
        sa.Column("created_at",    sa.DateTime(timezone=True),    nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alerts_enabled", "alerts", ["enabled"])

    # ── alert_events ──────────────────────────────────────────────────────────
    op.create_table(
        "alert_events",
        sa.Column("id",           postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("alert_id",     postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True),    nullable=False, server_default=sa.text("now()")),
        sa.Column("asof_date",    sa.Date(),                     nullable=False),
        sa.Column("payload_json", postgresql.JSONB(),            nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["alert_id"], ["alerts.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_alert_events_alert_id",     "alert_events", ["alert_id"])
    op.create_index("ix_alert_events_triggered_at", "alert_events", ["triggered_at"])


def downgrade() -> None:
    # Drop in reverse FK dependency order
    op.drop_index("ix_alert_events_triggered_at", table_name="alert_events")
    op.drop_index("ix_alert_events_alert_id",     table_name="alert_events")
    op.drop_table("alert_events")

    op.drop_index("ix_alerts_enabled", table_name="alerts")
    op.drop_table("alerts")

    op.drop_table("positions")
    op.drop_table("portfolios")
    op.drop_table("watchlist_items")
    op.drop_table("watchlists")

    op.drop_index("ix_universe_tickers_active", table_name="universe_tickers")
    op.drop_table("universe_tickers")
