# Contract 0197 — One app-wide sweep watcher, shown in the header

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

**Depends on contract 0196.** Run 0196 first. Without it, checking `sweep_status` on every route
change shows a false spinner in long-lived sessions (0196's Why explains this).

## Goal

After this contract:
- a single module-level store watches the universe sweep;
- a spinner reading "Updating universe data" appears in the sticky header on every page while a
  sweep runs;
- the shared portfolio request cache is cleared whenever a watched sweep ends, whichever page the
  user is on.

## Why

Navigating away during a sweep was always safe. The sweep is a server-side `BackgroundTasks` job
(`app/autorefresh.py`), and no client request keeps it alive. What navigation breaks is **knowing
about** the sweep, and the cache cleanup that should follow it:

1. **The scheduled sweep never clears `sharedRequests`.** `UniversePage`'s watcher reloads only its
   own table when the sweep ends. Portfolio tabs that loaded during the sweep keep serving
   pre-sweep results for up to the 10-minute TTL, even after the Universe table shows new data.
   Contract 0194 added cache invalidation for add, delete and the *forced* refresh, but not for the
   scheduled sweep.
2. **A forced refresh from `/ops` loses its cleanup if you leave the page.** `SystemHealthCard`'s
   watcher clears the cache when the sweep finishes, but it is cancelled on unmount. Click
   "Force update", go to Portfolios, and the clear never runs.
3. **The indicator exists only on `/universe`.**

All three have one cause: the watcher belongs to a page. Moving it into a module-level store that
the header renders fixes all three.

**Where it goes.** The indicator goes in the header, not in a banner above each page. The header is
`sticky` and has spare width beside `BackendStatus`, so the indicator stays visible while scrolling
and its appearing or disappearing never moves page content. A full-width banner would push every
page's layout down mid-read. REBUILD.md already decided against spending vertical space this way
(the strip is "deliberately **not** sticky … so the Universe table keeps its vertical space").

**What happens when a sweep ends.** Open analysis pages are **not** re-fetched. The cache is cleared,
so the next tab or page the user opens fetches fresh data. The page currently on screen keeps its
numbers. This is deliberate. A sweep normally adds one day's bar, and Monte Carlo, frontier and
risk results jumping mid-read for a one-day change is worse than one tab being a day behind. The
tooltip says so. The Universe table keeps its silent reload, as today.

## Files

Create:
- `frontend/src/lib/sweepStore.ts`: `createSweepStore` and the app-wide `sweepStore` instance.
- `frontend/src/lib/sweepStore.test.ts`: the tests in criterion 6.
- `frontend/src/components/SweepIndicator.tsx`: the header spinner.

Modify:
- `frontend/src/components/Header.tsx`: render `<SweepIndicator />` immediately before
  `<BackendStatus />`.
- `frontend/src/pages/UniversePage.tsx`: delete its `watchSweep` effect, the `sweeping` state and
  the "Updating universe data" paragraph. Subscribe to `sweepStore.onEnded` to call
  `reloadSilently`.
- `frontend/src/components/SystemHealthCard.tsx`: call `sweepStore.check()` in `beginWatching`.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. In particular, `lib/sweepWatch.ts` is reused as-is.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

```ts
// frontend/src/lib/sweepStore.ts
export interface SweepStoreOptions {
  poll: () => Promise<{ active: boolean }>
  intervalMs: number
  timeoutMs: number
}

export interface SweepStore {
  /** Current value. Stable between changes, so it is a valid useSyncExternalStore snapshot. */
  isActive: () => boolean
  /** Called whenever isActive() changes value, and only then. Returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void
  /** Called once each time a watch that saw `active: true` later sees `active: false`.
   *  Not called on timeout. Not called when a watch never saw an active poll. Returns an
   *  unsubscribe function. */
  onEnded: (listener: () => void) => () => void
  /** Starts a watch unless one is already running; if so, does nothing. */
  check: () => void
}

export function createSweepStore(options: SweepStoreOptions): SweepStore

/** App-wide instance: poll = getSweepStatus, intervalMs 10_000, timeoutMs 600_000.
 *  clearSharedRequests is registered as an onEnded listener at module load. */
export const sweepStore: SweepStore
```

Implement the watch with the existing `watchSweep` from `lib/sweepWatch.ts`:
- `onUpdate` sets the active value.
- `onFinished` sets it to false and fires the ended listeners if this watch saw an active poll.
- `onTimeout` sets it to false and fires nothing.
- **Track "saw an active poll" with a flag, not `polls > 1`.** A rejected first poll followed by an
  inactive one gives `polls === 2` without any sweep having run.

```tsx
// frontend/src/components/SweepIndicator.tsx
export function SweepIndicator(): JSX.Element | null
```

- Reads the store with `useSyncExternalStore(sweepStore.subscribe, sweepStore.isActive)`.
- Calls `sweepStore.check()` in an effect keyed on `useLocation().pathname`. That gives one check
  on app load and one per navigation, and the store ignores checks while a watch is running.
  Contract 0196 makes each check also start a due sweep on the server, which is why this is safe.
- Renders `null` when inactive. When active, renders the spinner `<span>` that `UniversePage`
  uses today (same classes, `aria-hidden="true"`), followed by the text
  `Updating universe data`. Both go inside a `role="status"` element. The text carries
  `hidden md:inline`, so below `md` only the spinner shows and the header does not overflow at
  375 px. Give the element left/right margin so it does not touch the nav or the API dot. Match
  `BackendStatus`'s text size and muted colour.

## Tooltips

The indicator is not interactive, but it replaces a sentence that explained what would happen.
Wrap it in `Tooltip` with exactly this label:

> Prices and fundamentals are refreshing in the background. You can keep using the app. The
> Universe table reloads itself when this finishes; other pages show the new data the next time
> you open them.

Do not use the `title` attribute.

## Out of scope

- Do not re-fetch or re-render open analysis pages when a sweep ends. Clearing the cache is the
  whole behaviour.
- Do not remove `SystemHealthCard`'s own watcher or its `clearSharedRequests()` call. It polls
  `getOpsStatus` to update the card's stats, and a second cache clear costs nothing.
- Do not change `watchSweep`, `sharedRequests.ts`, `api/client.ts` or any backend file.
- Do not touch `TickerStrip`, and do not fold sweep state into the strip response.
- Do not add a "Universe updated" toast or any completion message.
- Do not fix the existing `set-state-in-effect` lint warning in `UniversePage.tsx`'s `load()`.

## Acceptance criteria

1. `grep -c "watchSweep" frontend/src/pages/UniversePage.tsx` prints `0`.
2. `grep -rn "Updating universe data" frontend/src` prints lines from
   `frontend/src/components/SweepIndicator.tsx` only.
3. `grep -rln "getSweepStatus" frontend/src` lists only `api/client.ts`, `lib/sweepStore.ts`,
   and `lib/sweepStore.test.ts` if the test mocks it. No page or component imports it.
4. `grep -c "<SweepIndicator />" frontend/src/components/Header.tsx` prints `1`. In the file, that
   line comes immediately before the `<BackendStatus />` line.
5. `grep -c "sweepStore.check()" frontend/src/components/SystemHealthCard.tsx` prints `1`, and
   that call is inside `beginWatching`.
6. `frontend/src/lib/sweepStore.test.ts` tests `createSweepStore` with fake timers,
   `intervalMs: 100` and `timeoutMs: 300`. Write the poll sequences as literal values, as listed:
   - a. **Idle.** Poll resolves `[{active:false}]`. `isActive()` stays `false`, `subscribe`'s
     listener is never called, `onEnded`'s listener is never called, and after advancing 1000 ms
     the poll has run exactly once.
   - b. **A sweep runs and ends.** Polls resolve `{active:true}`, `{active:true}`,
     `{active:false}` in that order. After the first resolves, `isActive()` is `true`. At the end,
     `isActive()` is `false`. `subscribe`'s listener ran exactly twice (false→true, true→false),
     not once per poll. `onEnded`'s listener ran exactly once.
   - c. **Check while watching is a no-op.** Polls resolve `{active:true}`, then `{active:true}`,
     then `{active:false}`. Call `check()` twice before the first poll resolves, and once more
     after it. The poll was called exactly 3 times in total.
   - d. **Check after an ended watch starts a new one.** After scenario b's sequence completes,
     `check()` causes one more poll call.
   - e. **Timeout.** Every poll resolves `{active:true}`. After advancing 1000 ms, `isActive()` is
     `false` and `onEnded`'s listener was never called.
   - f. **A rejection never counts as a sweep.** The poll rejects, then resolves `{active:false}`.
     `onEnded`'s listener was never called.
   - g. **Unsubscribe.** A `subscribe` listener and an `onEnded` listener, each unsubscribed
     before scenario b's sequence, are never called.
   - h. **The app-wide instance clears the shared cache.** Use `vi.mock` on `../api/client` so
     `getSweepStatus` resolves `{active:true}` then `{active:false}`, and `vi.mock` on
     `./sharedRequests` with a spy `clearSharedRequests`. Then `sweepStore.check()`, advance
     10 000 ms, and assert the spy ran exactly once.
7. From `frontend/`, `npx vitest run` passes. The baseline before this contract is 487. Report the
   new total.
8. From `frontend/`, `npm run build` exits 0.
9. From `frontend/`, `npx oxlint` reports no warning in any file this contract creates, and none
   in `Header.tsx` or `SystemHealthCard.tsx`. The baseline is 2 warnings: `UniversePage.tsx`
   `set-state-in-effect` in `load()`, and one in `HelpSidebar.tsx`. Report the full output.

`BLOCKED` is the correct answer to a criterion that cannot be satisfied as written, as well as to
an undecided design question. Do not find a clever way to pass a criterion. Stop and say which one
and why.

## Verification to run and paste

Paste the **complete, verbatim** output of each command.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
grep -c "watchSweep" frontend/src/pages/UniversePage.tsx
grep -rn "Updating universe data" frontend/src
grep -rln "getSweepStatus" frontend/src
grep -n "<SweepIndicator />\|<BackendStatus />" frontend/src/components/Header.tsx
grep -n "sweepStore.check()\|function beginWatching" frontend/src/components/SystemHealthCard.tsx
cd frontend && npx vitest run 2>&1 | tail -5 && npm run build 2>&1 | tail -5 && npx oxlint
```

Also report every file you edited or created.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it**, after 0196 is in and the backend has been restarted.

1. Backend: `cd backend && PATH="$PWD/.venv/bin:$PATH" uvicorn app.main:app --port 8000`. Restart
   it if one is already running (`lsof -nP -iTCP:8000 -sTCP:LISTEN`).
2. Frontend: `cd frontend && npm run dev`.
3. Open `/ops` and click **Force update**. The header should show the spinner with "Updating
   universe data". Hover it and check the tooltip text.
4. While it spins, go to `/portfolios`, then a portfolio's Risk tab, then `/macro`. The spinner
   should stay in the header on every page, and the page layout should not shift when it appears
   or disappears. Over current data the forced sweep takes seconds, so do this quickly or force it
   twice.
5. Resize to about 375 px wide. You should see only the spinner, with no text, and the header
   should not wrap or overflow.
6. On `/universe`, the old line under the page title should be gone, and the table should still
   reload once when the spinner disappears.

## Open questions

None. Placement (header, not a banner) and on-end behaviour (clear the cache, don't re-fetch open
pages) are decided in Why. If either looks wrong once you're in the code, report `BLOCKED`. Do not
choose differently.
