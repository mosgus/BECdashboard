"""news_articles table

Deduplicated news articles for the whole universe. Yahoo's own article id is the dedup key
rather than a (ticker, ...) composite, because `.news` is associated with a ticker rather
than about it (contract 0030) and the same story regularly surfaces under more than one
ticker's feed. No foreign key to universe_tickers, same rule as price_bars and ticker_quotes:
cached market data must not depend on a curated list. See app/models.py and
contracts/0031-news-storage-and-endpoint.md.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "news_articles",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("publisher", sa.String(), nullable=True),
        sa.Column("url", sa.String(), nullable=True),
        sa.Column("thumbnail_url", sa.String(), nullable=True),
        sa.Column("pub_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "source_ticker",
            sa.String(),
            nullable=True,
            comment=(
                "Provenance only, not a relevance claim — the ticker whose feed surfaced this "
                "article first. Kept stable across refreshes: on conflict the existing value "
                "wins rather than the newest one."
            ),
        ),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_news_articles_pub_date", "news_articles", ["pub_date"])


def downgrade() -> None:
    op.drop_index("ix_news_articles_pub_date", table_name="news_articles")
    op.drop_table("news_articles")
