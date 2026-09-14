# Contract 0014 — Replace per-row refresh with a single sequential "Refresh all"

**Status:** accepted
**Assigned to:** sonnet
**Author:** sonnet, drafted directly at Gunnar's request in conversation — not planner-authored
or planner-reviewed before assignment. Flagging this because every other contract in this
sequence carries `Author: planner (opus)` and gets audited against that authorship; this one
doesn't have that pass. Read it a little more skeptically than usual.

## Goal

The per-ticker `Refresh` button disappears from the table. One `Refresh all` control above the
table refreshes every listed ticker sequentially, with a visible progress bar, updating each row
in place as its refresh completes.

## Why

Gunnar's own words: "I dislike that there is a refresh button for each ticker's row... it'd make
more sense to me to have just one refresh button above the table that when pressed,
refreshes/appends new data to all the stocks in the universe."

This does not require a backend change. `POST /universe/{ticker}/refresh` already exists
(contract 0008) and `refresh_ticker`'s freshness check already makes an already-current ticker a
no-op — no Yahoo request, just a fast local check (contract 0007). So looping over every listed
ticker costs one request per *stale* ticker, not one per ticker in the universe.

**Sequential, not parallel, and this is a real decision, not a style preference.** Contract 0013
fixed a production outage caused by Yahoo's crumb endpoint rate-limiting Render's shared IP. Firing
every stale ticker's refresh concurrently (`Promise.all`) reproduces exactly the request-burst
pattern that caused that outage. Sequential is slower to finish but is the only choice that doesn't
reopen a bug this codebase already paid to fix once.

`REBUILD.md`'s own open-questions list has carried "bulk update ('update all')... fans out into one
Yahoo request per stale ticker" as unresolved since contract 0008. This contract resolves it, in
the frontend only.

**Depends on contract 0009.** If `frontend/src/pages/UniversePage.tsx` or
`frontend/src/components/UniverseTable.tsx` don't exist in their current form (a `rows` +
`onRowRefreshed` table, a `load()`-based page), stop and report `BLOCKED`.

## Files

Modify:
- `frontend/src/components/UniverseTable.tsx` — remove the per-row `Refresh` column, the
  `refreshing` state, `handleRefresh`, and the `onRowRefreshed` prop entirely. It becomes a plain
  display component: `rows` in, a table out, nothing else.
- `frontend/src/pages/UniversePage.tsx` — owns all refresh orchestration now: the sequential loop,
  the progress bar, the `Refresh all` button, and patching each row from its own
  `RefreshResult.detail` as it completes.

**Touch nothing else.** Do not modify `api/client.ts` (`refreshTicker` already has the shape this
needs — call it in a loop, do not add a bulk endpoint), `AddTickerForm.tsx`, `Header.tsx`,
`NavItem.tsx`, `lib/format.ts`, `globals.css`, or anything under `backend/`. No new dependencies —
this is a `for` loop and a state machine, not a job worth a library. If the work appears to need a
file not on this list, stop and report `BLOCKED`.

## Interface

### `UniverseTable.tsx`

```tsx
interface UniverseTableProps {
  rows: UniverseEntry[]
}

export function UniverseTable({ rows }: UniverseTableProps): JSX.Element
```

Delete the `Refresh` column's `<th>` and every row's trailing `<td>` with it — the table goes from
eleven columns to ten. Delete `refreshTicker` and `UniverseDetail` from this file's imports if
nothing else in it needs them.

### `UniversePage.tsx`

New local state, shape is yours to choose, but it must distinguish at least these things: not
running / running with a completed count and a total / finished (with a count of failures, if any).
A plausible shape:

```tsx
type BulkRefreshState =
  | { status: 'idle' }
  | { status: 'running'; completed: number; total: number; failures: string[] }
  | { status: 'done'; failures: string[] }
```

Orchestration, called from the `Refresh all` button's `onClick`:

```tsx
async function handleRefreshAll(): Promise<void> {
  // guard: no-op if already running, or if state isn't 'ready', or entries.length === 0
  // snapshot the ticker list once at the start — do not re-read state.entries mid-loop
  // for each ticker, in order:
  //   await refreshTicker(ticker)
  //   on success: patch that row in place via result.detail (reuse the existing
  //     patch-by-ticker logic currently in handleRowRefreshed)
  //   on failure: record the ticker in `failures`, continue to the next ticker — one
  //     ticker's failure must never stop the run
  //   update the running count after every ticker, success or failure
}
```

**Must-haves, each with a specific failure mode if skipped:**

- **Snapshot the ticker list before the loop starts.** If you iterate `state.entries` live, adding
  a ticker mid-run (via `AddTickerForm`, which is not disabled during a bulk refresh) changes the
  array out from under the loop.
- **Guard against a component-unmount mid-run.** Track whether the page is still mounted (a ref
  set in a `useEffect` cleanup is enough) and check it before every `setState` call inside the
  loop. Without this, navigating to `/` mid-refresh either throws a React warning about setting
  state on an unmounted component or silently does nothing useful — verify which, and make sure
  it's silent-and-harmless, not a console error.
- **The button is disabled while running**, and reads something that communicates progress (e.g.
  `Refreshing 3 of 12…`), matching the disabled/in-flight convention `AddTickerForm` already uses
  (`Adding…`).
- **The progress bar is a real bar**, not just text — a filled track proportional to
  `completed / total`, using existing tokens (`bg-brand-primary` fill, `bg-brand-border` track).
  Text-only progress does not satisfy "progress bar."
- **A failure is visible after the run finishes** — e.g. `Refreshed 11 of 12 — 1 failed: XYZ` —
  and must not blank the page or throw. Reuse the inline-error visual language `AddTickerForm`
  already established (small, muted-negative text beneath the control), not a new pattern.
- **Place the control above the table**, in the row with the page heading and `AddTickerForm`, or
  directly above the table itself — your call, but it must not appear inside the empty state (no
  table, nothing to refresh) or the error state (no data loaded yet).

## Out of scope

- **No backend changes of any kind.** No bulk endpoint, no batched query, nothing in `app/`. The
  existing per-ticker `refresh_ticker` idempotence is what makes this affordable; do not touch it.
- **No parallelism.** Do not use `Promise.all`, `Promise.allSettled`, or any concurrent fan-out for
  the per-ticker calls, for the reason in "Why" above.
- **No artificial delay or backoff between requests.** Sequential-and-awaited is the only
  throttling this contract adds. A sleep between calls is a rate-limiting decision this contract
  does not make.
- **No cancel button.** Once started, a run completes or the user navigates away (which the
  mounted-guard above makes safe, not aborted).
- **No persistence of run history.** The failure summary disappears on the next `load()` or
  navigation; nothing is stored.
- **No re-fetch of the whole list after the run.** Rows are patched in place from each
  `RefreshResult.detail`, exactly as the per-row button used to do it — do not call `load()` at the
  end "to be safe."
- **No single-ticker refresh control anywhere**, including inside a future detail view — that is
  explicitly undecided (see Open Questions) and not this contract's call to make.

## Acceptance criteria

0. `frontend/src/components/UniverseTable.tsx` and `frontend/src/pages/UniversePage.tsx` are the
   only files changed.
1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output.
2. `npm run build` succeeds.
3. `git diff frontend/package.json` is empty — no new dependency.
4. `grep -n "onRowRefreshed\|refreshTicker" frontend/src/components/UniverseTable.tsx` matches
   nothing (exit 1) — the table no longer knows refresh exists.
5. `grep -n "Promise.all" frontend/src/pages/UniversePage.tsx` matches nothing (exit 1).
6. `grep -n "Refresh all" frontend/src/pages/UniversePage.tsx` matches — the control exists with
   that label (case-sensitive match is fine to adjust; the point is a single, findable control).
7. No hardcoded colours: `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/pages/
   frontend/src/components/UniverseTable.tsx` matches nothing (exit 1).
8. No `any` or non-null assertions in either changed file:
   `grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/pages/UniversePage.tsx
   frontend/src/components/UniverseTable.tsx` matches nothing (exit 1).

## Verification to run and paste

```bash
git diff --stat frontend/ ; echo "(only the two listed files should appear)"
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git diff frontend/package.json ; echo "(empty = no new deps)"
grep -n "onRowRefreshed\|refreshTicker" frontend/src/components/UniverseTable.tsx ; echo "exit=$? (1 means clean)"
grep -n "Promise.all" frontend/src/pages/UniversePage.tsx ; echo "exit=$? (1 means clean)"
grep -n "Refresh all" frontend/src/pages/UniversePage.tsx
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/pages/ frontend/src/components/UniverseTable.tsx ; echo "exit=$? (1 means clean)"
grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/pages/UniversePage.tsx frontend/src/components/UniverseTable.tsx ; echo "exit=$? (1 means clean)"
```

For the manual checks below, load the app three ways and paste what renders plus the browser
console for each. If you cannot drive a browser, say so plainly under "Not done" — do not report
these as passing without observing them.

1. With a populated universe (at least 3 tickers, ideally with one that will fail — e.g. monkeypatch
   or manually break one ticker's refresh if you can, otherwise note that failure-path coverage was
   simulated rather than observed live), click `Refresh all`: the button disables and shows a count,
   the bar fills incrementally, each row visibly updates as its own refresh lands (not all at once
   at the end), and the run ends with an accurate summary.
2. Add a ticker via `AddTickerForm` *while* a bulk refresh is running: confirm the loop's original
   snapshot is unaffected (the newly-added ticker is not part of the in-flight run) and nothing
   throws.
3. Start a bulk refresh, then click the `Universe` → `Blue Eagle Capital` nav link (i.e. navigate
   away) before it finishes: confirm no console error or warning about setting state on an
   unmounted component.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** This is a UI/UX change Gunnar asked for by feel ("I dislike...
it'd make more sense to me"); no amount of automated verification substitutes for him looking at
the actual bar filling in and the actual button label while it runs, against the real backend with
several real tickers in the universe.

```bash
cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000
cd frontend && npm run dev
```

At `http://localhost:5173/universe`, with several tickers already added: click `Refresh all`,
watch it run to completion, and confirm the per-row buttons are gone and nothing about the rest of
the page changed.

## Open questions — do NOT resolve these yourself

- **Whether single-ticker refresh comes back later**, e.g. as part of a future `/universe/:ticker`
  detail route. Contract 0009 already left that route undecided; this contract removes the only
  current way to refresh one ticker without deciding whether that capability should exist
  somewhere else. Do not scaffold a detail route or any other single-ticker control to compensate.
- **Whether `AddTickerForm` should be disabled while a bulk refresh is running.** This contract
  deliberately does not couple them — adding and refreshing are independent actions — but if that
  turns out to feel wrong in practice, that's a follow-up, not something to guess at here.
- **Behavior at large universe sizes** (tens or hundreds of tickers) is unmeasured. Sequential
  execution means total run time scales linearly with stale-ticker count; whether that eventually
  needs a real progress-preserving mechanism (e.g. surviving a page reload) is unscoped.
