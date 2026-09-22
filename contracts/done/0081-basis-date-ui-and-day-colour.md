# Contract 0081 — Basis-date UI, the `Since` column, and always-coloured Day figures

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

A portfolio's basis date can be set on `/portfolios`, survives a CSV import, drives a `Since` column
on Holdings — and the Day column is coloured by sign in both tables rather than greyed when the price
is not live.

## Why

Contracts 0079 (model + CSV) and 0080 (the `since` endpoint parameter) are both accepted. Nothing
reaches the user yet; this wires it.

**Part B is a separate, smaller thing Gunnar asked to fold in.** Both tables currently render the Day
figure grey whenever `priceChange` reports `live: false` — outside market hours, or when the stored
quote is stale. That is a deliberate signal, not a bug, and Holdings copied `UniverseTable` exactly as
contract 0078 required. Gunnar's call, 2026-09-22: **colour by sign always, in both tables.**

That decision has a consequence this contract must handle. Colour was carrying the live/not-live
distinction; once it stops, **the tooltip becomes the only signal.** `UniverseTable` already has one
on the change label. `HoldingsPage` has none, because 0078 banned tooltips on data cells — so Holdings
would end up with no way at all to tell an intraday move from yesterday's close. A header tooltip
fixes that and is consistent with 0078's rule that headers stating a convention get one.

## Files

Modify:
- `frontend/src/api/client.ts` — `getReturns` gains an optional `since`.
- `frontend/src/pages/PortfoliosPage.tsx` — the basis-date input.
- `frontend/src/components/NewPortfolioDialog.tsx` — `applySeed` carries an imported `basisDate`.
- `frontend/src/pages/analysis/HoldingsPage.tsx` — the `Since` column, and the Day colour.
- `frontend/src/components/UniverseTable.tsx` — the Day colour, two lines.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not touch `portfolio.ts`, `portfolioCsv.ts`, `portfolioStore.ts`, `presets.ts`, `change.ts`,
`returns.py`, or any backend file. The model, the parser and the endpoint are done and accepted.

**Gunnar has hand-styled `AnalysisLayout.tsx`, `PortfoliosPage.tsx` and `HoldingsPage.tsx`.** Change
only what this contract names. Do not reformat, re-indent, or "tidy" surrounding markup — a contract
that reverted one of his hand-edits is recorded in `REBUILD.md` (contract 0035) and it is the reason
this warning exists.

**`reference files/` is read-only and never belongs on a file list.**

## Part A — the basis date

### Client

```ts
export function getReturns(tickers: string[], since?: string): Promise<ReturnsResponse>
```

Append `since` to the query **only when it is a non-empty string**. The existing empty-tickers guard
stays: `getReturns([])` still returns `{ returns: [], as_of: null }` without a request, regardless of
`since`.

### The input on `/portfolios`

In the portfolio header block, beside the existing Cash field, a labelled `<input type="date">`.
`type="date"` emits `YYYY-MM-DD` natively, which is exactly what `isValidBasisDate` accepts.

- Label: `Return since`.
- Value: `current.basisDate ?? ''`.
- **Empty clears it** — persist the portfolio with `basisDate` absent. Do not store `''`;
  `isValidCurrentPortfolio` rejects a present-but-malformed value and `''` is malformed.
- A non-empty value is persisted only when `isValidBasisDate` accepts it. A native date input makes
  a malformed value hard to produce, but the guard is cheap and the field is user-editable in some
  browsers.
- Reseed the input when the selected portfolio changes, the same way `cashText` already does via the
  `current?.id` effect. Follow that existing pattern rather than inventing a second one.
- No validation message. Unlike cash, there is no arithmetic to violate — a date is accepted or the
  input will not emit it.

### Import carries it

`NewPortfolioDialog` holds a `basisDate` state, `applySeed` sets it from `seed.basisDate`, and
`handleCreate` includes it on the created `Portfolio` when present.

**Do not add a date input to the composer.** A new portfolio gets its date on `/portfolios` after
creation; import is the only path that sets one at creation time.

### The `Since` column on Holdings

- `HoldingsPage` passes `current.basisDate` to `getReturns`, and re-fetches when it changes — add it
  to the existing effect's dependency list beside `tickerKey`.
- **The column is hidden entirely when the portfolio has no basis date.** A column of dashes with
  nothing to explain it is noise, and the feature is opt-in. When a date is set the column appears,
  which is also how the user discovers the setting worked.
- Header reads `Since <the date>` — for example `Since 2026-01-02` — so the anchor is visible without
  hovering.
- Cells render `formatPercent(tickerReturns?.since ?? null)`, `—` when null, coloured by sign exactly
  like 5D/30D/YTD. Reuse the existing `ReturnCell`.
- The cash row's `Since` cell is `—`, like its other non-weight cells.

**A `null` here is ordinary, not an error.** Contract 0080 returns `null` when the anchor predates a
ticker's first stored bar — a position added to the Universe after the basis date will legitimately
show `—`. Do not add a warning for it.

## Part B — Day colour, both tables

In `UniverseTable.tsx:135` and the equivalent cell in `HoldingsPage.tsx`, colour by sign
**regardless of `change.live`**:

```tsx
// UniverseTable
className={`text-xs ${CHANGE_COLOR[change.direction]}`}

// HoldingsPage
className={`${TD} text-right tabular-nums whitespace-nowrap ${signedColor(change.percent)}`}
```

`change.direction` and `change.percent` are already computed for both branches of `priceChange`, so
nothing else changes. An empty label — no data at all — must still render `—` in the muted colour it
uses today; `signedColor(null)` already returns `MUTED`, so check that path survives.

**Keep `UniverseTable`'s existing tooltip exactly as it is.** Its two messages —
`Change from the last close` and `Last completed session's change — not a live price` — are now the
*only* thing distinguishing the two states. Deleting or merging them would remove the last signal.

**Add a header tooltip to Holdings' `Day` column**, since that table has none on the cell:

`Change from the last close. When the market is closed this is the last completed session's move.`

## Out of scope

- **No cost basis, no P&L, no dollar figures.** Declined 2026-09-22.
- No date input in `NewPortfolioDialog`.
- No per-position basis dates. Per-portfolio was decided.
- Do not change `priceChange`, `CHANGE_COLOR`, or `signedColor`.
- Do not change the Universe page's tooltip copy.
- Do not add sorting, filtering, or any other Holdings column.
- Do not add tests. The 63 `src/lib/` tests must stay untouched and passing; `REBUILD.md`'s
  "UI unit tests are skipped deliberately" applies to everything here.
- No new dependency.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
2. `cd frontend && npm run build` exits 0. Report the main chunk's gzip size before and after.
3. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
4. `cd frontend && npm run test` exits 0 with **63** tests — unchanged.
5. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; no
   backend file is in scope.
6. `grep -n "change.live" frontend/src/components/UniverseTable.tsx` still prints the **tooltip**
   line — the live distinction survives in the tooltip — and **no longer appears in the `className`**.
   Quote both.
7. `grep -n "change.live" frontend/src/pages/analysis/HoldingsPage.tsx` prints nothing in a
   `className`. Quote what remains, if anything.
8. Reading the diff: the `Since` column is absent from the DOM when `basisDate` is undefined — not
   rendered-and-hidden with CSS. State the lines that guarantee it.
9. Reading the diff: `getReturns` omits `since` from the query string when it is undefined or empty.
   Quote the guard.
10. Reading the diff: an empty date input persists the portfolio with `basisDate` **absent**, not
    `''`. Quote the line.
11. `grep -n "basisDate" frontend/src/components/NewPortfolioDialog.tsx` shows `applySeed` setting it
    and `handleCreate` reading it.
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
grep -n "change.live" frontend/src/components/UniverseTable.tsx
grep -n "change.live" frontend/src/pages/analysis/HoldingsPage.tsx ; echo "holdings-live grep exit: $?"
grep -n "basisDate" frontend/src/components/NewPortfolioDialog.tsx
grep -n "since" frontend/src/api/client.ts
grep -n "available.some" frontend/src/components/AddPositionForm.tsx
```

## Tooltips — required for any contract adding interactive elements

| element | tooltip label |
|---|---|
| `Return since` date input | `Return is measured from this date's closing price. Leave empty for none.` |
| Holdings `Day` column header | `Change from the last close. When the market is closed this is the last completed session's move.` |
| Holdings `Since` column header | `Total return including dividends since the portfolio's basis date.` |

Do **not** use the `title` attribute — it does not render on `disabled` elements, and only the
truncated `Name` cell is allowed to use it. `UniverseTable`'s existing change-label tooltip keeps its
current copy verbatim.

## Human verification — does Gunnar need to run anything?

**Yes, and part of it needs market hours.**

```bash
cd frontend && npm run dev
```

1. On `/portfolios`, pick a portfolio and set **Return since** to a date a few months back. Reload.
   The date must still be there — that is contract 0079's storage path proven through the UI.
2. Open that portfolio's **Holdings** tab. A `Since <date>` column appears, with a figure per
   position. Positions you added to the Universe *after* that date will show `—`; that is correct.
3. **Clear the date.** The `Since` column disappears entirely.
4. **Export the portfolio, then re-import it** in a fresh `New portfolio` dialog. The basis date must
   survive — it rides in the `basis_date` column on the `CASH` row. Check the file in a text editor
   first if it does not.
5. **Day colour, during market hours:** green and red as before.
6. **Day colour, after the close:** now also green and red, where it used to be grey. Hover the
   change figure on `/universe` — the tooltip must still say *"Last completed session's change — not a
   live price."* That tooltip is the only remaining signal and is the thing to confirm did not get
   lost.
7. Check Holdings at **1024px and 1023px** and at 375px with the `Since` column present — that is ten
   columns, the widest the table has been. `REBUILD.md` records the Universe table clipping silently
   three times; use `document.querySelector('table').scrollWidth` against its container's
   `clientWidth` rather than judging by eye.

## Open questions — do not resolve these yourself

None. Per-portfolio, percentage-only, the `CASH`-row CSV column, and always-colour were all decided by
Gunnar on 2026-09-22. If you find another, report `BLOCKED` and stop.
