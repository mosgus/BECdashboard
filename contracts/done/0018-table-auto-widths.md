# Contract 0018 — Content-sized table columns

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Columns size to their content: `Sector` shows `Consumer Cyclical` in full instead of
`Consumer Cyc…`, `Coverage` stops hoarding space it never uses, and `Name` absorbs the slack.

## Why

`UniverseTable` uses `table-fixed` with hand-tuned percentage widths. Two problems, both arithmetic
rather than design:

- **The percentages sum to 104% at `lg`** (6+16+9+10+10+8+6+7+6+18+8), so the browser scales every
  column down proportionally. Nothing gets the width it was assigned.
- **The allocation is backwards.** `Coverage` holds `2016-01-04 → 2026-09-14` — **always exactly 23
  characters, it never varies** — and is given 18%. `Sector` needs up to 22 characters and is given
  10%, so it truncates.

Measured against the live universe on 2026-09-15:

| column | longest content | bounded? |
|---|---|---|
| Ticker | 5 (`BYDDF`) | yes |
| Sector | 18 now, **22 max** (`Communication Services`) | yes |
| Coverage | **always 23** | fixed format |
| Name | 31 (`Constellation Energy Corporatio`) | the only variable one |

Every column except `Name` has bounded, knowable content. That is exactly the case auto table layout
handles correctly and hand-tuned percentages handle badly — these widths have now been re-tuned
three times (contracts 0009, 0014, 0017), once per column added or removed. Content sizing ends
that.

**Drag-to-resize was considered and rejected** for now: it does not fix the default being wrong,
it needs a persistence decision to survive a reload, and it conflicts with responsive column hiding.
Revisit only if content sizing proves insufficient in use.

**The constraint that must survive.** `table-fixed` was introduced in contract 0009 because
auto-sizing overflowed horizontally at 375px, and the card's `overflow-hidden` **silently clipped**
the last column rather than producing a scrollbar. It was caught only by comparing
`table.scrollWidth` to the container numerically — a screenshot looked fine. The `max-width` on
`Name` is what prevents that recurring, and criterion 6 requires it be re-measured the same way, not
eyeballed.

**Depends on contract 0017.** If `UniverseTable.tsx` has no download column, stop and report
`BLOCKED`.

## Files

Modify:
- `frontend/src/components/UniverseTable.tsx`

**Touch nothing else.** Do not modify `UniversePage.tsx`, `FilterDialog.tsx`, `lib/`, `api/`,
`globals.css`, or anything under `backend/`. No new dependencies. If the work appears to require a
file not on this list, stop and report `BLOCKED`.

## Interface

### Layout

- Replace `table-fixed` with **`table-auto`** on the `<table>`.
- **Delete every `w-[…%]` class** from the `<th>` elements. All of them. Leaving any behind
  partially re-imposes the fixed allocation and produces a worse result than either approach alone.
- Keep `w-full` on the table so it still fills the card.
- Keep the existing `hidden sm:table-cell` / `md:` / `lg:` responsive hiding exactly as-is. This
  contract changes *widths*, not *which columns appear*.
- Keep the existing right-alignment on numeric columns and the existing padding.

### Per-column content rules

- **Every column except `Name` keeps `whitespace-nowrap` and drops any truncation.** They are
  bounded; they should occupy exactly what they need. `Sector` in particular must **not** be
  truncated or ellipsized — showing it in full is the point of this contract.
- **`Name` is the only shrinkable column.** It keeps `whitespace-nowrap overflow-hidden
  text-ellipsis` and gains a responsive `max-width`, so it yields space under pressure and
  ellipsizes only when genuinely necessary:

```
max-w-[9rem] sm:max-w-[12rem] md:max-w-[16rem] lg:max-w-[24rem]
```

Tune these if measurement demands it — they are a starting point, not a specification. Report what
you land on and why.

**Why `Name` must carry a `max-width`:** in auto layout a table grows to fit its content, and if the
sum of min-content widths exceeds the container the table overflows its parent. With
`overflow-hidden` on the card that overflow is invisible clipping rather than a scrollbar. The
`max-width` gives the browser one column it is permitted to shrink. Without it, this contract
recreates the 0009 bug.

- Keep `title={row.short_name}` (or add it) on the `Name` cell so the full value is available on
  hover when it does ellipsize.

## Out of scope

- **No drag-to-resize.** Considered and rejected above.
- No sorting, no column show/hide controls, no user-configurable widths.
- No change to which columns are hidden at which breakpoint.
- No change to the data, the formatters, or `lib/format.ts`.
- No switch from `short_name` to `long_name` — see open questions.
- No changes to `UniversePage.tsx`, the filters, or the download column's behaviour.
- No new dependencies.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`** — the root tsconfig has `files: []` and checks nothing.
2. `npm run build` succeeds.
3. `grep -n "table-fixed" frontend/src/components/UniverseTable.tsx` matches nothing (exit 1).
4. `grep -nE 'w-\[[0-9]+%\]' frontend/src/components/UniverseTable.tsx` matches nothing (exit 1) —
   every percentage width is gone.
5. `grep -nE 'text-ellipsis|truncate' frontend/src/components/UniverseTable.tsx` matches **only** on
   the `Name` cell. Quote the matching lines in the report; `Sector` must not appear among them.
6. **Measured, not eyeballed.** At **375px**, `document.querySelector('table').scrollWidth` is `<=`
   the card's `clientWidth`. Report both numbers. Repeat at **700px, 900px, 1100px and 1440px**.
   This is the check that caught real clipping in contract 0009; a screenshot is not a substitute.
7. At `lg` width, `Consumer Cyclical` and `Financial Services` render **in full**, with no ellipsis.
8. `git diff --stat frontend/package.json frontend/src/pages/ frontend/src/lib/ frontend/src/api/ backend/`
   is empty.

Criteria 6 and 7 are the contract. If a browser is unavailable, say so plainly under "Not done"
rather than inferring them from the CSS — the whole point is that reasoning about this was wrong
twice before.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
grep -n "table-fixed" frontend/src/components/UniverseTable.tsx ; echo "exit=$? (1 means clean)"
grep -nE 'w-\[[0-9]+%\]' frontend/src/components/UniverseTable.tsx ; echo "exit=$? (1 means clean)"
grep -nE 'text-ellipsis|truncate|max-w-' frontend/src/components/UniverseTable.tsx
git diff --stat frontend/package.json frontend/src/pages/ frontend/src/lib/ frontend/src/api/ backend/ ; echo "(empty = untouched)"
```

For criterion 6, paste a table of `scrollWidth` vs `clientWidth` at each of the five widths.

## Human verification — does Gunnar need to run anything?

**Yes — this is a visual contract and the planner cannot judge it.**

With backend and frontend running, at `localhost:5173/universe`:

1. **`Sector` shows `Consumer Cyclical` in full** — no `Consumer Cyc…`. This is the complaint that
   started the contract.
2. `Coverage` no longer has a large gap before the download icon; that space went to the other
   columns.
3. Long company names still ellipsize gracefully rather than pushing the table sideways, and
   hovering one shows the full value.
4. **Narrow to 375px** — no horizontal scrollbar, and the download icon is still visible and
   clickable. Check the icon specifically; it was the column silently clipped last time.
5. Drag the window slowly from wide to narrow — columns should disappear at the existing
   breakpoints without anything jumping or overflowing in between.

## Open questions — do NOT resolve these yourself

- **Drag-to-resize.** Rejected for now; revisit only if content sizing proves insufficient in use.
- **Showing `long_name` instead of `short_name`.** Yahoo caps `shortName` at ~31 characters —
  `Constellation Energy Corporatio` is genuinely missing its final "n" in the source data, not in our
  rendering. `long_name` is already stored and carries the full value. Switching would widen the
  column and is a separate decision. Do not switch.
- **Sorting.** Still open. Do not add sortable headers.
