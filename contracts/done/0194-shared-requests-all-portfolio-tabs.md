# Contract 0194 — Every portfolio tab shares one request cache

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, Holdings, Risk, Outlook, Optimize and Research all read from one shared cache
(contract 0191's `memoizeRequest`). Specifically:
- The universe list, risk, performance, attribution, returns and signals are each fetched once and
  shared across tabs for 10 minutes.
- The cache is cleared whenever the universe or its prices change.

## Why

The planner measured the live API on 2026-11-09, on a warm server:
- `GET /universe` takes 1.3–1.8 s.
- `POST /portfolio/risk` takes 1–4 s, depending on the number of holdings.

Opening the **Risk tab** mounts four sections at once, which together send:
- `/universe` four times;
- a risk request (Health), performance and signals (Performance), and attribution (Attribution).

Several of those are byte-identical to requests Research's Overview already sent:
- `DEFAULT_RISK_SETTINGS` for risk.
- `{ start: '', end: '' }` for performance and attribution.

So moving between Research and Risk recomputes everything. Returning to any tab recomputes it again.

0191 fixed this inside Research only. This contract widens the same cache to every portfolio tab.
It also adds the invalidation 0191 lacked: adding or deleting a ticker, or a forced universe refresh,
clears the cache. Otherwise a newly added ticker would be missing its price for up to 10 minutes.

## Files

Create:
- `frontend/src/lib/sharedRequests.ts`: replaces `researchRequests.ts` (below).

Delete:
- `frontend/src/lib/researchRequests.ts`: its exports move into `sharedRequests.ts`.

Modify:
- `frontend/src/lib/requestCache.ts`: the returned function gains a `clear()` method.
- `frontend/src/lib/requestCache.test.ts`: add test (i).
- `frontend/src/pages/analysis/research/OverviewSection.tsx`, `MemoSection.tsx`,
  `PortfolioSection.tsx`: change the import path `../../../lib/researchRequests` to
  `../../../lib/sharedRequests`. Nothing else.
- `frontend/src/pages/analysis/risk/HealthSection.tsx`
- `frontend/src/pages/analysis/risk/PerformanceSection.tsx`
- `frontend/src/pages/analysis/risk/AttributionSection.tsx`
- `frontend/src/pages/analysis/risk/ScenariosSection.tsx`
- `frontend/src/pages/analysis/HoldingsPage.tsx`
- `frontend/src/pages/analysis/outlook/CapmSection.tsx`
- `frontend/src/pages/analysis/outlook/ForecastSection.tsx`
- `frontend/src/pages/analysis/outlook/MonteCarloSection.tsx`
- `frontend/src/pages/analysis/OptimizePage.tsx`
- `frontend/src/components/AddTickerForm.tsx`, `frontend/src/components/ChartDialog.tsx`,
  `frontend/src/components/SystemHealthCard.tsx`: one `clearSharedRequests()` call each, plus its
  import.

**Touch nothing else.** In particular, `UniversePage`, `LaunchPage`, `PortfoliosPage`,
`PresetsAdmin` and `api/client.ts` keep their uncached calls. The Universe page must always show
fresh data. If the work appears to require editing a file not on this list, stop and report
`BLOCKED` instead of editing it.

**Edit lines, never reformat files.** Each page and section file changes in exactly two kinds of
lines:
- the `api/client` import line, which loses the functions now cached;
- the call sites.

Plus one new import from `sharedRequests`. Do not re-wrap, re-indent, reorder or reformat anything
else. Criterion 6 checks this by line count.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs — that is what it is for — but it is a snapshot of other working software kept so its behaviour
can be compared against this rebuild, and an edited reference stops being evidence of anything.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it.

**`BLOCKED` is also the right answer if any criterion below cannot be satisfied as written.** Do not
find a clever way to pass a criterion that contradicts another one or the code. Stop and say which.

## Interface

### `requestCache.ts`

```ts
export type CachedRequest<Req, Res> = ((request: Req) => Promise<Res>) & {
  /** Drops every stored result, settled or pending. Pending callers still receive their result. */
  clear: () => void
}

export function memoizeRequest<Req, Res>(
  fetcher: (request: Req) => Promise<Res>,
  options: RequestCacheOptions,
): CachedRequest<Req, Res>
```

`clear()` calls the internal map's `clear()`. No other behaviour changes. The rejection cleanup
already checks that the map still holds the same promise, so it stays correct after a `clear()`.

### `sharedRequests.ts`

```ts
import {
  attributionPortfolio,
  comparePortfolio,
  getReturns,
  getSignals,
  getUniverse,
  performancePortfolio,
  riskPortfolio,
} from '../api/client'
import type { UniverseEntry } from '../api/client'
import { memoizeRequest } from './requestCache'

// Shared by every portfolio tab (contracts 0191, 0194). Results are kept for 10 minutes: prices
// update at most daily, a holdings change alters the request so it never matches an old entry, and
// anything that changes the universe calls clearSharedRequests().
const OPTIONS = { ttlMs: 10 * 60_000, maxEntries: 20 }

export const cachedComparePortfolio = memoizeRequest(comparePortfolio, OPTIONS)
export const cachedRiskPortfolio = memoizeRequest(riskPortfolio, OPTIONS)
export const cachedPerformancePortfolio = memoizeRequest(performancePortfolio, OPTIONS)
export const cachedAttributionPortfolio = memoizeRequest(attributionPortfolio, OPTIONS)
export const cachedGetReturns = memoizeRequest(getReturns, OPTIONS)
export const cachedGetSignals = memoizeRequest(getSignals, OPTIONS)
export const cachedUniverse = memoizeRequest<void, UniverseEntry[]>(getUniverse, {
  ttlMs: 10 * 60_000,
  maxEntries: 1,
})

const ALL = [
  cachedComparePortfolio,
  cachedRiskPortfolio,
  cachedPerformancePortfolio,
  cachedAttributionPortfolio,
  cachedGetReturns,
  cachedGetSignals,
  cachedUniverse,
]

/** Drops every shared result. Call after anything that changes the universe or its stored prices. */
export function clearSharedRequests(): void {
  for (const cached of ALL) cached.clear()
}
```

### Call sites

| File | Was | Becomes |
|---|---|---|
| HealthSection | `getUniverse()`, `riskPortfolio(x)` | `cachedUniverse()`, `cachedRiskPortfolio(x)` |
| PerformanceSection | `getUniverse()`, `performancePortfolio(x)`, `getSignals(x)` | `cachedUniverse()`, `cachedPerformancePortfolio(x)`, `cachedGetSignals(x)` |
| AttributionSection | `getUniverse()`, `attributionPortfolio(x)` | `cachedUniverse()`, `cachedAttributionPortfolio(x)` |
| ScenariosSection | `getUniverse()`, `riskPortfolio(x)` | `cachedUniverse()`, `cachedRiskPortfolio(x)` |
| HoldingsPage | `getUniverse()`, `getReturns(x)`, `getSignals(x)` | `cachedUniverse()`, `cachedGetReturns(x)`, `cachedGetSignals(x)` |
| Capm/Forecast/MonteCarlo sections, OptimizePage | `getUniverse()` | `cachedUniverse()` |

**Do not cache** `stressPortfolio`, `capmPortfolio`, `forecastPortfolio`, `monteCarloPortfolio` or
`optimizePortfolio`. They run only when the user presses a button, and pressing it again must
compute again; Monte Carlo is random. Those calls and their imports stay exactly as they are.
ScenariosSection keeps its local `riskCache` ref unchanged; leave it alone.

### Invalidation: three call sites, each exactly one line plus the import

- `AddTickerForm.tsx`: on the line directly after `await addTicker(trimmed)`, call
  `clearSharedRequests()`.
- `ChartDialog.tsx`: on the line directly after `await deleteTicker(currentTicker)`, call
  `clearSharedRequests()`.
- `SystemHealthCard.tsx`: inside `beginWatching`'s `onFinished` callback, call
  `clearSharedRequests()` as the first statement, before `setWatching(false)`. The forced refresh
  rewrites prices in the background, so the cache is cleared when it **finishes**, not when it
  starts.

## Out of scope

- Do not cache anything on the Universe, Launch or Portfolios pages, or in the admin panel.
- No server-side caching (that is contract 0195), no persistence, no refresh button.
- Do not change `api/client.ts`, any request builder, or any rendering.

## Acceptance criteria

1. `cd frontend && npx vitest run src/lib/requestCache.test.ts` passes: the eight existing tests
   (a–h), unchanged, plus:
   - **i.** `call({ a: 1 })`, then `call.clear()`, then `call({ a: 1 })`: the fetcher was called
     twice.
2. `cd frontend && npx vitest run && npx tsc -b && npx oxlint src` all pass, and oxlint reports no
   warning in a file this contract touched.
3. `test -e frontend/src/lib/researchRequests.ts && echo STILL-THERE` prints nothing, and
   `grep -rn "researchRequests" frontend/src` prints nothing.
4. This prints nothing:
   ```
   grep -nE "\b(comparePortfolio|riskPortfolio|performancePortfolio|attributionPortfolio|getReturns|getSignals)\(|getUniverse\(\)" frontend/src/pages/analysis/research/*.tsx frontend/src/pages/analysis/risk/*.tsx frontend/src/pages/analysis/outlook/*.tsx frontend/src/pages/analysis/HoldingsPage.tsx frontend/src/pages/analysis/OptimizePage.tsx
   ```
5. These still print exactly one line each, because the button-triggered calls must stay uncached:
   - `grep -c "stressPortfolio(" frontend/src/pages/analysis/risk/ScenariosSection.tsx`
   - `grep -c "monteCarloPortfolio(" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx`
   - `grep -c "optimizePortfolio(" frontend/src/pages/analysis/OptimizePage.tsx`
6. **Line counts.** `wc -l` for each file below is **at least** its 2026-11-09 count and **at most 8
   more**. Re-wrapping a whole file blows this range in either direction:

   | File | Count on 2026-11-09 |
   |---|---|
   | research/OverviewSection.tsx | 425 |
   | research/MemoSection.tsx | 521 |
   | research/PortfolioSection.tsx | 583 |
   | risk/HealthSection.tsx | 246 |
   | risk/PerformanceSection.tsx | 295 |
   | risk/AttributionSection.tsx | 232 |
   | risk/ScenariosSection.tsx | 296 |
   | HoldingsPage.tsx | 278 |
   | outlook/CapmSection.tsx | 770 |
   | outlook/ForecastSection.tsx | 421 |
   | outlook/MonteCarloSection.tsx | 339 |
   | OptimizePage.tsx | 812 |
   | components/AddTickerForm.tsx | 62 |
   | components/ChartDialog.tsx | 408 |
   | components/SystemHealthCard.tsx | 199 |
7. `grep -c "clearSharedRequests()" frontend/src/components/AddTickerForm.tsx frontend/src/components/ChartDialog.tsx frontend/src/components/SystemHealthCard.tsx`
   prints `1` for each of the three files.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up. **A description of the output is not the
output.** Contract 0193's report described its results instead of pasting them, and the audit had
to redo everything.

```bash
cd frontend && npx vitest run src/lib/requestCache.test.ts; cd ..
cd frontend && npx vitest run 2>&1 | tail -4 && npx tsc -b && npx oxlint src; cd ..
test -e frontend/src/lib/researchRequests.ts && echo STILL-THERE; grep -rn "researchRequests" frontend/src
grep -nE "\b(comparePortfolio|riskPortfolio|performancePortfolio|attributionPortfolio|getReturns|getSignals)\(|getUniverse\(\)" frontend/src/pages/analysis/research/*.tsx frontend/src/pages/analysis/risk/*.tsx frontend/src/pages/analysis/outlook/*.tsx frontend/src/pages/analysis/HoldingsPage.tsx frontend/src/pages/analysis/OptimizePage.tsx
grep -c "stressPortfolio(" frontend/src/pages/analysis/risk/ScenariosSection.tsx; grep -c "monteCarloPortfolio(" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx; grep -c "optimizePortfolio(" frontend/src/pages/analysis/OptimizePage.tsx
cd frontend/src && wc -l pages/analysis/research/OverviewSection.tsx pages/analysis/research/MemoSection.tsx pages/analysis/research/PortfolioSection.tsx pages/analysis/risk/HealthSection.tsx pages/analysis/risk/PerformanceSection.tsx pages/analysis/risk/AttributionSection.tsx pages/analysis/risk/ScenariosSection.tsx pages/analysis/HoldingsPage.tsx pages/analysis/outlook/CapmSection.tsx pages/analysis/outlook/ForecastSection.tsx pages/analysis/outlook/MonteCarloSection.tsx pages/analysis/OptimizePage.tsx components/AddTickerForm.tsx components/ChartDialog.tsx components/SystemHealthCard.tsx; cd ../..
grep -c "clearSharedRequests()" frontend/src/components/AddTickerForm.tsx frontend/src/components/ChartDialog.tsx frontend/src/components/SystemHealthCard.tsx
```

State which files you edited.

## Human verification — does Gunnar need to run anything?

- **Run the frontend and look at it.** Start the backend
  (`cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000`) and the frontend
  (`cd frontend && npm run dev`), and open DevTools → Network.
  1. Open a portfolio → **Research**, then **Risk**. Risk sends no new `/universe` or `risk`
     request. It does send its own `performance`/`attribution` only if Overview's haven't been
     cached yet.
  2. Switch to **Holdings** and back to **Risk**. There are no new requests at all.
  3. On **Universe**, add a ticker. Return to the portfolio's Holdings. A fresh `/universe` request
     is sent, because the add cleared the cache.

## Open questions

None. If something here contradicts the code as it stands, report `BLOCKED`.
