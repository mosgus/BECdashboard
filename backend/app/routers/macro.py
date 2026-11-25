"""Macro tab: serves the newest stored market scorecard snapshot.

Snapshots are built from the uploaded inputs by app/macro_build.py and stored in macro_snapshots.
Until one exists (or when no database is configured) the page keeps serving the static JSON in
backend/hard_data, built by hand with hard_data/build_macro_scorecard.py from the scorecard project's
output: the stopgap accepted 2026-11-09, now the fallback.
"""

import hashlib
import io
import logging
import zipfile
from dataclasses import asdict
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, OperationalError, ProgrammingError
from starlette.concurrency import run_in_threadpool

from app import macro_store
from app.db import is_enabled, session
from app.macro_build import (
    current_inputs_key,
    last_build,
    latest_snapshot_meta,
    request_rebuild,
    snapshot_body,
)
from app.macro_inputs import SLOTS, MacroInputError, template_workbook
from app.macro_prices import price_coverage
from app.models import MacroSnapshot
from app.schemas import MacroBuild, MacroDataStatus, MacroGate, MacroPrices, MacroSlot, MacroVersion

router = APIRouter(prefix="/macro", tags=["macro"])

SNAPSHOT_PATH = Path(__file__).resolve().parents[2] / "hard_data" / "macro_scorecard.json"
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ZIP_NAME = "macro_sample_data.zip"
_SLOT_BY_ID = {slot.id: slot for slot in SLOTS}
logger = logging.getLogger(__name__)
_missing_snapshot_table_warning_logged = False


@lru_cache(maxsize=1)
def _snapshot() -> tuple[bytes, str]:
    # Served as the stored bytes rather than parsed and re-serialized: the file is ~1 MB of chart
    # series, and FastAPI's JSON encoding of it would cost more than the request is worth.
    body = SNAPSHOT_PATH.read_bytes()
    return body, _etag(body)


def _etag(body: bytes) -> str:
    return f'"{hashlib.sha256(body).hexdigest()[:32]}"'


def _is_missing_table(exc: DBAPIError) -> bool:
    """Return whether a database error says the macro snapshot table is missing."""
    original = exc.orig
    if type(original).__name__ == "UndefinedTable":
        return True
    message = str(original)
    return message.startswith("no such table") and "macro_snapshots" in message


@lru_cache(maxsize=1)
def _stored(snapshot_id: int) -> tuple[bytes, str]:
    """One stored snapshot's body and ETag, so the ~1 MB body is read from the database only when the
    newest snapshot's id changes."""
    body = snapshot_body(snapshot_id)
    return body, _etag(body)


def _current() -> tuple[bytes, str]:
    """The newest stored snapshot, else the hard_data file (FileNotFoundError when that is missing too).
    Also asks for a rebuild when the live inputs differ from the ones the newest snapshot was built from
    (or none exists), which heals a build lost to a restart. Two small queries, never a wait on a build."""
    global _missing_snapshot_table_warning_logged

    stored = None
    if is_enabled():
        try:
            meta = latest_snapshot_meta()
        except (ProgrammingError, OperationalError) as exc:
            if not _is_missing_table(exc):
                raise
            if not _missing_snapshot_table_warning_logged:
                logger.warning(
                    "macro_snapshots table is missing; run alembic upgrade head to apply migrations"
                )
                _missing_snapshot_table_warning_logged = True
            # Other tables needed by self-healing may be missing too; serve the file directly.
            return _snapshot()
        if meta is not None:
            try:
                stored = _stored(meta[0])
            except KeyError:  # pruned between the two reads; the next request sees the newer one
                pass
        key = current_inputs_key()
        if key is not None and (meta is None or key != meta[1]):
            request_rebuild(key)
    return stored if stored is not None else _snapshot()


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
        body, etag = _current()
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="Macro scorecard snapshot not found")
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if _etag_matches(if_none_match, etag):
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


# --------------------------------------------------------------------------- data dialog routes


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_database() -> None:
    if not is_enabled():
        raise HTTPException(status_code=503, detail="No database configured")


def _require_slot(slot_id: str) -> None:
    if slot_id not in _SLOT_BY_ID:
        raise HTTPException(status_code=404, detail=f"Unknown slot: {slot_id}")


def _slot_out(status: macro_store.SlotStatus) -> MacroSlot:
    slot = _SLOT_BY_ID[status.slot_id]
    return MacroSlot(
        id=slot.id, label=slot.label, source=slot.source, filename=slot.filename, market=slot.market,
        versions=[MacroVersion(**asdict(version)) for version in status.versions],
        gate=MacroGate(**asdict(status.gate)), can_revert=status.can_revert)


def _newest_snapshot_built_at() -> datetime | None:
    with session() as db:
        built_at = db.scalar(select(MacroSnapshot.built_at).order_by(MacroSnapshot.id.desc()).limit(1))
    if built_at is None:
        return None
    return built_at if built_at.tzinfo is not None else built_at.replace(tzinfo=timezone.utc)


def _rebuild_if_complete() -> None:
    """request_rebuild(None) schedules a run that finds nothing to build, so ask only once all 15 slots
    have a live file."""
    key = current_inputs_key()
    if key is not None:
        request_rebuild(key)


@router.get("/data", response_model=MacroDataStatus)
def get_data_status() -> MacroDataStatus:
    _require_database()
    slots = [_slot_out(status) for status in macro_store.slot_statuses(_now())]
    built_at = _newest_snapshot_built_at()
    build = last_build()
    prices = price_coverage()
    return MacroDataStatus(
        slots=slots,
        slots_filled=sum(any(version.live for version in slot.versions) for slot in slots),
        serving="uploads" if built_at is not None else "snapshot_file",
        snapshot_built_at=built_at,
        last_build=None if build is None else MacroBuild(**asdict(build)),
        prices=MacroPrices(tickers=prices.tickers, newest_fetched_at=prices.newest_fetched_at))


def _store_and_rebuild(slot_id: str, filename: str, content: bytes, uploaded_by: str, now: datetime) -> MacroSlot:
    status = macro_store.store_upload(slot_id, filename, content, uploaded_by, now)
    _rebuild_if_complete()
    return _slot_out(status)


# async because the raw body is read with `await request.body()`; the parse (about 13 s for a CY workbook
# on Render) runs in the threadpool so it never blocks the event loop.
@router.post("/slots/{slot_id}", response_model=MacroSlot, status_code=201)
async def upload_slot(slot_id: str, request: Request, uploaded_by: str, filename: str) -> MacroSlot:
    _require_slot(slot_id)
    _require_database()
    too_large = HTTPException(
        status_code=413, detail=f"The file is larger than {macro_store.MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > macro_store.MAX_UPLOAD_BYTES:
        raise too_large
    content = await request.body()
    try:
        return await run_in_threadpool(_store_and_rebuild, slot_id, filename, content, uploaded_by, _now())
    except macro_store.InvalidSignature as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except macro_store.UploadTooLarge:  # a chunked request carries no Content-Length to check above
        raise too_large
    except MacroInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except macro_store.UploadLocked as exc:
        raise HTTPException(
            status_code=429, detail={"message": str(exc), "unlocks_at": exc.unlocks_at.isoformat()})


@router.post("/slots/{slot_id}/revert", response_model=MacroSlot)
def revert_slot(slot_id: str, reverted_by: str) -> MacroSlot:
    _require_slot(slot_id)
    _require_database()
    try:
        status = macro_store.revert(slot_id, reverted_by, _now())
    except macro_store.InvalidSignature as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except macro_store.NothingToRevert as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    _rebuild_if_complete()
    return _slot_out(status)


def _sample_name(filename: str) -> str:
    stem, dot, extension = filename.rpartition(".")
    return f"{stem}_sample{dot}{extension}"


def _attachment(body: bytes, media_type: str, filename: str) -> Response:
    return Response(content=body, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@lru_cache(maxsize=len(SLOTS))
def _template(slot_id: str) -> bytes:
    # Cached: all 15 take about 0.8 s locally and about 8 s on Render, and a template never changes.
    return template_workbook(slot_id)


@lru_cache(maxsize=1)
def _templates_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for slot in SLOTS:
            archive.writestr(_sample_name(slot.filename), _template(slot.id))
    return buffer.getvalue()


# Declared before /templates/{slot_id}: the two don't collide today, but a literal route belongs ahead of
# a parameterized sibling (the /universe convention).
@router.get("/templates.zip")
def get_templates_zip() -> Response:
    return _attachment(_templates_zip(), "application/zip", ZIP_NAME)


@router.get("/templates/{slot_id}")
def get_template(slot_id: str) -> Response:
    _require_slot(slot_id)
    return _attachment(_template(slot_id), XLSX_MEDIA_TYPE, _sample_name(_SLOT_BY_ID[slot_id].filename))
