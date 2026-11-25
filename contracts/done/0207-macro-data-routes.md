# Contract 0207 — Macro data routes: slot status, upload, revert, templates

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, the backend exposes everything the Data dialog will need:
- the status of all 15 slots, plus the rebuild's and the prices' status;
- uploading a file into a slot;
- reverting a slot;
- downloading one format template, or all 15 as a zip.

A successful upload or revert asks for a rebuild.

## Why

The pipeline is complete and accepted (0199–0206). It parses, stores versions, enforces the
correction window and lock, rebuilds in a subprocess and serves the result. What is missing is the
HTTP surface. The Data dialog (next contract) is built against exactly these shapes, so they are
pinned here.

**The upload is the raw request body, not multipart.** `python-multipart` isn't installed. A raw
body needs no new dependency, and `fetch(url, { method: "POST", body: file })` sends it directly.
The name and filename go in the query string.

**The upload handler is `async`, and it runs the store in the threadpool.** Reading the body needs
`await request.body()`. Parsing a CY workbook takes about 13 s on Render, and that must not block
the event loop.

## Files

Modify:
- `backend/app/routers/macro.py`: add the routes.
- `backend/app/schemas.py`: add the response models below.
- `backend/app/macro_build.py`: add `last_build()` (below). Nothing else in that file changes.

Create:
- `backend/tests/test_api_macro_data.py`

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. In particular, `macro_store`, `macro_inputs` and
`macro_prices` are used as they are.

## Interface

```python
# app/macro_build.py — addition
@dataclass(frozen=True)
class BuildRun:
    status: str                  # job_runs.status: "success" | "partial" | "failure"
    started_at: datetime
    finished_at: datetime | None
    result: str | None           # detail["result"] ("built" | "unchanged" | "incomplete") when present
    error: str | None            # the last non-empty line of detail["error"]["message"], when present

def last_build() -> BuildRun | None    # the newest job_runs row with job_name == JOB_NAME
```

```python
# app/schemas.py — additions (Pydantic, no logic)
class MacroGate(BaseModel):
    allowed: bool
    opens_window: bool
    window_closes_at: datetime | None
    locked_until: datetime | None

class MacroVersion(BaseModel):
    id: int
    filename: str
    size_bytes: int
    data_through: date | None
    uploaded_by: str
    uploaded_at: datetime
    reverted_by: str | None
    reverted_at: datetime | None
    live: bool

class MacroSlot(BaseModel):
    id: str
    label: str
    source: str
    filename: str            # the conventional export name
    market: str | None
    versions: list[MacroVersion]   # newest first
    gate: MacroGate
    can_revert: bool

class MacroBuild(BaseModel):
    status: str
    started_at: datetime
    finished_at: datetime | None
    result: str | None
    error: str | None

class MacroPrices(BaseModel):
    tickers: int
    newest_fetched_at: datetime | None

class MacroDataStatus(BaseModel):
    slots: list[MacroSlot]         # SLOTS order
    slots_filled: int              # slots with a live version
    serving: str                   # "uploads" when a stored snapshot exists, else "snapshot_file"
    snapshot_built_at: datetime | None
    last_build: MacroBuild | None
    prices: MacroPrices
```

### Routes (all under the existing `/macro` router)

| Route | Success | Errors |
|---|---|---|
| `GET /macro/data` | 200 `MacroDataStatus` | 503 with no database |
| `POST /macro/slots/{slot_id}?uploaded_by=&filename=` (raw body) | 201 `MacroSlot` | 404 unknown slot · 400 `InvalidSignature` · 413 too large · 422 `MacroInputError` · 429 `UploadLocked` · 503 with no database |
| `POST /macro/slots/{slot_id}/revert?reverted_by=` | 200 `MacroSlot` | 404 · 400 · 409 `NothingToRevert` · 503 |
| `GET /macro/templates/{slot_id}` | 200 xlsx attachment | 404 unknown slot |
| `GET /macro/templates.zip` | 200 zip attachment | — |

- **Error bodies** are FastAPI's `{"detail": <message>}`:
  - for 422, use `str(exc)` from the `MacroInputError`, which is already written for users;
  - for 429, `detail` is an object: `{"message": "…", "unlocks_at": "<ISO 8601>"}`. The dialog shows
    the time.
- **Size, before reading the body.** If the `Content-Length` header exceeds
  `macro_store.MAX_UPLOAD_BYTES`, return 413 before reading. After reading, also map
  `UploadTooLarge` to 413, because a chunked request has no length header.
- **Missing query parameters.** `uploaded_by` / `reverted_by` / `filename` are required. When one is
  missing, FastAPI's default 422 is acceptable.
- **After a successful upload or revert**, call `request_rebuild(current_inputs_key())`. It returns
  `None` until all 15 slots are filled, and `request_rebuild(None)` schedules a run, which returns
  `"incomplete"`. **So call it only when the key is not `None`.**
- **Time.** `now = datetime.now(timezone.utc)` in the handler. Tests monkeypatch a module-level
  `_now()` function in the router.
- **Templates:**
  - The attachment filename is the slot's filename with `_sample` inserted before `.xlsx` (e.g.
    `CY1_sample.xlsx`), so a template can never be mistaken for a real export. The zip is
    `macro_sample_data.zip` and holds all 15 under those names.
  - Media types: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and
    `application/zip`.
  - Cache the generated bytes in-process. All 15 take 0.8 s locally (planner, 2026-11-25), about
    8 s on Render.
  - Templates do **not** need a database.
- **Route order.** `/macro/templates.zip` and `/macro/templates/{slot_id}` don't collide. Still,
  declare the `.zip` route first and say so in a comment, following the `/universe` convention.

## Out of scope

- The frontend and the price downloader.
- Any change to the store's rules, the build or the scorecard route.
- Authentication: anyone can upload (Gunnar, 2026-11-09).

## Acceptance criteria

1. `backend/tests/test_api_macro_data.py` uses `db_mode`, the 0199 templates as upload bodies, and
   a pinned `_now`. It **spies on `request_rebuild` in every test that uploads**, so no test starts
   a real subprocess. It covers:
   - a. `GET /macro/data` on an empty database: 15 slots in `SLOTS` order, `slots_filled == 0`,
     `serving == "snapshot_file"`, `last_build is None`, `prices.tickers == 0`.
   - b. Uploading the `cons_spx` template returns 201, and the slot has 1 version with
     `live == true` and `uploaded_by` as sent. Afterwards, `GET /macro/data` shows
     `slots_filled == 1`, and the rebuild spy was **not** called (14 slots still empty).
   - c. Uploading all 15 slots calls the spy exactly once with a non-`None` key, on the 15th
     upload.
   - d. Errors:
     - `b"hello"` → 422, with a `detail` containing `.xlsx`;
     - `uploaded_by=%20%20` → 400;
     - an unknown slot → 404;
     - a `Content-Length` over the maximum → 413 (send a header that overstates the size of a
       small body, or monkeypatch `MAX_UPLOAD_BYTES` low);
     - an upload at `T + 1 h` after one at `T` → 429, with `detail.unlocks_at == (T + 24 h)` in
       ISO form.
   - e. Revert:
     - with two versions → 200, and the older version is live;
     - with one → 409;
     - with all 15 slots filled, a successful revert calls the spy.
   - f. With no database (no `db_mode`): `/macro/data`, the upload and the revert return 503.
     `GET /macro/templates/cy1` still returns 200.
   - g. Templates:
     - `GET /macro/templates/cy1` returns bytes that `parse_slot("cy1", …)` accepts, with
       `Content-Disposition` containing `CY1_sample.xlsx`;
     - `GET /macro/templates.zip` holds exactly 15 entries named per the `_sample` rule, each
       accepted by its slot's `parse_slot`;
     - `GET /macro/templates/nope` returns 404.
   - h. `last_build()`: with a `job_runs` row for `macro_rebuild` with status `"failure"` and
     `detail = {"error": {"type": "RuntimeError", "message": "Traceback ...\nValueError: Out of range float values are not JSON compliant\n"}}`,
     `GET /macro/data` shows `last_build.status == "failure"` and
     `last_build.error == "ValueError: Out of range float values are not JSON compliant"`.
2. Every pre-existing test passes unmodified.
3. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q` passes. Report the count; the baseline is
   1082.

`BLOCKED` is the correct answer to a criterion that cannot be satisfied as written.

## Verification to run and paste

Paste the **complete, verbatim** output of each command. Trimming only the warnings summary is
fine; say that you did.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/backend
PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_api_macro_data.py
PATH="$PWD/.venv/bin:$PATH" pytest -q
```

Report every file you edited or created.

## Human verification — does Gunnar need to run anything?

**Yes. This is the first real end-to-end run, and it writes production data.** In order, from
`backend/` (your `.env` points at production):

1. **Migrate**, if you haven't since 0204: `.venv/bin/alembic upgrade head`. Then
   `.venv/bin/alembic current` must print `0013`.
2. **Deploy** the backend, and confirm the live `/openapi.json` lists `/macro/data`.
3. **Seed prices, once:**
   `.venv/bin/python hard_data/seed_macro_prices.py "../reference files/new integration/Scorecard_Project_2026-11-09/prices_cache.pkl"`.
4. **Upload the 15 real files** with the planner's script, signing with your name:
   `bash ../contracts/tools/macro_upload_all.sh https://<your-api-host> "Gunnar Balch"`
5. **Wait about 2 minutes**, then open `https://<your-api-host>/macro/data`. You should see:
   - `slots_filled: 15`;
   - `last_build.status: "success"` with `result: "built"`;
   - `serving: "uploads"`.
6. **Open the Macro page.** It should look like today's, with these differences, which are
   expected: the economic scorecard's "as of" date is today's, and stale flags are judged against
   today.

If step 5 shows a failure, paste the whole `/macro/data` response to the planner.

## Open questions

None.
