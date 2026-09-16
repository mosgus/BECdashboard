# Contract 0033 — Paged news card grid with prev/next

**Status:** accepted (2026-09-15) — audited by planner. One a11y fix applied; visual checks 1-9
remain Gunnar's.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Every article with a thumbnail becomes a card. The cards are paged six at a time in a grid that
slides between pages, driven by prev/next buttons. The text list reverts to its reference role:
**articles with no thumbnail, only.**

Frontend only. One file.

## Why

Gunnar, 2026-09-15, looking at the shipped page: *"there are only 6 cards with thumbnails. I expected
more? … Could we implement a slide show with buttons to load the next grid and can it be animated in
a way to show a 'rotation' of article cards?"*

He is right that articles are missing from the grid. Contract 0032 capped cards at 6 and pushed the
rest into the text list, because rendering ~15 cards in one column stack is a wall. Paging is the
answer that contract should have had — and it is what
`reference files/news_section_reference/news_section.py` does (`CARDS_PER_SLIDE = 3`, prev/next at
lines 283–298). **Contract 0032 explicitly cut the slideshow and that was the wrong call.** This
restores it.

**Consequence to expect: the text list may empty out.** With today's feed all 20 articles carry a
thumbnail, so all 20 become cards across four pages and `withoutThumb` is empty. That is correct —
41 of 159 stored rows have no thumbnail, so the list will reappear as older articles rotate in. Do
not invent filler to keep it populated.

## Environment

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`** — the root
tsconfig has `files: []` and checks zero files.

**Restart the backend with `--reload` before any visual check.** A stale `uvicorn` serves the code it
was launched with. `lsof -nP -iTCP:8000 -sTCP:LISTEN` names whatever owns the port.

Verification harnesses are **new files you delete afterwards**. Never edit `frontend/src/main.tsx`,
`App.tsx`, or `index.html` to drive a browser — see your role file. A stalled run that leaves a new
file behind is visible in `git status`; a stalled run that leaves an edited entry point is not.

## Files

Modify:
- `frontend/src/components/NewsSection.tsx`

**That is the entire file list.** No backend change — `GET /news` already returns everything needed.
Do not touch `app/news.py`, `routers/news.py`, `client.ts`, `LaunchPage.tsx`, `Tooltip.tsx`,
`relativeTime.ts`, `TickerStrip.tsx`, `App.tsx`, `main.tsx`, `index.html`, or any backend file.
**No migration. No new dependency.** Specifically: no carousel library, no `framer-motion`, no
`embla`, no `swiper`.

## Current state — read before changing

`NewsSection.tsx` already has, and must keep:

- `LIMIT = 20`, `MAX_PER_TICKER = 2`, requested as `/news?limit=20&max_per_ticker=2`
- `hasThumbnail`, `publisherLabel`, `ExternalLink`, `ArticleCard`, `ArticleRow`
- `CARD_CLASS` carrying `w-full h-full` — **do not remove those two classes.** `Tooltip` wraps its
  child in an `inline-flex` span, making the card a flex item in a row-direction container, which
  does not stretch along the main axis. Without them a card with a small source thumbnail renders
  narrower than its neighbours. Fixed 2026-09-15; the comment above `CARD_CLASS` explains it.
- `null` on failure, on empty, and while loading

## What changes

### Card set and list set

```
cards = articles.filter(hasThumbnail)          // ALL of them, no slice
list  = articles.filter(a => !hasThumbnail(a)) // thumbnail-less only
```

This replaces 0032's "first 6 as cards, everything else to the list". The list keeps its existing
behaviour — first 5 visible, remainder behind the `<details>` disclosure — and still renders nothing
when empty.

### Paging

`CARDS_PER_PAGE = 6`, chunked in order. The last page may be short; **do not pad it**. A CSS grid
with fewer items simply leaves empty cells, and padding with empty nodes (as the Streamlit reference
had to) would add elements that screen readers announce.

- `useState` for the page index. Reset to 0 whenever `articles` changes.
- **No auto-advance.** A grid that moves while someone is reading it is hostile. Manual only.

### The slide

A single track, each page exactly one container width, translated horizontally:

- Outer: `overflow-hidden`
- Track: `flex`, `transition-transform duration-500 ease-in-out`,
  `style={{ transform: `translateX(-${page * 100}%)` }}`
- Each page: `w-full shrink-0` wrapping the existing
  `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5`

`shrink-0` is load-bearing — without it every page compresses to share one width and the transform
lands between pages.

**`prefers-reduced-motion: reduce` must disable the transition** and leave paging instant. Two lines
of CSS, same as `TickerStrip.tsx` does it. Use a `<style>` block or Tailwind's `motion-reduce:`
variant; either is fine.

Everything is CSS transform. **No `requestAnimationFrame`, no JS animation loop, no interval.**

### Controls

A right-aligned row **above** the grid: prev button, a `page + 1 / totalPages` indicator, next button.

- **Disabled at the ends — no wrap-around.** Wrapping with `translateX` animates the full width of
  the track backwards, which reads as a glitch rather than a rotation. Disabled buttons must be
  visibly disabled and carry `disabled` so they are not focusable.
- Render the whole control row **only when `totalPages > 1`**. One page of cards must not show
  `1 / 1` and two dead buttons.
- Buttons need `aria-label` (`Previous articles` / `Next articles`) **and** a project `Tooltip` —
  these are interactive elements, and `title` does not render on a disabled element, which is exactly
  the case here.

Use inline SVG chevrons or plain `‹` / `›` text. **Do not add an icon dependency.** `DownloadIcon.tsx`
and `SettingsIcon.tsx` are the house pattern for inline SVG if you want one.

## Tooltips

| element | copy |
|---|---|
| Previous button | `Previous articles` |
| Next button | `Next articles` |
| Cards and rows | unchanged from 0032 — `<full title> — <publisher>` |

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
2. `cd frontend && npm run build` succeeds.
3. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` still passes at **253** — this
   contract touches no backend file, so the count must not move.
4. `grep -n "w-full h-full" frontend/src/components/NewsSection.tsx` matches — the 0032 card-sizing
   fix survived.
5. `grep -n "shrink-0" frontend/src/components/NewsSection.tsx` matches.
6. `grep -n "translateX" frontend/src/components/NewsSection.tsx` matches.
7. `grep -rn "prefers-reduced-motion\|motion-reduce" frontend/src/components/NewsSection.tsx`
   matches. **Then state in the report which element the rule actually applies to and why it takes
   effect** — a keyword grep proved nothing twice before in this project and shipped a broken
   reduced-motion fallback both times.
8. `grep -rnE "requestAnimationFrame|setInterval|setTimeout" frontend/src/components/NewsSection.tsx`
   matches nothing (exit 1) — CSS only, and no auto-advance.
9. `grep -n "disabled" frontend/src/components/NewsSection.tsx` matches on both buttons.
10. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/NewsSection.tsx`
    matches nothing (exit 1).
11. `grep -rn "dangerouslySetInnerHTML" frontend/src/` matches nothing (exit 1).
12. `git diff --name-only` lists **only** `frontend/src/components/NewsSection.tsx` among source
    files.
13. `git status --porcelain` shows no new untracked files under `frontend/src/` or `backend/`.
14. `git diff --stat frontend/package.json` is empty — no dependency added.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "w-full h-full\|shrink-0\|translateX\|disabled" frontend/src/components/NewsSection.tsx
grep -rn "prefers-reduced-motion\|motion-reduce" frontend/src/components/NewsSection.tsx
grep -rnE "requestAnimationFrame|setInterval|setTimeout" frontend/src/components/NewsSection.tsx ; echo "(exit $? — 1 = correct)"
git diff --name-only
git status --porcelain
git diff --stat frontend/package.json ; echo "(empty = no dependency added)"
```

Plus, showing how many pages today's data actually produces:

```bash
curl -s "http://127.0.0.1:8000/news?limit=20&max_per_ticker=2" | python3 -c "
import json,sys,math
a=json.load(sys.stdin)['articles']
t=[x for x in a if x['thumbnail_url']]
print('articles', len(a), '| with thumbnail', len(t), '| pages', math.ceil(len(t)/6), '| list rows', len(a)-len(t))"
```

## Human verification — does Gunnar need to run anything?

**Yes.** It is an animation on the first page anyone sees; none of it is provable from source.

At `localhost:5173/`:

1. **The card-width fix from this session**: all six cards in a page are the same width, and every
   thumbnail fills its card edge to edge. The Reuters card was the one that looked wrong — check it
   specifically.
2. Six cards, prev/next and `1 / N` above the grid on the right. Prev is disabled on page 1.
3. Click next — the grid **slides** left, it does not cut or fade. Click again to the last page; next
   becomes disabled.
4. The last page may hold fewer than six cards. Expected, not a bug.
5. **The text list may be gone entirely.** Also expected — every current article has a thumbnail, so
   there is nothing left for it. It returns as thumbnail-less articles rotate in.
6. Hover prev/next — tooltips appear, **including on the disabled one**. That is why they are project
   `Tooltip`s and not `title` attributes.
7. **Stop the backend and reload.** Hero, ticker strip and the four cards still render; the whole news
   section is simply absent.
8. macOS → System Settings → Accessibility → Display → **Reduce motion**. Reload. Paging still works,
   with no slide animation. This is the check that has been skipped twice in this project and shipped
   a broken fallback both times — **please actually do it.**
9. Judge the pace. `duration-500` is one constant.

## Out of scope

- No auto-advance, no autoplay, no timer.
- No swipe or touch-drag gestures.
- No wrap-around from last page to first.
- No change to `GET /news`, to `limit`, or to `max_per_ticker`.
- No infinite scroll, no "load more" that refetches.
- No LLM, no AI summary.
- No change to the ticker strip, the Universe page, or the four `Coming soon` cards.

## Open questions — do NOT resolve these yourself

- **Whether the section gets a heading** ("Latest news") beside the controls. It has none today.
- **Whether six per page is right**, or two rows of four on very wide screens.
- **Whether `max_per_ticker=2` still holds** now that every article becomes a card — more pages may
  justify loosening it. Gunnar decides after seeing it.
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-15)

- `tsc -p tsconfig.app.json --noEmit` clean; `npm run build` succeeds
- `pytest -q` → **253 passed**, unchanged, as required for a frontend-only contract
- `requestAnimationFrame|setInterval|setTimeout` → exit 1; no auto-advance, CSS only
- hardcoded colours → exit 1; `dangerouslySetInnerHTML` → exit 1 across `frontend/src/`
- `w-full h-full` survived on `CARD_CLASS`; `shrink-0`, `translateX`, both `disabled` present
- `package.json` diff empty — no carousel library
- No contamination: `main.tsx`, `App.tsx`, `index.html`, `Tooltip.tsx`, `package.json` all untouched.
  The only new untracked file is this contract.

### Reduced motion — verified for the first time in this project

Confirmed in the **built** CSS, not merely in source:

```css
@media (prefers-reduced-motion:reduce){.motion-reduce\:transition-none{transition-property:none}}
```

`transition-property: none` leaves no property enrolled, so a page change applies the transform
instantly. The implementer went further and emulated the media feature over the Chrome DevTools
Protocol (`Emulation.setEmulatedMedia`), reading the computed style back — and correctly identified
that **`transition-duration` still reports `0.5s`** under the override, so checking duration instead
of property reads as a failure when the rule is working. That nuance is the reason two earlier
contracts shipped a broken reduced-motion fallback behind a passing keyword grep.

### Criterion 12 was unsatisfiable — planner's error, fourth this session

`git diff --name-only` cannot list `NewsSection.tsx`: the file has been **untracked** since contract
0032, because nothing has been committed since, and `git diff` only compares tracked files against
HEAD. The implementer used file mtimes to demonstrate it was the sole file touched, which is the
right substitute.

**Acceptance criteria must account for a working tree carrying uncommitted prior contracts.** Three
contracts' worth of files are untracked right now, so any criterion phrased in terms of `git diff`
silently changes meaning depending on what has been committed.

### One fix applied by the planner

Off-screen carousel pages stayed mounted (necessary for the slide) and therefore focusable — a
keyboard user tabbed through 14 invisible article links before reaching the text list. Added
`inert={i !== page}` on each page, which removes them from both the tab order and the accessibility
tree. React 19.2 accepts `inert` as a real boolean prop; typecheck and build confirm it.

### Accepted

Plain `‹` / `›` characters instead of inline SVG chevrons. `DownloadIcon.tsx`'s path was hand-copied
from `lucide-react`, which is **not** a dependency of this project — so there was no source to copy
from, and inventing SVG path coordinates would have been worse. The contract permitted either.
