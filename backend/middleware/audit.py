"""AuditMiddleware — writes a row to audit_log for every mutating request.

Design rules:
- Never let a DB write failure kill the request (try/except around all DB ops).
- Read body bytes once; Starlette caches them in request._body for route handlers.
- Extract actor from X-Actor-Name header (no JWT decoding required).
"""
from __future__ import annotations

import hashlib
import time
import uuid
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

import logging

from auth import get_actor_name
from db.base import SessionLocal
from db.models import AuditLog

logger = logging.getLogger(__name__)

_AUDITED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        start = time.perf_counter()
        request_id = str(uuid.uuid4())[:8]

        # Cache body bytes — Starlette stores result in request._body so the
        # downstream route handler can still read it normally.
        body_bytes = await request.body()
        body_hash = hashlib.sha256(body_bytes).hexdigest()[:16] if body_bytes else None

        # Actor from X-Actor-Name header — always a safe string, never raises.
        actor = get_actor_name(request)

        response = await call_next(request)

        latency_ms = int((time.perf_counter() - start) * 1000)

        if request.method in _AUDITED_METHODS:
            db = None
            try:
                db = SessionLocal()
                db.add(AuditLog(
                    ts=datetime.now(timezone.utc),
                    actor=actor,
                    method=request.method,
                    path=request.url.path,
                    status_code=response.status_code,
                    latency_ms=latency_ms,
                    body_hash=body_hash,
                    request_id=request_id,
                ))
                db.commit()
            except Exception:
                # Audit failure must never surface as a 500 to the caller
                logger.warning("Audit log write failed", exc_info=True)
            finally:
                if db:
                    db.close()

        return response
