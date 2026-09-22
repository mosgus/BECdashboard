# Contract 0078 — The Holdings table

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`/portfolios/:id/holdings` shows one row per position — weight, shares, price, day change, and
5D / 30D / YTD returns — plus a cash row, replacing the placeholder.

## Why

The analysis shell landed in contract 0075 and the returns endpoint in 0077. This is the first tab
with content.

**No cost basis, no P&L, no market value, no dollar totals.** Decided 2026-09-22 and recorded in
`REBUILD.md`: share counts are optional metadata that drift from weights on every cash edit
(contract 0072), so any dollar figure derived from them looks precise and is not. Returns need
neither a share count nor a purchase price.

Gunnar also cut three sections the reference Holdings page carries: the Portfolio Value summary, the
Add Holding form (handled on `/portfolios`), and Cash & Equivalents. **Do not reintroduce any of
them.**

A **basis date** — a per-portfolio anchor giving a "return since" column, percentage only — is decided
and is contract **0079**. Nothing here needs to change to accept it; it is a sixth return column.
Do not build it now.

## Files

Modify:
- `frontend/src/api/client.ts` — a typed function for `GET /universe/returns`.
- `frontend/src/pages/analysis/HoldingsPage.tsx` — the table.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not touch `AnalysisLayout.tsx` — Gunnar has styled it and it is correct. It owns the portfolio
name, the back link and the tab bar; this page renders only what sits below them.

Do not touch `portfolio.ts`, `portfolioStore.ts`, `portfolioCsv.ts`, `presets.ts`, `PortfoliosPage.tsx`,
or any backend file.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

### Client

```ts
export interface TickerReturns {
  ticker: string
  five_day: number | null
  thirty_day: number | null
  ytd: number | null
}

export interface ReturnsResponse {
  returns: TickerReturns[]
  as_of: string | null
}

export function getReturns(tickers: string[]): Promise<ReturnsResponse>
```

`getReturns([])` must **not** issue a request — return `{ returns: [], as_of: null }` directly. The
endpoint treats an empty list as empty, so the round trip buys nothing, and an empty portfolio is a
real state.

Build the query string with `URLSearchParams` so a ticker containing a character needing escaping
cannot break the URL. Go through the existing `request` helper in `client.ts` — it carries the base
URL, `ApiError`, and the GET-only transient retry from contract 0041. Do not call `fetch` directly.

### The page

`HoldingsPage` resolves its own portfolio from `useParams`, the same way `AnalysisLayout` does. It
does **not** take props — the layout renders `<Outlet/>` with no context, and adding one is out of
scope.

Two fetches on mount, in parallel: `getUniverse()` and `getReturns(<the portfolio's tickers>)`.

State shape — model it so partial failure is representable, because it is the normal case:

```
universe: loading | error | ready
returns:  loading | error | ready
```

The table renders as soon as the portfolio is read from storage. It never waits for the network.

### Columns

`Ticker · Name · Weight % · Shares · Price · Day · 5D · 30D · YTD`

- **Ticker** — left aligned. Everything else right aligned except Name.
- **Name** — `short_name`, or `—`. Truncate with a `title` attribute; that is the one place
  `REBUILD.md` still allows `title`, as a fallback for truncated text rather than as an explanation.
- **Weight %** — `formatPercent(position.weight)`. **Always renders**, from local storage, never from
  the network. This is the saved allocation and it is the truth.
- **Shares** — `formatShares(position.shares)` when present, `—` when not. Most positions will show
  `—` and that is correct.
- **Price** — `formatPrice(positionPrice(entry))`, the existing
  `current_price ?? last_close ?? regular_market_price` chain from `lib/portfolio.ts`. Do not write a
  second one.
- **Day** — use `priceChange` from `lib/change.ts`, rendered exactly as `UniverseTable` renders it,
  including its colour treatment. Do not invent a second day-change calculation; contract 0026 settled
  what this column means and it must not disagree with the Universe page.
- **5D / 30D / YTD** — `formatPercent` over the matching `TickerReturns`, `—` when null. Colour them
  the same way Day is coloured, by sign.

### Rows

- **Sort by weight, descending.** A holdings table is read largest-first. Not user-sortable — out of
  scope.
- **A cash row, last**, after a visual separator: ticker `CASH`, weight `formatPercent(cashWeight)`,
  every other cell `—`. Cash is part of the allocation and omitting it would make the weight column
  visibly fail to reach 100%. It is not a position, so it gets no name, price or returns.
- **A position whose ticker is not in the Universe still renders**, with its weight and shares, and
  `—` for name, price and returns. Weight is local and does not depend on the Universe. `valuePortfolio`
  already models this as `missing`; reuse it rather than re-deriving.
- **Empty portfolio** — no positions — renders the cash row alone at 100%, not an empty-state card.
  A 100%-cash portfolio is a legitimate allocation, not an absence of one.

### Failure

Follow `PortfoliosPage`'s precedent exactly, which `REBUILD.md` records as deliberate: saved data
still shows, and the failure is stated rather than hidden.

- `getUniverse()` fails → names, prices and day change are `—`; render, above the table,
  `The Universe could not be reached. Saved allocations and share counts are still shown.`
- `getReturns()` fails → the three return columns are `—`; render
  `Returns could not be loaded.`
- Both fail → both lines.
- **Never render `null` for the whole page** on a failed fetch. `TickerStrip` and `NewsSection` do
  that because they are chrome on a page with other content; this table *is* the page's content, and
  a blank tab is indistinguishable from a broken one.

## Out of scope

- **No cost basis, P&L, market value, portfolio value, or any dollar total.**
- **No basis-date column.** That is contract 0079.
- No Add Holding form, no Cash & Equivalents panel, no Portfolio Value summary. Gunnar cut all three.
- No editing from this page — no remove, no weight change, no rename. `/portfolios` owns mutation.
- No sorting controls, no filtering, no column toggles, no CSV export from this tab.
- No `Signal` column. The reference has one; it is backed by analysis that does not exist here.
- Do not add a chart. `ChartDialog` is lazy-loaded specifically to keep recharts out of the main
  bundle (`REBUILD.md`) and pulling it in here would undo that.
- Do not add tests. `REBUILD.md`'s "UI unit tests are skipped deliberately" applies; the 55 `src/lib/`
  tests must stay untouched and passing.
- No new dependency.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
2. `cd frontend && npm run build` exits 0. Report the main chunk's gzip size before and after. A jump
   over ~3 kB means something was imported that should not have been — say what if so.
3. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
4. `cd frontend && npm run test` exits 0 with **55** tests — unchanged.
5. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; it was
   **467** at the time of writing, and no backend file is in scope here. If it differs, say so rather
   than investigating — another contract may have landed.
6. `grep -n "positionPrice\|priceChange" frontend/src/pages/analysis/HoldingsPage.tsx` shows both
   existing helpers are used. Neither calculation may be reimplemented.
7. `grep -rn "cost\|Cost\|P&L\|marketValue\|Market Value" frontend/src/pages/analysis/` prints
   nothing.
8. `grep -n "recharts" frontend/src/pages/analysis/HoldingsPage.tsx` prints nothing.
9. `grep -n "URLSearchParams" frontend/src/api/client.ts` prints a line inside `getReturns`.
10. Reading the diff: `getReturns([])` returns without issuing a request. Quote the guard.
11. `git status --porcelain frontend/src/pages/analysis/AnalysisLayout.tsx` prints nothing — Gunnar's
    styled layout is untouched.
12. `grep -n "available.some" frontend/src/components/AddPositionForm.tsx` still prints the Universe
    guard.
13. State exactly which files you edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm run test
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "positionPrice\|priceChange" frontend/src/pages/analysis/HoldingsPage.tsx
grep -rn "cost\|Cost\|P&L\|marketValue\|Market Value" frontend/src/pages/analysis/ ; echo "no-dollars grep exit: $?"
grep -n "recharts" frontend/src/pages/analysis/HoldingsPage.tsx ; echo "recharts grep exit: $?"
grep -n "URLSearchParams" frontend/src/api/client.ts
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/src/pages/analysis/AnalysisLayout.tsx ; echo "layout-untouched exit: $?"
grep -n "available.some" frontend/src/components/AddPositionForm.tsx
```

## Tooltips — required for any contract adding interactive elements

This page adds **no** interactive elements — no buttons, links, inputs, or clickable rows. Rows are
display only.

Column headers that state a convention get a `Tooltip`, because the convention is not guessable:

| header | tooltip label |
|---|---|
| `Weight %` | `The saved allocation. It does not change as prices move.` |
| `5D` / `30D` / `YTD` | `Total return including dividends, from stored price history.` |

The dividend point matters: these figures use `adj_close` and will not match price-only quotes
elsewhere. A user comparing against Yahoo needs to know why ours reads higher for a dividend payer.

Do **not** use the `title` attribute for these — only for truncated `Name` text.

## Human verification — does Gunnar need to run anything?

**Yes — the numbers are the part no check here can judge.**

```bash
cd frontend && npm run dev
```

1. Open `/portfolios/<id>/holdings` for `Gunnar Preset`. Confirm one row per position, sorted
   largest weight first, with the `CASH` row last.
2. **Check the weight column sums to 100%** including cash. If it does not, the allocation is wrong,
   not the table.
3. **Sanity-check one YTD figure against a public source.** Expect ours to read *slightly higher* for
   a dividend payer — ours are dividend-adjusted, most quote sites are price-only. A large gap is a
   real problem; a fraction of a percent is the dividend.
4. Confirm the `Day` column agrees with the same ticker's day change on `/universe`. They use the same
   helper and must not disagree.
5. Open a portfolio holding a ticker you have since **deleted from the Universe**, if you have one.
   The row must still appear with its weight, showing `—` for name, price and returns.
6. **Stop the backend and reload.** Weights and shares must still render, with the two failure lines
   above the table — not a blank tab.
7. Check at **1024px and 1023px** and at 375px. Nine columns is the widest table in the app.
   `REBUILD.md` records the Universe table overflowing silently three separate times because the
   card's `overflow-hidden` clips the last column instead of producing a scrollbar — so do not judge
   this by eye alone. In DevTools, run
   `document.querySelector('table').scrollWidth` against its container's `clientWidth`.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
