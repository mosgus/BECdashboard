# Report — Contract 0204 (rebuild job and serving)

## Audit

**Accepted, 2026-11-25 (planner).** I re-ran the checks myself:
- The migration SQL creates only `macro_snapshots`.
- `python -m app.macro_build` with no database prints `no database` and exits 0.
- `full-db` is IDENTICAL.
- The full suite passes at 1062, with the 14 pre-existing API tests unmodified.

**Good judgment calls:**
- **The `_running` flag instead of `thread.is_alive()`.** It closes a real lost-request race, where a request lands between the runner deciding to exit and the thread dying.
- **Keeping the stderr tail intact** within `record_run`'s 500-character cap.
- **Falling back to the file when a snapshot is pruned** between the router's two reads.

**A gap in the contract, fixed by 0205: self-heal retries a failing build on every page view.** A key whose build fails deterministically (it raises, or it emits NaN) never matches a snapshot. So every GET requests a rebuild, and that means a ~90 s failing subprocess back to back for as long as people view the page. 0205 adds a failure memo: a key that failed is not retried for 1 hour.

**Accepted as-is:**
- **A database error in the router returns 500.** Silently falling back to the 2026-11-09 file during an outage would show stale data as if it were current.
- **The id-keyed body cache.** Ids are never reused in production.
- **Postgres paths are verified only through offline SQL.** The first real exercise is the routes contract's production check. Watch `DELETE … NOT IN (SELECT … LIMIT 3)` there; Postgres accepts that form.
