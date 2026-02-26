"""Demo seed — two example portfolios for fresh installs

Revision ID: 0008
Revises: 0007
Create Date: 2026-02-26

Inserts two fully-populated demo portfolios so every fresh deployment has a
working example to click through immediately.  All inserts are idempotent via
ON CONFLICT DO NOTHING; downgrade deletes only the demo rows (cascade removes
positions and candidates automatically).

Demo portfolios:
  1. "Demo — Mag 7 Growth"   $500 k   7 positions   last_target_set (max_sharpe)
  2. "Demo — Balanced Core"  $250 k   7 positions   no target set (shows CTA)

Fixed UUIDs:
  P1  aaaaaaaa-bbbb-4000-8000-000000000001
  P2  aaaaaaaa-bbbb-4000-8000-000000000002

Weight unit convention (positions table): percentage units (25.0 = 25 %)
Weight unit convention (last_target_set): fractions (0.25 = 25 %)
All seed tickers must exist in universe_tickers (seeded in 0002).
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

# ── Fixed UUIDs ────────────────────────────────────────────────────────────────
_P1 = "aaaaaaaa-bbbb-4000-8000-000000000001"  # Demo — Mag 7 Growth
_P2 = "aaaaaaaa-bbbb-4000-8000-000000000002"  # Demo — Balanced Core

# last_target_set blob for P1 (weights as fractions, sums to 1.0)
_P1_TARGET_SET = json.dumps(
    {
        "source": "optimizer",
        "weights": {
            "AAPL": 0.20,
            "MSFT": 0.18,
            "NVDA": 0.17,
            "GOOGL": 0.15,
            "AMZN": 0.13,
            "META": 0.10,
            "TSLA": 0.07,
        },
        "mode": "max_sharpe",
        "views_applied": False,
        "as_of_date": "2026-02-26",
        "created_at": "2026-02-26T12:00:00Z",
    },
    separators=(",", ":"),
)


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. Portfolios ──────────────────────────────────────────────────────────
    conn.execute(
        sa.text(
            """
            INSERT INTO portfolios (id, name, notional_value, last_target_set)
            VALUES
              (:p1, 'Demo — Mag 7 Growth',  500000.00, :p1_ts),
              (:p2, 'Demo — Balanced Core', 250000.00, NULL  )
            ON CONFLICT DO NOTHING
            """
        ),
        {"p1": _P1, "p1_ts": _P1_TARGET_SET, "p2": _P2},
    )

    # ── 2. Positions — Mag 7 Growth (weights in %, sum = 100) ─────────────────
    conn.execute(
        sa.text(
            """
            INSERT INTO positions (portfolio_id, ticker, weight)
            VALUES
              (:pid, 'AAPL',  20.0),
              (:pid, 'MSFT',  18.0),
              (:pid, 'NVDA',  17.0),
              (:pid, 'GOOGL', 15.0),
              (:pid, 'AMZN',  13.0),
              (:pid, 'META',  10.0),
              (:pid, 'TSLA',   7.0)
            ON CONFLICT DO NOTHING
            """
        ),
        {"pid": _P1},
    )

    # ── 3. Positions — Balanced Core (weights in %, sum = 100) ────────────────
    conn.execute(
        sa.text(
            """
            INSERT INTO positions (portfolio_id, ticker, weight)
            VALUES
              (:pid, 'SPY',  30.0),
              (:pid, 'QQQ',  20.0),
              (:pid, 'AAPL', 15.0),
              (:pid, 'MSFT', 15.0),
              (:pid, 'JPM',  10.0),
              (:pid, 'V',     5.0),
              (:pid, 'GLD',   5.0)
            ON CONFLICT DO NOTHING
            """
        ),
        {"pid": _P2},
    )

    # ── 4. Monitor candidates ──────────────────────────────────────────────────
    # Mag 7 Growth watches index exposure as potential additions
    # Balanced Core watches growth names as potential additions
    conn.execute(
        sa.text(
            """
            INSERT INTO portfolio_candidates (portfolio_id, ticker)
            VALUES
              (:p1, 'SPY' ),
              (:p1, 'QQQ' ),
              (:p1, 'IWM' ),
              (:p2, 'NVDA'),
              (:p2, 'META'),
              (:p2, 'GOOGL')
            ON CONFLICT DO NOTHING
            """
        ),
        {"p1": _P1, "p2": _P2},
    )


def downgrade() -> None:
    conn = op.get_bind()
    # CASCADE on FK removes positions and portfolio_candidates automatically
    conn.execute(
        sa.text("DELETE FROM portfolios WHERE id = :p1"),
        {"p1": _P1},
    )
    conn.execute(
        sa.text("DELETE FROM portfolios WHERE id = :p2"),
        {"p2": _P2},
    )
