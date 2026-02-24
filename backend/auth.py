"""Identity helpers — actor-header based identity (no JWT).

Design:
- Actor identity comes from the X-Actor-Name request header (user-supplied display name).
- If the header is missing or blank, actor defaults to "unknown".
- The optional CLASS_WRITE_KEY gate (X-Class-Key header) can protect mutations
  when the app is deployed publicly. It is NOT an identity mechanism.

Why no JWT:
- Professor guidance: "don't worry too much about security" — reliability matters more.
- JWT adds moving parts (secret rotation, expiry, auth bugs) not required for the course.
- Audit logging is retained for full accountability — actor source changes, not the log.
"""
from __future__ import annotations

from fastapi import HTTPException, Request

from config import settings


def get_actor_name(request: Request) -> str:
    """Extract and sanitize the actor name from X-Actor-Name header.

    Trims whitespace, caps at 64 chars, defaults to 'unknown'.
    Never raises — always returns a safe non-empty string.
    """
    raw = request.headers.get("x-actor-name", "")
    return raw.strip()[:64] or "unknown"


def require_write_key(request: Request) -> None:
    """FastAPI dependency for optional write-key protection.

    No-op when CLASS_WRITE_KEY is not set (open access mode, suitable for course use).
    When CLASS_WRITE_KEY is set, rejects mutations whose X-Class-Key header does not match.
    Returns 403 — not 401 — because this is not identity authentication.
    """
    if settings.class_write_key:
        provided = request.headers.get("x-class-key", "")
        if provided != settings.class_write_key:
            raise HTTPException(status_code=403, detail="Missing or invalid write key")
