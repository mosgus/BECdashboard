"""news_summaries table

An LLM-generated market briefing over the currently stored headlines. No foreign key to
news_articles, same rule as the rest of this codebase: cached/derived data never cascades.
Kept as a short history rather than a single row, so a failed regeneration still leaves the
prior briefing as a visible fallback instead of the page going blank — see app/briefing.py and
contracts/0034-ai-briefing-backend.md.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "news_summaries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("article_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_news_summaries_created_at", "news_summaries", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_news_summaries_created_at", table_name="news_summaries")
    op.drop_table("news_summaries")
