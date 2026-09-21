# Contract 0075 — Portfolio analysis shell: five empty tabbed pages under `/portfolios/:id`

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

An `Analysis` button on `/portfolios` navigates to `/portfolios/:id/holdings`, a tabbed shell with
five routes — Holdings, Backtest, Outlook, Monitor, Risk & Perf — each rendering a placeholder.

## Why

**Gunnar's call, 2026-09-22.** Portfolios is the current focus (order of work: Portfolios → Ops →
Research), and analysis is the next area. This contract builds the navigation shell only, so the
route tree and the tab layout are settled before any analysis feature argues about where it lives.

**The routes are portfolio-scoped, with the id in the URL** — `/portfolios/:id/holdings`, matching
`main:frontend/app/portfolios/[id]/`. Gunnar confirmed this 2026-09-22 over the shorter
`/portfolios/holdings`. Without the id a reload has no way to know which portfolio is being analysed:
selection currently lives in `PortfoliosPage`'s React state, which a reload destroys. It is also what
`REBUILD.md`'s routing decision already committed to — *"real URLs that can be linked, bookmarked,
and reloaded"*.

**Every page is deliberately empty.** No metrics, no charts, no tables, no data fetching. The point is
the shell. A placeholder that quietly grows a feature is worse than an empty one, because the next
contract then has to argue with it.

Note the tab list is **not** the reference's. `main` has `holdings, monitor, outlook, rebalance, risk,
targets`; this is Gunnar's list — `rebalance` and `targets` dropped, `Backtest` added. Build the list
below, not the reference's.

## Files

Create:
- `frontend/src/pages/analysis/AnalysisLayout.tsx` — resolves the portfolio from the route param,
  renders the header and tab bar, and an `<Outlet/>`.
- `frontend/src/pages/analysis/HoldingsPage.tsx`
- `frontend/src/pages/analysis/BacktestPage.tsx`
- `frontend/src/pages/analysis/OutlookPage.tsx`
- `frontend/src/pages/analysis/MonitorPage.tsx`
- `frontend/src/pages/analysis/RiskPage.tsx`

Modify:
- `frontend/src/App.tsx` — the nested route tree.
- `frontend/src/pages/PortfoliosPage.tsx` — the `Analysis` button.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not touch `portfolio.ts`, `portfolioStore.ts`, `portfolioCsv.ts`, `presets.ts`, `download.ts`,
`AddPositionForm.tsx`, or `NewPortfolioDialog.tsx`. `AddPositionForm.tsx` carries the Universe guard
at line 57 — verify with `grep`, never `git diff`.

A new `pages/analysis/` folder is justified at six files. `REBUILD.md` records the flat-`components/`
rule and its "revisit past roughly 25" threshold; this is `pages/`, which has four files today, and
six analysis pages under it would double the directory with one feature's worth of routes.

**`reference files/` is read-only and never belongs on a file list.** Read `main` in place with
`git show main:<path>` — in particular `main:frontend/app/portfolios/[id]/layout.tsx` for the tab
shape. Do not copy its contents wholesale; it is Next.js App Router and this is react-router.

## Interface

### Routes

```tsx
<Route path="/portfolios" element={<PortfoliosPage />} />
<Route path="/portfolios/:portfolioId" element={<AnalysisLayout />}>
  <Route index element={<Navigate to="holdings" replace />} />
  <Route path="holdings" element={<HoldingsPage />} />
  <Route path="backtest" element={<BacktestPage />} />
  <Route path="outlook" element={<OutlookPage />} />
  <Route path="monitor" element={<MonitorPage />} />
  <Route path="risk" element={<RiskPage />} />
</Route>
```

The `index` redirect means `/portfolios/:id` lands on Holdings, so a link that omits the tab still
works. `replace` keeps it out of the back-button history — otherwise Back from Holdings returns to the
same URL and appears to do nothing.

**Declare the `:portfolioId` route after the literal `/portfolios` route.** Both match
`/portfolios`, and react-router ranks static segments above dynamic ones so the order is not
load-bearing here — but state in the report that you confirmed `/portfolios` still renders the list
rather than the layout. `REBUILD.md` records a route-ordering trap on the backend that cost a
debugging session; the frontend equivalent is cheap to check and expensive to assume.

The existing `<Route path="*" element={<Navigate to="/" replace />} />` stays last.

### `AnalysisLayout`

```tsx
const ANALYSIS_TABS = [
  { path: 'holdings', label: 'Holdings' },
  { path: 'backtest', label: 'Backtest' },
  { path: 'outlook',  label: 'Outlook' },
  { path: 'monitor',  label: 'Monitor' },
  { path: 'risk',     label: 'Risk & Perf' },
] as const
```

Behaviour:

- Read `portfolioId` with `useParams`. Resolve it against `listPortfolios()` — the same read
  `PortfoliosPage` uses. Do **not** add a store function.
- **Unknown or legacy id** → render a card reading
  `That portfolio could not be found in this browser.` with a `<Link to="/portfolios">` back. Do not
  redirect automatically: a silent bounce to the list makes a mistyped or stale bookmark look like the
  app forgot the portfolio. Portfolios are `localStorage`-only, so a link opened in another browser
  legitimately hits this — say so in the copy: add
  `Portfolios are stored in the browser that created them.`
- Treat a `LegacyPortfolio` as not-found for now. `isLegacyPortfolio` already exists; analysis has no
  meaning for an unmigrated record and the `/portfolios` page already explains that state.
- Header shows the portfolio name and a `<Link to="/portfolios">` labelled `← Portfolios`.
- Tab bar uses `NavLink` with `end={false}`, styled from existing tokens. Match the selected/unselected
  treatment already used by the portfolio sidebar in `PortfoliosPage`
  (`bg-btn-selected/10 text-btn-selected-text font-semibold` vs
  `text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground`) so the app looks like one
  app. Do not invent a new active style.
- Page container matches every other page: `max-w-screen-2xl mx-auto px-4 sm:px-6`.

### The five pages

Each is the same shape — a heading and one muted line. Nothing else.

```tsx
export function BacktestPage(): JSX.Element {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-16 text-center">
      <p className="text-sm text-[var(--color-muted)]">Backtest — not built yet.</p>
    </div>
  )
}
```

**No props, no hooks, no data.** A page that reads the portfolio "just to show the name" is a page
with a bug waiting in it; the layout owns the name.

### The `Analysis` button

In `PortfoliosPage`, inside the existing `<div className="flex items-center gap-2">` that holds
`Export CSV` and `Delete portfolio`, placed **first** so the destructive control stays last:

```tsx
<Tooltip label="Open analysis and optimization tools for this portfolio">
  <Link
    to={`/portfolios/${current.id}/holdings`}
    className="text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text whitespace-nowrap hover:opacity-90"
  >
    Analysis
  </Link>
</Tooltip>
```

A `<Link>`, not a `button` with `navigate()` — it is navigation, so it should middle-click, open in a
new tab, and show a target on hover. It appears only in the `valued && current` branch, never on the
legacy-portfolio card.

## Out of scope

- **No analysis of any kind.** No metrics, no charts, no tables, no optimizer, no backtest engine, no
  data fetching on any of the five pages. This is the shell.
- Do not add a route for `rebalance` or `targets`. They are in the reference and not in Gunnar's list.
- Do not add `Analysis` to the header nav. It is portfolio-scoped and has no meaning without an id.
- Do not change the portfolio list, the editor, the CSV controls, presets, or any `lib/` module.
- Do not persist the last-viewed tab, add breadcrumbs, or add a portfolio switcher inside the shell.
- Do not add tests for these pages. `REBUILD.md`'s "UI unit tests are skipped deliberately" applies —
  there is no logic here to test, and the 55 `src/lib/` tests must stay untouched.
- No new dependency. `react-router-dom` is already present.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
2. `cd frontend && npm run build` exits 0. Report the main chunk's gzip size before and after; six
   trivial components should move it by well under a kilobyte, and a larger jump means something was
   imported that should not have been.
3. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
4. `cd frontend && npm run test` exits 0 with **55** tests — unchanged.
5. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0 with **460** — unchanged.
   No backend file is touched by this contract; this is the regression check that nothing drifted.
6. `grep -rn "useEffect\|useState\|fetch\|getUniverse\|listPortfolios" frontend/src/pages/analysis/`
   matches **only** `AnalysisLayout.tsx`, and only for `listPortfolios`. The five pages have no hooks
   and no data access. Paste the full output.
7. `grep -c "ANALYSIS_TABS" frontend/src/pages/analysis/AnalysisLayout.tsx` shows the list is declared
   once and mapped, not five hand-written links.
8. `grep -n "rebalance\|targets" frontend/src/` prints nothing — the two reference tabs Gunnar did not
   ask for are absent.
9. `grep -n "available.some" frontend/src/components/AddPositionForm.tsx` still prints the Universe
   guard.
10. State which files you created and edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm run test
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -rn "useEffect\|useState\|fetch\|getUniverse\|listPortfolios" frontend/src/pages/analysis/
grep -c "ANALYSIS_TABS" frontend/src/pages/analysis/AnalysisLayout.tsx
grep -n "rebalance\|targets" frontend/src/ -r ; echo "reference-tabs grep exit: $?"
grep -n "available.some" frontend/src/components/AddPositionForm.tsx
```

## Tooltips — required for any contract adding interactive elements

| element | tooltip label |
|---|---|
| `Analysis` link on `/portfolios` | `Open analysis and optimization tools for this portfolio` |

Phrased as the effect, not the label. Do **not** use the `title` attribute.

**The five tab links get no `Tooltip`.** Their labels already say exactly where they go, and a tooltip
repeating a visible label is noise — `REBUILD.md` makes the same call for ticker-strip cells. The
`← Portfolios` link is likewise self-describing. Say in the report that this was deliberate, so the
audit does not read it as an omission.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.**

```bash
cd frontend && npm run dev
```

1. On `/portfolios`, select a portfolio and click **Analysis**. You land on
   `/portfolios/<id>/holdings` with Holdings active in the tab bar.
2. Click each of the five tabs. The URL changes, the active tab moves, each page shows its
   `— not built yet` line.
3. **Reload on a non-default tab** — say `/portfolios/<id>/risk`. It must come back on Risk & Perf
   with the right portfolio name. This is the whole reason the id is in the URL.
4. Browser **Back** from a tab returns to the previous tab, and Back from Holdings returns to
   `/portfolios` — not to a URL that appears to do nothing.
5. Edit the URL to a nonsense id (`/portfolios/zzz/holdings`). You should get
   *"That portfolio could not be found in this browser"* with a link back — **not** a blank page and
   **not** a silent redirect.
6. Confirm `/portfolios` itself still shows the list and editor, unchanged.
7. Check the tab bar at **1024px and 1023px** and at 375px. Five tabs plus a portfolio name is the
   widest row on the page; confirm it wraps or scrolls rather than clipping. `REBUILD.md` records
   that a `min-width` breakpoint's worst case is exactly at its trigger point, and that this page's
   cards use `overflow-hidden`, which turns overflow into silent clipping rather than a scrollbar.

No backend restart is needed — this contract changes no server code.

## Open questions — do not resolve these yourself

None. The route shape was decided by Gunnar on 2026-09-22. If you find another, report `BLOCKED` and
stop.
