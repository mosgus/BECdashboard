# Contract 0204 — Macro rebuild job, stored snapshots, and serving them

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

**Depends on contracts 0202 and 0203.** This contract's migration revises `0012`. Run both first.

## Goal

After this contract:
- **The rebuild.** Whenever all 15 slots have a live upload and the inputs (live uploads or
  prices) differ from those of the newest stored snapshot, the backend rebuilds the Macro page
  payload in a separate process and stores it in `macro_snapshots`.
- **Serving.** `GET /macro/scorecard` serves the newest stored snapshot. While none exists, it
  keeps serving `hard_data/macro_scorecard.json` exactly as today.

## Why

This is the last backend step before the upload routes and the Data dialog (REBUILD.md, Macro
tab). Four decisions shape it:

1. **A separate process.** `build_snapshot` peaks at about 174 MB measured on its own (0201 audit).
   The web process already holds pandas, scipy and prophet, and Render's free tier has 512 MB.
   A subprocess gives that memory back to the OS when it exits, and a crash in it can't take the
   API down.
2. **One build at a time, coalesced.** At 0.1 CPU a build takes roughly 80–90 s. Uploads or reverts
   that arrive during a build schedule **exactly one** more, so a burst of corrections costs at
   most two builds (Gunnar, 2026-11-25).
3. **Self-healing.** A Render restart kills a running build, and the trigger is in memory, so the
   request would be lost. So every `GET /macro/scorecard` compares the current input key with the
   newest snapshot's key, and requests a rebuild if they differ. The page heals on its next visit.
4. **`allow_nan=False`.** A NaN in the JSON breaks `JSON.parse` in the browser. The real snapshot
   has none, but an unusual upload could produce one. A build that would emit NaN must **fail**.
   The previous snapshot stays live, and the failure is recorded.

## Files

Create:
- `backend/app/macro_build.py`: the build body, the coalescing trigger, and the subprocess entry
  point (`python -m app.macro_build`).
- `backend/migrations/versions/0013_macro_snapshots.py`: revision `"0013"`, revises `"0012"`.
- `backend/tests/test_macro_build.py`

Modify:
- `backend/app/models.py`: add `MacroSnapshot`.
- `backend/app/routers/macro.py`: serve the newest stored snapshot when one exists, and trigger
  self-healing. Keep the ETag, 304 and `Cache-Control` behaviour from 0190.
- `backend/tests/test_api_macro.py`: add the tests in criterion 3. The existing tests must keep
  passing **unchanged**, because they run without a database and so cover the fallback path.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

```python
# app/models.py
class MacroSnapshot(Base):
    __tablename__ = "macro_snapshots"
    id: Mapped[int]              # Integer, primary key, autoincrement
    built_at: Mapped[datetime]   # DateTime(timezone=True), not null
    inputs_key: Mapped[str]      # String, not null
    body: Mapped[bytes]          # LargeBinary, not null — the exact JSON bytes served
```

```python
# app/macro_build.py — tier 5 (feature): app.db, app.models, app.jobrun, macro_store, macro_prices,
#                      macro_inputs, macro_snapshot
JOB_NAME = "macro_rebuild"
SNAPSHOTS_KEPT = 3
WORKER_TIMEOUT_S = 900

def inputs_key(upload_ids: Mapping[str, int], prices_version: str | None) -> str | None   # pure
def current_inputs_key() -> str | None
def run_build(now_utc: datetime) -> str        # the worker body; returns "built" | "unchanged" | "incomplete"
def request_rebuild() -> None                  # non-blocking, coalescing
def latest_snapshot_meta() -> tuple[int, str] | None   # (id, inputs_key) of the newest row, without its body
def snapshot_body(snapshot_id: int) -> bytes
```

- **`inputs_key`:**
  - It returns `None` unless every slot in `SLOTS` has an id.
  - Otherwise it returns
    `",".join(f"{s.id}:{upload_ids[s.id]}" for s in SLOTS) + "|prices:" + (prices_version or "none")`.
  
  `current_inputs_key()` is `inputs_key(live_upload_ids(), prices_version())`.
- **`run_build(now_utc)`** is the body that runs inside the worker process:
  1. Compute `key = current_inputs_key()`. If it is `None`, return `"incomplete"`. If it equals
     the newest snapshot's key, return `"unchanged"`.
  2. `files = {slot: lf.content for slot, lf in live_versions().items()}`, then
     `build_snapshot(parse_inputs(files), load_prices(), today)`. `today` is `now_utc`'s date in
     America/New_York.
  3. Body: `{"generated_at": now_utc.isoformat(timespec="seconds"), **built}`, serialised with
     `json.dumps(..., ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")`.
     The `ValueError` from a NaN propagates, and nothing is stored.
  4. Insert the `MacroSnapshot` row with `key` (the key read in step 1, not re-read), then delete
     all but the newest `SNAPSHOTS_KEPT` rows. Return `"built"`.
  
  Exceptions propagate. The worker turns them into a non-zero exit.
- **`python -m app.macro_build`** (`if __name__ == "__main__":`):
  - prints `"no database"` and exits 0 when `is_enabled()` is false;
  - otherwise calls `run_build(datetime.now(timezone.utc))`, prints the result and exits 0;
  - on an exception, prints the traceback to stderr and exits 1.
- **`request_rebuild()`:**
  - If no runner thread is alive, it starts one (a daemon `threading.Thread`). If one is running,
    it sets a module-level `_pending` flag and returns. Guard both with a `threading.Lock`.
  - The runner loops: clear `_pending`, run `_run_worker()` once, then repeat only if `_pending`
    was set meanwhile. A burst of N requests during one build therefore causes exactly one more
    run.
  - `_run_worker()` runs
    `subprocess.run([sys.executable, "-m", "app.macro_build"], cwd=<backend dir>, capture_output=True, text=True, timeout=WORKER_TIMEOUT_S)`
    inside `record_run(JOB_NAME, started_at)`.
  - Put the worker's stdout result in `detail["result"]`. On a non-zero exit or a timeout, raise
    inside `record_run` with the last 500 characters of stderr, so the run is recorded as a
    failure. The runner then catches and logs it, and keeps looping. **One failed build must not
    kill the runner.**
- **`GET /macro/scorecard`:**
  1. If the database is enabled:
     - read `latest_snapshot_meta()`;
     - if a snapshot exists, serve its body. Cache the body and its ETag in-process, keyed by
       snapshot id, so the 1 MB body is read from the database only when the id changes;
     - then, if `current_inputs_key()` is not `None` and differs from that snapshot's key (or
       there is no snapshot), call `request_rebuild()`.
  2. If the database is disabled, or there is no snapshot, serve the `hard_data` file exactly as
     now, including its 503 when the file is missing.
  
  ETag and 304 handling is the same for both sources.
  
  The self-heal check costs two small queries per request (ids and `fetched_at`, never content).
  It never blocks on a build.

## Out of scope

- Upload, revert, status and template routes, and the price downloader. Those are the next
  contracts.
- Showing build status to users.
- Changing `build_snapshot` or anything in `macro_inputs`, `macro_econ`, `macro_equity`,
  `macro_snapshot`, `macro_store` or `macro_prices`.
- Deleting `hard_data/macro_scorecard.json`. It stays the fallback.

## Acceptance criteria

1. Run `env -u DATABASE_URL .venv/bin/alembic upgrade 0012:0013 --sql`. It prints only a
   `CREATE TABLE macro_snapshots`.
2. `backend/tests/test_macro_build.py` uses `db_mode`, the 0199 templates and an empty price table:
   - a. `inputs_key` with all 15 slots and `prices_version=None` equals the literal string that
     the rule above produces. Write the string out in the test. With one slot missing, it returns
     `None`.
   - b. `run_build` with 14 slots uploaded returns `"incomplete"` and stores no row.
   - c. With all 15 template slots uploaded, `run_build(datetime(2026, 11, 25, 17, 0, tzinfo=UTC))`
     returns `"built"`. The row's `body` parses as JSON, with `generated_at ==
     "2026-11-25T17:00:00+00:00"` and group keys `["DM", "EM"]`. A second call returns
     `"unchanged"` and stores no new row.
   - d. With `build_snapshot` monkeypatched to return `{"groups": [], "x": float("nan")}`,
     `run_build` raises `ValueError` and stores no row.
   - e. After four builds, each with a different key (revert or re-upload between them), exactly
     3 rows remain, the newest three.
   - f. **Coalescing.** Monkeypatch `_run_worker` with a fake that counts its calls, sets an
     `entered` event, then blocks on a `release` event. Call `request_rebuild()`, then
     **wait for `entered`**. Without that wait, the runner could clear `_pending` after the next
     calls and the test would flake. Call it 3 more times, set `release`, and join the runner
     (expose the thread, or poll for it to finish, with a timeout). The fake ran exactly **2**
     times. (The planner confirmed on 2026-11-25 that a template build with no prices emits no
     NaN, so 2c passes `allow_nan=False` legitimately.)
   - g. **A failure doesn't kill the runner.** The fake raises on its first call. A
     `request_rebuild()` made after that failure still runs the fake again.
   - h. **The real subprocess entry point.** Run
     `subprocess.run([sys.executable, "-m", "app.macro_build"], cwd=<backend>, env={**os.environ, "DATABASE_URL": ""})`.
     It exits 0 and prints `no database`. This proves the module starts in a fresh process.
3. `backend/tests/test_api_macro.py`, with these additions:
   - with a stored snapshot row, `GET /macro/scorecard` returns that row's exact bytes. Its ETag
     differs from the `hard_data` file's, and a matching `If-None-Match` gets a 304;
   - with all 15 slots uploaded and no snapshot, the GET calls `request_rebuild` once (use a spy)
     and still serves the `hard_data` bytes;
   - with a snapshot whose key equals the current key, the GET does **not** call
     `request_rebuild`.
   
   Every pre-existing test in this file passes without modification.
4. **Planner-run.** `DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py full-db`
   still prints `full-db: IDENTICAL`.
5. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q` passes. Report the count; the baseline is
   the count after 0203.

`BLOCKED` is the correct answer to a criterion that cannot be satisfied as written.

## Verification to run and paste

Paste the **complete, verbatim** output of each command.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/backend
env -u DATABASE_URL .venv/bin/alembic upgrade 0012:0013 --sql
DATABASE_URL="" .venv/bin/python -m app.macro_build; echo "exit=$?"
DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py full-db
PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_macro_build.py tests/test_api_macro.py
PATH="$PWD/.venv/bin:$PATH" pytest -q
```

Report every file you edited or created.

## Human verification — does Gunnar need to run anything?

- **Nothing yet.** Until the upload routes exist, no slot can be filled, so production keeps
  serving the `hard_data` snapshot. The real end-to-end check comes with the routes contract.

## Open questions

None.
