# Report — Contract 0205 (macro hardening)

## Audit

**Accepted, 2026-11-25 (planner).** I re-ran the checks myself:
- `full-db` is IDENTICAL.
- The full suite passes at 1082, including 0206's 3 tests.

I read the eviction rule, the three-step `store_upload` and the runner.
- **The opener is kept:** `versions_to_evict` adds the newest `opens_window` row whether or not it was reverted. The regression test pins `Gate(False, False, None, T+24h)` at `T+2h`.

**Two deviations, both correct, and the first one closes a hole in the planner's spec:**
1. **Follow-up runs re-check the failure memo.** The contract skipped failed keys only at request time. A GET arriving while a failing build runs passes that check, because the failure isn't recorded yet. It sets `_pending`, and the follow-up then reruns the same failing key. Under steady traffic that is back-to-back failing builds again, the very thing goal 3 forbids. The coder exempts only the first, explicitly requested run, which keeps a key-less manual trigger able to force a build. **The known corner is acceptable:** a key-less request made *during* a build whose key then fails is skipped as a follow-up.
2. **`_attempted_key` catches exceptions from reading the key.** An exception there would kill the runner thread with `_running` stuck true, blocking all builds until a restart. The catch guards only the memo bookkeeping, logs the error, and never skips the build. This is the right use of a broad catch.

**Still open, as before:** none of this has run on Postgres. The first real exercise is the routes contract's production check.
