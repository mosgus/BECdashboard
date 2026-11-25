# Contract 0206 — `GET /macro/scorecard` falls back to the file when the snapshot table doesn't exist

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

**Run after contract 0205.** Both edit `routers/macro.py` and `tests/test_api_macro.py`.

## Goal

After this contract, if the `macro_snapshots` table does not exist, `GET /macro/scorecard` serves
`hard_data/macro_scorecard.json` (200, same ETag behaviour) and logs a warning, instead of
returning 500. Every other database error still returns 500.

## Why

On 2026-11-25 Gunnar ran the local backend with 0204's code. His `.env` points at the production
database, which was still at migration `0010`. Every `GET /macro/scorecard` returned 500 with
`UndefinedTable: relation "macro_snapshots" does not exist`.

Render's build command is only `pip install -r requirements.txt` (REBUILD.md, "Migrations may not
run automatically"). Migrations are applied by hand with `alembic upgrade head`. So any deploy
that ships before that command runs would break the live Macro page the same way.

A missing table means "no snapshot yet". Serving the file is the correct answer to that, not an
outage. Other database errors keep their 500: the 0204 audit decided that silently showing the
2026-11-09 file during a real outage would mislead.

## Files

Modify:
- `backend/app/routers/macro.py`
- `backend/tests/test_api_macro.py`: add tests. Change no existing assertion.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

## Interface

- **Detect the missing table.** In `routers/macro.py`, add a private helper:

  ```python
  def _is_missing_table(exc: DBAPIError) -> bool
  ```

  It returns true when the error is about the snapshot table being missing:
  - **Postgres:** `exc.orig` is `psycopg.errors.UndefinedTable`. Import it lazily, or compare
    `type(exc.orig).__name__ == "UndefinedTable"`, so SQLite-only test runs don't need psycopg.
  - **SQLite:** `str(exc.orig)` starts with `"no such table"`.
- **Fall back.** Where the router reads `latest_snapshot_meta()`, catch
  `sqlalchemy.exc.ProgrammingError` and `sqlalchemy.exc.OperationalError`:
  - if `_is_missing_table(exc)`: log one `logger.warning` naming the table and suggesting
    `alembic upgrade head`, serve the `hard_data` file, and **skip the self-heal check**. The
    upload and price tables may be missing too;
  - otherwise: re-raise.
- **Log only once.** Log the warning at most once per process (a module-level flag), so a page
  view doesn't spam the log.

## Out of scope

- Running migrations automatically, or changing the Render build or start commands.
- Catching anything broader than the missing-table case.
- Any change to `macro_build`, `macro_store` or `macro_prices`.

## Acceptance criteria

1. In `tests/test_api_macro.py`, add:
   - a. A test using `db_mode` with **no** `macro_snapshots` table. Drop it after the fixture
     creates the schema, or create only the other tables. `GET /macro/scorecard` returns 200 with
     the `hard_data` file's exact bytes and its ETag.
   - b. With `latest_snapshot_meta` monkeypatched to raise
     `sqlalchemy.exc.OperationalError("SELECT 1", {}, Exception("connection refused"))`, the GET
     returns 500. Use `TestClient(app, raise_server_exceptions=False)`.
   - c. Two GETs in the missing-table state log the warning exactly once. Use `caplog`.
2. Every pre-existing test in `test_api_macro.py` passes unmodified.
3. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q` passes. Report the count; the baseline is
   the count after 0205.

`BLOCKED` is the correct answer to a criterion that cannot be satisfied as written.

## Verification to run and paste

Paste the **complete, verbatim** output of each command.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/backend
PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_api_macro.py
PATH="$PWD/.venv/bin:$PATH" pytest -q
```

Report every file you edited.

## Human verification — does Gunnar need to run anything?

- **Nothing.** The unit tests cover the fallback.

## Open questions

None.
