# Report — Contract 0026 — Last Close column, and a colour-coded change on the live price

**Status:** reported

## Summary

New `Last Close` column between `Sector` and `Price`, visible from `lg` up. The `Price` cell now
shows a colour-coded percentage change beside the price, computed by a new pure `priceChange`.
`Bars` moved to `xl` to make room, per the contract's stated first preference.

Files exactly as listed:
- `frontend/src/lib/change.ts` (new) — `priceChange`
- `frontend/src/components/UniverseTable.tsx` — the column, the Price cell, the breakpoint move

No other files touched this session.

## Which column moved, and the measurements that drove it

**Moved `Bars`** from `hidden sm:table-cell` to `hidden xl:table-cell` — the contract's first
preference, and it was sufficient; `Yield`/`Mkt Cap` were never touched.

One thing worth naming precisely: the contract frames this as moving a column "from `lg` to
`xl`," but `Bars` was actually at `sm` (640px), not `lg`, in the file as it stood — `Mkt Cap` and
`P/E` are the only two columns that were genuinely at `lg`. The contract's own preference order
(`Bars` first) and its stated goal (free space in the 1024–1279px window) both point to the same
action regardless: hiding `Bars` until `xl` removes it from the crowded `lg` range exactly the
same way a literal `lg→xl` move would have, since anything visible at `sm` is *also* visible
throughout `lg`. I did what the contract's goal requires, not what its literal breakpoint
description assumed was already true — flagging the mismatch rather than silently treating it as
consistent.

**Before adding the widened Price cell and the new column, this contract's own premise was
already live and correct**: 1024px fit with zero slack (contract 0019). Adding both broke it
immediately, along with 375px and — a case the contract didn't explicitly call out — 1280px once
`Bars` and `Coverage` compete there simultaneously alongside everything else. Measured, not
assumed: moving `Bars` alone recovers exactly the room needed at 1024px, but `Name`'s max-width
caps (the one shrinkable column, established in contracts 0018/0019) also needed retightening at
three breakpoints, because the widened Price cell (now carrying a change label alongside the
price) eats into the same budget everywhere it's visible — including at 375px, where there's no
new column at all, only a wider one.

`Name`'s caps: `max-w-[5rem] sm:max-w-[12rem] md:max-w-[7rem] lg:max-w-[10rem] xl:max-w-[10rem]`
— down from `7rem`/`14rem`/`28rem` at base/lg/xl respectively; `sm` and `md` were untouched since
they measured clean without adjustment.

## Criterion 5 — all ten widths, final state

| width | `table.scrollWidth` | card `clientWidth` | pass/fail |
|---|---|---|---|
| 375 | 341 | 341 | pass |
| 639 | 605 | 605 | pass |
| 640 | 590 | 590 | pass |
| 767 | 717 | 717 | pass |
| 768 | 718 | 718 | pass |
| 1023 | 973 | 973 | pass |
| 1024 | 974 | 974 | pass |
| 1279 | 1229 | 1229 | pass |
| 1280 | 1230 | 1230 | pass |
| 1440 | 1390 | 1390 | pass |

All ten pass as exact matches (`scrollWidth == clientWidth`), not just `<=`. Measured over CDP
against the real `UniverseTable` component (temporary swap of `frontend/src/main.tsx`, restored
to its exact original content afterward — confirmed via empty `git diff --stat` and absence from
`git status` — same technique as every prior UI contract this session, since this sandbox still
cannot run the backend to drive the real page).

Before the `Name`-cap fix, the actual failures were:
- 375px: 362 vs 341 (21px over), download icon clipped
- 1024px: 1025 vs 974 (51px over), download icon clipped
- 1280px: 1310 vs 1230 (80px over), download icon clipped

## Criterion 6 — `Last Close` placement

`Last Close` is present at 1024px (placed at `lg`, per the contract's explicit instruction —
"Visible from `lg` up"), absent below it, and `Bars` (the column I moved) is absent at 1024px and
present only from 1280px (`xl`). Confirmed by reading actual rendered header visibility
(`getComputedStyle(th).display !== 'none'`), not by reading the CSS classes.

## Criterion 7 — download icon

Present and unclipped (bounding rect fully inside the card's rect) at all ten widths, confirmed in
the same measurement pass above.

## Verification

```
$ npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ built in 163ms

$ git diff --stat frontend/package.json
(empty)

$ grep -nE 'hidden (sm|md|lg|xl):table-cell' frontend/src/components/UniverseTable.tsx
46:            <th className={`${TH} hidden sm:table-cell`}>Type</th>
47:            <th className={`${TH} hidden md:table-cell`}>Sector</th>
48:            <th className={`${TH} text-right hidden lg:table-cell`}>Last Close</th>
50:            <th className={`${TH} text-right hidden lg:table-cell`}>Mkt Cap</th>
51:            <th className={`${TH} text-right hidden lg:table-cell`}>P/E</th>
52:            <th className={`${TH} text-right hidden md:table-cell`}>Yield</th>
53:            <th className={`${TH} text-right hidden xl:table-cell`}>Bars</th>
54:            <th className={`${TH} hidden xl:table-cell`}>Coverage</th>
(plus the matching <td> cells at lines 83, 86, 89, 116, 119, 122, 125, 128)

$ grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/lib/change.ts frontend/src/components/UniverseTable.tsx
(no matches, exit 1)

$ grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/lib/change.ts frontend/src/components/UniverseTable.tsx
(no matches, exit 1)

$ git diff --stat backend/ frontend/src/pages/ frontend/src/components/ChartDialog.tsx frontend/src/components/FilterDialog.tsx frontend/src/lib/ranges.ts frontend/src/api/client.ts
frontend/src/pages/UniversePage.tsx | 2 +-
```
That one line predates this session — uncommitted work from contract 0023, present before I
started. `git status` before and after confirms the only files I touched are `change.ts` (new)
and `UniverseTable.tsx`.

### Criterion 4 — `priceChange` against all six cases plus the rounding trap, `/tmp` script

```
priceChange(330.26, 333.08) -> {"percent":-0.8466...,"direction":"down","label":"-0.85%"}
priceChange(340, 333.08)    -> {"percent":2.0775...,"direction":"up","label":"+2.08%"}
priceChange(333.08, 333.08) -> {"percent":0,"direction":"flat","label":"0.00%"}
priceChange(null, 333.08)   -> {"percent":0,"direction":"flat","label":"0.00%"}
priceChange(100, null)      -> {"percent":null,"direction":"flat","label":""}
priceChange(100, 0)         -> {"percent":null,"direction":"flat","label":""}

--- rounding trap ---
priceChange(333.0933, 333.08) -> {"percent":0.00399...,"direction":"flat","label":"0.00%"}
```
All seven match exactly, including the trap (raw +0.004% rounds to `0.00%`/`flat`, never
`up`). Script written to and deleted from `/tmp` (confirmed via `ls` failing afterward).

## Design decisions

- **`priceChange`'s `percent` field is the raw, unrounded value**; only `direction` and `label`
  go through rounding. The interface doesn't specify rounding for `percent` itself, and keeping it
  precise costs nothing since no caller renders it directly — `label` is what's displayed.
- **Guarded against negative zero.** `Math.round(percent * 100) / 100` on a very small negative
  percentage (e.g. −0.001%) produces `-0` in JavaScript, and `(-0).toFixed(2)` prints the string
  `"-0.00"` — a colour-correct-but-visually-wrong result the contract's own six cases don't happen
  to exercise, but the rounding-trap case they *do* specify is close enough to this exact
  boundary that I checked for it deliberately. Normalized explicitly (`if (rounded === 0) rounded
  = 0`) rather than leaving it to chance.
- **Computed `priceChange` once per row**, not once per usage. My first draft called it twice
  inline (once for the colour class, once for the label) inside the JSX; cleaned this up to a
  single `const change = priceChange(...)` per row before rendering, since the function is pure
  but there's no reason to compute it twice per row for no benefit.

## Human verification — not done by me

Both halves need either real market hours or a running server, neither available here (this
sandbox cannot run the backend at all — the standing constraint across every backend-adjacent
contract this session). Specifically:
1. During market hours: `Last Close` and `Price` showing different numbers, a green/red
   percentage that matches the sign of the actual difference, cross-checked against
   `ticker_quotes` via `psql`.
2. After 16:00 ET: `Last Close` and `Price` showing the *same* number, the change reading grey
   `0.00%`, and the tooltip switching to `Market closed — showing the last close`.

I verified the logic these depend on (`priceChange`'s six cases plus the rounding trap, and the
live rendering of `Last Close`/`Bars` visibility and the download icon at all ten widths) with
controlled data — not against the live site or real quote data.
