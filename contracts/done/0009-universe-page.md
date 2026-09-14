# Contract 0009 — Routing and the Universe page

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

`/universe` is a real, reachable URL showing the tracked securities in a table, with a working add
form and per-row refresh — the first page in this app that does something.

## Why

The backend has been complete and unreachable for four contracts. This is the seam.

`REBUILD.md` decided 2026-09-13 to adopt **real URLs via `react-router-dom`**, deliberately
reversing contract 0002's "no router — there is one page." The reasoning is recorded there: reload
and bookmark, the browser back button, and avoiding a `useState` switch in `App.tsx` that grows a
branch per page until it becomes a worse router.

The layout below was approved against `mockup-universe.html` on 2026-09-13. **Open it.** It uses
the same tokens as `globals.css`, so every value has a Tailwind equivalent.

**Depends on contracts 0002, 0003 and 0008.** If `frontend/src/components/Header.tsx` or the
backend's `/universe` endpoint does not exist, stop and report `BLOCKED`.

## The mockup is the visual target

`mockup-universe.html` at the repo root is approved. Match it.

- It is a *reference*, not a file to port. Do not import it, link it, or copy its `<style>` block.
- Where it uses a raw custom property (`var(--color-surface)`), use the token class
  (`bg-brand-surface`). Only `--color-muted`, `--radius-card` and `--radius-btn` have no class —
  reach those with `text-[var(--color-muted)]` etc., which does not count as a hardcoded colour.
- If the mockup and this contract disagree, **this contract wins** — report the discrepancy.
- Do not modify or delete it. Gunnar retires it.

## Files

Create:
- `frontend/src/pages/LaunchPage.tsx` — the existing launch page, moved verbatim
- `frontend/src/pages/UniversePage.tsx` — the new page
- `frontend/src/components/AddTickerForm.tsx`
- `frontend/src/components/UniverseTable.tsx`
- `frontend/src/lib/format.ts` — number/date formatting helpers
- `frontend/public/_redirects` — SPA fallback for Cloudflare Pages

Modify:
- `frontend/package.json` — add `react-router-dom`
- `frontend/src/App.tsx` — becomes the router shell only
- `frontend/src/components/Header.tsx` — `Universe` becomes a real link
- `frontend/src/components/NavItem.tsx` — support an optional `to` prop
- `frontend/src/api/client.ts` — three universe functions and their types

**Touch nothing else.** Do not modify `globals.css`, `index.html`, `vite.config.ts`,
`main.tsx`, `BackendStatus.tsx`, `EntryCard.tsx`, `SettingsIcon.tsx`, or anything under `backend/`.
If the work appears to require a file not on this list, stop and report `BLOCKED`.

## Interface

### Routing

`react-router-dom`, installed with `npm install react-router-dom`. Pin whatever version npm
resolves and **state it in the report**.

`App.tsx` becomes the shell only:

```
<BrowserRouter>
  <Header />
  <Routes>
    <Route path="/"         element={<LaunchPage />} />
    <Route path="/universe" element={<UniversePage />} />
    <Route path="*"         element={<Navigate to="/" replace />} />
  </Routes>
</BrowserRouter>
```

`Header` sits outside `Routes` so it renders on every page and does not remount on navigation —
remounting would refire `BackendStatus`'s health check on every click.

**`LaunchPage.tsx` is the current `App.tsx` body moved verbatim** — hero, four `EntryCard`s, same
copy, same classes. Do not redesign it, do not renumber the cards, do not make them clickable.

### `frontend/public/_redirects`

One line:

```
/*    /index.html   200
```

Without this, Cloudflare Pages serves a **404 for `/universe` on reload or a direct link**, because
the path exists only in the client-side router and no such file exists on disk. The bug appears
only in production and only on deep links, which makes it exactly the kind that ships. Vite's dev
server already handles this, so it cannot be caught locally.

### `NavItem.tsx` — extend, don't rewrite

```tsx
interface NavItemProps {
  label: string
  icon?: boolean
  title?: string
  to?: string      // when present, render a NavLink instead of a span
}
```

- No `to` → unchanged: an inert `<span>`, `cursor-default`, no `onClick`, no `href`. `Portfolios`,
  `Research` and the gear stay this way — those pages do not exist and a link to nothing is a
  broken link.
- With `to` → a `NavLink` carrying the identical padding, size and hover classes, plus an **active**
  state: `text-brand-primary bg-brand-border font-semibold`. Use `NavLink`'s `isActive` render prop,
  not manual `useLocation` comparison.

`Header.tsx` changes on exactly one line: `<NavItem label="Universe" to="/universe" />`.

### `api/client.ts` — three functions, reusing the existing `request<T>` helper

```ts
export interface UniverseEntry {
  ticker: string
  short_name: string | null
  sector: string | null
  quote_type: string | null
  regular_market_price: number | null
  bar_count: number
  first_bar: string | null
  last_bar: string | null
  fetched_at: string | null
  added_at: string
}

export interface UniverseDetail extends UniverseEntry {
  long_name: string | null
  industry: string | null
  currency: string | null
  exchange: string | null
  previous_close: number | null
  market_cap: number | null
  trailing_pe: number | null
  forward_pe: number | null
  dividend_yield: number | null
  fifty_two_week_high: number | null
  fifty_two_week_low: number | null
  beta: number | null
  average_volume: number | null
}

export interface RefreshResult {
  ticker: string
  action: string
  last_session: string | null
  bars_before: number
  bars_after: number
  drift_detected: boolean
  detail: UniverseDetail
}

export async function getUniverse(): Promise<UniverseEntry[]>
export async function addTicker(ticker: string): Promise<UniverseDetail>
export async function refreshTicker(ticker: string): Promise<RefreshResult>
```

- **Every fundamentals field is nullable.** ETFs genuinely lack `sector`, `industry`, `market_cap`,
  `beta` and `forward_pe` — measured across SPY, QQQ and VTI, and visible in the mockup's QQQ row.
  A non-nullable field here makes QQQ a type error at runtime.
- `request<T>` currently issues GET only. Extend it to take an optional method and JSON body,
  keeping one place that owns the base URL, parsing and errors. **Do not add a second fetch path.**
- Non-2xx must throw an `Error` whose message includes the status **and** the server's `detail`
  string, so the UI can show "MSFT is already in the universe" rather than "request failed".
- No `any`, no non-null assertions.

### `lib/format.ts`

```ts
export function formatPrice(v: number | null): string        // 495.63  → "495.63"     | null → "—"
export function formatMarketCap(v: number | null): string    // 3.68e12 → "3.68T"      | null → "—"
export function formatRatio(v: number | null): string        // 38.148  → "38.1"       | null → "—"
export function formatPercent(v: number | null): string      // 0.33    → "0.33%"      | null → "—"
export function formatCount(v: number): string               // 2513    → "2,513"
export function formatDateRange(a: string | null, b: string | null): string
```

Three requirements, each with a test-visible consequence:

1. **`null` renders as `—` (em dash), never as blank and never as `0`.** A blank cell reads as
   loading or broken; `0` is a false claim. TSLA pays no dividend — that is not a 0.00% yield.
2. **`formatPercent` does not multiply.** The API returns `dividend_yield: 0.33` meaning 0.33%,
   already in percent units. Multiplying by 100 yields 33%, a 100× error that looks plausible on a
   screen.
3. `formatMarketCap` uses T/B/M suffixes at two decimals — `3.68T`, `1.44T`.

### `UniversePage.tsx`

State via `useState` + `useEffect`. **No data-fetching library** — `REBUILD.md` decided react-query
is not added yet.

Four view states, all required:

| state | render |
|---|---|
| loading | a neutral "Loading universe…" inside the card frame |
| error | the error message, plus a retry button |
| empty (`[]`) | the mockup's empty state — heading, the explanatory copy, no table |
| populated | the table |

Page head: `<h1>Universe</h1>`, the sub-line *"Securities tracked for analysis. Data is shared and
persists across sessions."*, and `<AddTickerForm />` right-aligned on the same row, stacking below
`sm`.

**A `503` from the API is not a generic error.** The backend returns it when no database is
configured. Show *"Database not configured — the backend is running without persistence."* Anything
else reads as a network failure and sends you debugging the wrong thing.

### `AddTickerForm.tsx`

- Uppercase input, `maxLength={10}`, `spellCheck={false}`, placeholder `Add ticker`.
- Submit disabled when empty/whitespace or while in flight.
- **While in flight the button reads `Adding…` and is disabled.** Adding a ticker fetches ten years
  of history and takes several seconds; a button that looks idle invites a second click, and the
  second click returns `409`.
- On success: clear the input and refresh the list.
- On failure: show the server's `detail` inline beneath the form, keep the typed value. `409`
  (already present) and `404` (unknown symbol) are ordinary outcomes, not crashes — they must not
  blank the page or surface as an uncaught rejection.

### `UniverseTable.tsx`

Columns, in order, with the responsive class that hides each:

| column | align | hidden below |
|---|---|---|
| Ticker | left | — |
| Name | left | — |
| Type | left | `sm` |
| Sector | left | `md` |
| Price | right | — |
| Mkt Cap | right | `lg` |
| P/E | right | `lg` |
| Yield | right | `md` |
| Bars | right | `sm` |
| Coverage | left | `lg` |
| *(refresh)* | right | — |

- Numeric columns right-aligned with `tabular-nums`. Ticker `font-semibold text-brand-primary`.
- Type is a pill: `Equity` or `ETF` from `quote_type`, ETF tinted differently.
- **Columns hide; the table never scrolls horizontally.** Horizontal scroll in a data table is the
  single worst thing about them on a laptop.
- Per-row `Refresh` button. While in flight that row's button reads `…` and is disabled; **other
  rows stay clickable.** Track in-flight state per ticker, not one page-wide boolean.
- After a refresh, update that row from `RefreshResult.detail` — do not refetch the whole list.
- Rows ordered as the API returns them. **No client-side sorting.**

## Out of scope

- No detail route, no `/universe/:ticker`, no expanding rows. Every field is visible at full width.
- No sorting, filtering, pagination, or search.
- No delete or de-list control — the backend has no such endpoint and removal is an open question.
- No "refresh all" — bulk update is unscoped and fans out into one Yahoo request per stale ticker.
- No charts, no sparklines, no day-change column. The API returns none of that.
- No react-query, no state library, no component library, no toast library.
- No changes to the launch page's design — it moves verbatim into `LaunchPage.tsx`.
- Do not make `Portfolios`, `Research` or the gear navigate. Those pages do not exist.
- No tests. `REBUILD.md`'s frontend standard is typecheck + build + a human look.

## Acceptance criteria

0. Every file in the Files list exists.
1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`** — the root tsconfig has `files: []` and checks nothing.
2. `npm run build` succeeds.
3. `react-router-dom` is the **only** dependency added — `git diff frontend/package.json` shows no
   other new entry.
4. `frontend/public/_redirects` contains `/*` and `/index.html` and `200`.
5. No hardcoded colours in new files:
   `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/pages/ frontend/src/components/ frontend/src/lib/`
   matches nothing (exit 1).
6. No `any` or non-null assertions in code this contract wrote:
   `grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/pages/ frontend/src/lib/ frontend/src/api/client.ts`
   matches nothing (exit 1).
7. `formatPercent` does not multiply:
   `grep -nE '\*\s*100' frontend/src/lib/format.ts` matches nothing (exit 1).
8. `grep -rn "useLocation" frontend/src/components/NavItem.tsx` matches nothing (exit 1) — active
   state comes from `NavLink`.
9. `Portfolios`, `Research` and the gear render without `to`, so they remain inert — verifiable in
   `Header.tsx` by reading the diff.
10. With the backend running: `/` shows the launch page unchanged, `/universe` shows the table,
    clicking `Universe` navigates without a full page load, and the browser back button returns to
    `/`.
11. Reloading the browser directly on `/universe` renders the Universe page, not a blank screen.
12. With the backend **stopped**, `/universe` shows an error state and the page still renders —
    no white screen, no uncaught console error.

Criteria 10–12 are the ones most likely to be skipped. Do not report them without observing them.

## Verification to run and paste

```bash
ls -1 frontend/src/pages/ frontend/src/lib/ frontend/public/
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git diff frontend/package.json
cat frontend/public/_redirects
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/pages/ frontend/src/components/ frontend/src/lib/ ; echo "exit=$? (1 means clean)"
grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/pages/ frontend/src/lib/ frontend/src/api/client.ts ; echo "exit=$? (1 means clean)"
grep -nE '\*\s*100' frontend/src/lib/format.ts ; echo "exit=$? (1 means clean)"
grep -rn "useLocation" frontend/src/components/NavItem.tsx ; echo "exit=$? (1 means clean)"
```

For criteria 10–12, load the app three ways — navigate to `/universe`, reload directly on it, and
with the backend stopped — and paste what renders plus the browser console for each. If you cannot
drive a browser, say so plainly under "Not done."

State in the report: the `react-router-dom` version installed, and how you extended `request<T>` to
carry a method and body.

## Human verification — does Gunnar need to run anything?

**Yes — this is a UI contract; the planner cannot judge whether it looks right.**

```bash
# terminal 1
cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000
# terminal 2
cd frontend && npm run dev
```

Then at `http://localhost:5173`:

1. Click **Universe** in the header — it should navigate with no page flash, and the nav item
   should show its active state.
2. The table should list MSFT and QQQ from the real database, with QQQ showing `—` for sector,
   market cap and forward P/E.
3. **Add `NVDA`.** The button should read `Adding…` for several seconds, then the row appears with
   `bar_count` around 2,500.
4. **Add `MSFT` again** → an inline error saying it's already present. **Add `NOTREAL`** → an inline
   error naming the symbol. Neither should blank the page.
5. **Refresh a row** → `action: none`, row unchanged.
6. **Reload the browser on `/universe`** → the page renders. This is the one `_redirects` exists for.
7. **Press back** → returns to `/`.
8. Narrow to 375px → columns drop, nothing scrolls sideways.

## Open questions — do NOT resolve these yourself

- **Whether `/universe/:ticker` becomes a detail route.** Undecided; it is the natural home for a
  price chart later. Do not scaffold it.
- **Removing a ticker from the universe.** Open in `REBUILD.md`; no backend endpoint exists.
- **Bulk refresh.** Open, and it fans out into one request per stale ticker.
- **Whether `Portfolios` and `Research` survive as features.** Open in `REBUILD.md` — two of the
  four nav destinations contradict the cut list. Leave them inert.
