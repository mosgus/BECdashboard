# Contract 0122: `/universe` shows a running sweep and reloads once it finishes

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

**Depends on contract 0121.** It uses `getSweepStatus()` and `watchSweep` from that contract. If either is missing from the tree, report `BLOCKED`.

## Goal

After this contract, a `/universe` page opened while a universe sweep is running (or about to start) does two things:

- It shows a one-line "updating" note while the sweep runs.
- It reloads the table **once, without blanking it**, when the sweep finishes.

## Why

On 2026-09-28 Gunnar opened `/universe` at about 16:48 ET, during the 16:00 window's 145 s sweep. He saw Coverage at 9/25 and concluded the refresh was broken; every ticker was at 9/28 by 16:49.

`UniversePage` fetches `GET /universe` once on mount and never again. That is the same shape as the ticker-strip bug fixed by contract 0073 (REBUILD.md, "The strip's accuracy was a side effect of somebody opening /universe"). The page renders a snapshot taken before the refresh its own visit triggered.

`GET /universe/sweep_status` (contract 0121) reports `active: true` in two cases:
- a sweep holds the lock, or
- the current window is due but not yet claimed.

The second case closes the race where this page asks before the strip's background task has started.

## Files

Modify:

- `frontend/src/pages/UniversePage.tsx`

**Touch nothing else.** In particular, `lib/sweepWatch.ts`, `api/client.ts`, `UniverseTable` and every backend file stay byte-identical. If the work appears to need another file, stop and report `BLOCKED`.

**`reference files/` is read-only and never belongs on a file list.**

**`BLOCKED` is also the correct answer to a contract that cannot be satisfied as written.** Do not find a clever way around a criterion; report the conflict.

## Interface

All changes are inside `UniversePage`.

1. **New state:** `const [sweeping, setSweeping] = useState(false)`.

2. **Latest-response-wins guard.** Add `const requestSeq = useRef(0)`.
   - Every `getUniverse()` call made by this component increments `requestSeq.current` and captures the new value.
   - That includes the existing `load()` and the new silent reload below.
   - Its `.then` / `.catch` applies state **only if** the captured value still equals `requestSeq.current`.
   - Why: on a cold Render start the initial load can take up to a minute. If it resolved *after* the post-sweep reload, it would overwrite fresh rows with pre-sweep ones.

3. **Silent reload:** `function reloadSilently(): void`.
   - It calls `getUniverse()` under the guard above.
   - On success it runs `setState({ status: 'ready', entries })`.
   - On failure it does **nothing**, so the table already on screen stays.
   - It never sets `{ status: 'loading' }`. That is the difference from `load()`, which blanks the table to the loading card and must stay as it is for its existing callers (mount, Retry, `AddTickerForm onAdded`).

4. **Watch effect.** Add one `useEffect` with an empty dependency array:

   ```ts
   useEffect(() => {
     let unmounted = false
     const cancel = watchSweep({
       poll: getSweepStatus,
       isActive: (s) => s.active,
       onUpdate: (s) => setSweeping(s.active),
       onFinished: (_s, polls) => {
         setSweeping(false)
         if (polls > 1 && !unmounted) reloadSilently()
       },
       onTimeout: () => setSweeping(false),
       intervalMs: 10000,
       timeoutMs: 600000,
     })
     return () => {
       unmounted = true
       cancel()
     }
   }, [])
   ```

   - **`polls > 1` is the rule for reloading.** A first poll that is already inactive means no sweep was running, so the mount load is current and a second `GET /universe` would be wasted.
   - A rejected first poll followed by an inactive one also reloads. That is one harmless extra request, accepted for simplicity.
   - Also guard `reloadSilently`'s own `setState` against unmount. The `requestSeq` check does not cover that. Incrementing `requestSeq.current` in the cleanup function is the simplest way to invalidate any in-flight response.

5. **The note.**
   - When `sweeping` is `true`, render this immediately after the existing subtitle `<p>` ("Securities tracked for analysis…"), inside the same `<div>`:

     ```tsx
     <p className="text-xs text-[var(--color-muted)] mt-1">
       Updating universe data — the table will refresh when it finishes.
     </p>
     ```

   - Nothing is rendered when `sweeping` is `false`.
   - The note is not interactive, so it gets no tooltip.

## Out of scope

- Do not change `load()`'s behaviour, the loading messages, or `AddTickerForm`.
- Do not make the reload repeat (no periodic `GET /universe`). It happens at most once per page mount.
- Do not add a spinner, toast, or any new component.
- Do not touch the `Refresh prices` button, `TickerStrip`, or `/ops`.
- Do not add polling to `TickerPage` or any other page.
- No new dependencies. No new test file: `watchSweep`'s behaviour is covered by contract 0121's `sweepWatch.test.ts`, and the only logic left here is wiring.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit`, `npm run lint` and `npm test` exit 0. (Never plain `npx tsc --noEmit`.)
2. `grep -c "watchSweep(" frontend/src/pages/UniversePage.tsx` prints `1`.
3. `grep -c "getUniverse()" frontend/src/pages/UniversePage.tsx` prints `2`: one call in `load` and one in `reloadSilently`.
4. `grep -n "Updating universe data — the table will refresh when it finishes." frontend/src/pages/UniversePage.tsx` prints exactly one line.
5. `grep -c "setInterval" frontend/src/pages/UniversePage.tsx` prints `1`. That is the pre-existing loading-message rotator. No new interval is added; the polling lives in `watchSweep`.
6. Inside `reloadSilently`, the string `status: 'loading'` does not appear. Verify it by reading the function; the report should quote the function in full.
7. `lint` introduces no new `set-state-in-effect` warning. Every `setSweeping` / `setState` in the new code runs in a promise callback, not synchronously in the effect body.

## Verification to run and paste

Paste the **complete, verbatim** output.

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm test
grep -c "watchSweep(" frontend/src/pages/UniversePage.tsx
grep -c "getUniverse()" frontend/src/pages/UniversePage.tsx
grep -n "Updating universe data — the table will refresh when it finishes." frontend/src/pages/UniversePage.tsx
grep -c "setInterval" frontend/src/pages/UniversePage.tsx
```

## Human verification: does Gunnar need to run anything?

**Yes, on the deployed app after 0121 and 0122 are both deployed.** This is the only honest test, because the local backend points at production through `.env`.

1. Open `/ops` in tab A and `/universe` in tab B.
2. In tab A, click **Force update**. Within 10 s, reload tab B.
3. Tab B shows the "Updating universe data…" line under the subtitle, and the table stays visible.
4. When tab A's button returns to **Force update**, tab B's line disappears within ~10 s. The table stays in place, with no flash to the loading card, and filters and any open chart dialog are unchanged.
5. Reload tab B again while idle. No note appears, and the Network panel shows exactly one `GET /universe` and one `GET /universe/sweep_status`.

## Open questions

None known. If `watchSweep`'s signature or `getSweepStatus` differ from contract 0121's Interface section, report `BLOCKED` with the difference rather than adapting.
