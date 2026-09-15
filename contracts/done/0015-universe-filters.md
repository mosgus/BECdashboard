# Contract 0015 — Universe filtering: search, filter dialog, and result line

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The Universe table can be narrowed by text search and by six filters — Type, Sector, Price, Market
cap, P/E and Yield — set inside a dialog, with a result line that says how many rows are showing and
how many were hidden for missing data.

## Why

The universe is eight tickers today and is meant to grow. A table you can only read top-to-bottom
stops being useful somewhere around thirty rows.

The layout was approved against `mockup-universe-filters.html` on 2026-09-14, after two constraints
Gunnar set explicitly: **the control row stays one row at every width** (hence a dialog rather than
inline expanders), and **Update all ignores filters entirely** (hence the count in its label, so
"all 8" while three rows show is unambiguous rather than a lie).

All filtering is **client-side**. No API change, no query parameters. At this size, shipping the
whole list and filtering in the browser is both simpler and faster than a round trip, and it keeps
`GET /universe` the single cacheable endpoint it is now.

**Depends on contracts 0009 and 0014.** If `frontend/src/pages/UniversePage.tsx` has no
`bulkRefresh` state or `UniverseTable` does not take a `rows` prop, stop and report `BLOCKED`.

## The mockup is the visual target

`mockup-universe-filters.html` at the repo root is approved and **functional** — it really filters.
Open it, use it, and match its behaviour as well as its appearance.

- It is a *reference*, not a file to port. Do not import it or copy its `<style>` block.
- Where it uses a raw custom property, use the token class. Only `--color-muted`, `--radius-card`
  and `--radius-btn` have no class; reach those with `text-[var(--color-muted)]` etc., which does
  not count as a hardcoded colour.
- Its one amber value (`#b3820a`, the hidden-rows note) has **no token**. Use
  `text-brand-accent`, the existing gold, rather than introducing a hex literal.
- If the mockup and this contract disagree, **this contract wins** — report the discrepancy.

## Files

Create:
- `frontend/src/lib/filters.ts` — pure filter logic and the numeric-input parser
- `frontend/src/components/FilterDialog.tsx` — the modal

Modify:
- `frontend/src/pages/UniversePage.tsx` — control row, filter state, result line

**Touch nothing else.** `UniverseTable.tsx` already takes `rows: UniverseEntry[]`; the page passes
it the filtered array and the table needs no change. Do not modify `api/client.ts`, `lib/format.ts`,
`AddTickerForm.tsx`, `Header.tsx`, `App.tsx`, `globals.css`, or anything under `backend/`. No new
dependencies — **no UI library, no headless-dialog package, no filter library.** If the work appears
to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `lib/filters.ts` — pure, no React

```ts
export interface FilterState {
  query: string
  types: string[]              // quote_type values, e.g. ['EQUITY']
  sectors: (string | null)[]   // null represents "Not reported"
  price:  [number | null, number | null]
  mcap:   [number | null, number | null]
  pe:     [number | null, number | null]
  yield:  [number | null, number | null]
}

export const EMPTY_FILTERS: FilterState

export function parseNumericInput(raw: string): number | null
export function applyFilters(rows: UniverseEntry[], f: FilterState): {
  shown: UniverseEntry[]
  hiddenForMissingData: number
  missingFields: string[]      // human labels, e.g. ['market cap']
}
export function activeFilterCount(f: FilterState): number
export function sectorOptions(rows: UniverseEntry[]): (string | null)[]
```

**Everything here is pure.** No React, no hooks, no DOM. That is what makes it checkable.

#### `parseNumericInput`

Accepts a `k`/`m`/`b`/`t` suffix (case-insensitive), strips `$`, commas and whitespace, and returns
`null` for empty or unparseable input. **Required behaviour, verified in criterion 7:**

| input | result |
|---|---|
| `""` / `"   "` | `null` |
| `"25"` | `25` |
| `"1.5"` | `1.5` |
| `"500m"` / `"500M"` | `500000000` |
| `"100B"` | `100000000000` |
| `"1T"` | `1000000000000` |
| `"$1,250"` | `1250` |
| `"abc"` / `"1.2.3"` / `"B"` | `null` |
| `"-40"` | `-40` |

Market cap spans 92.7B to 5.09T in the live universe — a 55× range — which is why suffixes exist.
Nobody types `3680000000000`.

#### `applyFilters`

Order and rules:

1. `query` — case-insensitive substring against `ticker` **or** `short_name`. `short_name` is
   nullable; a null name must not throw and must not match. Empty query matches everything.
2. `types` — empty array matches everything; otherwise `quote_type` must be in the array.
3. `sectors` — empty matches everything; otherwise `sector` must be in the array. **`null` is a
   selectable value**, not an absence of selection.
4. The four numeric ranges — inclusive bounds. A `null` bound is unbounded on that side.

**Null values are excluded while their filter is active**, and this is the part that must be
visible. Set a market-cap filter and every ETF disappears, because all three of QQQ, SPY and VEA
have `market_cap: null` — 3 of 8 rows in the live universe. Silently dropping them is the bug this
contract is written to avoid.

So `applyFilters` also returns:
- `hiddenForMissingData` — rows that failed **only** because of a `null` on an active numeric
  filter. A row excluded because its real value is out of range does **not** count.
- `missingFields` — the distinct human labels of the fields responsible: `price`, `market cap`,
  `P/E`, `dividend yield`.

#### `activeFilterCount`

One per *group* that is doing something: a non-empty `types`, a non-empty `sectors`, and each
numeric range with at least one non-null bound. **`query` is not counted** — it has its own visible
input, so counting it would double-report.

### `components/FilterDialog.tsx`

```tsx
interface FilterDialogProps {
  open: boolean
  rows: UniverseEntry[]          // for deriving sector options
  filters: FilterState
  onChange: (next: FilterState) => void
  onClose: () => void
}
export function FilterDialog(props: FilterDialogProps): JSX.Element | null
```

- Returns `null` when `open` is false. No hidden DOM.
- Six groups in this order: **Type, Sector, Price, Market cap, P/E, Dividend yield %**. Each has a
  small `clear` link that resets only that group.
- Type and Sector are multi-select **chips**, not `<select>` elements. Selected chips use
  `bg-brand-primary text-white`; unselected use the surface/border treatment.
- **Sector options come from the data** via `sectorOptions(rows)`, sorted, with a `Not reported`
  chip appended when any row has `sector === null`. Without it, 37% of the live universe is
  unselectable.
- Numeric groups are two text inputs, `Min` and `Max`. **Not `type="number"`** — that rejects the
  `1T` suffix and shows spinners nobody wants here.
- Market cap carries the hint: `Accepts suffixes: 500M, 100B, 1T. Rows without a market cap are
  hidden while this is set.`
- Footer: `Clear all` on the left, `Done` on the right.
- **Closes on:** the × button, `Done`, `Escape`, and a click on the backdrop — but **not** a click
  inside the dialog.
- `role="dialog"`, `aria-modal="true"`, and an accessible label. Move focus into the dialog on open
  and return it to the Filters button on close. A full focus trap is **not** required.
- State lives in the page and flows down. The dialog is controlled — it holds no filter state of its
  own.

### `UniversePage.tsx` — the control row

Exactly one row, in this order, and it must not wrap at any width:

```
[ search input ] [ Filters (badge) ] [ × ] ————— spacer ————— [ Update all N ]
```

- Search: left-aligned, `flex: 0 1 20rem`, with a magnifier icon inside. Below `sm` it takes the
  remaining width and the Filters button collapses to its icon alone.
- Filters button: opens the dialog. Shows a count badge when `activeFilterCount > 0`.
- `×`: clears **everything**, including the search query. Rendered only when a filter or the query
  is active.
- `Update all N` where **N is the total row count, never the filtered count.** Bulk refresh ignores
  filters — that was Gunnar's explicit decision, and the count is what keeps the label honest.
  Preserve the existing verb `Update all`; do not rename it to the mockup's "Refresh all".
- While a bulk refresh runs, the existing `Updating X of N…` label takes precedence, unchanged from
  contract 0014.

**Result line**, between the controls and the table, `text-xs`:

- Nothing is filtered → render nothing (keep the element's height reserved so the table does not
  jump).
- Otherwise → `Showing 3 of 8`, and when `hiddenForMissingData > 0`, ` · 3 hidden — no market cap
  data` in `text-brand-accent`, naming the fields from `missingFields`.

**Empty result** → the table renders a single full-width row reading `No securities match these
filters.` Do **not** reuse the "No securities yet" empty state; those are different situations and
conflating them is confusing when the universe is full but the filter is narrow.

Filtering must not interfere with contract 0014's bulk refresh: `patchRow` still matches by ticker,
and the snapshot still comes from the unfiltered entries.

## Out of scope

- **No sorting.** Ticker order, as now.
- No saving filters, no URL/query-string persistence, no `localStorage`. The router exists but
  filter state does not go in the URL in this contract.
- No server-side filtering, no API change, no new endpoint.
- No column show/hide controls.
- No date-range or bar-count filters.
- No changes to `UniverseTable.tsx` — it already takes `rows`.
- No new dependencies of any kind.
- No test framework. `REBUILD.md`'s frontend standard is typecheck + build + a human look.

## Acceptance criteria

0. Every file in the Files list exists; nothing outside it changed.
1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`** — the root tsconfig has `files: []` and checks nothing.
2. `npm run build` succeeds.
3. `git diff --stat frontend/package.json` is empty — no dependency added.
4. `git diff --stat frontend/src/components/UniverseTable.tsx frontend/src/api/client.ts frontend/src/lib/format.ts frontend/src/components/AddTickerForm.tsx backend/`
   is empty.
5. No hardcoded colours:
   `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/lib/ frontend/src/components/ frontend/src/pages/`
   matches nothing (exit 1).
6. No `any`, no non-null assertions:
   `grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/lib/ frontend/src/components/FilterDialog.tsx frontend/src/pages/`
   matches nothing (exit 1).
7. **`parseNumericInput` handles every row of the table above.** Verify it and paste the output —
   see the verification block for a runnable check. A wrong multiplier here is silent: `100B` parsed
   as `100` filters nothing out and looks like it worked.
8. `activeFilterCount` does not count `query` — verifiable by reading the diff.
9. With the backend running, all of the following behave as in the mockup:
   - typing `mic` matches MU by its **name** (Micron), not its ticker
   - Market cap min `1T` hides all three ETFs and the line reads `Showing N of 8 · 3 hidden — no
     market cap data`
   - Sector → `Not reported` shows only the ETFs
   - the badge shows the count, and `×` clears filters **and** the search box
   - `Escape` and a backdrop click both close the dialog; a click inside does not
10. `Update all 8` still reads **8** while the table shows three rows.
11. At 375px the control row is still one row and nothing overflows horizontally.

Criteria 9–11 are the ones most likely to be skipped. Do not report them without observing them.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git diff --stat frontend/package.json ; echo "(empty = no deps added)"
git diff --stat frontend/src/components/UniverseTable.tsx frontend/src/api/client.ts frontend/src/lib/format.ts frontend/src/components/AddTickerForm.tsx backend/ ; echo "(empty = untouched)"
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/lib/ frontend/src/components/ frontend/src/pages/ ; echo "exit=$? (1 means clean)"
grep -rnE ':\s*any\b|<any>|\bas any\b|\bas any\b|\)!|\w!\.' frontend/src/lib/ frontend/src/components/FilterDialog.tsx frontend/src/pages/ ; echo "exit=$? (1 means clean)"
```

For criterion 7, exercise `parseNumericInput` against every row of the table and paste the results.
There is no test framework here, so a temporary script is acceptable — **write it to `/tmp`, not
into the repo, and delete it afterwards.**

For criteria 9–11, drive the running app and paste what you observe at desktop and at 375px. If you
cannot drive a browser, say so plainly under "Not done."

## Human verification — does Gunnar need to run anything?

**Yes — it is a UI contract and most of it is interaction the planner cannot judge.**

```bash
# terminal 1
cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000
# terminal 2
cd frontend && npm run dev
```

At `http://localhost:5173/universe`, compare against the mockup side by side:

1. Search `mic` → MU matches by name.
2. Filters → Market cap min `1T` → ETFs drop out, amber hidden-count line appears.
3. Filters → Sector → `Not reported` → only ETFs.
4. Badge counts groups, not individual values. `×` clears search too.
5. `Escape` closes; clicking inside does not.
6. **`Update all 8` still says 8 with three rows showing.**
7. Narrow to 375px — one row, no horizontal scroll.

## Open questions — do NOT resolve these yourself

- **Persisting filter state in the URL.** The router exists and `/universe?sector=Technology` would
  be shareable and survive reload. Deliberately out of scope; do not add it.
- **Sorting.** Open. Do not add sortable headers.
- **Negative P/E.** Unprofitable companies report a negative or absent P/E, so a "max 25" filter
  silently includes a company at −40. Not present in the current eight. Do not add special handling.
- **Whether the result line should always be visible** (`Showing 8 of 8` when unfiltered) rather than
  appearing only when filtered. Build it as specified.
