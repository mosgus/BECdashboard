"""JWT utilities and FastAPI auth dependency."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException
from jose import JWTError, jwt

from config import settings

_ALGORITHM = "HS256"


def create_token(display_name: str) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=settings.jwt_expiry_hours)
    return jwt.encode(
        {"sub": display_name, "iat": now, "exp": exp},
        settings.jwt_secret,
        algorithm=_ALGORITHM,
    )


def decode_token(token: str) -> str:
    """Decode and validate a JWT. Returns display_name (sub) or raises JWTError."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[_ALGORITHM])
    sub = payload.get("sub")
    if not sub:
        raise JWTError("Missing sub claim")
    return str(sub)


def verify_password(plain: str) -> bool:
    """Constant-time comparison against CLASS_PASSWORD."""
    return secrets.compare_digest(plain.encode(), settings.class_password.encode())


async def get_current_actor(
    authorization: str | None = Header(default=None),
) -> str:
    """FastAPI dependency — extracts and validates Bearer token.

    Raises 401 if token is missing, malformed, or expired.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.removeprefix("Bearer ")
    try:
        return decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
