# Contract 0074 — `record_run` takes `now` instead of reading the wall clock

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

The job-run prune measures retention against an injected clock, so
`test_prune_keeps_rows_within_retention` stops failing purely because time passed.

## Why

**The backend suite fails today and will fail every day from here.** Found during the contract 0073
audit, 2026-09-22:

```
FAILED tests/test_jobrun.py::test_prune_keeps_rows_within_retention - assert 1 == 2
```

`jobrun.py:81`:

```python
cutoff = datetime.now(timezone.utc) - timedelta(days=JOB_RETENTION_DAYS)
```

The prune measures against the **real wall clock**. The test pins its fixture at `2026-09-18 10:00Z`
and inserts a row 29 days before *that*, comfortably inside the 30-day window. Today is 2026-09-22, so
the row sits 33 days before the *real* clock and is pruned.

**This is not flaky — it is expired.** It armed itself on 2026-09-19 and gets worse daily. It is
nothing to do with contract 0073, which never touched either file.

`REBUILD.md` already carries the rule this breaks: *"any test touching market state, freshness, or
quotes must pin time explicitly — a suite whose result depends on when it runs is not a suite,"* and
*"the pure/impure split exists so time can be passed in; use it rather than patching a clock."*
`freshness.py`, `schedule.py`, `quotes.py` and every function in `frontend/src/lib/` take `now` as an
argument. `jobrun.py` is the holdout.

The test is **half-pinned**, which is the worst state: `started_at` comes from the fixture and
`finished_at` from the wall clock, so it reads as deterministic and is not.

`jobrun.py:79` already contemplates *"a slow-clock test"* in its docstring. Someone saw this and wrote
prose around it instead of injecting the clock.

## Files

Modify:
- `backend/app/jobrun.py` — `record_run` accepts an optional `now`; the prune uses it.
- `backend/tests/test_jobrun.py` — pass the fixture clock.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not change `JOB_RETENTION_DAYS`, the `job_runs` schema, or any caller's behaviour in production.

**`reference files/` is read-only and never belongs on a file list.**

> **Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string, so an
> unprefixed script talks to the **production database**. `tests/conftest.py` strips the variable for
> `pytest` only.

## Interface

```python
def record_run(job_name: str, started_at: datetime, *, now: datetime | None = None):
    """...
    `now` exists so tests can pin the clock. When None — every production call site — it is read
    at exit exactly as before, so runtime behaviour is unchanged. Retention is measured against the
    same value used for finished_at, never against a second reading of the clock.
    """
```

Rules:

- **`now` is keyword-only** and defaults to `None`. **No production call site changes.** Verify that
  by grep, not by assumption.
- When `now is None`, read `datetime.now(timezone.utc)` **once, at exit**, and use that single value
  for both `finished_at` and the prune cutoff. Today they are two separate readings
  (`jobrun.py:63` and `jobrun.py:81`); collapsing them removes a second source of skew that nobody
  has hit yet but which is the same defect.
- When `now` is supplied, it is used for both. Do not mix an injected clock with a real one — a
  half-pinned test is what produced this bug.
- The prune keeps its `id != keep_id` guard exactly as it is. `REBUILD.md` records why: a superseded
  row is deleted for being superseded **and** past retention, never for being superseded alone.

In `test_jobrun.py`, pass `now=now` at every `record_run` call so the fixture clock governs both the
row and the prune. **Do not change the fixture date to "today"** — a test that only passes near its
authoring date is the bug, not the fix.

## Out of scope

- Do not widen `JOB_RETENTION_DAYS` or add a tolerance to the cutoff. The retention rule is correct;
  the clock source was wrong.
- Do not change what gets pruned, or the `keep_id` guard.
- Do not thread `now` through `autorefresh.py`, `news.py`, or any caller — the default preserves them.
- Do not touch any other test file, even one with the same shape. If you find another wall-clock
  dependency, **report it in the report** rather than fixing it; it gets its own contract.
- Do not add a freezegun-style dependency. Injection is the project's established pattern.
- No new dependency.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count — it was
   `1 failed, 459 passed`.
2. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest tests/test_jobrun.py -q` exits 0.
3. **The test must pass independent of the date.** Demonstrate it by running the jobrun tests with the
   fixture date deliberately far in the past — temporarily set `_now()` to a date **90 days** before
   today, confirm the suite still passes, then restore the original value. Paste both runs and confirm
   the file is back to its original `_now()`. This is the criterion that proves the bomb is defused
   rather than reset.
4. `grep -rn "record_run(" backend/app/` shows every production call site unchanged — none passes
   `now`. Quote them.
5. `grep -n "datetime.now" backend/app/jobrun.py` prints **exactly one** line. Two readings of the
   clock in one function was a latent second bug.
6. `grep -n "keep_id" backend/app/jobrun.py` still shows the guard in the delete.
7. A test asserts that with an injected `now`, a row exactly `JOB_RETENTION_DAYS + 1` days before it is
   pruned and one at `JOB_RETENTION_DAYS - 1` days is kept — both measured against the injected value,
   not the wall clock.
8. `grep -n "slow-clock test" backend/app/jobrun.py` — either the docstring still describes real
   behaviour, or it is corrected. State which and why. A docstring left describing a hazard that no
   longer exists is the same defect contract 0073 fixed in `get_strip`.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest tests/test_jobrun.py -q
grep -rn "record_run(" app/
grep -n "datetime.now" app/jobrun.py
grep -n "keep_id" app/jobrun.py
grep -n "slow-clock" app/jobrun.py
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain backend/
```

For criterion 3, paste the temporary `_now()` value you used, both pytest runs, and the `git diff` of
`test_jobrun.py` afterwards showing `_now()` restored.

## Tooltips

Not applicable — backend only.

## Human verification — does Gunnar need to run anything?

**Nothing to run.** No visible surface changes and no production behaviour changes: every existing
call site keeps reading the wall clock exactly as it does today. The suite passing on a date that is
not 2026-09-18 is the whole verification.

If you want the one-line confidence check after it lands:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

It should report `0 failed` — which it has not done since 2026-09-19.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
