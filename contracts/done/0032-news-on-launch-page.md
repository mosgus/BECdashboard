# Contract 0032 — News on the launch page: thumbnail cards over a text list

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The launch page renders the stored news feed as the reference app does: **cards for articles that
have a thumbnail, a plain text list for the ones that don't**, with a per-ticker cap so the feed
represents the universe instead of whoever published most recently.

## Why

Contract 0031 built the storage and `GET /news`. Two measurements from the real table on
2026-09-15 shape this contract — **do not re-measure, and do not design around guesses**:

**1. Recency-only ordering concentrates the feed.** Storage is evenly spread (8–10 articles per
ticker across 18 tickers), but the top-30 by `pub_date` is not:

```
^GSPC 8 | NVDA 6 | ^IXIC 5 | MU 3 | MSFT 3 | + 5 tickers with 1 each
```

19 of 30 slots from three tickers, and only 10 of 18 contributing tickers visible at all. A feed
meant to represent the universe shows half of it. Hence `max_per_ticker`.

**2. 41 of 159 articles (26%) have no thumbnail.** That is a quarter of the feed, not an edge case —
the text list is a first-class part of the design, not a fallback.

### What ports from the reference and what does not

`reference files/news_section_reference/news_section.py` splits `with_image` / `without_image`
(lines 257–258), renders the first group as cards and the second as text rows with the overflow
behind a `<details>` disclosure (lines 339–366). **That split is what Gunnar asked for and is the
core of this contract.** Four deliberate departures:

- **A responsive grid, not a slideshow.** The reference pages 3 at a time with prev/next buttons
  (`CARDS_PER_SLIDE = 3`) because Streamlit cannot lay out a responsive grid. React can. **No slide
  index, no prev/next, no carousel state.**
- **`publisher`, not `_get_domain(url)`.** `ticker_fundamentals`… no — `news_articles.publisher`
  already stores `provider.displayName`. "Insider Monkey" reads better than "insidermonkey.com".
  Fall back to the URL's hostname only when `publisher` is null.
- **No `DOMAIN_WHITELIST`.** That list exists because Currents returns low-quality domains. Yahoo's
  providers are already curated, and a whitelist would silently drop articles with no way to tell.
- **No `_clean_title`.** It strips a `By <Source>` suffix that Currents appends and Yahoo does not.

**The reference's own security note applies inversely.** Its header warns that `_card_html` does not
escape `url` or `image` before interpolating them into HTML. In React that class of bug is gone —
JSX escapes by default. **Do not reintroduce it:** no `dangerouslySetInnerHTML` anywhere in this
contract, for any reason.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`** — the root
tsconfig has `files: []` and checks zero files.

**Restart the backend before any visual check**, and with `--reload`. A stale `uvicorn` serves the
code it was launched with. `lsof -nP -iTCP:8000 -sTCP:LISTEN` names whatever owns the port.

**If a command fails with `password authentication failed for user "<something not in .env>"`**, the
shell has a stale exported `DATABASE_URL` that `load_dotenv` will not override. `unset DATABASE_URL`.

## Files

Create:
- `frontend/src/lib/relativeTime.ts`
- `frontend/src/components/NewsSection.tsx`

Modify:
- `backend/app/news.py` — one pure function, one changed signature
- `backend/app/routers/news.py` — one query param
- `backend/tests/test_news.py`
- `backend/tests/test_api_news.py`
- `frontend/src/api/client.ts` — `getNews` and types
- `frontend/src/pages/LaunchPage.tsx` — render the section

**Touch nothing else.** Not `app/cache.py`, `app/quotes.py`, `app/strip.py`, `app/universe.py`,
`app/models.py`, `app/schemas.py`, `app/main.py`, `app/db.py`, any migration, `tests/conftest.py`,
`Header.tsx`, `TickerStrip.tsx`, `UniverseTable.tsx`, `UniversePage.tsx`, `ChartDialog.tsx`,
`EntryCard.tsx`, or `App.tsx`.

**No migration** — the schema is unchanged. **No new dependency.**

## Backend — the per-ticker cap

### Pure

```python
def cap_per_ticker(articles: list[dict], max_per_ticker: int, limit: int) -> list[dict]:
    """Keep input order; skip an article once its source_ticker has max_per_ticker already.
    Stop at `limit`. max_per_ticker <= 0 disables the cap."""
```

No database, no clock, no network — articles arrive newest-first and the returned list stays in that
order. This is the whole diversity mechanism, so it is the thing tests must pin.

Articles with a **null `source_ticker`** are never capped against each other — treat null as
uncapped rather than as a shared bucket, otherwise a handful of null rows would crowd each other out
for no reason.

### `recent_articles`

```python
def recent_articles(limit: int, max_per_ticker: int = 0) -> list[dict]
```

When `max_per_ticker > 0`, over-select before capping: order by `pub_date` descending and take
`min(limit * 4, 400)` rows, pass them through `cap_per_ticker`, and return. Still **one** bounded
query — the existing bounded-query test must pass unmodified.

Over-selecting is necessary and the factor is a judgement call: with a cap of 2 and a limit of 20 you
need well over 20 candidate rows to fill the page. `4×` is enough for the observed distribution
without being unbounded. **Say in the report if you chose differently and why.**

### `GET /news`

Add `max_per_ticker: int = 0`, clamped to `[0, 50]`. Default **0** so the endpoint's existing
behaviour is unchanged for any caller that does not ask for it. Everything else about the route —
`BackgroundTasks`, the 503, the `limit` clamp — stays exactly as it is.

## Frontend

### `lib/relativeTime.ts` — pure

```ts
export function relativeTime(iso: string | null, now: Date): string
```

`"3h ago"`, `"2d ago"`, `"just now"` under a minute, and `""` for null or an unparseable input.
**Takes `now` as an argument and never reads the clock** — the same discipline as `lib/ranges.ts` and
`lib/change.ts`. A function that calls `new Date()` internally cannot be tested.

### `components/NewsSection.tsx`

```tsx
export function NewsSection(): JSX.Element | null
```

Self-fetching, like `TickerStrip` — `useState`/`useEffect`, no data library. Requests
**`/news?limit=20&max_per_ticker=2`**. Returns `null` while loading, on any error, and when the feed
is empty. **The launch page must never break because the news endpoint is slow or down.**

Split the returned articles exactly as the reference does:

- `withThumb` — `thumbnail_url` is a non-empty string
- `withoutThumb` — everything else

Then:

| region | contents |
|---|---|
| **Cards** | the first **6** of `withThumb` |
| **List** | everything else — `withThumb.slice(6)` **and** all of `withoutThumb`, in recency order |

**Card overflow goes into the list, it does not disappear.** With 74% of articles carrying a
thumbnail, rendering a card for every one of them gives ~15 cards at `limit=20` — a wall. Six is two
rows of three on a wide screen.

**Cards**
- Responsive grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.
- Image: full width, fixed height, `object-cover`. Reference uses 160px; `h-40` matches.
- Below the image: publisher in muted small text, then the title, **clamped to 3 lines**, then the
  relative time.
- The whole card is one `<a>` with `target="_blank"` and **`rel="noopener noreferrer"`**.
- **`onError` on the `<img>` must hide the image** and let the card render text-only. A stored
  `thumbnail_url` that 404s must not leave a broken-image icon. Do not move the article to the list
  on error — that would reflow the page after load.
- Add `referrerPolicy="no-referrer"` and `loading="lazy"`.

**List**
- One row per article: title as a link, then `·`, then the publisher, then the relative time.
- First **5** visible; the remainder inside a `<details>` element whose `<summary>` reads
  `… N more`, exactly as the reference does. Native `<details>` — no state, no library.
- Same `target="_blank"` / `rel="noopener noreferrer"`.

**Neither region renders at all when its list is empty.** No empty heading, no "0 articles".

### `LaunchPage.tsx`

Order becomes: hero → **NewsSection** → the four `Coming soon` cards.

This is what Gunnar asked for when the strip landed: *"let's just have the cards get pushed down
below each new news piece."* **Do not alter the hero, the card copy, or the card grid**, and do not
decide the cards' fate — that is still an open question.

## Tooltips

| element | copy |
|---|---|
| Each card | `<full title> — <publisher>` |
| Each list row | `<full title> — <publisher>` |
| The `… N more` summary | `Show N more headlines` |

Use the project `Tooltip`, never `title`. These are genuinely load-bearing rather than decorative:
card titles are clamped to 3 lines and list rows are one line, so the tooltip is how a truncated
headline gets read.

**Unlike the ticker strip, these elements do not move**, so `Tooltip`'s anchor-captured-once
behaviour is correct here. The strip dropped its tooltips because a scrolling cell drifts away from
the bubble; a static card does not.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from **242**.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
3. `cd frontend && npm run build` succeeds.
4. Tests for `cap_per_ticker`: a list where one ticker holds 8 of the first 10 returns at most
   `max_per_ticker` of it; input order is preserved; `max_per_ticker=0` returns the first `limit`
   unchanged; articles with `source_ticker=None` are **not** capped against one another.
5. A test asserts `GET /news?max_per_ticker=2` returns at most 2 articles per `source_ticker`, and
   that omitting the param leaves the response unchanged from contract 0031's behaviour.
6. `?max_per_ticker=999` clamps to 50; `?max_per_ticker=-1` clamps to 0.
7. The existing bounded-query test passes **unmodified** — `git diff` on it shows no change.
8. `grep -rn "dangerouslySetInnerHTML" frontend/src/` matches nothing (exit 1).
9. `grep -n "rel=" frontend/src/components/NewsSection.tsx` — **every** external `<a>` has
   `noopener noreferrer`. Quote each matching line in the report.
10. `grep -n "onError" frontend/src/components/NewsSection.tsx` matches — broken thumbnails degrade
    to a text-only card.
11. `grep -n "new Date()" frontend/src/lib/relativeTime.ts` matches nothing (exit 1) — `now` is an
    argument.
12. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/NewsSection.tsx`
    matches nothing (exit 1).
13. `ls backend/migrations/versions/` shows exactly **five** revisions.
14. `git diff --stat backend/app/models.py backend/app/schemas.py backend/app/main.py backend/app/cache.py backend/app/strip.py frontend/src/App.tsx frontend/src/components/Header.tsx frontend/src/components/TickerStrip.tsx frontend/package.json`
    is empty.
15. `grep -n "NewsSection" frontend/src/pages/LaunchPage.tsx` matches, and the four `EntryCard`s
    still render after it.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
ls -1 backend/migrations/versions/
grep -rn "dangerouslySetInnerHTML" frontend/src/ ; echo "(exit $? — 1 = correct)"
grep -n "rel=" frontend/src/components/NewsSection.tsx
grep -n "onError\|referrerPolicy\|loading=" frontend/src/components/NewsSection.tsx
grep -n "new Date()" frontend/src/lib/relativeTime.ts ; echo "(exit $? — 1 = correct)"
grep -n "NewsSection" frontend/src/pages/LaunchPage.tsx
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git diff --stat backend/app/models.py backend/app/schemas.py backend/app/main.py frontend/src/App.tsx frontend/src/components/TickerStrip.tsx frontend/package.json ; echo "(empty = untouched)"
git status --porcelain
```

Plus, against the running backend, showing the cap actually works:

```bash
curl -s "http://127.0.0.1:8000/news?limit=20&max_per_ticker=2" | python3 -c "
import json,sys; from collections import Counter
a=json.load(sys.stdin)['articles']
c=Counter(x['source_ticker'] for x in a)
print('returned', len(a), '| distinct tickers', len(c), '| max per ticker', max(c.values()))
print('with thumbnail:', sum(1 for x in a if x['thumbnail_url']), '/', len(a))"
```

Expect `max per ticker` to be **2**, and `distinct tickers` to be materially higher than the 10 that
recency-only ordering produced. Paste the numbers.

## Human verification — does Gunnar need to run anything?

**Yes — it is the main content of the first page anyone sees.**

At `localhost:5173/`:

1. A grid of up to **6 image cards**, 3 across on a wide window, 2 on a medium one, 1 on a narrow
   one. Below it a text list, first 5 visible.
2. Click `… N more` — the rest expand. No layout jump above it.
3. **Hover a card title** — the tooltip shows the full headline. This matters because titles are
   clamped to 3 lines.
4. Click a card and a list row — both open in a **new tab**, original page still there.
5. The four `Coming soon` cards sit **below** the news, unchanged.
6. **Stop the backend and reload.** Hero, ticker strip and cards all still render; the news section
   is simply absent. No error banner, no blank page.
7. Look at the ticker labels across the feed — the same story may appear under a ticker it is not
   really about. That is contract 0030's relevance finding, not a bug, and is why `source_ticker`
   is **not** displayed anywhere in this design.
8. Judge the counts: **6 cards and 5 visible rows**. Both are one-line constants if they read wrong.

## Out of scope

- No LLM, no AI summary, no Gemini key.
- No carousel, slideshow, prev/next, or pagination.
- No per-ticker news page, no filtering by ticker, no search.
- No display of `source_ticker` anywhere in the UI — see point 7.
- No changes to the ticker strip, the Universe page, or the four cards' copy.
- No migration, no new dependency, no schema change.
- No infinite scroll, no "load more" that refetches.

## Open questions — do NOT resolve these yourself

- **What happens to the four `Coming soon` cards.** Gunnar decides once he sees them under real
  content.
- **Whether an AI briefing gets built**, and with which provider.
- **Whether `max_per_ticker=2` is the right number.** Shipped as the frontend's request; easy to
  change after Gunnar sees a real feed.
- **Whether the news section belongs on the Universe page too.** Not now.

---

## Audit (planner, 2026-09-15)

The agent stalled mid-run during browser verification — same point as contract 0028 — so the planner
re-ran everything against the working tree.

**No contamination.** `main.tsx`, `App.tsx`, `index.html`, `Header.tsx`, `TickerStrip.tsx` and
`package.json` all show an empty diff. The harness rule from 0028 did its job: verification artefacts
were three `_scratch_news_*.png` files, and the agent deleted them even though it never finished. A
stalled run left the tree clean, which is exactly what that rule was written for.

- `pytest -q` → **253 passed** (from 242)
- `tsc -p tsconfig.app.json --noEmit` clean; `npm run build` succeeds
- `dangerouslySetInnerHTML` → exit 1 across all of `frontend/src/`
- `new Date()` in `lib/relativeTime.ts` → exit 1; `now` is an argument
- hardcoded colours in `NewsSection.tsx` → exit 1
- `rel="noopener noreferrer"` present on the single shared `ExternalLink`, used by both cards and rows
- `onError`, `referrerPolicy="no-referrer"`, `loading="lazy"` all present on the thumbnail
- five migrations; `models.py` / `schemas.py` / `main.py` diffs belong to uncommitted 0031, not to
  this contract

Live, against the running backend:

```
?limit=20&max_per_ticker=2  -> 20 articles | 12 distinct tickers | max 2 per ticker
?limit=20                   -> 20 articles |  9 distinct tickers | max 6 per ticker
```

The cap works and the default is unchanged, as required.

### The implementer improved on the contract, and was right to

The contract specified the list as `withThumb.slice(6)` concatenated with `withoutThumb`. That
concatenation puts every card-overflow article ahead of every thumbnail-less one, **breaking recency
order**. The implementation instead filters the original list by "not chosen as a card", preserving
the global ordering, and says so in a comment at `NewsSection.tsx:122`. The planner's spec was wrong;
this is the correct behaviour.

### One fix applied by the planner

The reference hides WebKit's disclosure triangle explicitly
(`news_section.py:352`, `summary::-webkit-details-marker{display:none}`). The port kept `list-none`
and dropped the pseudo-element. Chrome honours `list-style: none` on `<summary>`; WebKit
historically does not, so Safari would show a stray triangle beside "… N more". Added as
`[&::-webkit-details-marker]:hidden` and **verified in the built CSS**, not merely in source.

### Not exercised by today's data

All 20 articles in the current feed have thumbnails, so `withoutThumb` is empty and the list is pure
card-overflow. The thumbnail-less branch is implemented and reachable — 41 of 159 stored rows have no
thumbnail — but no visual check today can confirm it renders correctly.
