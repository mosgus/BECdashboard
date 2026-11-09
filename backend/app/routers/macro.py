"""Macro tab: serves the market scorecard snapshot from backend/hard_data.

The snapshot is a static JSON file built by hand with hard_data/build_macro_scorecard.py from the
scorecard project's output. Stopgap storage, accepted 2026-11-09 to ship the tab quickly; how the
data should be aggregated is still open.
"""

import hashlib
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Response

router = APIRouter(prefix="/macro", tags=["macro"])

SNAPSHOT_PATH = Path(__file__).resolve().parents[2] / "hard_data" / "macro_scorecard.json"


@lru_cache(maxsize=1)
def _snapshot() -> tuple[bytes, str]:
    # Served as the stored bytes rather than parsed and re-serialized: the file is ~1 MB of chart
    # series, and FastAPI's JSON encoding of it would cost more than the request is worth.
    body = SNAPSHOT_PATH.read_bytes()
    return body, f'"{hashlib.sha256(body).hexdigest()[:32]}"'


def _etag_matches(if_none_match: str | None, etag: str) -> bool:
    """Weak comparison (RFC 9110 8.8.3.2). Render's edge may rewrite the tag to W/"..." when it
    compresses the response, so the browser can send it back in that form."""
    if if_none_match is None:
        return False
    if if_none_match.strip() == "*":
        return True
    return any(tag.strip().removeprefix("W/") == etag for tag in if_none_match.split(","))


@router.get("/scorecard")
def get_scorecard(if_none_match: str | None = Header(default=None)) -> Response:
    try:
        body, etag = _snapshot()
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="Macro scorecard snapshot not found")
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if _etag_matches(if_none_match, etag):
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)
