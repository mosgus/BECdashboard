# Contract 0196 — `GET /universe/sweep_status` also schedules the due sweep

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, `GET /universe/sweep_status` schedules `run_auto_refresh_if_due` as a
background task, the same way `GET /universe/strip` does. The response body is unchanged.

## Why

`is_sweep_active` returns true when the sweep lock is held, **or when a window is due and nobody
has claimed it yet** (contract 0121/0122; REBUILD.md, "A forced sweep exists for one case"). That
second term covers the short gap between `/universe/strip` scheduling the sweep and the task taking
the lock. It assumes a strip request is always on the way.

That assumption breaks in a long-lived browser session. `TickerStrip` fetches `/universe/strip`
once, on a full page load. Suppose someone loads the app at 11:50 ET and, at 12:05, clicks through
to `/universe` without reloading. `sweep_status` reports `active: true` because 12:00 is due and
unclaimed. But no strip request is coming, so no sweep starts. The Universe page then shows
"Updating universe data" for its full 10-minute watch timeout while nothing runs. This bug exists
today.

Contract 0197 makes the frontend check `sweep_status` on every route change, which would spread
this false spinner to every page. The fix belongs here: if the status endpoint reports a due sweep,
it also starts that sweep. `run_auto_refresh_if_due` already returns immediately when the lock is
held or the window is claimed, so frequent polls cost one `app_state` read each.

Only the universe sweep is scheduled, because that is what `sweep_status` reports on. News, FF3
and strip quotes stay strip-only.

## Files

Modify:
- `backend/app/routers/universe.py`: `get_sweep_status` takes `background_tasks: BackgroundTasks`
  and schedules the sweep. Rewrite its docstring to say why.
- `backend/tests/test_api_ops.py`: patch the router's `run_auto_refresh_if_due` in the existing
  `sweep_status` test, and add the two tests below.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

```python
@router.get("/sweep_status", response_model=SweepStatus)
def get_sweep_status(background_tasks: BackgroundTasks) -> dict:
    _require_database()
    now_utc = datetime.now(timezone.utc)
    now_et = datetime.now(ZoneInfo("America/New_York"))
    background_tasks.add_task(run_auto_refresh_if_due, now_utc, now_et)
    return {"active": is_sweep_active(now_et)}
```

- `_require_database()` stays first, so a 503 schedules nothing.
- `is_sweep_active` is evaluated in the request. The background task runs after the response is
  sent, so in a due window the response still reports `active: true`. That is correct: the sweep is
  about to start.
- Every name used is already imported in `universe.py` (`BackgroundTasks`, `datetime`, `timezone`,
  `ZoneInfo`, `run_auto_refresh_if_due`, `is_sweep_active`). Add no imports to the router.

## Out of scope

- Do not schedule `run_news_refresh_if_due`, `run_ff3_refresh_if_due` or `_refresh_strip_quotes`
  from `sweep_status`.
- Do not change `is_sweep_active`, `run_auto_refresh_if_due`, `_LOCK` or `app/schedule.py`.
- Do not edit `get_strip` or its docstring.
- Do not change the `SweepStatus` response model.
- No frontend changes. Contract 0197 covers those.

## Acceptance criteria

1. `grep -n "def get_sweep_status(background_tasks: BackgroundTasks)" backend/app/routers/universe.py`
   prints exactly one line.
2. `grep -c "background_tasks.add_task(run_auto_refresh_if_due, now_utc, now_et)" backend/app/routers/universe.py`
   prints `2`: the strip's existing call and the new one.
3. The existing `test_sweep_status_route_returns_a_boolean_active_value` patches
   `app.routers.universe.run_auto_refresh_if_due` with a no-op. Without the patch it would run a
   real sweep against the test database and write a `job_runs` row. Its assertions are unchanged.
4. New test `test_sweep_status_schedules_the_auto_refresh` (uses `db_mode`): patch
   `app.routers.universe.run_auto_refresh_if_due` with a spy that records its arguments, then
   `GET /universe/sweep_status`. Assert:
   - status 200;
   - the spy was called exactly once;
   - it received two positional arguments, both `datetime` instances with non-`None` `tzinfo`.
5. New test `test_sweep_status_without_a_database_schedules_nothing` (no `db_mode`): patch the same
   name with a spy, then `GET /universe/sweep_status`. Assert status 503 and zero spy calls.
6. `pytest` passes in full. The baseline before this contract is 901 passed. Report the new
   count, which should be 903.

`BLOCKED` is the correct answer if any criterion cannot be satisfied as written, for example if a
name listed as already imported is not. Do not work around a criterion.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
grep -n "def get_sweep_status(background_tasks: BackgroundTasks)" backend/app/routers/universe.py
grep -c "background_tasks.add_task(run_auto_refresh_if_due, now_utc, now_et)" backend/app/routers/universe.py
(cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_api_ops.py)
(cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q)
```

## Human verification — does Gunnar need to run anything?

- **Nothing to run for this contract alone.** It has no visible surface of its own. Contract
  0197's human check covers the user-facing result.

## Open questions

None.
