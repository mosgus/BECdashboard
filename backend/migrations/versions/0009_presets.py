"""presets table and seed data (contract 0156).

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-03
"""
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "presets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("csv", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    presets = sa.table(
        "presets",
        sa.column("id", sa.String()),
        sa.column("name", sa.String()),
        sa.column("description", sa.String()),
        sa.column("csv", sa.Text()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    gunnar_created_at = datetime(2026, 9, 1, tzinfo=timezone.utc)
    bec_created_at = datetime(2026, 9, 29, tzinfo=timezone.utc)
    op.bulk_insert(
        presets,
        [
            {
                "id": "test-concentrated",
                "name": "Gunnar Preset",
                "description": "Gunnar's real and current allocations.",
                "csv": "ticker,weight_pct,shares\nMU,74.1847583834589,\nVOO,10.104829494715357,\nPBR,6.8215124159481295,\nORCL,4.426503750208732,\nSHNY,4.163845785064591,\nXIACF,0.2985501706042959,\nCASH,0,\n",
                "created_at": gunnar_created_at,
                "updated_at": gunnar_created_at,
            },
            {
                "id": "bec-2026-09-29",
                "name": "BEC Portfolio",
                "description": "Blue Eagle Capital holdings as share counts, with $292,406.58 cash.",
                "csv": "ticker,shares\nXLK,184\nXLP,559\nXLV,410\nVEA,300\nMS,833\nSETM,870\nCEG,155\nGLD,113\nCASH,292406.58\n",
                "created_at": bec_created_at,
                "updated_at": bec_created_at,
            },
        ],
    )


def downgrade() -> None:
    op.drop_table("presets")
