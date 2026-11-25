# Contract 0202 — Macro upload storage: versions, sign-off, correction window, revert

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, a `macro_uploads` table and `app/macro_store.py` exist. The module stores each
validated upload as a signed version of its slot. It enforces the correction-window rule and keeps
5 versions, never evicting the last good one. It supports a signed revert and hands the build the
live file for every slot. No HTTP routes are part of this contract.

## Why

These decisions come from REBUILD.md, Macro tab ("Data dialog and pipeline order" and "Cooldown vs.
fixing a bad upload"), from Gunnar on 2026-11-09 and 2026-11-25:
- **Anyone can upload**, with no server-side auth. Each upload is signed with a typed name. The name
  is attribution, not identity.
- **Correction window.** An upload made while the slot is unlocked opens a window at time `T`.
  Further uploads to that slot are allowed until `T + 1 h`, and they **do not extend** the window.
  The slot is then locked until `T + 24 h`. *Why:* a flat 24 h cooldown meant a valid but wrong
  upload left the correct file locked out for a day. With no limit at all, a vandal holding a
  sample template could re-upload after every revert.
- **Revert is always allowed**, is signed like an upload, and never touches `T`.
- **5 versions are kept**, but the newest good version from **before the current window opened is
  never evicted**. Otherwise five uploads inside one window would push it out of reach of revert.

## Files

Create:
- `backend/app/macro_store.py`
- `backend/migrations/versions/0011_macro_uploads.py`: revision `"0011"`, revises `"0010"`.
- `backend/tests/test_macro_store.py`

Modify:
- `backend/app/models.py`: add `MacroUpload`.

**Touch nothing else.** No router, no frontend. If the work appears to require editing a file not on
this list, stop and report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

```python
# app/models.py
class MacroUpload(Base):
    __tablename__ = "macro_uploads"
    id: Mapped[int]                    # Integer, primary key, autoincrement
    slot_id: Mapped[str]               # String, not null, indexed
    filename: Mapped[str]              # String, not null
    content: Mapped[bytes]             # LargeBinary, not null
    size_bytes: Mapped[int]            # Integer, not null
    data_through: Mapped[date | None]  # Date
    uploaded_by: Mapped[str]           # String, not null
    uploaded_at: Mapped[datetime]      # DateTime(timezone=True), not null
    opens_window: Mapped[bool]         # Boolean, not null
    reverted_by: Mapped[str | None]    # String
    reverted_at: Mapped[datetime | None]  # DateTime(timezone=True)
```

The migration creates exactly this table and index, and `downgrade` drops them.

```python
# app/macro_store.py — tier 2: app.db, app.models, app.macro_inputs
UPLOAD_WINDOW = timedelta(hours=1)
UPLOAD_LOCK = timedelta(hours=24)
VERSIONS_KEPT = 5
MAX_UPLOAD_BYTES = 20 * 1024 * 1024     # the largest real file, CY1, is 4.1 MB
MAX_SIGNATURE_LENGTH = 60

class InvalidSignature(ValueError): ...
class UploadTooLarge(ValueError): ...
class UploadLocked(Exception):
    slot_id: str
    unlocks_at: datetime
class NothingToRevert(Exception):
    slot_id: str

@dataclass(frozen=True)
class Gate:
    allowed: bool
    opens_window: bool
    window_closes_at: datetime | None   # set only while inside an open window
    locked_until: datetime | None       # set only while locked

def gate(window_opened_at: datetime | None, now: datetime) -> Gate          # pure
def versions_to_evict(rows: Sequence[tuple[int, datetime, bool]],
                      window_opened_at: datetime | None) -> set[int]        # pure

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
    versions: tuple[SlotVersion, ...]   # newest first
    gate: Gate                          # gate(<this slot's window_opened_at>, now)
    can_revert: bool

@dataclass(frozen=True)
class LiveFile:
    upload_id: int
    content: bytes

def slot_statuses(now: datetime) -> list[SlotStatus]   # one per SLOTS entry, in SLOTS order
def store_upload(slot_id: str, filename: str, content: bytes, uploaded_by: str, now: datetime) -> SlotStatus
def revert(slot_id: str, reverted_by: str, now: datetime) -> SlotStatus
def live_versions() -> dict[str, LiveFile]    # only slots that have a live version
def live_upload_ids() -> dict[str, int]       # the same, without loading content
```

### Rules

- **The live version** is the newest row by `(uploaded_at, id)` with `reverted_at IS NULL`.
- **The window opener** `T` is the `uploaded_at` of the newest row with `opens_window` true. Reverted
  rows count. A vandal's reverted upload still holds the lock it started, which is the point.
- **`gate(T, now)`**, with `T` possibly `None`:
  - `T is None` or `now >= T + UPLOAD_LOCK` → `Gate(True, True, None, None)`;
  - `now < T + UPLOAD_WINDOW` → `Gate(True, False, T + UPLOAD_WINDOW, None)`;
  - otherwise → `Gate(False, False, None, T + UPLOAD_LOCK)`.
  
  At exactly `T + 1 h` the slot is locked; at exactly `T + 24 h` it is unlocked.
- **`versions_to_evict(rows, T)`.** `rows` are `(id, uploaded_at, reverted)` for one slot, in any
  order. **Keep:**
  - the `VERSIONS_KEPT` newest by `(uploaded_at, id)`;
  - the live row;
  - the newest non-reverted row with `uploaded_at < T`, if `T` is set.
  
  Return every other id.
- **`store_upload`**, in this order:
  1. An unknown `slot_id` raises `KeyError`.
  2. Validate the name. Strip it; it must be 1–`MAX_SIGNATURE_LENGTH` characters with no control
     characters, otherwise `InvalidSignature`.
  3. `len(content) > MAX_UPLOAD_BYTES` raises `UploadTooLarge`.
  4. Check the gate. If it is not allowed, raise `UploadLocked(slot_id, locked_until)`. Checking
     the gate before parsing means a locked slot never pays for a parse. A CY workbook takes
     about 1.3 s to parse locally and roughly ten times that on Render.
  5. Call `parse_slot` and let `MacroInputError` propagate, so nothing is stored.
  6. Insert the row. Use `opens_window` from the gate, `data_through` from the parse, and
     `filename` reduced to its final path component and cut to 200 characters.
  7. Delete `versions_to_evict(...)`.
  8. Return the slot's status.
  
  Steps 4–7 run under a module-level `threading.Lock` (one process; see `autorefresh._LOCK`).
- **`revert`:**
  - validate the name as above;
  - if there is no live row, or no older non-reverted row, raise `NothingToRevert`;
  - otherwise set the live row's `reverted_by` / `reverted_at`. Never delete it, and never touch
    the window.
  
  Run it under the same lock. Each successful revert moves the live version one step older.
- **`can_revert`** is true exactly when `revert` would succeed.
- **Times.** Store UTC. Times read back from SQLite are naive, so relabel them as UTC the way
  `autorefresh._as_utc` does. Every datetime this module returns is timezone-aware.

## Out of scope

- HTTP routes, the rebuild trigger, snapshots, prices and the frontend. Later contracts cover them.
- Any check across slots. Each upload is validated alone by `parse_slot`.
- Any way to delete a version, edit a signature or un-revert.

## Acceptance criteria

1. `env -u DATABASE_URL .venv/bin/alembic upgrade 0010:0011 --sql` (from `backend/`) prints a
   `CREATE TABLE macro_uploads` and a `CREATE INDEX` on `slot_id`, and touches no other table.
2. `backend/tests/test_macro_store.py`:
   - **Pure functions.** Use literal datetimes, with `T = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)`:
     - a. `gate(None, T)` returns `Gate(True, True, None, None)`.
     - b. `gate(T, T + 59 min)` returns `Gate(True, False, T + 1 h, None)`.
     - c. `gate(T, T + 1 h)` returns `Gate(False, False, None, T + 24 h)`.
     - d. `gate(T, T + 24 h)` returns `Gate(True, True, None, None)`.
     - e. `versions_to_evict`, with every row written out as a literal tuple:
       - seven rows, none reverted, one per hour, and `T` set **after** the second row → evicts
         exactly the oldest one;
       - the same seven rows with `T = None` → evicts the two oldest;
       - six rows where the newest five are reverted → keeps the live (oldest) row.
   - **Database.** Use a `db_mode` fixture like `tests/test_api_ops.py`, and the 0199 templates as
     content:
     - f. The first upload has `opens_window` true and becomes live.
     - g. A second upload at `T + 30 min` is allowed and does **not** move `T`. A third at `T + 1 h`
       raises `UploadLocked` with `unlocks_at == T + 24 h`. A fourth at `T + 24 h` succeeds and
       opens a new window.
     - h. Revert at `T + 2 h`, while locked, succeeds. The newest row gets
       `reverted_by` / `reverted_at`, and the previous one becomes live. Reverting until only one
       non-reverted row is left, then once more, raises `NothingToRevert`.
     - i. Invalid content (`b"hello"`) raises `MacroInputError`, and the slot has no rows. An
       oversized `b"PK\x03\x04" + bytes(MAX_UPLOAD_BYTES)` raises `UploadTooLarge`. A name of
       `"   "` or 61 characters raises `InvalidSignature`. None of these stores anything.
     - j. A locked slot raises `UploadLocked` without calling `parse_slot`. Prove it with a
       monkeypatched `parse_slot` that fails the test if called.
     - k. Six uploads inside one window keep 6 rows: the 5 newest plus the pre-window version.
       Set this up with an earlier window's upload at `T - 25 h`. `live_versions()` returns the
       newest row's exact bytes. `live_upload_ids()` returns the same ids.
     - l. `slot_statuses(now)` returns 15 entries in `SLOTS` order, and a slot never uploaded to
       has empty `versions`, `can_revert` false and an open gate.
3. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q` passes. Report the count; the baseline
   is 1009.

`BLOCKED` is the correct answer to a criterion that cannot be satisfied as written. Do not find a
way around one.

## Verification to run and paste

Paste the **complete, verbatim** output of each command.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/backend
env -u DATABASE_URL .venv/bin/alembic upgrade 0010:0011 --sql
PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_macro_store.py
PATH="$PWD/.venv/bin:$PATH" pytest -q
```

Report every file you edited or created.

## Human verification — does Gunnar need to run anything?

- **Nothing to run yet.** The table is created on the next deploy. Nothing writes to it until the
  upload routes exist.

## Open questions

None.
