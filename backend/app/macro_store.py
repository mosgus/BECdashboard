"""Stored uploads for the Macro scorecard's 15 input slots (contract 0202).

Each validated upload is kept as a signed version of its slot. Anyone can upload; the typed name is
attribution, not identity. An upload made while the slot is unlocked opens a correction window at `T`:
further uploads are allowed until `T + UPLOAD_WINDOW` and do not extend it, then the slot is locked
until `T + UPLOAD_LOCK`. Revert is always allowed, is signed like an upload and never touches `T`.
`VERSIONS_KEPT` versions are kept, but the newest good version from before the current window opened is
never evicted, so five uploads inside one window cannot push it out of reach of a revert.

Tier 2: app.db, app.models, app.macro_inputs. No HTTP, no rebuild, no snapshots.
"""

import re
import threading
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import NamedTuple

from sqlalchemy import delete, select, update

from app.db import session
from app.macro_inputs import SLOTS, parse_slot
from app.models import MacroUpload

UPLOAD_WINDOW = timedelta(hours=1)
UPLOAD_LOCK = timedelta(hours=24)
VERSIONS_KEPT = 5
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # the largest real file, CY1, is 4.1 MB
MAX_SIGNATURE_LENGTH = 60
_MAX_FILENAME_LENGTH = 200

_SLOT_BY_ID = {slot.id: slot for slot in SLOTS}

# One process, one writer at a time (see autorefresh._LOCK). Reading the gate and inserting must be one
# step, or two uploads racing past the same gate would both open a window. The parse is deliberately
# outside it: a CY workbook takes ~13 s on Render, and the lock covers every slot.
_LOCK = threading.Lock()


class InvalidSignature(ValueError):
    """The typed name is empty, too long, or holds a control character."""


class UploadTooLarge(ValueError):
    """The file is bigger than MAX_UPLOAD_BYTES."""


class UploadLocked(Exception):
    def __init__(self, slot_id: str, unlocks_at: datetime):
        super().__init__(f"{slot_id} is locked until {unlocks_at.isoformat()}")
        self.slot_id = slot_id
        self.unlocks_at = unlocks_at


class NothingToRevert(Exception):
    def __init__(self, slot_id: str):
        super().__init__(f"{slot_id} has no older version to revert to")
        self.slot_id = slot_id


@dataclass(frozen=True)
class Gate:
    allowed: bool
    opens_window: bool
    window_closes_at: datetime | None  # set only while inside an open window
    locked_until: datetime | None  # set only while locked


@dataclass(frozen=True)
class SlotVersion:
    id: int
    filename: str
    size_bytes: int
    data_through: date | None
    uploaded_by: str
    uploaded_at: datetime
    reverted_by: str | None
    reverted_at: datetime | None
    live: bool


@dataclass(frozen=True)
class SlotStatus:
    slot_id: str
    versions: tuple[SlotVersion, ...]  # newest first
    gate: Gate  # gate(<this slot's window_opened_at>, now)
    can_revert: bool


@dataclass(frozen=True)
class LiveFile:
    upload_id: int
    content: bytes


class _Row(NamedTuple):
    """A macro_uploads row without its content, times relabeled UTC."""

    id: int
    slot_id: str
    filename: str
    size_bytes: int
    data_through: date | None
    uploaded_by: str
    uploaded_at: datetime
    opens_window: bool
    reverted_by: str | None
    reverted_at: datetime | None


_ROW_COLUMNS = (
    MacroUpload.id, MacroUpload.slot_id, MacroUpload.filename, MacroUpload.size_bytes, MacroUpload.data_through,
    MacroUpload.uploaded_by, MacroUpload.uploaded_at, MacroUpload.opens_window, MacroUpload.reverted_by,
    MacroUpload.reverted_at,
)
_NEWEST_FIRST = (MacroUpload.uploaded_at.desc(), MacroUpload.id.desc())


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite (used in tests) hands a DateTime(timezone=True) column back naive; Postgres round-trips it
    tz-aware. Every time written here is UTC, so relabeling a naive read as UTC is a relabel, not a guess
    (the same pattern as autorefresh._as_utc)."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _to_utc(dt: datetime) -> datetime:
    return _as_utc(dt).astimezone(timezone.utc)


def _to_row(raw) -> _Row:
    row = _Row(*raw)
    return row._replace(uploaded_at=_as_utc(row.uploaded_at), reverted_at=_as_utc(row.reverted_at))


# --------------------------------------------------------------------------- pure rules


def gate(window_opened_at: datetime | None, now: datetime) -> Gate:
    if window_opened_at is None or now >= window_opened_at + UPLOAD_LOCK:
        return Gate(True, True, None, None)
    if now < window_opened_at + UPLOAD_WINDOW:
        return Gate(True, False, window_opened_at + UPLOAD_WINDOW, None)
    return Gate(False, False, None, window_opened_at + UPLOAD_LOCK)


def versions_to_evict(rows: Sequence[tuple[int, datetime, bool, bool]], window_opened_at: datetime | None) -> set[int]:
    """`rows` are (id, uploaded_at, reverted, opens_window) for one slot, in any order. Keeps the
    VERSIONS_KEPT newest, the live row (newest non-reverted), the newest non-reverted row from before the
    window opened, and the newest window opener, reverted or not: `T` is read from that row, so evicting
    it would unlock the slot."""
    ordered = sorted(rows, key=lambda row: (row[1], row[0]), reverse=True)
    keep = {row[0] for row in ordered[:VERSIONS_KEPT]}
    live = next((row for row in ordered if not row[2]), None)
    if live is not None:
        keep.add(live[0])
    if window_opened_at is not None:
        before = next((row for row in ordered if not row[2] and row[1] < window_opened_at), None)
        if before is not None:
            keep.add(before[0])
    opener = next((row for row in ordered if row[3]), None)
    if opener is not None:
        keep.add(opener[0])
    return {row[0] for row in ordered} - keep


# --------------------------------------------------------------------------- reading


def _status(slot_id: str, rows: Sequence[_Row], now: datetime) -> SlotStatus:
    """`rows` are one slot's rows, newest first."""
    live_id = next((row.id for row in rows if row.reverted_at is None), None)
    opened_at = next((row.uploaded_at for row in rows if row.opens_window), None)
    good = sum(row.reverted_at is None for row in rows)
    versions = tuple(
        SlotVersion(row.id, row.filename, row.size_bytes, row.data_through, row.uploaded_by, row.uploaded_at,
                    row.reverted_by, row.reverted_at, row.id == live_id)
        for row in rows)
    return SlotStatus(slot_id, versions, gate(opened_at, now), good >= 2)


def _slot_rows(db, slot_id: str) -> list[_Row]:
    query = select(*_ROW_COLUMNS).where(MacroUpload.slot_id == slot_id).order_by(*_NEWEST_FIRST)
    return [_to_row(raw) for raw in db.execute(query)]


def slot_statuses(now: datetime) -> list[SlotStatus]:
    now = _to_utc(now)
    by_slot: dict[str, list[_Row]] = {slot.id: [] for slot in SLOTS}
    with session() as db:
        for raw in db.execute(select(*_ROW_COLUMNS).order_by(*_NEWEST_FIRST)):
            row = _to_row(raw)
            by_slot[row.slot_id].append(row)
    return [_status(slot.id, by_slot[slot.id], now) for slot in SLOTS]


def live_upload_ids() -> dict[str, int]:
    """The live row id of every slot that has one, in SLOTS order."""
    with session() as db:
        query = (select(MacroUpload.slot_id, MacroUpload.id).where(MacroUpload.reverted_at.is_(None))
                 .order_by(*_NEWEST_FIRST))
        newest: dict[str, int] = {}
        for slot_id, upload_id in db.execute(query):
            newest.setdefault(slot_id, upload_id)
    return {slot.id: newest[slot.id] for slot in SLOTS if slot.id in newest}


def live_versions() -> dict[str, LiveFile]:
    """The live file of every slot that has one, in SLOTS order."""
    ids = live_upload_ids()
    if not ids:
        return {}
    with session() as db:
        query = select(MacroUpload.id, MacroUpload.content).where(MacroUpload.id.in_(ids.values()))
        contents = {upload_id: content for upload_id, content in db.execute(query)}
    return {slot_id: LiveFile(upload_id, bytes(contents[upload_id])) for slot_id, upload_id in ids.items()}


# --------------------------------------------------------------------------- writing


def _check_slot(slot_id: str) -> None:
    if slot_id not in _SLOT_BY_ID:
        raise KeyError(slot_id)


def _clean_signature(name: str) -> str:
    name = name.strip()
    if not 1 <= len(name) <= MAX_SIGNATURE_LENGTH:
        raise InvalidSignature(f"The name must be 1 to {MAX_SIGNATURE_LENGTH} characters.")
    if any(unicodedata.category(char) == "Cc" for char in name):
        raise InvalidSignature("The name must not contain control characters.")
    return name


def _final_component(filename: str) -> str:
    return re.split(r"[\\/]", filename)[-1][:_MAX_FILENAME_LENGTH]


def _gate_for(rows: Sequence[_Row], now: datetime) -> Gate:
    """`rows` are one slot's rows, newest first."""
    return gate(next((row.uploaded_at for row in rows if row.opens_window), None), now)


def store_upload(slot_id: str, filename: str, content: bytes, uploaded_by: str, now: datetime) -> SlotStatus:
    _check_slot(slot_id)
    uploaded_by = _clean_signature(uploaded_by)
    if len(content) > MAX_UPLOAD_BYTES:
        raise UploadTooLarge(f"The file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    now = _to_utc(now)
    # A locked slot is refused before the file is parsed, so it never pays for one.
    with _LOCK, session() as db:
        verdict = _gate_for(_slot_rows(db, slot_id), now)
        if not verdict.allowed:
            raise UploadLocked(slot_id, verdict.locked_until)
    parsed = parse_slot(slot_id, content)  # outside the lock; MacroInputError propagates, nothing is written
    with _LOCK, session() as db:
        # Another upload may have landed during the parse, so the decision that counts is this one, made
        # immediately before the insert.
        rows = _slot_rows(db, slot_id)
        verdict = _gate_for(rows, now)
        if not verdict.allowed:
            raise UploadLocked(slot_id, verdict.locked_until)
        new = MacroUpload(
            slot_id=slot_id, filename=_final_component(filename) or _SLOT_BY_ID[slot_id].filename, content=content,
            size_bytes=len(content), data_through=parsed.data_through, uploaded_by=uploaded_by, uploaded_at=now,
            opens_window=verdict.opens_window)
        db.add(new)
        db.flush()
        opened_at = now if verdict.opens_window else next((row.uploaded_at for row in rows if row.opens_window), None)
        stored = [(row.id, row.uploaded_at, row.reverted_at is not None, row.opens_window) for row in rows]
        stored.append((new.id, now, False, verdict.opens_window))
        evict = versions_to_evict(stored, opened_at)
        if evict:
            db.execute(delete(MacroUpload).where(MacroUpload.id.in_(evict)))
        return _status(slot_id, _slot_rows(db, slot_id), now)


def revert(slot_id: str, reverted_by: str, now: datetime) -> SlotStatus:
    _check_slot(slot_id)
    reverted_by = _clean_signature(reverted_by)
    now = _to_utc(now)
    with _LOCK, session() as db:
        rows = _slot_rows(db, slot_id)
        live = next((row for row in rows if row.reverted_at is None), None)
        if live is None or sum(row.reverted_at is None for row in rows) < 2:
            raise NothingToRevert(slot_id)
        db.execute(update(MacroUpload).where(MacroUpload.id == live.id).values(reverted_by=reverted_by, reverted_at=now))
        return _status(slot_id, _slot_rows(db, slot_id), now)
