from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings

_engine: Engine | None = None
_engine_url_key: object = object()


def normalize_database_url(url: str) -> str:
    """Rewrite Render's short 'postgres://' scheme to the psycopg v3 driver URL SQLAlchemy needs."""
    prefix = "postgres://"
    if url.startswith(prefix):
        return "postgresql+psycopg://" + url[len(prefix) :]
    return url


def get_engine() -> Engine | None:
    """Process-wide SQLAlchemy engine, created lazily on first call.
    Returns None when settings.database_url is None."""
    global _engine, _engine_url_key

    raw_url = Settings().database_url
    if raw_url == _engine_url_key:
        return _engine

    if _engine is not None:
        _engine.dispose()

    _engine = create_engine(normalize_database_url(raw_url), pool_pre_ping=True) if raw_url else None
    _engine_url_key = raw_url
    return _engine


def is_enabled() -> bool:
    """True when a database is configured and an engine could be created."""
    return get_engine() is not None


@contextmanager
def session() -> Iterator[Session]:
    """Transactional scope. Commits on clean exit, rolls back on exception.
    Raises RuntimeError if no database is configured — callers must check is_enabled() first."""
    engine = get_engine()
    if engine is None:
        raise RuntimeError("No database configured")

    factory = sessionmaker(bind=engine)
    db_session = factory()
    try:
        yield db_session
        db_session.commit()
    except Exception:
        db_session.rollback()
        raise
    finally:
        db_session.close()
