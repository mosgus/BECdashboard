# Contract 0026 — Last Close column, and a colour-coded change on the live price

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The table gains a `Last Close` column between `Sector` and `Price`, and the `Price` cell shows a
percentage change against that close, coloured green up / red down / grey flat.

## Why

The Price column currently shows a live intraday price with no reference point — a number with
nothing to compare it to. Adding the previous close and the percentage between them turns it into a
quote.

**No backend work is needed.** `last_close` has been on `UniverseEntry` since contract 0024, derived
from the most recent non-null close in `price_bars`, and `client.ts` already types it. Verified
2026-09-15: AAPL `last_close 333.08` against `current_price 330.26` — the −0.85% this contract will
display.

**The constraint that shapes this contract.** The table is 11 columns and, at 1024px, fits with
**zero slack** — contract 0019 measured `scrollWidth 974 = clientWidth 974` exactly. A 12th column
*plus* a wider Price cell **will** overflow, and the card's `overflow-hidden` turns overflow into
**silent clipping of the download icon** rather than a scrollbar. That has been a bug three times
(0009, 0014, 0018). Something must move up a breakpoint; see below.

**Depends on contracts 0024 and 0025.** If `UniverseEntry` in `client.ts` has no `last_close`, stop
and report `BLOCKED`.

## Files

Create:
- `frontend/src/lib/change.ts` — pure percent-change calculation

Modify:
- `frontend/src/components/UniverseTable.tsx` — the column, the Price cell, breakpoints

**Touch nothing else.** Do not modify `UniversePage.tsx`, `ChartDialog.tsx`, `FilterDialog.tsx`,
`AddTickerForm.tsx`, `Tooltip.tsx`, `lib/format.ts`, `lib/filters.ts`, `lib/ranges.ts`,
`api/client.ts`, `globals.css`, or anything under `backend/`. No new dependencies. If the work
appears to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `lib/change.ts` — pure

```ts
export type ChangeDirection = 'up' | 'down' | 'flat'

export interface PriceChange {
  percent: number | null       // null when it cannot be computed
  direction: ChangeDirection
  label: string                // e.g. '+1.24%', '-0.85%', '0.00%', or '' when percent is null
}

export function priceChange(current: number | null, lastClose: number | null): PriceChange
```

Rules, each with a test below:

- `current` **null** — the market-closed case — returns `percent: 0`, `direction: 'flat'`,
  `label: '0.00%'`. The Price cell is showing `last_close` itself in that state, so the change
  against it is genuinely zero. This is Gunnar's stated expectation.
- `lastClose` null **or** `0` returns `percent: null`, `direction: 'flat'`, `label: ''`. Never
  divide by zero, never render `Infinity` or `NaN`.
- Otherwise `percent = (current - lastClose) / lastClose * 100`.

**Direction is derived from the *rounded* value, not the raw one.** Round to two decimals first,
then compare to zero. Otherwise a change of +0.004% renders as a **green `+0.00%`** — a colour that
contradicts the number beside it. This is the one real trap in this contract.

- `label` carries an explicit `+` for positive, the `-` comes from the number, and flat is exactly
  `0.00%` with no sign.

### Price cell

```
<live or fallback price>   <change label>
```

- The price itself keeps its current precedence: `current_price ?? last_close ??
  regular_market_price`, unchanged from contract 0025.
- The change label sits beside it, smaller (`text-xs`), coloured by `direction`:
  - `up` → `text-brand-positive`
  - `down` → `text-brand-negative`
  - `flat` → `text-[var(--color-muted)]`
- **Colour only the change label, not the price.** Colouring the price itself makes the column hard
  to scan and collides with the muted `—` used for missing values.
- Both on one line, right-aligned, `tabular-nums`, no wrapping.

### `Last Close` column

- Sits **between `Sector` and `Price`**, right-aligned, `formatPrice(row.last_close)` so null renders
  as `—`.
- Visible from **`lg`** up: `hidden lg:table-cell`. It is a reference value for the Price beside it,
  so it is the first thing to drop on narrow screens.

### Making room — read this before choosing breakpoints

At 1024px the table currently fits exactly. This contract adds a column and widens another, so
**you must free space at `lg` and prove it by measurement.**

Move **one** other column from `lg` to `xl`, choosing in this order of preference:

1. **`Bars`** — a data-completeness indicator, not an analysis input. First choice.
2. **`Yield`** — if moving `Bars` is insufficient.
3. **`Mkt Cap`** — last resort.

Do not move `Price`, `Last Close`, `Ticker`, `Name` or the download column at any breakpoint. Report
which you moved and the measurements that drove it. Moving more than one requires saying why.

## Tooltips

Per `REBUILD.md`, using the project `Tooltip`, not `title`:

| element | copy |
|---|---|
| `Last Close` cell | `Closing price of the most recent completed session` |
| Change label, live | `Change from the last close` |
| Change label, market closed | `Market closed — showing the last close` |

The existing Price-cell tooltips from contract 0025 stay as they are.

## Out of scope

- No backend changes. `last_close` is already served.
- No absolute change (`+2.41`) alongside the percentage — percentage only.
- No colouring of the price value itself.
- No flashing, animation, or transition on change.
- No sorting by change.
- No change to `ChartDialog`'s header, which computes its own range-relative figure.
- No new dependencies.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`.**
2. `npm run build` succeeds.
3. `git diff --stat frontend/package.json` is empty — no dependency added.
4. **`priceChange` verified against all six cases**, in a temporary script written to `/tmp`, not the
   repo, deleted afterwards. Paste the output:

   | current | lastClose | expected |
   |---|---|---|
   | 330.26 | 333.08 | `-0.85%`, down |
   | 340.00 | 333.08 | `+2.08%`, up |
   | 333.08 | 333.08 | `0.00%`, flat |
   | `null` | 333.08 | `0.00%`, flat |
   | 100 | `null` | `''`, flat, percent null |
   | 100 | 0 | `''`, flat, percent null — **no Infinity, no NaN** |

   Plus the rounding trap: `current = 333.0933, lastClose = 333.08` → label `0.00%` **and**
   direction `flat`, not `up`.
5. **Measured at every breakpoint boundary and just below**: 375, 639, 640, 767, 768, 1023, 1024,
   1279, 1280, 1440. At each, `table.scrollWidth <=` the card's `clientWidth`. Paste all ten as a
   table. This has been a real bug three times; a screenshot is not a substitute.
6. `Last Close` is absent at 1024px only if you chose to place it at `xl` — otherwise it must be
   present at 1024px and the column you moved must be absent. State which.
7. The download icon is present and unclipped at all ten widths.
8. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/lib/change.ts frontend/src/components/UniverseTable.tsx`
   matches nothing (exit 1).
9. `grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/lib/change.ts frontend/src/components/UniverseTable.tsx`
   matches nothing (exit 1).
10. `git diff --stat backend/ frontend/src/pages/ frontend/src/components/ChartDialog.tsx frontend/src/components/FilterDialog.tsx frontend/src/lib/ranges.ts frontend/src/api/client.ts`
    is empty.

Criteria 4 and 5 are the contract. If a browser is unavailable for criterion 5, say so plainly under
"Not done" — criterion 4 needs no browser.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git diff --stat frontend/package.json ; echo "(empty = no deps)"
grep -nE 'hidden (sm|md|lg|xl):table-cell' frontend/src/components/UniverseTable.tsx
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/lib/change.ts frontend/src/components/UniverseTable.tsx ; echo "exit=$? (1 means clean)"
grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/lib/change.ts frontend/src/components/UniverseTable.tsx ; echo "exit=$? (1 means clean)"
git diff --stat backend/ frontend/src/pages/ frontend/src/components/ChartDialog.tsx frontend/src/api/client.ts ; echo "(empty = untouched)"
```

## Human verification — does Gunnar need to run anything?

**Yes, and the two halves need opposite market states.**

**During market hours**, at `localhost:5173/universe`:

1. `Last Close` and `Price` show **different** numbers, with a coloured percentage beside the price.
2. Cross-check one against the database:
   `psql "$DATABASE_URL" -c "select ticker, price from ticker_quotes order by ticker limit 5"`.
3. Green where price > close, red where below. A ticker sitting at its close reads grey `0.00%`.
4. Hover the change → `Change from the last close`.

**After 16:00 ET**, reload:

5. `Last Close` and `Price` show the **same** number, the change reads grey `0.00%`, and the tooltip
   becomes `Market closed — showing the last close`. That is exactly what you specified.

**At ~1024px**, at either time: no horizontal scrollbar and the download icon fully visible. Then
drag from 1440 to 375 and watch nothing clip in between.

## Open questions — do NOT resolve these yourself

- **Whether `0.00%` is the right thing to show when the market is closed**, versus a blank or a dash.
  Gunnar specified `0.00%`; it is internally consistent since the Price cell is showing the close
  itself. Build it as specified.
- **Sorting by change.** Still open, along with all other sorting.
- **Absolute change alongside the percentage.** Not now; width is the binding constraint.
- **Whether `Coverage` earns a column at all**, now that four columns compete for `xl`. A product
  decision, not a layout fix.
