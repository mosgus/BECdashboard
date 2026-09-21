# Report — Contract 0073 (Strip quote freshness)

**Verdict: accepted.** The `BLOCKED` was correct and the blocker is a pre-existing time bomb in an
unrelated module, filed as contract 0074.

## Verified independently

`quotes_stale` is wired end to end — `schemas.py:92`, `strip.py:154/183/218`, `client.ts:85`,
`TickerStrip.tsx:68`. The market-open gate is right where it has to be (`strip.py:181-183`): the flag
is only raised inside the `else` branch **and** under `if market_open`, so the after-hours session-move
fallback never asks a client to refetch.

Three tests cover the three states, including
`test_quotes_stale_is_false_after_hours_even_with_an_ancient_quote` — the one that protects contract
0028's decision.

The third background task is in place (`routers/universe.py:124`) as a zero-argument
`_refresh_strip_quotes` wrapper, which the contract permitted. `grep "stays owned by list_all"` is
empty, so the docstring that contradicted the new behaviour is gone.

Frontend: one `setTimeout`, one `clearTimeout` on unmount, **no `setInterval`**. A second refetch
cannot be chained.

459 backend tests pass. The only failure is below.

## The blocker is real, pre-existing, and worth the stop

`tests/test_jobrun.py::test_prune_keeps_rows_within_retention`, `assert 1 == 2`.

`jobrun.py:81` computes its prune cutoff from `datetime.now(timezone.utc)` — the **real wall clock** —
while the test pins its fixture at `2026-09-18 10:00Z`. The test inserts a row 29 days before the
*fixture* clock, inside the 30-day retention. Today is 2026-09-22, so that row is 33 days before the
*real* clock and gets pruned.

**It armed itself on 2026-09-19 and will fail every day from now on.** It is not flaky; it is expired.

Confirmed unrelated to this contract: `git status` shows neither `jobrun.py` nor `test_jobrun.py` was
touched, and the mechanism is independent of anything the strip does.

The coder was right to stop rather than edit an out-of-scope file, and criterion 9 — full suite exits
0 — did exactly the job `REBUILD.md` asks of it: *"Run the full backend suite at the start of every
audit, whatever the contract's domain,"* recorded after the suite sat broken for two contracts without
anyone noticing. It caught a defect nobody was looking for.

Accepting 0073 rather than holding it: its own work is complete and verified, and blocking a fix
Gunnar is waiting on behind an unrelated expired fixture helps nobody. Contract **0074** repairs the
clock dependency.

## Note on `jobrun.py:79`

The docstring already contemplates *"a slow-clock test"* as a case the prune must survive. Someone saw
this and wrote around it instead of injecting the clock. Worth remembering when 0074 is audited: the
fix is not a wider tolerance, it is passing `now` in — the discipline every other pure module here
already follows.

## Still outstanding

Gunnar's browser check, which must happen **during market hours** — the bug is invisible when the
market is closed.

## Status

Accepted and archived.
