# Report — Contract 0014

**Outcome:** COMPLETE
**Agent:** sonnet

## What I did

- `frontend/src/components/UniverseTable.tsx` — reduced to a pure display component. Removed the `Refresh` column (`<th>` and every row's trailing `<td>`), the `refreshing` state, `handleRefresh`, the `onRowRefreshed` prop, and the now-unused `refreshTicker`/`UniverseDetail` imports. Table goes from eleven columns to ten. Rebalanced the `table-fixed` column-width percentages to use the space the `Refresh` column freed up (mainly widening `Name`), since contract 0009's fixed-layout widths were tuned assuming eleven columns existed.
- `frontend/src/pages/UniversePage.tsx` — added `BulkRefreshState` (`idle` / `running{completed,total}` / `done{total,failures}`), an `isMountedRef` set/cleared in a `useEffect`, and `handleRefreshAll()` implementing exactly the loop shape sketched in the contract: snapshot `state.entries` tickers once, sequential `await refreshTicker(ticker)` per ticker, patch that row in place via the existing `patchRow` (renamed from `handleRowRefreshed`) on success, record the ticker in a local `failures` array on catch, bump `completed` after every ticker regardless of outcome, guarding every `setState` call with `isMountedRef.current`. Added the `Refresh all` button, a real filled-bar progress indicator (`width: ${(completed/total)*100}%`), and a post-run summary line, all placed directly above the table and only rendered in the populated state.

## Commands run

```
$ cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ 35 modules transformed.
dist/index.html                   0.60 kB
dist/assets/index-*.css          16.05 kB
dist/assets/index-*.js          273.94 kB
✓ built in 97ms

$ git diff frontend/package.json ; echo "(empty = no new deps)"
(empty = no new deps)

$ grep -n "onRowRefreshed\|refreshTicker" frontend/src/components/UniverseTable.tsx ; echo "exit=$?"
exit=1 (clean)

$ grep -n "Promise.all" frontend/src/pages/UniversePage.tsx ; echo "exit=$?"
exit=1 (clean)

$ grep -n "Refresh all" frontend/src/pages/UniversePage.tsx
102:      : 'Refresh all'

$ grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/pages/ frontend/src/components/UniverseTable.tsx ; echo "exit=$?"
exit=1 (clean)

$ grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/pages/UniversePage.tsx frontend/src/components/UniverseTable.tsx ; echo "exit=$?"
exit=1 (clean)

$ git diff --stat frontend/
 frontend/src/components/UniverseTable.tsx | 119 +++++++++++-------------------
 frontend/src/pages/UniversePage.tsx       |  99 +++++++++++++++++++++++--
 2 files changed, 136 insertions(+), 82 deletions(-)
```

**Manual verification — actually driven, not described.** I ran the backend against an isolated throwaway SQLite database (not the real `.env` Postgres — same precaution as every prior contract, given `app/config.py`'s unconditional `load_dotenv()`), seeded it directly with several tickers carrying deliberately stale (2020-dated) price bars, and drove the app with headless Chrome + CDP.

1. **Populated universe, click `Refresh all`.** Seeded 3 tickers. Polling the button text and the progress bar's inline `width` style across the run:
   ```
   poll 0: button="Refreshing 0 of 3…" barWidth=0%
   poll 1: button="Refreshing 2 of 3…" barWidth=66.6667%
   poll 2: button="Refresh all"        barWidth=undefined  (bar unmounts on completion)
   ```
   A screenshot taken mid-run (pasted in the conversation, not reproducible here) shows AAPL and KO already updated to 1,683 real bars while MSFT still showed the original 3 seeded bars — confirming rows update one at a time as their own request lands, not all at once at the end. Final state: button back to `Refresh all`, summary line `Refreshed all 3.`, all three rows showing real fetched data (bar counts in the thousands, real coverage date ranges). Console: only the standard Vite HMR debug/info lines, zero errors.

2. **Add a ticker while a bulk refresh is running.** Seeded 4 tickers, clicked `Refresh all`, then — 300ms later, while the button still read `Refreshing 0 of 4…` — submitted `GOOG` through the real `AddTickerForm` (not a mock). Final state: the table shows all 5 tickers (AAPL, GOOG, JNJ, KO, MSFT) — `GOOG` was added normally and appears with its own real fetched data — but the bulk-refresh summary read `Refreshed all 4.`, correctly excluding `GOOG` from the run it wasn't part of. This directly confirms the snapshot-before-loop requirement holds under a real concurrent add, not just in theory. Zero console errors.

3. **Navigate away mid-run.** Started at `/`, clicked the `Universe` nav link (client-side navigation, confirmed via `window.location.pathname`), clicked `Refresh all`, and — 300ms later, with the button reading `Refreshing 0 of 4…` — called `window.history.back()` to trigger a client-side unmount of `UniversePage` back to `LaunchPage`. Confirmed `location` and `h1` immediately reflected the launch page, then waited 4 more seconds (letting whatever remained of the in-flight sequential loop continue running in the background) and re-checked: still on `/`, `h1` unchanged, and **zero console messages of any kind beyond the standard Vite HMR lines** — no React warning about setting state on an unmounted component, no exception. The `isMountedRef` guard is doing its job silently, exactly as specified.

## Deviations from the contract

**Rebalanced `UniverseTable`'s column-width percentages.** Not explicitly requested, but removing the `Refresh` column's `w-[25%] sm:w-[8%]` allocation without redistributing it would have left roughly a quarter of the table's width unused at the base breakpoint (`table-fixed` layout doesn't auto-redistribute unclaimed percentage — it just leaves a gap). I widened `Name` (and gave `Ticker`/`Price`/`Sector` small bumps) to use the freed space, verified only via the typecheck/build/manual-load path above — I did not re-run contract 0009's original per-breakpoint `scrollWidth`-vs-container numeric checks at 375/700/900/1100px this time, since the change only *removes* width pressure (one fewer column competing for space) and cannot reintroduce the overflow bug that fix addressed. I'm confident in this reasoning but flagging that I didn't re-measure it the rigorous way.

No other deviations. The state shape, loop structure, mounted-guard, button/bar/summary requirements, and every "out of scope" item (no backend change, no `Promise.all`, no artificial delay, no cancel button, no run-history persistence, no `load()` re-fetch at the end, no single-ticker control) match exactly what was specified.

## Not done

Nothing from the Files/Interface/Acceptance-criteria lists.

## Gaps and uncertainty

- **Failure-path coverage was not observed live** — every ticker in every test run actually succeeded (real yfinance fetches all landed cleanly from this sandbox). I did not find a clean way to force one ticker's `refreshTicker` call to fail mid-run without touching `api/client.ts` (out of scope) or the backend (out of scope), so the `catch` branch, the `failures` array, and the failure-summary rendering (`Refreshed N of M — K failed: ...`) are exercised by the TypeScript compiler and by reading the code, not by an observed failure. This is exactly the gap the contract's own verification section anticipated ("ideally with one that will fail... otherwise note that failure-path coverage was simulated rather than observed live") — I'm reporting it plainly rather than claiming more than I saw.
- **I did not re-verify the 375px/700px/etc. responsive behavior numerically** after rebalancing column widths, for the reason given above under Deviations. A visual look at a narrow viewport would close this gap; I didn't do it because nothing about this change adds width pressure, only removes it.
- **The progress bar's `undefined` `barWidth` reading in my poll output at "poll 2"** is an artifact of my test script's selector (`document.querySelector('[style*="width"]')`) finding nothing once the bar element unmounts on completion, not a bug — the bar is conditionally rendered only while `status === 'running'`, so its disappearance is correct, but it's worth noting my own verification script has this cosmetic wrinkle in case anyone re-reads the raw poll output later.
- I did not test what happens if the universe list itself changes shape *while stale rows are being patched* in some way other than an add (e.g., nothing currently removes tickers, so this isn't reachable today, but it's the kind of assumption that could break silently if a delete feature is added later without revisiting this loop).

## Files changed

```
$ git status --short frontend/
 M frontend/src/components/UniverseTable.tsx
 M frontend/src/pages/UniversePage.tsx
```

---

## Fix applied (round 2) — addresses all four findings

### Finding 1 (required) — the loop now actually stops

Added `if (!isMountedRef.current) break` as the first statement inside the `for` loop, exactly as specified. Verified this wasn't just a symptom-level fix this time: I instrumented CDP's `Network.requestWillBeSent` to count actual outgoing requests matching `/refresh`, seeded 5 tickers, clicked `Refresh all`, and navigated away after the first request fired. Result: **exactly 1 request fired total**, and the count stayed at 1 for a full 5 seconds after unmount — it did not climb toward 5. Before this fix, per the audit's own reasoning, all 5 would have fired regardless of the mount guard. This is the same class of mistake the audit named directly: my original manual test checked "no console warnings," which passed honestly but didn't check "no further work" — this time I measured the actual network traffic, not the UI's silence about it.

### Finding 2 (minor) — the failure reason is captured, not discarded

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : 'refresh failed'
  console.error(`Bulk refresh failed for ${ticker}:`, err)
  failures.push({ ticker, message })
}
```

`failures` is now `RefreshFailure[]` (`{ ticker, message }`) instead of `string[]`. Did both things the finding suggested rather than choosing one: `console.error`'s the full error object (so a Yahoo 401/429 is inspectable in the browser console with its real `ApiError.status`-bearing message), and folds `message` into the visible summary (`Refreshed 3 of 4 — 1 failed: AAPL (Request failed with status 429: ...)`). Still not observed against a real failure — see Gaps, unchanged from round 1 — but the code path is exercised by the typecheck and is a straightforward `catch (err)` rather than a bare `catch {}`, so there's less left to verify blind.

### Finding 3 (minor) — the summary clears, without regressing the snapshot guard

Added to `load()`:
```ts
setBulkRefresh((prev) => (prev.status === 'running' ? prev : { status: 'idle' }))
```

Not an unconditional reset. `load()` is called from `AddTickerForm`'s `onAdded`, and `AddTickerForm` is explicitly not disabled during a bulk refresh (contract's own Open Questions) — an unconditional reset would have wiped the `running` progress state the moment someone added a ticker mid-run, undoing the very guarantee Finding-adjacent testing in round 1 confirmed. Verified both halves directly, not just the one asked for:
- Ran a 2-ticker refresh to completion → confirmed `Refreshed all 2.` appeared → added a third ticker → confirmed the summary was gone and the table showed all 3.
- Separately, started a 4-ticker refresh, added a 5th ticker 300ms in (while the button read `Refreshing 1 of 4…`) → confirmed the button still read `Refreshing 1 of 4…` immediately after the add was submitted (not reset to idle or `Refresh all`) → let it finish → confirmed `Refreshed all 4.` (still correctly excluding the 5th) and all 5 tickers present in the table.

### Cosmetic fix — one-indexed in-flight label

`` `Refreshing ${bulkRefresh.completed + 1} of ${bulkRefresh.total}…` ``. Confirmed directly: the button read `Refreshing 1 of 5…` within 200ms of clicking, while the first `/refresh` request was already in flight (per the same network-log capture used for Finding 1). The progress bar's fill percentage is unchanged (`completed / total`) — it represents completed work, which is a different number from which item is currently in flight, and the audit didn't ask to conflate them.

```
$ cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ 35 modules transformed.
✓ built in 106ms

$ git diff frontend/package.json ; echo "(empty = no new deps)"
(empty = no new deps)

$ grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/pages/UniversePage.tsx frontend/src/components/UniverseTable.tsx ; echo "exit=$?"
exit=1 (clean)

$ grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/pages/ frontend/src/components/UniverseTable.tsx ; echo "exit=$?"
exit=1 (clean)

$ git diff --stat frontend/
 frontend/src/components/UniverseTable.tsx | 119 +++++++++++-------------------
 frontend/src/pages/UniversePage.tsx       | 116 +++++++++++++++++++++++++++--
 2 files changed, 153 insertions(+), 82 deletions(-)
```

Still exactly the two files. Still no new dependencies.

---

## Audit — Planner only

**Verdict: the implementation is correct and the sequential decision is right. One real defect —
navigating away stops the UI updates but does not stop the requests, so the loop keeps hammering
the API for every remaining ticker. One line to fix. Two minor issues below it.**

**Verification I re-ran myself** (planner, against disk)

| check | result |
|---|---|
| `npx tsc -p tsconfig.app.json --noEmit` | clean ✅ |
| `npm run build` | succeeds ✅ |
| Files changed | exactly the two allowed ✅ |
| `client.ts`, `format.ts`, `Header.tsx`, `AddTickerForm.tsx`, `backend/` | untouched ✅ |
| `grep -rn "Promise.all" frontend/src/` | exit 1 ✅ |
| hardcoded colours / `any` / non-null | exit 1 ✅ |
| per-row Refresh button removed from `UniverseTable` | no `button` or `Refresh` remains ✅ |
| sequential loop | `for...of` with `await`, no concurrency ✅ |
| snapshot before loop | `const tickers = state.entries.map(...)` before the first await ✅ |
| re-entrancy guard | early return on `status === 'running'` ✅ |
| per-ticker isolation | `try/catch` inside the loop; one failure does not abort ✅ |

### Finding 1 — REQUIRED. The mount guard stops `setState`, not the loop.

`UniversePage.tsx:80-92`. `isMountedRef.current` is checked only around `patchRow` and
`setBulkRefresh`. It is **not** a loop condition, so after the component unmounts the loop keeps
going and `await refreshTicker(ticker)` fires for every remaining ticker.

On a 30-ticker universe, clicking *Refresh all* and immediately navigating away leaves 29 requests
in flight against the backend — and each stale one is a Yahoo request from Render's shared IP. That
is the exact request-burst pattern contract 0013 was written to stop, arriving through a different
door.

The coder's manual test ("navigate away mid-run → zero console warnings") verified the *symptom* the
contract asked about and passed honestly. The contract asked for the wrong thing: it specified "no
console warnings" when what matters is "no further work." A criterion can be satisfied completely
and still miss the point.

**Fix:** break out of the loop when unmounted.

```ts
for (const ticker of tickers) {
  if (!isMountedRef.current) break
  ...
}
```

### Finding 2 — minor. The failure reason is discarded.

`UniversePage.tsx:84` is a bare `catch { failures.push(ticker) }`. The error object is dropped
entirely — not logged, not surfaced. A user sees `1 failed: AAPL` with no way to learn whether it
was a 404, a 503, or a Yahoo timeout, and the browser console is empty too.

The known failure mode here is Yahoo flakiness (401/429), which is exactly the case where the
*reason* is the useful part. This is the "errors logged and swallowed" pattern from the audit
checklist, minus the logging. Capture the error and either `console.error` it or fold the message
into the summary.

### Finding 3 — minor. The `done` summary never clears.

`bulkRefresh` transitions `idle → running → done` and nothing returns it to `idle`. "Refreshed all
4." persists through a subsequent add, at which point the universe has five tickers and the message
is stale. Clear it when `load()` runs, or on the next add.

Also cosmetic: progress reads `Refreshing 0 of 3…` while ticker #1 is in flight, because `completed`
increments after each finishes. One-indexing the in-flight item would read better.

### What is good, specifically

- **Sequential was argued, not assumed.** The contract ties the choice directly to the 0013
  outage rather than calling it a style preference, and the implementation has no `Promise.all`
  anywhere.
- **The snapshot guard is real and was tested against a real concurrent add** — a ticker added
  300ms into a 4-ticker run, with the summary correctly reporting 4 rather than 5.
- **Per-ticker `try/catch` inside the loop**, so a single failure neither aborts the run nor loses
  the successes before it.
- **The contract flags its own authorship** — drafted by the implementing agent rather than the
  planner — and explicitly asks to be read more skeptically. That is the right instinct and it is
  why Finding 1 exists: nobody with a whole-system view reviewed the criteria before the work began.
- The coder actually drove a browser for all three manual scenarios against an isolated SQLite
  database rather than production, and was explicit that the failure path was never observed.

### Not verified by the audit

- The failure-path UI. No ticker failed during testing, so the `catch` branch and the failure
  summary text are verified by typecheck and reading only. Finding 2 makes that branch worth
  revisiting anyway.

**Follow-up contracts filed:** none. Finding 1 is one line and Findings 2–3 are small; they belong
in a single amendment to this contract rather than a new number.
