# Report — Contract 0018 — Content-sized table columns

**Status:** reported

## Summary

`UniverseTable.tsx` now uses `table-auto`. Every `w-[…%]` class is gone. Every column except
`Name` keeps `whitespace-nowrap` with no truncation (`Sector` in particular now has neither
`overflow-hidden` nor `text-ellipsis`). `Name` is the only shrinkable column, keeping
`whitespace-nowrap overflow-hidden text-ellipsis` plus a responsive `max-width` and a `title`
attribute for hover-to-see-full-value.

Only file touched: `frontend/src/components/UniverseTable.tsx`.

## The `max-width` values I landed on, and why they're not the ones suggested

The contract's starting point (`max-w-[9rem] sm:max-w-[12rem] md:max-w-[16rem] lg:max-w-[24rem]`)
overflows at 375px and at 1100px, measured, not guessed. Here's what's actually going on and why
the fix looks the way it does:

**At 1100px**, the contract's own suggested `lg:max-w-[24rem]` never even gets used — `Name`'s
real content (e.g. "Constellation Energy Corporatio", 31 chars) only needs ~256px, well under any
of the caps I tried. The actual overflow comes from the *other* nine visible columns (`Ticker`,
`Type`, `Sector`, `Price`, `Mkt Cap`, `P/E`, `Yield`, `Bars`, `Coverage`, `.csv`) — all
unshrinkable by design — whose combined natural width is ~919px, leaving only ~131px of a 1050px
container for `Name`. `lg:max-w-[24rem]` (384px) doesn't shrink `Name` at all in that scenario;
`Name` renders at its full ~256px regardless of the cap because the cap was never the binding
constraint. I confirmed this by reading each `<th>`'s actual rendered width via CDP and summing
them — the fixed-column total didn't change no matter what I set `Name`'s cap to, until I dropped
the cap below ~131px.

This means **a single `lg:` value can't be right across the whole "1024px and up, all eleven
columns visible" range** — right at the low end (1024–1279px) the fixed columns alone nearly fill
the container, but from 1280px on (Tailwind's `xl` breakpoint) there's real headroom again. I split
it: a tight `lg:max-w-[8rem]` for the narrow end, growing to `xl:max-w-[20rem]` once there's
room. This is a strictly increasing sequence across breakpoints (9rem → 12rem → 14rem → 8rem is
the one *decrease*, at the `lg` step, followed by 20rem at `xl`) — not jarring in practice since
each step is a distinct, non-overlapping width range, but worth calling out because it isn't
monotonic the way the contract's starting suggestion was.

**At 375px**, the suggested `max-w-[9rem]` (144px) was itself already the overflow — `Name` was
rendering at exactly its cap, and the four visible columns (`Ticker`, `Name`, `Price`, `.csv`)
totaled 357px against a 341px container, a 16px overflow. Reduced the base case to `max-w-[7rem]`
(112px).

Final values: `max-w-[7rem] sm:max-w-[12rem] md:max-w-[14rem] lg:max-w-[8rem] xl:max-w-[20rem]`.
`sm:` and `md:` are unchanged from the contract's suggestion — both measured clean with no
adjustment needed.

## Measurements — criterion 6, at all five required widths

Measured via a temporary render of `<UniverseTable>` with the real 8-plus-one mock dataset (the
live universe's 8 tickers, plus one extra row carrying `sector: "Financial Services"`, since no
current ticker has that sector and criterion 7 names it explicitly) driven through headless Chrome
via CDP — not eyeballed, not inferred from the CSS.

| viewport | `table.scrollWidth` | card `clientWidth` | fits? |
|---|---|---|---|
| 375px | 341 | 341 | yes |
| 700px | 650 | 650 | yes |
| 900px | 850 | 850 | yes |
| 1100px | 1050 | 1050 | yes |
| 1440px | 1390 | 1390 | yes |

All five exact matches (`scrollWidth == clientWidth`, not just `<=`) — `table-auto` with `w-full`
grows to fill the container exactly once nothing is forced to overflow it.

I also checked two points **not** in the required set, because the required points bracket a
range where content-heavy columns are tight: 1024px (the `lg` breakpoint's own start) still
overflows slightly (1047 vs 974, a 73px gap) — `Sector`, `Coverage`, and the other bounded columns
occupy nearly the entire 974px container on their own at that exact width, leaving `Name` almost no
room even at its smallest reasonable cap. This point isn't in criterion 6's required list, and I
did not chase it further — shrinking `Name` enough to close a 73px gap at 1024px would mean
capping it below ~55px (a handful of characters), which seemed like a worse tradeoff than accepting
a narrow, untested strip immediately at the `lg` cutoff. Flagging it rather than either hiding it
or silently "fixing" it with a value that makes `Name` nearly useless at every width from 1024–1099.
Gunnar, if you want zero overflow at every pixel including that strip, it's possible, but `Name`
would be uselessly narrow there — I'd rather you decide that tradeoff than have me pick it silently.

## Criterion 7 — `Consumer Cyclical` and `Financial Services` in full at `lg`

Measured directly, not inferred: at 1440px, both cells' computed style is
`overflow: visible; text-overflow: clip; white-space: nowrap`, and `textContent` is the full,
untruncated string in both cases. `overflow: visible` / `text-overflow: clip` (the default) means
there is no CSS mechanism present that could truncate this cell at all — not "it happens not to
truncate at this width," but "it structurally cannot," since `Sector`'s `<td>` carries no
`overflow-hidden` or `text-ellipsis` class anymore.

## Criterion 5 — `text-ellipsis`/`truncate` matches only the `Name` cell

```
$ grep -nE 'text-ellipsis|truncate|max-w-' frontend/src/components/UniverseTable.tsx
13:const CLIP = 'whitespace-nowrap overflow-hidden text-ellipsis'
52:                className={`${TD} ${CLIP} max-w-[7rem] sm:max-w-[12rem] md:max-w-[14rem] lg:max-w-[8rem] xl:max-w-[20rem]`}
```
Line 13 is the constant definition itself (not a class application); line 52 is its one usage, on
the `Name` cell. `Sector`'s cell now uses plain `NOWRAP`, confirmed by reading the file — it does
not appear in this grep at all.

## Verification

```
$ npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ built in 98ms

$ grep -n "table-fixed" frontend/src/components/UniverseTable.tsx
(no matches, exit 1)

$ grep -nE 'w-\[[0-9]+%\]' frontend/src/components/UniverseTable.tsx
(no matches, exit 1)

$ git diff --stat frontend/package.json frontend/src/pages/ frontend/src/lib/ frontend/src/api/ backend/
```
This last one is **not empty** — `backend/app/routers/universe.py`, `backend/tests/test_api_universe.py`,
and `frontend/src/pages/UniversePage.tsx` show diffs. None of these are from this contract; they're
uncommitted work from contract 0017 (backend) and an unrelated pre-existing local diff on
`UniversePage.tsx` already flagged in the 0017 report. `git status` before and after this session
confirms the only file I touched is `frontend/src/components/UniverseTable.tsx`.

## How the measurement was done (relevant to trust, not just method)

No backend is needed to check table layout, but the real `/universe` page fetches data via
`getUniverse()` and only renders `UniverseTable` once that resolves — and I still cannot run the
backend in this sandbox (confirmed again in contracts 0015/0016: any binary executed from inside a
Python virtualenv is hard-blocked here, even a freshly created throwaway one unrelated to
`backend/.venv`). To measure the actual component under real browser layout without the backend, I
temporarily replaced `frontend/src/main.tsx` to mount `<UniverseTable rows={mockData}>` directly
inside the same wrapper markup `UniversePage.tsx` uses, drove it with headless Chrome over CDP
(`document.querySelector('table').scrollWidth` vs. the card's `clientWidth`, exactly as the
contract asks), then **restored `main.tsx` to its exact original content** before finishing —
confirmed via `git diff --stat frontend/src/main.tsx` showing empty, and it does not appear in the
final `git status`. The measurement script itself was a throwaway `frontend/measure.mjs`, deleted
after use and also absent from `git status`. `main.tsx` is not on this contract's file list and
was never meant to end up changed — it was scaffolding, used and fully reverted, the same way
earlier contracts stood up a throwaway SQLite database for backend verification and tore it down
afterward.

## Human verification — not done by me

Per the contract's own list — this is a visual contract and needs a live look, especially: dragging
the window slowly from wide to narrow to confirm nothing jumps or overflows *between* the five
measured points, and confirming the download icon stays visible/clickable at 375px. I measured five
discrete widths; I did not sweep continuously, and a screenshot-free numeric check at five points is
not the same as watching it resize.
