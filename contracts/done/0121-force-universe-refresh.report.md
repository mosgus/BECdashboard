# Report: Contract 0121

**Outcome:** BLOCKED (run 1), then revised. See Audit.
**Agent:** sonnet

## What was claimed

- Everything in the contract was implemented.
- Backend 671 passed. Frontend 181 passed, and tsc and lint exited 0.
- BLOCKED on criterion 5, because its grep could not match the existing `/{ticker}` line.

## Audit

**The BLOCKED was correct, and so is the code. The defect was the planner's.** Criterion 5 grepped `@router.get("/{ticker}")` with a closing parenthesis. The real line is `@router.get("/{ticker}", response_model=UniverseDetail)`, so the criterion could not pass on any correct implementation. This is checklist item 3 (does the pattern match the construct the code actually uses?), missed while drafting. The coder did the right thing: it reported the conflict instead of editing a working route declaration to satisfy a grep. That is exactly the 0067 precedent inverted, and it is the behaviour to keep.

**Re-run by the planner, not taken from the report:**
- Backend: `pytest -q` gives 671 passed. The four targeted files give 46 passed.
- Frontend: `tsc -p tsconfig.app.json --noEmit` OK; lint shows only the two pre-existing warnings (HelpSidebar, UniversePage:60); vitest 181 passed.
- Route order: `sweep_status` is at 278, `/{ticker}` at 284.
- `force=True` appears nowhere in the new paths.
- There are 2 `<Tooltip` elements, 0 `title=` attributes and 0 timers in `SystemHealthCard`.
- `tests/test_autorefresh.py` is unchanged from HEAD. It is absent from `git status`, so the refactor into `_refresh_tickers` passed the original automatic-path tests unmodified.

**What is good, concretely:**
- `run_manual_refresh` never acquires the lock, and releases it in `finally` on every path, including the no-database early return.
- The router computes both timestamps *before* `try_begin_manual_refresh()`, so nothing that can raise sits between acquire and `add_task`.
- `watchSweep` guards both the resolve and reject branches with `cancelled`, and catches a synchronous throw from `poll`.
- Test (f) monkeypatches `refresh_quotes_if_stale` to raise, which actually proves the quote fetch is forced.
- Test (e)'s one-argument lambda turns any `force=` into a `TypeError`.

**The one gap: test 2(i) does not test the thing that matters.** `test_manual_refresh_keeps_an_existing_window_claim` asserts the claim is unchanged, but not that the sweep *ran*. It has no ticker, no `refresh` recorder and no job-run check. A `run_manual_refresh` that bailed out on a claimed window would pass it. Running on a claimed window is the reason the button exists: the restart-mid-sweep hole. The code is correct today (`record_run` sits outside the `needs_auto_refresh` branch); only the test fails to pin it.

**Minor, not blocking:**
- The timeout note `Still running — check Job history shortly.` renders in `text-brand-negative`, because it shares `forceError`. It reads as an error, which it isn't. Accepted as is: the contract said "inline note" without specifying a colour, so this was the coder's call.
- The `routers/ops.py` docstring dropped the "no catch-all here, so route-ordering does not apply" note. That is harmless; it is still true.
- The Force update button stays enabled between the click and the POST response, so a double-click sends two POSTs. The second gets a 409 and joins the watch. Harmless by design.

**Fix:** contract revised in place with a `REVISED` banner. Criterion 5's grep is corrected, and the only work is strengthening test 2(i). Re-run in a fresh Sonnet session.

## Audit — run 2 (2026-09-28): **accepted**

The revision did exactly the one thing asked. `test_manual_refresh_keeps_an_existing_window_claim`
now adds `AAPL`, records `refresh`, and asserts all three: the claim is unchanged, `refreshed == ["AAPL"]`,
and a `universe_refresh_manual` job row exists. A `run_manual_refresh` that bailed on a claimed window
now fails it, so the restart-mid-sweep case the button exists for is pinned by a test, not
only by a code read. The planner re-ran `pytest -q` (671 passed). Only the test file changed; every
production file is as audited in run 1. Leaving `Status:` alone per the revision's one-file limit was
correct; the planner set it.
