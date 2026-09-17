# Contract 0039 — Briefing: broad-market scope, impartial voice, publisher preference

**Status:** accepted (2026-09-17) — audited by planner, live output verified clean.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The AI briefing describes the broader market instead of the universe's individual holdings, and
stops writing in first person or giving advice.

Backend only. No migration, no new dependency, no frontend change.

## Why

Gunnar, 2026-09-17, on the current output:

> *"I dont like how it is only referring to news related to stocks in the universe… I heavily dislike
> how this summary uses words like 'We', i just want a general analysis of the current news stories
> affecting the market."*

The offending briefing contained *"We are maintaining our defensive energy-infrastructure exposure"*
and *"Investors should pivot slightly from the earlier singular focus on nuclear utility plays."*

### The voice instruction already exists and is being ignored

`_FOCUS` in `app/briefing.py` already says: *"Use third-person voice (the market, investors, sectors)
rather than 'we' or first-person."* So writing a stronger sentence is not, on its own, the fix.

**The continuity chain propagates the voice.** The same-day branch of `build_prompt` says *"Rewrite
the briefing to reflect what has shifted"* and hands the model a stored briefing that already
contains "we". A rewrite inherits the style of what it is rewriting. Once one briefing acquires
first person, every subsequent one does, indefinitely — regardless of the instruction.

So this contract needs three things, and the third is a one-off data step, not code:

1. constraints that are prominent and absolute rather than buried mid-paragraph
2. an explicit override in **both** rewrite branches, so the earlier briefing's style is not copied
3. the existing contaminated summaries deleted once (Gunnar, in Human verification)

### Scope — the problem is the headline mix, not the source

**Do not switch to Yahoo's `topstories` RSS.** Measured 2026-09-17: it returns HTTP 200 with 50
items, no key needed — and roughly **two** of the fifty are broad-market. The rest is single-name SEO
copy (*"If You Missed the Nancy Pelosi Rally…"*, *"Is PulteGroup Stock Underperforming the S&P
500?"*). The reference app's quality came from **Currents plus a ~45-outlet domain whitelist** — its
README says the whitelist "is doing real work, not just tidiness" — and Yahoo RSS was only its
fallback. Swapping sources would not help.

**The existing feed already carries what Gunnar wants, outnumbered.** Measured across 488 stored
articles and 46 publishers:

```
67  24/7 Wall St.     54  Motley Fool     50  Zacks
38  GuruFocus.com     35  Trefis          19  Insider Monkey     ← 213 articles, single-name SEO
47  MT Newswires      23  Barrons.com     15  Investor's Business Daily
11  TheStreet         10  Yahoo Finance    5  WSJ · 5 Reuters · 4 Bloomberg · 1 FT
```

`MT Newswires` is the wire copy producing exactly the desired material — *"Update: US Equity Indexes
Rise as Fed's Commitment to Controlling Inflation Sinks Treasury Yields"*, *"Sector Update: Tech
Stocks Gain Late Afternoon"*. The fix is to let the briefing read those first. Same mechanism as the
reference's whitelist, applied to publishers instead of domains.

**This changes only what the briefing reads. The news cards keep showing every publisher** — Gunnar
is happy with the cards.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network, no database and no `GEMINI_KEY`.** Never call Gemini in a test.

**If a command fails with `password authentication failed for user "<not in .env>"`, or the frontend
shows "API offline" while the server logs 200s**, your shell has a stale exported `DATABASE_URL` or
`CORS_ORIGINS`.

## Files

Modify:
- `backend/app/briefing.py`
- `backend/tests/test_briefing.py`

**That is the whole list.** Not `app/news.py`, `app/routers/news.py`, `app/schedule.py`,
`app/autorefresh.py`, `app/universe.py`, `app/cache.py`, `app/models.py`, `app/schemas.py`, any
migration, `tests/conftest.py`, or **anything under `frontend/`**.

**No migration. No new dependency. No schema change. No new source, API or feed.**

## `_FOCUS` — rewrite

Replace the current paragraph. Requirements for the new text, not exact wording:

- Frames the task as **an impartial summary of the day's financial news for a market dashboard** —
  not an analyst writing for a portfolio manager. That framing is what produces positioning language.
- Asks for **index moves, sector rotation, rates, macro data and the themes driving them**. A company
  is mentioned only when its news moves a sector or the wider market.
- **Drops every reference to "this universe"**, "the securities", or holdings. The briefing is about
  the market, not about what Gunnar owns.
- Ends with the constraints as a short, explicit block — these must be the last thing the model
  reads:
  - third person only; never `we`, `our`, `us`, `I`, `my`, `you`, `your`
  - describe, do not advise — no recommendations, no "investors should", no positioning,
    exposure or risk-management language
  - `BRIEFING_SENTENCES` sentences maximum
  - plain prose, no bullets, headings or markdown

Keep `BRIEFING_SENTENCES` interpolated as it is now — Gunnar has it at **8** and may change it again.

## `build_prompt` — stop inheriting the old style

Both rewrite branches (same-day and prior-day) must state that the constraints apply to the new
briefing **regardless of how the earlier one was written**, e.g. *"Follow the constraints above even
where the earlier briefing does not."*

Nothing else about `build_prompt` changes: the three-way branch stays, the ET date comparison stays,
the signature stays, it stays pure.

## Publisher preference — pure

```python
PREFERRED_PUBLISHERS: frozenset[str]

def preferred_headlines(articles: list[dict], limit: int) -> list[dict]:
    """Articles from preferred publishers first, each group keeping input order,
    truncated to `limit`."""
```

- **Preference, not a filter.** Preferred articles first, then everything else appended as top-up,
  then truncate. A quiet wire day must still produce a full-length briefing rather than a two-headline
  one. A test must prove the top-up happens.
- Input order is recency order and must be preserved *within* each group.
- Matching is exact on `article["publisher"]`, case-insensitively, with `None` treated as
  non-preferred. Do not substring-match: `"Benzinga"` and `"Benzinga Prediction Markets"` are
  different sources.
- Pure. No database, no clock, no network.

Seed `PREFERRED_PUBLISHERS` from the measured data — wire services and mainstream financial press:

```
MT Newswires, Reuters, Bloomberg, The Wall Street Journal, Financial Times, Barrons.com,
Investor's Business Daily, TheStreet, Yahoo Finance, Yahoo Finance Video, AFP, Fortune,
Quartz, CBS News, Sky News, Investopedia, Kiplinger, Associated Press, CNBC, MarketWatch
```

The last three are not in the store yet and are included deliberately — they are plausible future
Yahoo providers and cost nothing. **Do not add** `24/7 Wall St.`, `Motley Fool`, `Zacks`,
`GuruFocus.com`, `Trefis`, `Insider Monkey`, `Simply Wall St.`, `StockStory`, `Stocktwits`,
`MarketBeat` — those are the 213 articles this contract exists to demote.

## Wiring in `refresh_briefing`

Today it calls `recent_articles(MAX_HEADLINES)`. Preferring inside an already-truncated list would do
almost nothing, so over-select then prefer — the same shape as `cap_per_ticker` in `app/news.py`:

```python
candidates = recent_articles(min(MAX_HEADLINES * 4, 200))
articles = preferred_headlines(candidates, MAX_HEADLINES)
```

Everything else in `refresh_briefing` is unchanged: the `needs_summary` gate, claim semantics, the
"never wipe on failure" rule, `_insert_summary` then `_prune_old_summaries(keep_id=...)`.

**Do not change `recent_articles` itself** — it lives in `app/news.py`, it is outside this contract's
file list, and `GET /news` depends on its current behaviour.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network, no
   database and no `GEMINI_KEY`. Count increases from **323**.
2. `grep -nE "universe|holdings|portfolio manager" backend/app/briefing.py` — no match inside the
   `_FOCUS` text. Quote the `_FOCUS` block verbatim in the report so the wording can be judged.
3. A test asserts every branch of `build_prompt` contains the third-person constraint **and** the
   no-advice constraint — cold start, same-day rewrite, prior-day rewrite. Three assertions.
4. A test asserts both rewrite branches contain the override phrase telling the model to follow the
   constraints even where the earlier briefing does not.
5. `preferred_headlines` tests: preferred-first ordering; recency preserved within each group;
   **top-up when fewer than `limit` preferred articles exist**; `publisher=None` treated as
   non-preferred; `"Benzinga Prediction Markets"` **not** matched by `"Benzinga"`.
6. A test asserts `refresh_briefing` over-selects then prefers — e.g. with 40 stored articles of
   which 5 are preferred, the prompt's headline block leads with those 5.
7. `grep -rnE "topstories|rss|feedparser|requests\.get" backend/app/briefing.py` matches nothing
   (exit 1) — no new source was added.
8. `git diff --stat backend/app/news.py backend/app/routers/news.py backend/app/schedule.py backend/app/autorefresh.py backend/app/universe.py backend/app/cache.py backend/app/models.py backend/app/schemas.py`
   is empty.
9. `ls backend/migrations/versions/` still shows exactly **seven**.
10. `git status --porcelain` lists nothing outside this contract's two files and nothing under
    `frontend/`. **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -rnE "topstories|rss|feedparser|requests\.get" backend/app/briefing.py ; echo "(exit $? — 1 = correct)"
ls -1 backend/migrations/versions/
git diff --stat backend/app/news.py backend/app/schedule.py backend/app/universe.py ; echo "(empty = untouched)"
git status --porcelain
```

Plus the prompt itself, so the wording can be reviewed without reading the diff:

```bash
cd backend && DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "
from datetime import datetime
from zoneinfo import ZoneInfo
from app.briefing import build_prompt
ET = ZoneInfo('America/New_York')
print(build_prompt(['- Example headline (MT Newswires)'], None, None, datetime(2026,9,17,10,0,tzinfo=ET)))"
```

And the publisher split against the real store — **deliberately not `DATABASE_URL=\"\"`**:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
from app.briefing import preferred_headlines, PREFERRED_PUBLISHERS, MAX_HEADLINES
from app.news import recent_articles
c = recent_articles(200)
sel = preferred_headlines(c, MAX_HEADLINES)
print(f'{len(c)} candidates -> {len(sel)} selected')
for a in sel: print(' ', (a.get('publisher') or '?')[:26], '|', a['title'][:66])"
```

Expect `MT Newswires` and the mainstream outlets at the top, and **no** `Zacks` / `Motley Fool` /
`GuruFocus` unless the preferred pool ran short.

## Human verification — does Gunnar need to run anything?

**Yes, and one step is mandatory or the fix will not appear to work.**

1. **Delete the existing briefings.** They contain first-person prose, and the same-day rewrite branch
   would copy that style into the next one. This is the step that makes the change visible:
   ```bash
   cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
   from sqlalchemy import delete
   from app.db import session
   from app.models import NewsSummary, AppState
   with session() as db:
       db.execute(delete(NewsSummary))
       db.execute(delete(AppState).where(AppState.key=='news_refresh'))
   print('cleared')"
   ```
   **Deliberately not `DATABASE_URL=\"\"`** — it must hit the real database. Clearing `news_refresh`
   too forces the next page load to regenerate rather than waiting for the next window.
2. Reload `localhost:5173/`, wait for the background refresh, reload again.
3. Read the new briefing. Check specifically: **no "we", "our", or "us"; no "investors should"; no
   talk of exposure or positioning.** It should read like a market report, not a client letter.
4. Check the subject matter — indices, sectors, rates and macro rather than a tour of individual
   holdings.
5. If it still drifts, say which sentence and I will adjust the constraint block. **One sample is not
   enough to re-tune a prompt** — give it two or three generations before deciding.

## Out of scope

- **No new news source.** Not Currents, not RSS, not scraping. The measurement above is why.
- No change to the news cards, the text list, or which publishers they display.
- No change to `recent_articles`, `GET /news`, or the refresh windows.
- No change to `BRIEFING_SENTENCES`, `SUMMARY_MIN_AGE_MINUTES` or `NEWS_RETENTION_DAYS` — those are
  Gunnar's to tune and he has already moved them.
- No migration, no schema change, no frontend change.

## Open questions — do NOT resolve these yourself

- **Whether the same-day rewrite branch should exist at all.** It is what makes the briefing grow
  through the day, and also what propagated the voice. This contract keeps it and overrides the style
  instead; if the voice still leaks, dropping the branch is the next lever.
- **Whether `PREFERRED_PUBLISHERS` should become a hard filter** once there is evidence the preferred
  pool is reliably deep enough.
- **Whether the briefing should read more headlines than `MAX_HEADLINES`.**
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-17)

- `pytest -q` → **336 passed** (from 323)
- `topstories|rss|feedparser|requests.get` in `briefing.py` → exit 1; no new source added
- Seven migrations; `git status` shows exactly `briefing.py` and `test_briefing.py` for this
  contract. The apparently non-empty criterion-8 diff is contract **0038**, reported last turn and
  still uncommitted — the implementer established that by mtime and was right.

### The structural fix went beyond the wording

The contract asked for the constraint block to be "the last thing the model reads". The version on
disk interpolated `_FOCUS` mid-paragraph in all three branches. The implementer restructured
`build_prompt` so `_FOCUS` — ending in the constraints — sits immediately before the final cue.
Verified by printing the same-day branch: earlier briefing → headlines → constraints →
`Follow the constraints above even where the earlier briefing does not.` → `Updated briefing:`.

That ordering is the actual fix. The instruction already existed and was being ignored because it was
buried above the contaminated prior text rather than below it.

### Measured on the real store after the change

```
200 candidates -> 20 selected
MT Newswires 5 · Investor's Business Daily 4 · Barrons.com 4 · TheStreet 2
WSJ 1 · Reuters 1 · Bloomberg 1 · Associated Press 1 · Yahoo Finance Video 1
demoted outlets that slipped in: 0
stored briefing | first-person hits: NONE
```

`Associated Press` was one of three publishers seeded speculatively that were not yet in the store;
it now appears, which justifies including plausible-future outlets in the list.

### Two test-design details worth keeping

- The substring test monkeypatches `PREFERRED_PUBLISHERS` and only works because
  `preferred_headlines` reads the constant from the module namespace on each call. A precomputed
  lowercase set built at import time would have made the test silently vacuous.
- The over-select test inserts 35 non-preferred articles *before* 5 preferred ones, so plain recency
  order would put the preferred ones last. A prefer-inside-an-already-truncated-list bug cannot
  produce the observed ordering — the test is adversarial rather than confirmatory.

### Honest limit

One generation. The contract itself says one sample cannot prove a prompt change, and the implementer
said so rather than claiming otherwise. The same-day rewrite branch was never observed resisting a
*real* contaminated earlier briefing, because those rows were deleted by the mandatory step before a
live rewrite could be watched — only the unit test covers it.
