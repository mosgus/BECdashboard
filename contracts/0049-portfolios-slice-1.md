# Contract 0049 — Portfolios, slice 1: create, persist, value

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

`/portfolios` lets you keep several portfolios in browser storage, add positions by ticker and share
count, set a cash balance, and see each position's price, value and weight against a total.

**Frontend only. No backend, no endpoint, no migration.**

## Why

This is what the app is for. `REBUILD.md` already settles most of it — read those decisions rather
than re-deriving them:

- **Persistence is browser `localStorage`, behind a `save`/`load`/`list` module.** Re-confirmed
  2026-09-13: with no auth, `localStorage` is the only thing that gives each person their own
  portfolios. Server-side storage would mean one global list anyone with the URL could edit. The
  split is principled — **shared reference data on the server (the Universe), personal state on the
  client (portfolios)**.
- **Shares are the stored truth; weights are derived.** A share count is a fact. A weight goes stale
  the moment prices move, so a stored weight describes what you intended the day you typed it.
- **Cash is a portfolio-level field**, not a position.

### There is no `POST /portfolio/analyze` in this slice

`REBUILD.md` specifies that endpoint for "prices, shares, weights and metrics". **It was written
before the Universe existed.** `GET /universe` already returns, per ticker: `current_price`,
`last_close`, `regular_market_price`, `short_name`, `sector`, `quote_type`. Validation already moved
to the Universe (REBUILD, resolved 2026-09-13); the same reasoning removes the endpoint here — the
prices arrive in a payload this page fetches anyway, and `price × shares` is arithmetic that belongs
in `lib/` beside `change.ts`.

An endpoint becomes necessary in **slice 2**, for metrics that need history — volatility, covariance,
drawdown, beta. Those cannot be computed client-side without shipping ~2,700 bars per ticker. The
reference's `backend/core/portfolio.py` (441 lines) is the port target then, **not now**.

### Positions are Universe members only

Gunnar's decision, 2026-09-18. The picker offers the Universe and nothing else. This guarantees every
position has stored bars, which slice 2 requires, and needs no new validation path. The accepted
friction: holding AMZN means adding AMZN to the Universe first.

## Environment

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`.**

`npm run lint` (oxlint) reports **exactly one** warning, the `set-state-in-effect` baseline in
`UniversePage.tsx`. Do not fix it, do not exceed it. Match on the rule and the count, not the line.

There is **no frontend test runner.** The greps below fix the mechanics; Gunnar judges the result.

**Dark mode is live.** Every colour from a token. Buttons use the contract 0048 tokens —
`bg-btn-action text-btn-action-text`, `bg-btn-danger text-btn-danger-text`. **No literal colour, no
Tailwind palette colour, and no `dark:` variant** — `dark:` keys off the OS, not the theme attribute,
and that bug was just removed.

## Files

Create:
- `frontend/src/lib/portfolio.ts` — types and pure valuation math
- `frontend/src/lib/portfolioStore.ts` — `localStorage`, guarded
- `frontend/src/components/PositionsTable.tsx`
- `frontend/src/components/AddPositionForm.tsx`
- `frontend/src/pages/PortfoliosPage.tsx`

Modify:
- `frontend/src/App.tsx` — the `/portfolios` route, before the `*` catch-all
- `frontend/src/components/Header.tsx` — `to="/portfolios"` on the existing `Portfolios` `NavItem`

**Touch nothing else.** No backend file, no migration, no `globals.css`, no `index.html`, no other
component or page, and nothing under `reference files/` (read-only). **No new dependency** — no state
library, no form library, no table library, no UUID package (`crypto.randomUUID()` is built in).

## `lib/portfolio.ts` — pure

```ts
export interface Position { ticker: string; shares: number }

export interface Portfolio {
  id: string
  name: string
  cash: number
  positions: Position[]
  updatedAt: string          // ISO
}

export interface ValuedRow {
  ticker: string
  shares: number
  name: string | null
  price: number | null
  value: number | null
  weight: number | null
  missing: boolean           // the ticker is no longer in the Universe
}

export interface ValuedPortfolio {
  rows: ValuedRow[]
  positionsValue: number
  cash: number
  totalValue: number
  cashWeight: number | null
  missingTickers: string[]
}

/** current_price ?? last_close ?? regular_market_price — the same fallback chain
 *  UniverseTable.tsx:120 already uses. Do not invent a second one. */
export function positionPrice(entry: UniverseEntry | undefined): number | null

export function valuePortfolio(
  portfolio: Portfolio,
  byTicker: Map<string, UniverseEntry>,
): ValuedPortfolio
```

No clock, no storage, no network, no `Intl` — the Universe arrives as a `Map` the caller built.

**Weights are against `positionsValue + cash`.** Cash is part of the portfolio, so position weights
sum to less than 100% whenever cash is non-zero and `cashWeight` is the remainder. Do not divide by
`positionsValue` alone — that would report a 100%-invested portfolio that is half cash.

### A position can reference a ticker that no longer exists

This is reachable, not theoretical: contract 0038 lets a Universe ticker be **permanently deleted**,
and portfolios live in `localStorage` where they survive that deletion entirely.

Such a row gets `price: null`, `value: null`, `weight: null`, `missing: true`, and its ticker appears
in `missingTickers`. **It must not contribute to `positionsValue`** — treating a missing price as
zero would silently understate the total and skew every other weight. `totalValue` is honest about
what it could price.

## `lib/portfolioStore.ts` — impure, guarded

```ts
export const PORTFOLIO_STORAGE_KEY = 'bec-portfolios'

export function listPortfolios(): Portfolio[]
export function savePortfolio(portfolio: Portfolio): void
export function deletePortfolio(id: string): void
```

- Every `localStorage` access wrapped in `try/catch`, returning `[]` or silently no-oping. Same rule
  as `lib/theme.ts`'s `readStoredPreference`: it throws outright in some privacy modes, and an
  unguarded read in a `useState` initialiser crashes the page during render.
- **`listPortfolios` must validate what it parses and drop anything malformed** rather than trusting
  it. This is user-editable storage that survives every future schema change; a stray shape must
  yield a missing portfolio, never a white screen. Check `id`/`name` are strings, `cash` is a finite
  number, `positions` is an array of `{ticker: string, shares: finite number}`.
- `savePortfolio` upserts by `id` and stamps `updatedAt`.
- IDs come from `crypto.randomUUID()`.

## `AddPositionForm.tsx`

```tsx
export function AddPositionForm({
  universe, existing, onAdd,
}: {
  universe: UniverseEntry[]
  existing: Position[]
  onAdd: (position: Position) => void
}): JSX.Element
```

- A `<select>` of Universe tickers showing `TICKER — Name`, **excluding tickers already held**, plus
  a number input for shares and an `Add` button.
- Disabled when no ticker is chosen, shares is empty, non-numeric, or `<= 0`.
- Shares accept fractions — fractional shares are ordinary now.
- When every Universe ticker is already held, render a muted line saying so instead of an empty
  select.
- When the Universe is empty or failed to load, render a muted line pointing at `/universe`.

A `<select>` rather than a typeahead: the Universe is ~22 entries, and a native select is
keyboard-accessible for free. **Do not build a combobox.**

## `PositionsTable.tsx`

```tsx
export function PositionsTable({
  valued, onRemove,
}: { valued: ValuedPortfolio; onRemove: (ticker: string) => void }): JSX.Element
```

Columns: **Ticker · Name · Shares · Price · Value · Weight · (remove)**.

- `formatPrice`, `formatPercent`, `formatCount` from `lib/format.ts`. **Add no new formatter.**
- A `missing` row renders its ticker, its shares, and `—` for price/value/weight, visibly marked —
  `text-brand-negative` on the ticker is enough. The row must still be removable; that is the only
  way out of it.
- A **cash row** and a **totals row**. Totals show `positionsValue + cash` and should make clear
  whether anything was unpriced.
- `overflow-x-auto`, like `UniverseTable`.
- The remove control is a button with a `Tooltip`, not a bare icon.

## `PortfoliosPage.tsx`

Shell matching `UniversePage`/`OpsPage`: `min-h-screen`, `max-w-screen-2xl mx-auto px-4 sm:px-6 pt-10
pb-20`, an `<h1>Portfolios</h1>` and a one-line subtitle.

- Fetches `GET /universe` once on mount via the existing `getUniverse()`; builds the `Map`.
- Lists saved portfolios and selects one. A `New portfolio` action creates one with a default name.
- Rename (an inline text input is fine) and **Delete, behind a confirmation** — it destroys data that
  exists nowhere else. Reuse `ChartDialog`'s two-step pattern conceptually; **do not import from
  it.**
- A cash input, portfolio-level.
- Empty state, no portfolios: a short line plus the `New portfolio` action.

### Portfolios must remain usable when `/universe` fails

They live in `localStorage` and need no network. If the fetch fails, **still render the portfolio
list, the positions and their share counts** — price, value and weight become `—`, with one muted
line explaining prices are unavailable. Adding positions is disabled, since the picker has no source.

This is neither the launch page's silent `null` nor `/ops`'s error card: local data stays visible and
only the priced columns degrade. Say in the report how you handled it.

## Tooltips

| element | copy |
|---|---|
| Ticker select | `Choose a security from your Universe` |
| Shares input | `Number of shares held — fractions allowed` |
| `Add` | `Add this position to the portfolio` |
| Remove (per row) | `Remove <TICKER> from this portfolio` |
| `New portfolio` | `Create an empty portfolio` |
| Rename input | `Rename this portfolio` |
| Cash input | `Uninvested cash, counted in the total and in weights` |
| `Delete portfolio` | `Permanently delete this portfolio — it is stored only in this browser` |

Project `Tooltip`, never `title`.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
2. `npm run lint` reports **exactly one** warning, still `set-state-in-effect`.
3. `git diff --stat backend/ frontend/src/styles/ frontend/index.html` is **empty**.
4. `grep -rn "dark:" frontend/src/` matches nothing (exit 1).
5. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(' frontend/src/lib/portfolio.ts frontend/src/lib/portfolioStore.ts frontend/src/components/PositionsTable.tsx frontend/src/components/AddPositionForm.tsx frontend/src/pages/PortfoliosPage.tsx`
   matches nothing (exit 1).
6. `grep -rnE "\b(bg|text|border|divide)-(white|black|gray|slate|zinc|red|green|blue|amber)-?[0-9]{0,3}\b" frontend/src/components/PositionsTable.tsx frontend/src/components/AddPositionForm.tsx frontend/src/pages/PortfoliosPage.tsx`
   matches nothing (exit 1).
7. `grep -n "current_price" frontend/src/lib/portfolio.ts` shows the **same** fallback chain as
   `UniverseTable.tsx:120`. Quote both lines side by side.
8. `grep -rnE "localStorage" frontend/src/lib/portfolioStore.ts` — **every** access is inside a
   `try`. Quote each one.
9. `grep -rn "localStorage" frontend/src/pages/PortfoliosPage.tsx frontend/src/components/` matches
   nothing (exit 1) — storage access goes through the store module only.
10. `grep -n "positionsValue + cash\|cash + " frontend/src/lib/portfolio.ts` — weights divide by the
    total including cash. Quote the denominator.
11. `grep -n "missing" frontend/src/lib/portfolio.ts frontend/src/components/PositionsTable.tsx`
    matches in both — a deleted Universe ticker is handled, not assumed away.
12. `grep -n "to=\"/portfolios\"" frontend/src/components/Header.tsx` and
    `grep -n "path=\"/portfolios\"" frontend/src/App.tsx` both match.
13. `grep -rn "Intl\.\|toLocaleString" frontend/src/lib/portfolio.ts frontend/src/components/PositionsTable.tsx`
    matches nothing (exit 1) — `lib/format.ts` already exists.
14. `git status --porcelain` lists nothing outside this contract's seven files.
    **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
grep -rn "dark:" frontend/src/ ; echo "(exit $? — 1 = correct)"
grep -n "current_price" frontend/src/lib/portfolio.ts frontend/src/components/UniverseTable.tsx
grep -n "localStorage" frontend/src/lib/portfolioStore.ts
grep -rn "localStorage" frontend/src/pages/PortfoliosPage.tsx frontend/src/components/ ; echo "(exit $? — 1 = correct)"
grep -n "missing" frontend/src/lib/portfolio.ts frontend/src/components/PositionsTable.tsx
grep -rn "Intl\.\|toLocaleString" frontend/src/lib/portfolio.ts frontend/src/components/PositionsTable.tsx ; echo "(exit $? — 1 = correct)"
git diff --stat backend/ frontend/src/styles/ frontend/index.html ; echo "(empty = untouched)"
git status --porcelain
```

Plus the math, exercised directly — **a throwaway `.mjs` you delete afterwards**, since there is no
test runner. Mirror `valuePortfolio`'s logic and show:

- two positions plus cash: weights sum with `cashWeight` to 100%
- a position whose ticker is absent from the map: `missing: true`, excluded from `positionsValue`,
  and the remaining weights still correct against the priced total
- zero cash: `cashWeight` is 0 (or null) and position weights sum to 100%
- an empty portfolio: no division by zero, no `NaN`, no `Infinity`

Paste the output. **`NaN` or `Infinity` anywhere is a failure.**

## Human verification — does Gunnar need to run anything?

**Yes — all of it, and in both themes.**

1. Gear → `Portfolios` is now a live nav item and highlights when active.
2. Create a portfolio, add two or three positions, set cash. Check value = price × shares and that
   position weights plus cash weight come to 100%.
3. **Reload.** It is still there — that is `localStorage` working.
4. Remove a position; add it back. Delete the portfolio and confirm the confirmation appears first.
5. **The deleted-ticker case, which is the interesting one.** Add a throwaway ticker to the Universe,
   put it in a portfolio, then delete it from the Universe via the chart dialog. Return to
   `/portfolios`: that row must show `—` for price/value/weight, be visibly marked, still be
   removable, and **must not** have dragged the total or the other weights wrong.
6. **Stop the backend and reload `/portfolios`.** Portfolios and share counts still render; prices
   read `—` with one explanatory line. Local data does not need the network.
7. Dark mode, then light. No literal colours anywhere, so it should follow — confirm the missing-row
   marking and the totals row are legible in both.

Point 5 is the one I would expect to be got wrong, and point 6 is the one most likely to have been
implemented as a blank page by reflex.

## Out of scope

- **No target-weights entry mode.** Slice 1b, once storage and the table are proven.
- **No metrics**: no volatility, beta, drawdown, correlation, Sharpe, optimisation. Slice 2, and it
  needs a backend endpoint.
- No CSV import or export.
- No non-Universe tickers.
- No charts.
- No server-side persistence, no endpoint, no migration.
- No cross-browser sync, no export/import of `localStorage`.
- No change to the Universe page, the launch page, `/ops`, or the theme system.

## Open questions — do NOT resolve these yourself

- **Whether a portfolio should record a target-weight set** alongshares, for later rebalancing. The
  reference had `portfolio_target_set` and `portfolio_last_rebalance` tables; both were cut with the
  relational schema, and whether the concept returns is undecided.
- **What happens to a `missing` position long-term** — silently dropped, or kept visible until
  removed by hand. This slice keeps it visible.
- **Whether cash should support multiple currencies.** It does not; it is one number.
- **Whether portfolios need an export file** as the backup story `REBUILD.md` mentions.
- **What happens to the four `Coming soon` cards.** Still open.
