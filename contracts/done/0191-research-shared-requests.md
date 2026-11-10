# Contract 0191 — Research tabs share their requests instead of each re-running them

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, the Research tab's three sections (Overview, Portfolio, Memo) share their
backend requests. Opening Overview, then Portfolio, then Memo runs the optimizer comparison once,
not three times. Returning to a tab within 10 minutes shows its results immediately.

## Why

The planner traced the slow "Computing the score…", "Comparing 8 optimizers…" and "Checking the
portfolio…" messages on 2026-11-09. All three wait on the same `POST /portfolio/compare` request,
built from the same `DEFAULT_COMPARE_SETTINGS`, and each section sends it again every time it mounts:

- `OverviewSection` sends compare, risk, performance and attribution.
- `PortfolioSection` sends compare automatically on mount.
- `MemoSection` sends compare and risk.

One comparison runs the optimizer 40 times (8 modes × in-sample + 4 walk-forward folds), so each
repeat costs seconds on Render. Contracts 0192 and 0193 make each comparison cheaper. This contract
stops repeating it.

Every section also waits for `GET /universe` before it can build its requests, so that call is cached
too.

## Files

Create:
- `frontend/src/lib/requestCache.ts`: `memoizeRequest`.
- `frontend/src/lib/requestCache.test.ts`: its tests.
- `frontend/src/lib/researchRequests.ts`: the cached request functions the Research sections use.

Modify:
- `frontend/src/pages/analysis/research/OverviewSection.tsx`
- `frontend/src/pages/analysis/research/MemoSection.tsx`
- `frontend/src/pages/analysis/research/PortfolioSection.tsx`

In each of the three sections, change only two things:
- The import of the request functions from `api/client`.
- The call sites, which switch to the cached functions with the same arguments.

Type imports from `api/client` stay as they are.

**Touch nothing else.** In particular, do not edit `api/client.ts` and do not touch the Risk, Outlook,
Optimize or Holdings pages, even though they call the same endpoints. If the work appears to require
editing a file not on this list, stop and report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs — that is what it is for — but it is a snapshot of other working software kept so its behaviour
can be compared against this rebuild, and an edited reference stops being evidence of anything.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it.

**`BLOCKED` is also the right answer if any criterion below cannot be satisfied as written.** Do not
find a clever way to pass a criterion that contradicts another one or the code. Stop and say which.

## Interface

### `frontend/src/lib/requestCache.ts`

```ts
export interface RequestCacheOptions {
  /** How long a stored result stays valid, in milliseconds. */
  ttlMs: number
  /** Most results kept at once; the oldest-stored is dropped first. */
  maxEntries: number
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number
}

/** Wraps a request function so identical requests share one result. */
export function memoizeRequest<Req, Res>(
  fetcher: (request: Req) => Promise<Res>,
  options: RequestCacheOptions,
): (request: Req) => Promise<Res>
```

Exact semantics. Each one has a test in criterion 1.

1. **Key:** the key is `JSON.stringify(request) ?? ''`. Two requests with equal content share a key,
   even if they are different objects.
2. **Hit:** if an entry for the key exists and `now() - entry.createdAt < ttlMs`, return
   `entry.promise`, the same promise object. That applies whether it is still pending or already
   settled. A hit changes neither `createdAt` nor the entry's position.
3. **Miss:** this covers no entry, or an expired one. Call `fetcher(request)` once, `delete` any old
   entry for the key, then `set` `{ promise, createdAt: now() }`, so the key moves to the newest
   position. Return that promise.
4. **Rejection:** when a stored promise rejects, delete its entry **only if the map still holds that
   same promise for the key**. A newer request may have replaced it after it expired. The caller
   still receives the rejection. Attach that cleanup without creating an unhandled rejection: keep
   the original promise for the caller, and handle the cleanup branch's own rejection.
5. **Eviction:** after a miss inserts its entry, while `size > maxEntries`, delete the first key in
   insertion order.

There is no other behaviour: no background refresh, no manual invalidation API.

### `frontend/src/lib/researchRequests.ts`

```ts
import {
  attributionPortfolio,
  comparePortfolio,
  getUniverse,
  performancePortfolio,
  riskPortfolio,
} from '../api/client'
import type { UniverseEntry } from '../api/client'
import { memoizeRequest } from './requestCache'

// Shared by the Research tab's sections (contract 0191). Results are kept for 10 minutes: prices
// update at most daily, and a holdings change alters the request, so it never matches an old entry.
const OPTIONS = { ttlMs: 10 * 60_000, maxEntries: 20 }

export const cachedComparePortfolio = memoizeRequest(comparePortfolio, OPTIONS)
export const cachedRiskPortfolio = memoizeRequest(riskPortfolio, OPTIONS)
export const cachedPerformancePortfolio = memoizeRequest(performancePortfolio, OPTIONS)
export const cachedAttributionPortfolio = memoizeRequest(attributionPortfolio, OPTIONS)
export const cachedUniverse = memoizeRequest<void, UniverseEntry[]>(getUniverse, { ttlMs: 10 * 60_000, maxEntries: 1 })
```

Call it as `cachedUniverse()`.

### The three sections

Replace each call with its cached counterpart, keeping the arguments and the surrounding
`.then`/`.catch` logic exactly as they are:

| Was | Becomes |
|---|---|
| `comparePortfolio(x)` | `cachedComparePortfolio(x)` |
| `riskPortfolio(x)` | `cachedRiskPortfolio(x)` |
| `performancePortfolio(x)` | `cachedPerformancePortfolio(x)` |
| `attributionPortfolio(x)` | `cachedAttributionPortfolio(x)` |
| `getUniverse()` | `cachedUniverse()` |

`PortfolioSection`'s "Run comparison" button goes through `cachedComparePortfolio` too. Re-running
with the same settings within 10 minutes returns the stored result instantly. That is intended: the
inputs are identical, so the backend would compute the same answer.

Nothing in the Research code mutates a response in place. The planner checked for `.sort(`,
`.reverse(`, `.splice(` and `.push(` on 2026-11-09, and every hit operates on a copy or a local
array. Sharing one response object between sections is therefore safe. Do not add copying or
freezing.

## Out of scope

- Do not cache requests anywhere outside the three Research sections.
- Do not add a refresh button, invalidation API, persistence (`localStorage`) or a server-side cache.
- Do not change `api/client.ts`, the request builders, or any rendering.

## Acceptance criteria

1. `cd frontend && npx vitest run src/lib/requestCache.test.ts` passes. It contains these tests. Use
   `vi.fn()` fetchers and an injected `now` backed by a `let t = 0` variable.
   - **a.** `call({ a: 1 })` twice in sequence calls the fetcher once, and both calls resolve to the
     same value.
   - **b.** `call({ a: 1, b: [2, 3] })`, then a separately constructed `call({ a: 1, b: [2, 3] })`,
     calls the fetcher once.
   - **c.** `call({ a: 1 })` then `call({ a: 2 })` calls the fetcher twice.
   - **d.** Two calls made before the first resolves (use `Promise.all`) call the fetcher once.
   - **e.** The fetcher rejects once (`mockRejectedValueOnce(new Error('x'))`) and then resolves
     with `42`. The first call rejects with `'x'`. The second resolves `42` and the fetcher has been
     called twice.
   - **f.** With `ttlMs: 1000`: a call at `t = 0`, then `t = 999` and call (a hit, fetcher called
     once), then `t = 1000` and call (fetcher called twice).
   - **g.** With `maxEntries: 2`: call `{ k: 'a' }`, `{ k: 'b' }`, `{ k: 'c' }`, then `{ k: 'b' }`
     (a hit), then `{ k: 'a' }` (a miss). The fetcher was called 4 times in total.
   - **h. A stale rejection must not remove a newer entry.** With `ttlMs: 1000`, the first fetch
     returns a promise you reject manually later; the second resolves `'fresh'`. At `t = 0`, call
     `{ k: 1 }` and keep its promise. At `t = 1000`, call `{ k: 1 }` again (a miss; fetcher called
     twice). Now reject the first promise and await its rejection. Then call `{ k: 1 }` again at
     `t = 1000`. It resolves `'fresh'`, and the fetcher is still at 2 calls.
2. `cd frontend && npx vitest run && npx tsc -b && npx oxlint src` all pass, and oxlint reports no
   warning in a file this contract touched.
3. `grep -nE "\b(comparePortfolio|riskPortfolio|performancePortfolio|attributionPortfolio)\(|getUniverse\(\)" frontend/src/pages/analysis/research/OverviewSection.tsx frontend/src/pages/analysis/research/MemoSection.tsx frontend/src/pages/analysis/research/PortfolioSection.tsx`
   prints nothing.
4. `grep -c "cachedUniverse()" <each of the three section files>` prints `1` for each file.
   `grep -c "cachedComparePortfolio(" <each>` prints `1` for each file.
5. `grep -c "^export const cached" frontend/src/lib/researchRequests.ts` prints `5`.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up. A description of the output is not the
output.

```bash
cd frontend && npx vitest run src/lib/requestCache.test.ts; cd ..
cd frontend && npx vitest run 2>&1 | tail -4 && npx tsc -b && npx oxlint src; cd ..
grep -nE "\b(comparePortfolio|riskPortfolio|performancePortfolio|attributionPortfolio)\(|getUniverse\(\)" frontend/src/pages/analysis/research/OverviewSection.tsx frontend/src/pages/analysis/research/MemoSection.tsx frontend/src/pages/analysis/research/PortfolioSection.tsx
for f in Overview Memo Portfolio; do grep -c "cachedUniverse()" frontend/src/pages/analysis/research/${f}Section.tsx; grep -c "cachedComparePortfolio(" frontend/src/pages/analysis/research/${f}Section.tsx; done
grep -c "^export const cached" frontend/src/lib/researchRequests.ts
```

State which files you edited.

## Human verification — does Gunnar need to run anything?

- **Run the frontend and look at it.** Start the backend (`cd backend && .venv/bin/uvicorn
  app.main:app --reload --port 8000`) and the frontend (`cd frontend && npm run dev`). Open a
  portfolio with at least two holdings → Research, and keep DevTools → Network open.
  1. **Overview** shows "Computing the score…" once, then the score.
  2. Switch to **Portfolio**. The comparison table appears with no "Comparing 8 optimizers…" wait.
  3. Switch to **Memo**. "Checking the portfolio…" disappears almost immediately.
  4. Back to **Overview**. The score is there with no wait.
  5. Network shows exactly **one** `compare` request across all four steps.

## Open questions

None. If something here contradicts the code as it stands, report `BLOCKED`.
