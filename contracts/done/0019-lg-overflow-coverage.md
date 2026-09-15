# Contract 0019 — Fix the 1024px table overflow

**Status:** accepted
**Assigned to:** haiku (reworked and re-verified by sonnet — see report)
**Author:** planner (opus)

## Goal

The Universe table fits its container at **every** width, including 1024px, where it currently
overflows by roughly 73px and silently clips the download icon.

## Why

**Planner defect.** Contract 0018 specified five test widths — 375, 700, 900, 1100, 1440 — and the
implementation passes all five. **None of them is a breakpoint boundary.** Tailwind's are 640, 768,
1024 and 1280.

At exactly **1024px** the `lg:` classes fire, so `Mkt Cap`, `P/E` and `Coverage` all become visible
**at once, in the narrowest viewport where any of them is shown.** That is definitionally the worst
case for a responsive table, and it sits between the two widths I chose. The 0018 coder measured it
anyway and reported ~73px of overflow rather than staying inside the letter of the criteria.

The consequence is the contract-0009 bug again: the card's `overflow-hidden` turns that overflow into
**invisible clipping of the last column** — the download icon — rather than a scrollbar. 1024px is
iPad landscape and a common laptop width, so this is not an edge case.

**Why shrinking `Name` further is not the fix.** At 1024px the ten other columns are unshrinkable and
already consume nearly the whole container; `Name`'s cap is not the binding constraint. Squeezing it
to fit would leave a column too narrow to read while still barely fitting.

**The fix is one fewer column in that range.** `Coverage` is the widest bounded column
(`2016-01-04 → 2026-09-14`, always 23 characters, ~180px with padding) and the least essential —
`Bars` already signals how much history exists. Moving it from `lg` to `xl` frees roughly 200px in
exactly the range that is short, and restores it at 1280px where there is room.

This reverses contract 0018's "do not change which columns appear at which breakpoint." That
instruction was mine and it was wrong: the widths cannot be made to work at 1024px with eleven
columns.

**Depends on contract 0018.** If `UniverseTable.tsx` still contains `table-fixed`, stop and report
`BLOCKED`.

## Files

Modify:
- `frontend/src/components/UniverseTable.tsx`

**Touch nothing else.** Do not modify `UniversePage.tsx`, `FilterDialog.tsx`, `DownloadIcon.tsx`,
`lib/`, `api/`, `globals.css`, or anything under `backend/`. No new dependencies. If the work appears
to require a file not on this list, stop and report `BLOCKED`.

## Interface

**One change plus its consequences:**

1. `Coverage` moves from `hidden lg:table-cell` to **`hidden xl:table-cell`**, on both the `<th>`
   and the matching `<td>`. Both, or the header and body rows disagree about column count.
2. Re-tune `Name`'s `max-width` **only if** measurement requires it. The `lg:max-w-[8rem]` dip exists
   solely because of the 1024px squeeze; with `Coverage` gone from that range, `lg` likely tolerates
   a larger value. Report what you land on and the measurements behind it.
3. Change nothing else — not the other columns' breakpoints, not `table-auto`, not the alignment,
   padding, or the download column.

## Out of scope

- No drag-to-resize, no sorting, no column show/hide controls.
- No changes to which columns are hidden **other than `Coverage`**.
- No change to `table-auto` or to the removal of percentage widths from 0018.
- No switch from `short_name` to `long_name`.
- No new dependencies.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`.**
2. `npm run build` succeeds.
3. `Coverage`'s `<th>` and `<td>` both use `xl:table-cell`, and neither uses `lg:table-cell`.
4. **Measured at every breakpoint boundary and just below it**, which is what 0018 failed to do:
   **375, 639, 640, 767, 768, 1023, 1024, 1279, 1280, 1440**. At each,
   `document.querySelector('table').scrollWidth <= ` the card's `clientWidth`. Paste both numbers
   for every width as a table.
5. `Coverage` is absent at 1024px and present at 1280px — confirm by reading the rendered header
   cells, not by reading the CSS.
6. The download icon is present and not clipped at all ten widths.
7. `git diff --stat frontend/package.json frontend/src/pages/ frontend/src/lib/ frontend/src/api/ backend/`
   is empty.

Criterion 4 is the contract. **If a browser is unavailable, say so plainly under "Not done"** rather
than inferring from CSS — reasoning about this has now been wrong three times.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
grep -n "Coverage" frontend/src/components/UniverseTable.tsx
grep -nE 'lg:table-cell|xl:table-cell' frontend/src/components/UniverseTable.tsx
grep -nE 'max-w-' frontend/src/components/UniverseTable.tsx
git diff --stat frontend/package.json frontend/src/pages/ frontend/src/lib/ frontend/src/api/ backend/ ; echo "(empty = untouched)"
```

For criterion 4, paste a ten-row table of width / `scrollWidth` / `clientWidth` / pass-fail.

## Human verification — does Gunnar need to run anything?

**Yes, and one width matters more than the rest.**

With the app running, at `localhost:5173/universe`:

1. **Set the window to roughly 1024px** — an iPad-landscape-sized window. No horizontal scrollbar,
   and the **download icon must be visible and clickable on every row**. That is the bug.
2. `Coverage` should be absent there, and reappear as you widen past ~1280px.
3. Drag slowly from 1440px down to 375px. Nothing should overflow or clip at any point in between —
   the previous two attempts at this both passed at the widths they were tested at and failed
   somewhere between them.
4. `Sector` still shows `Consumer Cyclical` in full — 0018's gain must survive.

## Open questions — do NOT resolve these yourself

- **Whether `Coverage` earns a column at all.** `Bars` already conveys how much history exists, and
  `first_bar`/`last_bar` are available on the detail shape. Removing it entirely would end this
  class of problem, but that is a product decision, not a layout fix.
- **Drag-to-resize.** Still rejected; revisit only if content sizing proves insufficient in use.
- **Sorting.** Still open.
