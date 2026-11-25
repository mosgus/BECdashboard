# Contract 0205 — Macro hardening: keep the window opener, parse outside the lock, don't retry failed builds

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, three defects found in the 0202–0204 audits are fixed:
1. **The lock can be erased.** Six uploads inside one correction window currently evict the row
   that opened it, so the slot reads as unlocked. After this, the opener is always kept and the
   lock holds.
2. **A slow parse blocks every slot.** Parsing a 4 MB CY workbook (about 13 s on Render) currently
   runs under the module-wide lock. After this, it runs outside the lock, and the gate is checked
   again before the insert.
3. **A failing build reruns on every page view.** After this, an input key whose build failed is
   not retried for an hour.

Two small gaps are closed as well:
- an empty filename falls back to the slot's conventional name;
- non-finite closes are dropped before prices are stored.

## Why

- **The opener (audit of 0202, `contracts/done/0202-*.report.md`).** The window start `T` is
  *derived* from the rows: it is the `uploaded_at` of the newest `opens_window` row. 0202's
  eviction rule didn't protect that row. With a pre-window upload at `T - 25 h` and six uploads
  from `T`, eviction deleted the opener, `T` fell back to `T - 25 h`, and
  `gate(T - 25 h, T + 2 h)` returned `allowed=True`. The planner reproduced this. That defeats the
  vandal limit the window exists for (Gunnar, 2026-11-25).
- **Parsing under the lock.** The lock serialises *all* slots, so one slow CY parse delays
  uploads and reverts everywhere. Checking the gate before the parse still matters, so a locked
  slot never pays for a parse. But the decision that counts is the one made under the lock,
  immediately before the insert.
- **The failure memo (audit of 0204).** A build that raises or emits NaN fails the same way every
  time for the same inputs. Self-healing compares keys on every `GET /macro/scorecard`, so without
  a memo every page view starts another ~90 s failing subprocess.
- **Non-finite closes.** `json.dumps` writes `Infinity`, which Postgres's `json` type rejects. One
  bad close would fail its whole insert batch.

## Files

Modify:
- `backend/app/macro_store.py`
- `backend/app/macro_build.py`
- `backend/app/macro_prices.py`
- `backend/app/routers/macro.py`: pass the key it computed to `request_rebuild`.
- `backend/tests/test_macro_store.py`: update criterion e's tuples and criterion k's count, as
  below, and add the new tests.
- `backend/tests/test_macro_build.py`
- `backend/tests/test_macro_prices.py`
- `backend/tests/test_api_macro.py`: update the `request_rebuild` spy for the new argument. Change
  no other assertion.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

## Interface changes

```python
# app/macro_store.py
def versions_to_evict(rows: Sequence[tuple[int, datetime, bool, bool]],
                      window_opened_at: datetime | None) -> set[int]
# rows are now (id, uploaded_at, reverted, opens_window).
```

**Keep** the union of:
- the `VERSIONS_KEPT` newest rows by `(uploaded_at, id)`;
- the live row (the newest non-reverted one);
- the newest non-reverted row with `uploaded_at < window_opened_at`;
- **the newest row with `opens_window` true.** This is new, and it is kept whether or not it was
  reverted, because `T` is read from it.

Evict every other row.

`store_upload` keeps its order of checks for the name, the size and an unknown slot. Then:
1. **Under `_LOCK`:** read the slot's rows and compute `gate`. If the slot is locked, raise
   `UploadLocked`. Release the lock.
2. **Outside the lock:** run `parse_slot` and let `MacroInputError` propagate.
3. **Under `_LOCK` again:** re-read the rows and **recompute** the gate. If the slot is now
   locked, raise `UploadLocked`. Otherwise insert, with `opens_window` taken from the
   **recomputed** gate, then evict and return the status.

Empty filename: if `_final_component(filename)` is empty, store the slot's `Slot.filename`.

```python
# app/macro_build.py
RETRY_FAILED_AFTER = timedelta(hours=1)
def request_rebuild(key: str | None = None) -> None
```

- **Skip a recently failed key.** If `key` is given, and that key's last build failed less than
  `RETRY_FAILED_AFTER` ago, return without scheduling anything. A `None` key always schedules, so
  a manual trigger can still force a run.
- **Record which key each build attempts.** Before each `_run_worker()` call, the runner records
  the key it is attempting: `current_inputs_key()`, read in the parent.
  - On failure, store `_failed[key] = now`.
  - On success, remove that key.
  - Drop entries older than `RETRY_FAILED_AFTER` whenever the dict is written.
  
  The dict is in-process only, guarded by `_STATE_LOCK`. A restart costs at most one more attempt,
  which is accepted.
- **Pass the key from the router.** `routers/macro.py` passes the key it already computed:
  `request_rebuild(key)`.

```python
# app/macro_prices.py
```

In `store_series`, drop `±inf` along with NaN before storing. A series that is empty after that is
skipped, exactly like an all-NaN series.

## Out of scope

- Routes, the price downloader and the frontend.
- Persisting the failure memo, and any backoff beyond the one-hour rule.
- Changing `gate`, `UPLOAD_WINDOW`, `UPLOAD_LOCK`, `VERSIONS_KEPT` or the revert rules.

## Acceptance criteria

1. Changes to `test_macro_store.py`:
   - **e:** the `versions_to_evict` tests now use 4-tuples. Rewrite them literally, with the opener
     marked:
     - "seven rows, opener is the third" with `T` = the third row's time → still evicts exactly
       the oldest;
     - the same rows with `T = None` and no opener flagged → evicts the two oldest;
     - "six rows, the newest five reverted" → keeps the oldest live row.
     
     Add one case: seven rows one hour apart, none reverted, the **oldest** flagged
     `opens_window`, `T` = that oldest row's time → evicts the second-oldest only. The oldest is
     kept as the opener.
   - **k:** six uploads inside one window, after a pre-window upload at `T - 25 h`, now leave
     **7** rows: the 5 newest, the opener and the pre-window version.
   - **New regression test, the defect itself.** In that same setup, `slot_statuses(T + 2 h)`
     reports that slot's gate as `Gate(False, False, None, T + 24 h)`.
2. New tests in `test_macro_store.py`:
   - **The parse runs outside the lock.** With `parse_slot` monkeypatched to a wrapper that
     asserts `not macro_store._LOCK.locked()` and then calls the real one, `store_upload`
     succeeds.
   - **The gate is recomputed.** On an empty slot, monkeypatch `parse_slot` to a wrapper that
     first inserts an `opens_window=True` row for the same slot, dated `now - 30 min`, directly
     into the database. This simulates a concurrent upload. It then calls the real parser. The
     stored upload must have `opens_window` false (inside the other upload's window). The slot's
     `T` must be the inserted row's time.
   - **Empty filename.** `store_upload(..., filename="dir/", ...)` stores `Slot.filename`.
3. New tests in `test_macro_build.py`, using the existing fake-worker pattern:
   - With `current_inputs_key` monkeypatched to return `"k1"` and the fake raising: after one
     failed run, `request_rebuild("k1")` within the hour does not
     start a run. `request_rebuild("k2")` does. `request_rebuild()` with no key does.
   - After a failed run for `"k1"` that is more than `RETRY_FAILED_AFTER` old, `request_rebuild("k1")`
     runs again. Inject time by monkeypatching the module's clock function, or by setting the
     memo entry's time directly. Say which you did.
   - Monkeypatch `current_inputs_key` so the runner records the attempted key. A successful run
     for a key that previously failed removes it from the memo.
4. New test in `test_macro_prices.py`:
   `store_series({"AAA": pd.Series([1.0, float("inf"), 3.0, float("-inf")], index=pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"]))}, ...)`
   stores closes `[1.0, 3.0]`, and `load_prices()` has index
   `["2026-01-02", "2026-01-06"]` in `datetime64[ns]`.
5. **Planner-run.** `DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py full-db`
   still prints `full-db: IDENTICAL`.
6. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q` passes. Report the count; the baseline is
   1062.

`BLOCKED` is the correct answer to a criterion that cannot be satisfied as written. In particular,
if the recomputed-gate test cannot be written without adding a hook to `macro_store`, say so and
do not add one silently.

## Verification to run and paste

Paste the **complete, verbatim** output of each command. Trimming only the warnings summary of the
full run is fine; say that you did.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/backend
DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py full-db
PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_macro_store.py tests/test_macro_build.py tests/test_macro_prices.py tests/test_api_macro.py
PATH="$PWD/.venv/bin:$PATH" pytest -q
```

Report every file you edited.

## Human verification — does Gunnar need to run anything?

- **Nothing.** No route exposes any of this yet.

## Open questions

None.
