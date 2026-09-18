# Contract 0040 — Broad-market news only: fixed feeds, publisher filter at ingest

**Status:** accepted (2026-09-17) — audited by planner. Human verification outstanding.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

News stops being aggregated per universe ticker. It comes from a **fixed set of five market-wide
feeds**, and only articles from preferred publishers are stored at all.

Backend, plus one frontend constant. No migration, no new dependency.

## Why

Gunnar, 2026-09-17:

> *"Can we remove the 'specific ticker' article aggregation functionality? I'd rather only have the
> top most-recent stories affecting the broader market on the current day… Ticker specific articles
> shouldnt be pulled especially as the universe grows."*

**The scaling half of that is correct and is the real reason to do this.** Today `run_news_refresh_if_due`
walks every active universe ticker, so single-stock articles grow linearly with the universe while
broad-market copy does not. At 500 tickers the feed would be almost entirely single-name noise, and
the refresh would cost 500 yfinance calls instead of 5.

**The "older articles" half is not happening** — measured 2026-09-17 across 381 stored articles:

```
<6h: 97    6-24h: 128    1-2d: 155    >2d: 1
```

`NEWS_RETENTION_DAYS = 2` already guarantees freshness. Do not add any age logic; that problem does
not exist.

### There is no Yahoo "top stories" endpoint — do not go looking for one

Four routes measured 2026-09-17. All draw from the same provider pool and all are dominated by
content mills:

| route | result |
|---|---|
| `finance.yahoo.com/rss/topstories` | ~2 of 50 broad-market; **and RSS items carry no publisher**, so they cannot be filtered |
| `yf.Search("stock market").news` | 11 of 15 are Zacks *"Why X Outpaced the Stock Market Today"* |
| `^GSPC` / `^IXIC` / `^RUT` feeds unfiltered | same Zacks templates — Yahoo attaches anything mentioning "the market" |
| per-ticker feeds (today) | 6 of 16 from preferred publishers |

**The channel is not the variable — the publisher is.** Which is what makes this contract's design
work, measured on the same day:

```
5 broad feeds → 42 unique articles → 8 pass the publisher filter

Yahoo Finance Video   The market is ready for a few more rate hikes
Investor's Business…  Stock Market Today: Nasdaq Snaps Losing Streak
Associated Press      How major US stock indexes fared Thursday 9/17/2026
MT Newswires          Sector Update: Tech Stocks Gain Late Afternoon
MT Newswires          Exchange-Traded Funds Higher as US Equities Advance After Midday
```

Seven of those eight are genuinely market-level. **And it is O(1)** — five feeds whether the universe
holds 20 tickers or 500.

**The accepted cost, stated plainly:** news about individual holdings disappears. If NVDA reports
earnings, that story appears only if a broad feed happens to carry it. Gunnar asked for this
explicitly having seen both.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`.**

**Tests must pass with no network, no database and no `GEMINI_KEY`.** Never call yfinance or Gemini
in a test.

**If a command fails with `password authentication failed for user "<not in .env>"`, or the frontend
shows "API offline" while the server logs 200s**, your shell has a stale exported `DATABASE_URL` or
`CORS_ORIGINS`.

## Files

Modify:
- `backend/app/news.py`
- `backend/app/briefing.py` — import the constant, do not redefine it
- `backend/tests/test_news.py`
- `backend/tests/test_briefing.py`
- `frontend/src/components/NewsSection.tsx` — one constant

**Touch nothing else.** Not `app/autorefresh.py`, `app/schedule.py`, `app/universe.py`, `app/cache.py`,
`app/quotes.py`, `app/strip.py`, `app/models.py`, `app/schemas.py`, `app/routers/news.py`,
`app/routers/universe.py`, `app/main.py`, `tests/conftest.py`, any migration, or any other frontend
file.

**No migration. No schema change. No new dependency. No new news source.**

## `app/news.py`

### The feed list

```python
MARKET_NEWS_TICKERS = ("^GSPC", "^IXIC", "^RUT", "SPY", "QQQ")
```

A module constant, not derived from the universe. These five were measured together; the tuple is
trivially extendable later if the yield proves thin.

### Move `PREFERRED_PUBLISHERS` here from `briefing.py`

`briefing.py` already does `from app.news import recent_articles`, so the constant moving *into*
`news.py` keeps the import direction as it is. **Moving it the other way would be circular** — do not
import `briefing` from `news` at module level.

`briefing.py` then imports it: `from app.news import PREFERRED_PUBLISHERS, recent_articles`.
`preferred_headlines` stays exactly as it is — it becomes close to a no-op now that ingest is
filtered, and that is deliberate: it is the safety net if the ingest filter is ever loosened.

### Filter at ingest

```python
def is_preferred_publisher(publisher: str | None) -> bool:
    """True when publisher is in PREFERRED_PUBLISHERS. Case-insensitive; None is never
    preferred. Exact match — 'Benzinga' must not match 'Benzinga Prediction Markets'."""
```

Pure. Apply it in the refresh loop **after** `parse_article` and **before** the article enters
`parsed_by_id`, so non-preferred articles are never stored.

**Do not put the check inside `parse_article`.** That function's contract is "one yfinance item → a
row dict, or None when malformed"; folding an editorial policy into it makes a parse failure and a
policy rejection indistinguishable.

Filtering at ingest rather than at read is the right call here **because retention is two days** —
nothing is lost long-term, the table stays small, and the cards, the list and the briefing all see
the same curated set with no extra plumbing.

### `run_news_refresh_if_due`

Iterate `MARKET_NEWS_TICKERS` instead of the universe. Delete the
`from app.autorefresh import active_universe_tickers as _shared_active_universe_tickers` import — it
becomes unused, and a dead import implies a dependency that no longer exists.

**`refresh_news_if_stale(tickers, now_utc, now_et)` keeps its signature** — tests drive it directly.
`run_news_refresh_if_due` simply passes `MARKET_NEWS_TICKERS` where it used to pass universe tickers.

Everything else is unchanged: claim-first on `app_state["news_refresh"]`, sequential fetching,
per-ticker `except Exception: continue`, never delete-then-insert, the 2-day `pub_date` prune, and
`refresh_briefing` at the end.

`source_ticker` now records which *market feed* surfaced an article. It is still provenance, still
never displayed. Leave the column and its first-wins conflict rule alone.

## `frontend/src/components/NewsSection.tsx`

**`MAX_PER_TICKER` must become `0`.** It is currently `1`. With only five source feeds, a cap of one
per feed would limit the entire page to **five articles**. Zero disables the cap — the endpoint
already treats it that way.

Change that constant and nothing else. `LIMIT`, `CARDS_PER_PAGE`, `VISIBLE_LIST_ROWS`, the carousel,
the hover expander and the briefing panel are all untouched.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network, no
   database and no `GEMINI_KEY`. Count increases from **336**.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
3. `grep -n "MARKET_NEWS_TICKERS" backend/app/news.py` matches, and
   `grep -n "active_universe_tickers" backend/app/news.py` matches **nothing** (exit 1).
4. A test asserts `run_news_refresh_if_due` fetches exactly the five tickers in
   `MARKET_NEWS_TICKERS` — spy on `fetch_news_for` and compare the call list. **It must fail if the
   universe is consulted**, so give the fake universe a different ticker set.
5. `is_preferred_publisher` tests: a preferred name; a demoted name (`Zacks`); `None`;
   case-insensitivity; and `"Benzinga Prediction Markets"` **not** matched by `"Benzinga"`.
6. A test asserts a non-preferred article is **never stored** — run a refresh whose feed returns one
   `MT Newswires` and one `Zacks` item, then assert only the first is in the table.
7. A test asserts `parse_article` still returns a row for a `Zacks` article — the policy lives in the
   loop, not in the parser.
8. `grep -n "PREFERRED_PUBLISHERS" backend/app/briefing.py` shows an **import**, not a definition.
9. `grep -n "MAX_PER_TICKER" frontend/src/components/NewsSection.tsx` shows `0`.
10. `git diff --stat backend/app/autorefresh.py backend/app/schedule.py backend/app/universe.py backend/app/cache.py backend/app/models.py backend/app/schemas.py backend/app/routers/news.py`
    is empty.
11. `ls backend/migrations/versions/` still shows exactly **seven**.
12. `git status --porcelain` lists nothing outside this contract's Files list.
    **Do not use `git diff --name-only`** — untracked files are invisible to it, and contract 0038 may
    still be uncommitted in this tree.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "MARKET_NEWS_TICKERS" backend/app/news.py
grep -n "active_universe_tickers" backend/app/news.py ; echo "(exit $? — 1 = correct)"
grep -n "PREFERRED_PUBLISHERS" backend/app/briefing.py
grep -n "MAX_PER_TICKER" frontend/src/components/NewsSection.tsx
ls -1 backend/migrations/versions/
git diff --stat backend/app/autorefresh.py backend/app/universe.py backend/app/routers/news.py ; echo "(empty = untouched)"
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git status --porcelain
```

Plus a live fetch showing what the five feeds actually yield — **one real network call per feed, no
database writes**:

```bash
cd backend && DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "
import yfinance as yf
from app.news import MARKET_NEWS_TICKERS, is_preferred_publisher
seen = {}
for t in MARKET_NEWS_TICKERS:
    for it in yf.Ticker(t).news:
        c = it.get('content', {}) or {}
        prov = c.get('provider') or {}
        pub = prov.get('displayName') if isinstance(prov, dict) else None
        if it.get('id') and it['id'] not in seen:
            seen[it['id']] = (pub, c.get('title') or '')
kept = [(p, ti) for p, ti in seen.values() if is_preferred_publisher(p)]
print(f'{len(seen)} unique -> {len(kept)} kept')
for p, ti in kept: print(f'  {(p or chr(63))[:22]:<24} {ti[:74]}')"
```

Expect roughly 40 unique and under a dozen kept, dominated by MT Newswires, Investor's Business
Daily, Associated Press and Yahoo Finance Video. **Paste the counts** — if `kept` is 0 or 1, the
filter or the publisher extraction is wrong.

## Human verification — does Gunnar need to run anything?

**Yes.**

1. Restart uvicorn with `--reload`, load `localhost:5173/`, wait for the background refresh, reload.
2. The cards should be visibly different: wire and mainstream outlets, market-level headlines. No
   `Zacks`, `Motley Fool`, `24/7 Wall St.`, `Trefis`, `Simply Wall St.` or `Stocktwits`.
3. **The feed will be smaller.** Roughly 8 new articles per refresh rather than ~20, accumulating
   across three windows a day against a two-day retention. If it feels too thin after a full day,
   the fix is adding feeds to `MARKET_NEWS_TICKERS` — say `^DJI` and `DIA` — not loosening the
   publisher filter.
4. **Old single-stock articles linger for up to two days** until the `pub_date` prune ages them out.
   To see the change immediately, clear the table — **deliberately not `DATABASE_URL=""`**:
   ```bash
   cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
   from sqlalchemy import delete
   from app.db import session
   from app.models import NewsArticle, AppState
   with session() as db:
       db.execute(delete(NewsArticle))
       db.execute(delete(AppState).where(AppState.key=='news_refresh'))
   print('cleared')"
   ```
   The trade: the feed is thin until the next couple of refreshes fill it.
5. Read the briefing after a regeneration. It was already reading preferred publishers only, so it
   should not change much — **if it changes a lot, something in the ingest filter is wrong.**

## Out of scope

- No new news source, RSS, API or scraping. Four routes were measured; the finding is in "Why".
- No age or recency logic — retention already handles it.
- No change to the refresh windows, the claim mechanism, retention, or the briefing prompt.
- No change to `GET /news`'s shape, its params, or its clamping.
- No UI change beyond the one constant.
- No removal of `preferred_headlines` — it stays as the safety net.

## Open questions — do NOT resolve these yourself

- **Whether `MARKET_NEWS_TICKERS` should grow** (`^DJI`, `DIA`, `IWM`, `^VIX`). Decide from a day of
  real yield, not from one sample.
- **Whether `PREFERRED_PUBLISHERS` is too strict.** `Stocktwits` was dropped carrying a legitimately
  broad headline — *"S&P 500, Nasdaq, Dow End Higher As Drop In Oil Prices Allays Inflationary
  Concerns"*. That is a real false negative.
- **Whether the universe should still contribute news at all** — e.g. a small per-ticker allowance
  for genuine company events. This contract removes it entirely, as asked.
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-17)

- `pytest -q` → **342 passed** (from 336)
- `MARKET_NEWS_TICKERS` at `news.py:42`, passed at `:330`; `active_universe_tickers` → exit 1
- **No broken importers**: nothing anywhere imports `app.news.active_universe_tickers`. The
  implementer deleted `news.py`'s own copy as well as the `autorefresh` alias — beyond the literal
  instruction, correct, and verified here by grepping every `from app.news import` in the tree.
- `briefing.py:24` imports `PREFERRED_PUBLISHERS`; no definition remains there
- `is_preferred_publisher` applied at `news.py:284`, after `parse_article` at `:275` and outside it —
  a parse failure and a policy rejection stay distinguishable, as specified
- `MAX_PER_TICKER = 0` in `NewsSection.tsx`
- Seven migrations; scope is exactly this contract's four files

Live: **42 unique → 9 kept**, against the contract's measured 42 → 8. The extra two were `TheStreet`,
already on the list; day-to-day feed variance, not a filter change.

### Why this contract exists in the shape it does

Gunnar's request was "remove per-ticker aggregation, give me top stories". The obvious implementation
— point at a top-stories endpoint — was measured and rejected: **Yahoo has no such channel**. All
four routes (`topstories` RSS, `yf.Search`, index feeds, per-ticker feeds) draw from one provider pool
dominated by the same content mills, and the RSS variant carries no publisher field at all, so it
cannot even be filtered.

The working design was therefore *fixed broad feeds + publisher filter*, which satisfies the request
for a reason Gunnar did not state: **it is O(1) in universe size**. Five feeds whether the universe
holds 20 tickers or 500, versus 500 yfinance calls per refresh under the old design.

One half of the stated rationale was wrong and the contract says so: per-ticker feeds were **not**
pulling stale articles — 380 of 381 stored rows were under two days old, because
`NEWS_RETENTION_DAYS = 2` already guarantees it. The contract explicitly forbade adding age logic for
a problem that does not exist.

### The trap this avoided

`MAX_PER_TICKER` was `1`. With five source feeds instead of twenty, a cap of one per feed would have
limited the entire news section to **five articles** — a change in a backend constant silently
starving the frontend through a parameter neither obviously connects to.
