# Contract 0035 — Render the briefing, generate one when none exists, silence the AFC warning

**Status:** accepted (2026-09-16) — audited by planner. One planner-authored instruction reverted
Gunnar's own layout change; see below. Render check (item 5) outstanding.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The AI briefing appears above the news cards on the launch page. It generates on first request when
no briefing exists at all, instead of waiting up to six hours for the next news refresh. And the
Gemini SDK stops logging a warning on every call.

## Why

Contract 0034 built storage, generation and the `/news` field, and Gunnar confirmed live output on
2026-09-16. Three things remain, all small, all found by running it for real:

**1. Nothing renders it.** `frontend/src/api/client.ts` does not even have `summary` on
`NewsResponse` — 0034 was backend-only.

**2. A newly-set key produces no briefing for up to six hours.** Generation piggybacks
`refresh_news_if_stale`, which returns early when articles are fresh, so `refresh_briefing` is never
reached. Gunnar hit this locally and had to call the function directly. Render is in exactly that
state right now: key set, no briefing.

**3. `google-genai` logs on every generation:**
```
Direct use of automatic function calling (AFC) in Models.generate_content is not recommended.
```
Harmless, but it is noise in Render's log on every call, and noise is where real errors go to hide.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`.**

**Tests must pass with no network, no database, and no `GEMINI_KEY`.** Never call Gemini in a test —
mock the client. Any test touching time must pin it explicitly.

**Restart the backend with `--reload` before any visual check.**

**If a command fails with `password authentication failed for user "<something not in .env>"`**, the
shell has a stale exported `DATABASE_URL` that `load_dotenv` will not override. `unset DATABASE_URL`.

Verification harnesses are **new files you delete afterwards**. Never edit `frontend/src/main.tsx`,
`App.tsx`, or `index.html` to drive a browser.

## Files

Modify:
- `backend/app/briefing.py`
- `backend/app/news.py`
- `backend/tests/test_briefing.py`
- `frontend/src/api/client.ts`
- `frontend/src/components/NewsSection.tsx`

**Touch nothing else.** Not `app/cache.py`, `app/quotes.py`, `app/strip.py`, `app/universe.py`,
`app/models.py`, `app/schemas.py`, `app/config.py`, `app/main.py`, `app/db.py`,
`app/routers/news.py`, any migration, `tests/conftest.py`, `requirements.txt`, `LaunchPage.tsx`,
`Tooltip.tsx`, `relativeTime.ts`, `TickerStrip.tsx`, `App.tsx`, `main.tsx`, or `index.html`.

**No migration. No new dependency.** The schema and the response model are already correct.

## Backend

### 1. Generate when none exists

`needs_summary` gains a third argument:

```python
def needs_summary(
    latest_created_at: datetime | None,
    now_utc: datetime,
    articles_refreshed: bool,
) -> bool:
```

Rules, in order:

1. `latest_created_at is None` → **True**, regardless of `articles_refreshed`. Same shape as the
   news feed's "an empty table refreshes at any hour".
2. otherwise → `articles_refreshed and now_utc - latest_created_at >= timedelta(minutes=SUMMARY_MIN_AGE_MINUTES)`.

Rule 2 is what stops this becoming an independent 30-minute schedule. Without the
`articles_refreshed` conjunct, every page load more than 30 minutes after the last briefing would
spend a Gemini call rewriting unchanged headlines.

`refresh_briefing` takes and forwards the same flag.

### 2. Restructure `refresh_news_if_stale`

Today the briefing call sits after an early `return`, so it is unreachable when articles are fresh.
Restructure so it always runs and is told whether articles moved:

```python
if not is_enabled() or not tickers:
    return

articles_refreshed = False
if needs_refresh(get_newest_fetched_at(), now_utc, now_et):
    ...existing fetch / upsert / prune, unchanged...
    articles_refreshed = True

from app.briefing import refresh_briefing   # deferred — circular, see the existing comment
try:
    refresh_briefing(now_utc, now_et, articles_refreshed)
except Exception:
    logger.exception(...)
```

**Do not change the fetch loop, the upsert, or the article prune.** They are correct and audited. The
existing broad `except` around `refresh_briefing` stays, and so does the deferred import — a
module-level import here deadlocks, and the comment explaining that must survive.

**The early `return` for "no database / no tickers" stays at the top.** Only the *staleness* early
return is being dissolved.

### 3. Silence the AFC warning

Pass an explicit config on the one `generate_content` call. Verified against the installed SDK
(`google-genai==2.23.0`) — these field names exist:

```python
from google.genai import types

config=types.GenerateContentConfig(
    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
)
```

**Suppress it by configuring the SDK, not by filtering the logger.** A `logging.Filter` on
`google_genai` would also swallow real errors from the same logger.

## Frontend

### `client.ts`

```ts
export interface NewsSummary {
  text: string
  created_at: string
  model: string | null
  article_count: number | null
}

export interface NewsResponse {
  articles: NewsArticle[]
  as_of: string | null
  summary: NewsSummary | null
}
```

`getNews` is otherwise unchanged.

### `NewsSection.tsx`

Render the briefing **above everything else in the section** — above the page controls, above the
grid. Order becomes: briefing → controls → card carousel → text list.

- Renders **only** when `summary` is non-null and `summary.text` is non-empty. No placeholder, no
  skeleton, no "generating…" state — a missing briefing is invisible.
- A panel matching the cards: `bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-5`.
- A header row: a small uppercase muted label on the left reading **`Market briefing · AI-generated`**,
  and `relativeTime(summary.created_at, now)` right-aligned in the same muted style.
- The text below it, `text-sm leading-relaxed`, constrained to **`max-w-[75ch]`**. This is six
  sentences of prose; run across a 1700px window it is genuinely hard to read, and a measure cap is
  the whole difference between a briefing and a wall.
- Reuse the existing `relativeTime` and the `now` already computed in `NewsSection`. **Do not add a
  second `new Date()`.**
- Plain text in a `<p>`. **No `dangerouslySetInnerHTML`** — this string comes from an LLM, which is
  the last input that should ever reach that API.

**"AI-generated" in the label is required, not decorative.** This is model-written commentary about
markets appearing on a finance dashboard; it must be labelled as such on the page, not only in a
tooltip.

The briefing is not interactive, so it takes **no** `Tooltip`.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network, no
   database and no `GEMINI_KEY`. Count increases from **277**.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
3. `cd frontend && npm run build` succeeds.
4. Tests for `needs_summary` covering all four combinations: `(None, refreshed=False) → True`;
   `(None, refreshed=True) → True`; `(2 hours old, refreshed=False) → False`;
   `(2 hours old, refreshed=True) → True`. **Quote all four assertions in the report.** The first
   and third are the two this contract exists to change.
5. A test asserting `refresh_briefing` is reached when `needs_refresh` is False — i.e. that
   dissolving the early return actually worked. Assert on the call, not on the source.
6. `grep -n "AutomaticFunctionCallingConfig" backend/app/briefing.py` matches.
7. `grep -rn "logging.Filter\|addFilter" backend/app/briefing.py` matches nothing (exit 1) — the
   warning is configured away, not filtered away.
8. `grep -n "from app.briefing import refresh_briefing" backend/app/news.py` matches **inside**
   `refresh_news_if_stale`, not at module level. State the line number and the enclosing function.
9. `grep -rn "dangerouslySetInnerHTML" frontend/src/` matches nothing (exit 1).
10. `grep -n "max-w-\[75ch\]\|AI-generated" frontend/src/components/NewsSection.tsx` matches both.
11. `grep -c "new Date()" frontend/src/components/NewsSection.tsx` is **1** — the existing one.
12. `ls backend/migrations/versions/` shows exactly **six** revisions.
13. `git status --porcelain` lists no file outside this contract's Files list, and nothing new under
    `backend/app/`, `backend/migrations/`, or `frontend/src/`.
    **Do not use `git diff --name-only` for this** — `briefing.py`, `test_briefing.py` and migration
    `0006` are untracked as of this contract, so `git diff` cannot see them however they change.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""` except where explicitly noted.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "AutomaticFunctionCallingConfig" backend/app/briefing.py
grep -rn "logging.Filter\|addFilter" backend/app/briefing.py ; echo "(exit $? — 1 = correct)"
grep -n "from app.briefing import refresh_briefing" backend/app/news.py
ls -1 backend/migrations/versions/
grep -n "max-w-\[75ch\]\|AI-generated" frontend/src/components/NewsSection.tsx
grep -c "new Date()" frontend/src/components/NewsSection.tsx
grep -rn "dangerouslySetInnerHTML" frontend/src/ ; echo "(exit $? — 1 = correct)"
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git status --porcelain
```

Then, **against the real database and with the real key** — note these are deliberately *not*
`DATABASE_URL=""`, unlike every other ad-hoc command in this project:

```bash
# Prove the AFC warning is gone. Expect briefing text on stdout and NO "automatic function
# calling" line on stderr.
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from app.briefing import generate_briefing, build_prompt
print(generate_briefing(build_prompt(['- Test headline (Reuters)'], None, None,
      datetime.now(ZoneInfo('America/New_York')))))
"
```

If you have no `GEMINI_KEY`, say so and skip that one — do not fabricate its output.

## Human verification — does Gunnar need to run anything?

**Yes.**

At `localhost:5173/`:

1. The briefing panel sits **above** the page controls and the card grid, with the
   `Market briefing · AI-generated` label and a relative timestamp.
2. The paragraph does **not** run the full width of a maximised window — it caps around 75
   characters.
3. The four `Coming soon` cards are still below everything, unchanged.
4. **Stop the backend and reload.** Hero, ticker strip and cards render; the whole news section,
   briefing included, is simply absent.
5. On Render after deploying: the **first** `/news` request should produce a briefing within a minute
   or so without waiting for a news refresh — that is item 2 of this contract. Cold start is ~43s, so
   load it, wait, reload.

## Out of scope

- **No prompt changes.** The "briefing discusses companies outside the universe" finding
  (`REBUILD.md`, contract 0034) needs more than one sample before anyone edits the prompt.
- No change to `GET /news`, its params, or `NewsResponse`'s server-side shape.
- No collapse/expand on the briefing, no "read more", no copy button.
- No change to the card carousel, the text list, the ticker strip, or the Universe page.
- No change to the four `Coming soon` cards.
- No migration, no new dependency.

## Open questions — do NOT resolve these yourself

- **Whether the prompt should be anchored to the universe's sectors.** Needs several days of output.
- **Whether the briefing gets its own heading** or stays label-only.
- **What happens to the four `Coming soon` cards.** Still Gunnar's, still open.
- **Whether a failed generation should surface anything to the user.** Today it is silent and the
  previous briefing stays; that is deliberate.

---

## Audit (planner, 2026-09-16)

- `pytest -q` → **281 passed** (from 277), with no network, database or `GEMINI_KEY`
- `AutomaticFunctionCallingConfig(disable=True)` at `briefing.py:125`; `logging.Filter`/`addFilter`
  → exit 1. Configured away, not filtered away.
- `refresh_news_if_stale` restructured correctly: the staleness early-return is dissolved,
  `articles_refreshed` is set only inside the fetch branch, and `refresh_briefing(now_utc, now_et,
  articles_refreshed)` runs unconditionally below it. The deferred import and the broad `except`
  both survived with their comments.
- `max-w-[75ch]` and `Market briefing · AI-generated` present; exactly one `new Date()`;
  `dangerouslySetInnerHTML` → exit 1
- `git status --porcelain` lists exactly this contract's five files

Live, with the real key: the AFC warning is gone from stderr and generation still succeeds.

### The planner reverted Gunnar's own layout change

The contract stated "Order becomes: briefing → controls → card carousel → text list". The
implementer followed it and moved the prev/next block from below the grid to above it, flagging the
move under Deviations — correct behaviour on its part.

But the arrangement it replaced was **not** drift from contract 0033. `git diff` shows the removed
block as `justify-between ... mt-3`, sitting after the carousel: buttons flanking the grid left and
right, with a `text-sm font-semibold text-brand-primary` indicator between them. 0033 shipped
`justify-end ... mb-3` above the grid with a small muted indicator. The difference is Gunnar's, made
by hand before commit `9515e96`.

**The planner wrote that ordering line from contract 0033's report rather than from the file on
disk.** Gunnar edits this codebase between contracts; a contract that restates existing layout must
be written from the current source, or it silently instructs a revert of his work. The implementer
cannot catch this — from inside the run, a hand-edit and a drift look identical.

### Outstanding

- **Human verification item 5** — on Render, the first `/news` request after deploy should produce a
  briefing within about a minute rather than waiting out `NEWS_TTL_HOURS`. Not verifiable locally,
  where a briefing already exists.
- The cold-start path was not re-proved against the live database; the implementer declined to delete
  the real `news_summaries` row to do it, which was the right call. Covered by unit tests.
