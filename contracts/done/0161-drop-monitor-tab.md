# Contract 0161 — Drop the Monitor tab

**Status:** done
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Gunnar decided on 2026-10-04 to drop the portfolio **Monitor** tab. In the rebuild it is a stub
("Monitor — not built yet"). In `main` it had two parts:
- **Technicals.** The Ticker page (`/ticker/:symbol`) already covers this.
- **Candidates.** A per-portfolio watchlist. It is not being rebuilt.

Remove the tab, the route and the stub page. Old links to `/portfolios/:id/monitor` must redirect
to that portfolio's Holdings tab instead of showing an empty layout.

## Change

### 1. `frontend/src/pages/analysis/AnalysisLayout.tsx`

Remove the `{ path: 'monitor', label: 'Monitor' }` entry from `ANALYSIS_TABS`. Make no other
change.

### 2. `frontend/src/App.tsx`

- Remove the `MonitorPage` import.
- Replace `<Route path="monitor" element={<MonitorPage />} />` with
  `<Route path="monitor" element={<Navigate to="../holdings" replace />} />`.
  `Navigate` is already imported. In react-router 7, a route-relative `..` from the `monitor`
  child goes up to `/portfolios/:portfolioId`.

### 3. Delete `frontend/src/pages/analysis/MonitorPage.tsx`

Delete only this one file, with `rm` and without `-r`.

## Out of scope

- The Ticker page, the Universe page and any backend code.
- `HelpSidebar` copy. The planner fixes `REBUILD.md` and `contracts/tools/`.

## Acceptance criteria

Run these from `frontend/`:

1. `npx vitest run` passes. Baseline 323; afterwards still **323**. Paste the totals.
2. `npx tsc -p tsconfig.app.json --noEmit` is clean, `npm run lint` shows only the 2 known
   warnings, and `npm run build` succeeds.
3. `grep -rn "MonitorPage" src` prints nothing.
4. `grep -n "'monitor'" src/pages/analysis/AnalysisLayout.tsx` prints nothing.
5. `grep -n 'path="monitor"' src/App.tsx` prints 1 line, and that line contains `../holdings`.
6. From the repo root, `node contracts/tools/smoke-render.mjs holdings` and
   `node contracts/tools/smoke-render.mjs risk` both report no uncaught exception.

`BLOCKED` is a valid outcome. Report any deviation.

## Human verification — Gunnar

1. Open a portfolio. The tab bar reads Holdings · Historical Optimize · Forward Models · Risk & Perf.
2. Type `/portfolios/<id>/monitor` into the address bar. It lands on that portfolio's Holdings tab,
   and the URL ends in `/holdings`.

## Open questions

None.
