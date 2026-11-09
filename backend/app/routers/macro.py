"""Macro tab: serves the market scorecard snapshot from backend/hard_data.

The snapshot is a static JSON file built by hand with hard_data/build_macro_scorecard.py from the
scorecard project's output. Stopgap storage, accepted 2026-11-09 to ship the tab quickly; how the
data should be aggregated is still open.
"""

from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response

router = APIRouter(prefix="/macro", tags=["macro"])

SNAPSHOT_PATH = Path(__file__).resolve().parents[2] / "hard_data" / "macro_scorecard.json"


@lru_cache(maxsize=1)
def _snapshot_bytes() -> bytes:
    # Served as the stored bytes rather than parsed and re-serialized: the file is ~1 MB of chart
    # series, and FastAPI's JSON encoding of it would cost more than the request is worth.
    return SNAPSHOT_PATH.read_bytes()


@router.get("/scorecard")
def get_scorecard() -> Response:
    try:
        body = _snapshot_bytes()
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="Macro scorecard snapshot not found")
    return Response(content=body, media_type="application/json")
