# Report — Contract 0019 — Fix the 1024px table overflow

**Status:** reported

## Context — this report supersedes an unverifiable prior attempt

This contract was assigned to haiku. Whatever was submitted before this report was not backed by
a working measurement: it left three scratch files in the repo — `measure.js`, `measure-table.js`,
and `frontend/measure-table.html` — and `measure-table.js` imported `puppeteer`, which is not a
project dependency (confirmed: not in `frontend/package.json`, not in `node_modules`), so that
script could not have executed. Gunnar asked for the real numbers and for those files deleted.

**On the files**: I searched the entire repo (root, `frontend/`, a recursive `find` across the
whole filesystem excluding system/node_modules noise) and none of the three files exist anywhere I
can find right now. There is nothing on disk for me to delete. If they're still visible somewhere
on your end — a different worktree, an editor buffer, something outside this checkout — point me
at the actual path and I'll remove it; I'm not going to claim a deletion I can't verify happened.

**On the numbers**: I did not repeat that mistake. Everything below was measured with a live
headless Chrome instance driven over the Chrome DevTools Protocol, against the real
`UniverseTable` component rendered with the real 8-ticker dataset plus one extra row carrying
`sector: "Financial Services"` (same dataset used for contract 0018's verification, for the same
reason — no current ticker has that sector).

## What I found before changing anything — two real failures, not one

`Coverage` had already been moved to `hidden xl:table-cell` on both `<th>` and `<td>` by the time I
started (confirmed by reading the file — this part of the fix was already in place). But measuring
all ten required widths against that state surfaced **two genuine overflows**, not zero:

| width | `scrollWidth` (before) | `clientWidth` | result |
|---|---|---|---|
| 768 | 812 | 718 | **fail** — 94px over, download icon clipped |
| 1024 | 990 | 974 | **fail** — 16px over |

**768px was not caused by `Coverage` at all.** `Coverage` doesn't appear until `xl` (1280px); at
768px the columns arriving simultaneously are `Sector` and `Yield` (the `md` breakpoint). This is
the identical failure class the contract itself describes for `lg` — "the widest-simultaneous-
arrival width is the worst case" — just recurring one breakpoint down, at `md`. It was invisible in
contract 0018's five test widths (none of which was 768) and apparently invisible in whatever
haiku actually ran too (or wasn't run).

**1024px was improved but not fixed.** The `Coverage` move freed real room there (73px of overflow
under contract 0018 down to 16px), but the `lg:` cap `Name` had at the time (`18rem` = 288px) still
exceeded the available budget by those 16 pixels.

## The fix

Tightened `Name`'s `md:` and `lg:` caps, leaving everything else (the `Coverage` breakpoint change,
`sm:`, `xl:`, all other columns, `table-auto`, alignment, padding) untouched:

```
max-w-[7rem] sm:max-w-[12rem] md:max-w-[7rem] lg:max-w-[14rem] xl:max-w-[28rem]
```

- `md:` dropped from `14rem` (224px) to `7rem` (112px) — the exact 768px squeeze needed `Name`
  under ~130px to close a 94px gap; matching it to the already-proven base value was simplest.
- `lg:` dropped from `18rem` (288px) to `14rem` (224px) — 1024px's budget was ~240px; 224px leaves
  real margin rather than cutting it to the pixel.

One non-obvious thing this surfaced, worth stating plainly rather than leaving implicit: `max-width`
on a table cell in `table-auto` layout does **not** behave like `max-width` on a normal block
element. Measured directly: at 1023px (still within the `md` range, but with more room than 768px),
`Name` rendered at 268px even though its cap at the time was 224px — the browser let it grow past
the cap because there was surplus space to distribute. The cap only reliably binds when the
container is tight enough that the browser needs to shrink something to fit. This is why the fix
targets the specific worst-case width in each range rather than picking one value and trusting it
holds everywhere in between — trusting it was exactly the failure mode this contract exists to
correct.

## Criterion 4 — the full ten-row table, final state

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

All ten pass, all as exact matches (`scrollWidth == clientWidth`), not just `<=`.

## Criterion 5 — `Coverage` absent/present, read from rendered headers, not CSS

Checked via each `<th>`'s **computed `display` style**, not `textContent` inclusion — a `hidden`
element's text is still present in the DOM, so text-matching alone would have silently passed even
if `Coverage` were rendering off-screen. (I made exactly this mistake on my first pass at this
measurement and caught it before reporting — worth naming since it's the same category of "checked
the wrong thing" error this contract exists to stop happening.)

- 375 through 1279px: `Coverage` **not** among the visible header cells.
- 1280px and 1440px: `Coverage` **is** among the visible header cells.

## Criterion 6 — download icon presence

Checked the last row's icon `<a>` at every width: non-zero bounding box, and its rect falls fully
within the card's rect (not clipped past the card's right edge by `overflow-hidden`). True at all
ten widths in the final state; **false at 768px** in the pre-fix state (this is what "the download
icon must be visible and clickable on every row" actually catches — it wasn't hidden by CSS, it was
geometrically pushed past the card's clipped boundary).

## Verification

```
$ npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ built in 112ms

$ grep -n "Coverage" frontend/src/components/UniverseTable.tsx
43:            <th className={`${TH} hidden xl:table-cell`}>Coverage</th>

$ grep -nE 'lg:table-cell|xl:table-cell' frontend/src/components/UniverseTable.tsx
39:  Mkt Cap — lg:table-cell
40:  P/E — lg:table-cell
43:  Coverage — xl:table-cell (th)
66, 69: Mkt Cap / P/E tds — lg:table-cell
78: Coverage td — xl:table-cell

$ grep -nE 'max-w-' frontend/src/components/UniverseTable.tsx
52:  max-w-[7rem] sm:max-w-[12rem] md:max-w-[7rem] lg:max-w-[14rem] xl:max-w-[28rem]
```
`Coverage`'s `<th>` and `<td>` both use `xl:table-cell`; neither uses `lg:table-cell` — the two
`lg:table-cell` matches are `Mkt Cap`/`P/E`, unrelated to this contract.

```
$ git diff --stat frontend/package.json frontend/src/pages/ frontend/src/lib/ frontend/src/api/ backend/
```
Not empty — `frontend/src/pages/UniversePage.tsx` and files under `backend/` show diffs. None of
these are from this contract. They're uncommitted work from contract 0020 (the zip-export button
and route), already present before I started this fix and untouched by me here. `git status` before
and after this session confirms the only file I edited is `frontend/src/components/UniverseTable.tsx`.

## How this was measured (relevant to trust)

Same method as contract 0018, for the same reason: I still cannot run the backend in this sandbox
(any binary executed from inside a Python virtualenv is hard-blocked here). I temporarily replaced
`frontend/src/main.tsx` to mount `<UniverseTable>` directly with mock data inside the same wrapper
markup `UniversePage.tsx` uses, drove it with headless Chrome over CDP, then **restored
`main.tsx` to its exact original content** — confirmed via `git diff --stat frontend/src/main.tsx`
showing empty, and it does not appear in `git status`. The measurement script
(`frontend/measure.mjs`) was deleted after use and also does not appear in `git status`.

## Human verification — not done by me

Per the contract's own list: setting the window to ~1024px and confirming the download icon is
clickable there, watching `Coverage` appear/disappear while dragging past 1280px, and — the point
of this whole contract — dragging continuously from 1440px down to 375px rather than checking
discrete points. I measured ten discrete widths, which is what was asked; it is still not the same
as watching a continuous drag, and I have no way to do that here.
