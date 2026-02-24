"""SQLAlchemy ORM models — Sprint 1 tables: audit_log, universe."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id:          Mapped[int]        = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts:          Mapped[datetime]   = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)
    actor:       Mapped[str | None] = mapped_column(Text, index=True)
    method:      Mapped[str]        = mapped_column(String(10), nullable=False)
    path:        Mapped[str]        = mapped_column(Text, nullable=False)
    status_code: Mapped[int]        = mapped_column(Integer, nullable=False)
    latency_ms:  Mapped[int]        = mapped_column(Integer, nullable=False)
    body_hash:   Mapped[str | None] = mapped_column(String(16))
    request_id:  Mapped[str | None] = mapped_column(String(8))


class Universe(Base):
    __tablename__ = "universe"

    ticker:   Mapped[str]      = mapped_column(Text, primary_key=True)
    added_by: Mapped[str]      = mapped_column(Text, nullable=False, default="seed")
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
