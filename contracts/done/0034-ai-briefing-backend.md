# Contract 0034 — AI news briefing: storage, generation, and `/news` field

**Status:** accepted (2026-09-16) — audited by planner, live Gemini generation confirmed by Gunnar.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

A short LLM-written market briefing, generated from the stored headlines whenever the news feed
actually refreshes, persisted with a retention window that **always leaves a fallback**, and returned
as a field on `GET /news`.

Backend only. Contract 0035 renders it above the article cards.

## Why

Gunnar asked for the reference app's AI summary, sitting above the cards. The structure ports from
`reference files/news_section_reference/news_summarizer.py`; the domain does not.

**Do not copy the reference prompt.** It says *"financial news analyst for a real estate private
equity firm"* and focuses on *"interest rates/SOFR, credit conditions, and sectors relevant to
commercial investment."* That is TCM.io's business. Blue Eagle's universe is equities, sector ETFs
and three indices. Copying it verbatim produces commercial-real-estate commentary about NVDA and
XLV. The **three-way continuity branch** is what ports — see below.

**Provider: Google Gemini**, chosen by Gunnar on 2026-09-15 because he already holds a `GEMINI_KEY`
from the other app and needs no new account.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network, no database, and no `GEMINI_KEY`.** Never call Gemini for real in
a test — mock the client. A test suite that needs an API key is a test suite that fails on a clean
checkout.

**If a command fails with `password authentication failed for user "<something not in .env>"`**, the
shell has a stale exported `DATABASE_URL` that `load_dotenv` will not override. `unset DATABASE_URL`.

## Files

Create:
- `backend/migrations/versions/0006_news_summaries.py`
- `backend/app/briefing.py`
- `backend/tests/test_briefing.py`

Modify:
- `backend/app/models.py` — the `NewsSummary` model
- `backend/app/schemas.py` — `NewsSummaryOut`, and one new field on `NewsResponse`
- `backend/app/config.py` — `gemini_key`, `gemini_model`
- `backend/app/news.py` — call the briefing refresh after a successful article refresh
- `backend/app/routers/news.py` — attach the summary to the response
- `backend/tests/test_api_news.py`
- `backend/requirements.txt` — one dependency

**Touch nothing else.** Not `app/cache.py`, `app/quotes.py`, `app/strip.py`, `app/universe.py`,
`app/market_data.py`, `app/db.py`, `app/main.py`, `tests/conftest.py`, migrations 0001–0005, or
**anything under `frontend/`**.

## The dependency

```
google-genai==2.23.0
```

Verified on PyPI 2026-09-15: package name `google-genai`, import path `from google import genai`,
`requires_python >=3.10`. The venv is 3.13. **Pin with `==`** — contract 0001 exists because `>=`
pins are how a working app becomes unrunnable by sitting still.

## Configuration — the feature must be optional

`Settings` gains:

```python
self.gemini_key: str | None = os.getenv("GEMINI_KEY") or None
self.gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")
```

**With no `GEMINI_KEY` the briefing is simply absent** — `GET /news` returns `summary: null`, no
error, no 500, no log spam beyond one line. Same discipline as `db.is_enabled()`. Render will run
without the key until Gunnar sets it, and the launch page must be fine in that state.

`gemini_model` is env-overridable on purpose: `gemini-3.1-flash-lite` is what the reference used and
what Gunnar's key is known to work with, but model names get retired and that must not need a code
change. **The planner could not verify this model id without a key** — if the live call rejects it,
report the error verbatim rather than substituting a model you guessed at.

## Schema — `news_summaries`

Migration revision **0006**, down-revision **0005**. `ls backend/migrations/versions/` must show
exactly six afterwards.

| column | type | notes |
|---|---|---|
| `id` | `Integer` PK, autoincrement | |
| `summary` | `Text` NOT NULL | |
| `model` | `String` | which model produced it |
| `article_count` | `Integer` | how many headlines went in |
| `created_at` | `DateTime(timezone=True)` NOT NULL, indexed | |

No foreign key to `news_articles` — consistent with the rest of this codebase, where cached data
never cascades.

## `app/briefing.py`

### Pure — no database, no clock, no network

```python
BRIEFING_SENTENCES = 6
SUMMARY_MIN_AGE_MINUTES = 30

def needs_summary(latest_created_at: datetime | None, now_utc: datetime) -> bool:
    """False when a summary was written less than SUMMARY_MIN_AGE_MINUTES ago."""

def build_prompt(
    headlines: list[str],
    previous_summary: str | None,
    previous_created_at: datetime | None,
    now_et: datetime,
) -> str:
```

`build_prompt` reproduces the reference's **three-way branch**, which is the one genuinely valuable
idea in `news_summarizer.py`:

1. **No previous summary** — cold start. Write the briefing from the headlines alone.
2. **Previous summary from the same ET day** — rewrite it in place to reflect what has shifted or
   newly emerged, dropping what is no longer relevant. The briefing grows through the day.
3. **Previous summary from an earlier day** — open with how sentiment or themes have moved since
   the prior briefing, then cover today.

**Compare dates in Eastern time, not UTC.** The reference used `_dt.utcnow().date()`, which flips
"today" at 8pm ET — wrong for a US market briefing, and a real bug inherited if copied. Hence
`now_et` as a parameter. **No function in this module may read the clock**; that is why both the
timestamp and `now_et` are arguments.

### The prompt content — write this for Blue Eagle

Persona: a market analyst briefing a portfolio manager. The universe is **equities, sector ETFs and
three indices** (`^GSPC`, `^IXIC`, `^RUT`).

Required in the shared focus text:

- market-wide moves, sector rotation, rates and macro data relevant to a diversified equity/ETF book
- individual companies only where the story has broader read-through
- `{BRIEFING_SENTENCES} sentences maximum`
- **"Plain sentences only — no bullet points, no headers, no markdown."** Keep this verbatim from the
  reference; 0035 renders the text as-is and markdown would show up as literal asterisks.

Feed at most **20** headlines, formatted `- {title} ({publisher})`. The reference used the URL's
domain; we store `publisher`, which is better.

### Impure

```python
def generate_briefing(prompt: str) -> str | None     # one Gemini call; None on any failure
def refresh_briefing(now_utc: datetime, now_et: datetime) -> None
def latest_briefing() -> dict | None
```

`refresh_briefing`:

1. Return immediately when `settings.gemini_key` is None.
2. Read the latest summary. Return when `needs_summary` is False.
3. Read the most recent stored articles (reuse `news.recent_articles`; do **not** write a second
   query). Return when there are none.
4. Build the prompt, call Gemini, and **return without writing anything if the call fails or returns
   an empty string.**
5. Insert the new row.
6. **Only then** prune: delete summaries older than `SUMMARY_RETENTION_HOURS = 24`, excluding the row
   just inserted.

**Step 6 must not run unless step 5 succeeded**, and it must exclude the new row. The README states
the rule as SQL:

```sql
DELETE FROM news_summary WHERE expires_at <= now() AND id != :just_inserted_id
```

This is the whole reason the reference keeps a retention window separate from a freshness window:
**a superseded summary is never deleted merely for being superseded** — only for being superseded
*and* 24 hours old. If generation fails, the previous briefing stays on the page, stale, instead of
the page going blank. A test must assert that a failing generation leaves the existing row untouched
and issues no delete.

Catching a broad exception around the Gemini call is correct and expected here — name it and its
line number in the report. Bare `except:` is still banned.

### Wiring into `app/news.py`

Call `refresh_briefing` at the **end** of `refresh_news_if_stale`, after the upsert and prune, and
only when the refresh actually ran. Wrap it so a briefing failure cannot affect stored articles.

Tying generation to the article refresh is deliberate: the summary is a function of the headlines, so
it regenerates when they change — roughly 09:00 / 15:00 / 21:00 ET. A separate 2-hour freshness TTL
like the reference's would rewrite the same headlines three times between refreshes. `needs_summary`'s
30-minute floor exists only to absorb the known concurrent-refresh race recorded in `REBUILD.md`.

## `GET /news`

```python
class NewsSummaryOut(BaseModel):
    text: str
    created_at: datetime
    model: str | None
    article_count: int | None

class NewsResponse(BaseModel):
    articles: list[NewsArticleOut]
    as_of: datetime | None
    summary: NewsSummaryOut | None      # new
```

Additive only. `limit`, `max_per_ticker`, the `BackgroundTasks` scheduling and the 503 all stay
exactly as they are. One extra bounded query for the latest summary; **never per-article**.

The endpoint still must not block on generation — it reads the stored summary and returns.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes **with `GEMINI_KEY` unset
   and no network**. Count increases from **253**.
2. `ls backend/migrations/versions/` shows exactly **six**; `0006` has `down_revision = "0005"`.
3. `grep -n "google-genai==" backend/requirements.txt` matches — pinned with `==`, not `>=`.
4. Tests for `build_prompt` covering all three branches, asserting a distinguishing substring of
   each. **Quote the three assertions in the report.**
5. A test asserting `build_prompt` uses **ET** for the same-day decision: a previous summary
   timestamped 2026-09-15T23:30Z (19:30 ET, same ET day) takes the *same-day* branch, while
   2026-09-16T01:00Z (21:00 ET on the 15th — still the same ET day) also does. A UTC comparison gets
   the second one wrong.
6. A test asserting a **failed generation writes nothing and deletes nothing** — existing summary row
   still present and unchanged.
7. A test asserting the prune excludes the just-inserted row.
8. A test asserting `GET /news` returns `summary: null`, status 200, when `GEMINI_KEY` is unset.
9. `grep -rnE "except\s*:" backend/app/briefing.py` matches nothing (exit 1). The broad
   `except Exception` around the Gemini call is expected — give its line number in the report.
10. `grep -rn "utcnow\|datetime.now(" backend/app/briefing.py` — **every** match must be inside
    `refresh_briefing` or `latest_briefing`, never inside `needs_summary` or `build_prompt`. Quote
    each match in the report.
11. `grep -rn "delete(" backend/app/briefing.py` — quote every match. There must be exactly one, and
    it must be the retention prune.
12. `git diff --stat backend/app/cache.py backend/app/quotes.py backend/app/strip.py backend/app/universe.py backend/app/db.py backend/app/main.py backend/tests/conftest.py` is empty.
13. `git status --porcelain` shows nothing new or modified under `frontend/`.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
ls -1 backend/migrations/versions/
grep -n "down_revision" backend/migrations/versions/0006_news_summaries.py
grep -n "google-genai" backend/requirements.txt
grep -rnE "except\s*:" backend/app/briefing.py ; echo "(exit $? — 1 = correct)"
grep -rn "utcnow\|datetime.now(" backend/app/briefing.py
grep -rn "delete(" backend/app/briefing.py
git diff --stat backend/app/cache.py backend/app/quotes.py backend/app/strip.py backend/app/universe.py backend/app/main.py ; echo "(empty = untouched)"
git status --porcelain
```

Then, proving the no-key path works — this is the state Render will be in until Gunnar sets the
variable:

```bash
cd backend && DATABASE_URL="" GEMINI_KEY="" PATH="$PWD/.venv/bin:$PATH" python -c "
from app.config import Settings
print('gemini_key:', Settings().gemini_key)
print('gemini_model:', Settings().gemini_model)"
```

Expect `None` and the default model string.

## Human verification — does Gunnar need to run anything?

**Yes — the migration touches the real database and the generation touches the real Gemini.**

1. Put `GEMINI_KEY=<your key from the other app>` in `backend/.env`.
2. Apply the migration:
   ```bash
   cd backend && PATH="$PWD/.venv/bin:$PATH" alembic upgrade head
   ```
3. Restart uvicorn **with `--reload`**. Then force a generation — the news TTL will block a natural
   refresh if articles are under 6 hours old, so trigger it directly:
   ```bash
   cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
   from datetime import datetime, timezone
   from zoneinfo import ZoneInfo
   from app.briefing import refresh_briefing
   refresh_briefing(datetime.now(timezone.utc), datetime.now(ZoneInfo('America/New_York')))
   from app.briefing import latest_briefing
   b = latest_briefing()
   print(b['model'], b['article_count'], 'chars:', len(b['text']))
   print(b['text'])"
   ```
4. **Read the briefing.** It should be about equities, sectors, rates and the indices — **not**
   commercial real estate. If it reads like a real-estate memo, the reference prompt was copied
   rather than rewritten and the contract failed.
5. Check it is plain prose: no `*`, no `#`, no bullets. 0035 renders it as text.
6. `curl -s "localhost:8000/news?limit=20&max_per_ticker=2" | python3 -m json.tool | head -20` —
   `summary` is populated and `articles` still works.
7. Confirm the model id: if step 3 raised, paste the error. `gemini-3.1-flash-lite` came from the
   reference app and the planner had no key to verify it against.
8. Deploy: set `GEMINI_KEY` in the Render dashboard, and **check the Render start command runs
   `alembic upgrade head`** — `REBUILD.md` records that nothing in version control proves it does. A
   missing migration surfaces as a 500 from `/news`, not as a failed deploy.

## Out of scope

- **No frontend.** Contract 0035 renders it.
- No streaming, no token-by-token display.
- No per-ticker or per-sector summaries — one briefing over the whole feed.
- No user-editable prompt, no settings UI, no model picker.
- No scheduler — generation piggybacks on the existing lazy article refresh.
- No retry or backoff on a failed generation; the next refresh tries again.
- No change to the ticker strip, the Universe page, or the four cards.

## Open questions — do NOT resolve these yourself

- **Whether 6 sentences is right.** One constant; Gunnar judges after reading one.
- **Whether the briefing should be regenerated on demand** from a button in the UI.
- **Whether a failed generation should surface anywhere in the UI**, or stay silent as it does now.
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-16)

Re-run against the working tree: **277 passed** (from 253) with `GEMINI_KEY` unset. Six migrations,
`0006` → `down_revision "0005"`. `google-genai==2.23.0` pinned. Scope empty across `cache.py`,
`quotes.py`, `strip.py`, `universe.py`, `db.py`, `main.py`, `conftest.py`; nothing under `frontend/`.

- `grep -nE "utcnow|datetime\.now\(|date\.today" app/briefing.py` → **exit 1**. The module never
  reads the clock; `now_utc`/`now_et` are injected all the way down from the router.
- One delete, `created_at <= cutoff AND id != keep_id`, and it runs strictly after a successful
  insert — `if not text: return` sits above it, so a failed generation writes nothing and prunes
  nothing. The previous briefing survives as the fallback, which is the whole point of the reference's
  two-TTL split.
- Ordering in `refresh_news_if_stale`: upsert articles → prune articles → **then** briefing, inside
  its own `try`. A Gemini failure cannot touch the article refresh that already committed.
- Live `GET /news` with no key → `summary: null` alongside working articles.

### The circular import the contract did not anticipate

`briefing.py` imports `news.recent_articles` (the contract's own instruction: reuse the bounded query
rather than write a second one), and `news.py` must call `briefing.refresh_briefing`. Two-way, so a
module-level import deadlocks. Resolved with a deferred import at the call site, commented. The
planner should have foreseen this when writing the file list.

### Live confirmation (Gunnar, 2026-09-16)

`gemini-3.1-flash-lite` is a valid model id. Six sentences, `article_count: 20`, stored and served
through `/news`. The rewritten persona holds — the output is about equities, sector rotation and ETF
allocation, not the reference's commercial-real-estate framing.

### Two findings from the first real output

1. **The briefing discusses companies outside the universe.** It reported "cyclical trucking stocks
   face significant headwinds from rising diesel costs"; there is no trucking exposure in the
   universe. This is contract 0030's relevance finding propagating upward — loosely-related Yahoo
   headlines enter the prompt and get faithfully summarized. Prompt-side fix, worth more than one
   sample before acting.
2. **The `google-genai` SDK logs an AFC warning on every `generate_content` call.** Noise in Render's
   log on every generation; silence it by disabling AFC in the request config rather than by
   filtering the logger.

### Known consequence: no briefing until the next news refresh

Generation piggybacks `refresh_news_if_stale`, which returns early when articles are fresh — so after
a deploy with the key newly set, there is no briefing for up to six hours. Gunnar hit this locally.
Addressed in contract 0035.
