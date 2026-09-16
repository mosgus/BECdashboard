# News Section — Reference Bundle

Snapshot of TCM.io's Home-page news section, pulled out for reuse in a
different project. Everything in this directory is copied **verbatim** from
`ToccoaIO` (this repo) as of 2026-09-15, with a short provenance comment added
to the top of each file. Nothing here has been rewritten, cleaned up, or
"improved" — the point is to show exactly what runs in production today,
warts included (see **Known rough edges**, below, for the ones I noticed).

**This is not a runnable package.** It has no `__init__.py`, most imports
point at TCM.io modules that aren't included, and it depends on Streamlit
session state, `st.secrets`, and a MongoDB connection that don't exist here.
Treat it as read-only reference material to reimplement against your own
stack (Streamlit + PostgreSQL, per your description), not something to drop
into `sys.path`.

## The four things you asked to recreate, and where each lives

| UI piece | Function | File |
|---|---|---|
| AI-generated news briefing (paragraph of text above the tickers) | `render_news_section()` → `_get_news_summary()` | `news_section.py` |
| Sliding ticker bars (price/change, scrolling marquee) | `render_indicators_strip()`, `render_focused_strip()` | `finance_ticker.py` |
| Slideshow of clickable article cards with thumbnails | `render_news_section()`'s "Image card slideshow" block | `news_section.py` |
| Plain article list (text-only, with a "N more" overflow) | `render_news_section()`'s "Text-only rows" block | `news_section.py` |
| *(bonus, not asked for but probably worth keeping)* Feed inspector — a debug expander showing every fetched article and whether it passed the whitelist | `render_news_section()`'s "Feed inspector" block | `news_section.py` |

All four (five) pieces are actually rendered by **one function**,
`render_news_section()`, called once from `Home.py`. There is no separate
"slideshow module" or "ticker module" wired independently — `news_section.py`
is the orchestrator and it reaches into `finance_ticker.py` for the two
ticker strips partway through its own render.

## File map

| File | Copied from | What it is |
|---|---|---|
| `news_section.py` | `main/pages/Home/home_modules/news.py` | Fetches Currents + Yahoo RSS articles, whitelist-filters them, gets/generates the AI summary, renders summary + slideshow + article list + feed inspector. |
| `finance_ticker.py` | `main/pages/Home/home_modules/finance.py` | Renders the scrolling ticker bars (price, 5-day/30-day/YTD % return) as pure HTML/CSS marquees. Data comes from `yfinance` today — **this is the part your note said to ignore**, but the file is included in full because the rendering logic (HTML/CSS generation, the data shape it expects) is the reusable part. |
| `news_summarizer.py` | `main/LLM/news_summarizer.py` | Builds the prompt and calls Gemini to produce the briefing paragraph. Contains the "same-day vs. new-day" branching logic — see below. |
| `llm_client_setup.py` | Extracted from `main/LLM/service.py` (lines ~1–39) | **Not a verbatim copy.** `service.py` is 440 lines and does five unrelated things (property research, asset summaries, AM report generation...); this file is just the six lines `news_summarizer.py` actually needs — constructing the Gemini client and naming the model. Said so at the top of the file. |
| `llm_output_store_mongo_reference.py` | `main/db/llm_output.py` | MongoDB-backed persistence for the generated summary: freshness check, insert, and a retention/pruning scheme. **This is the piece you'll port to PostgreSQL** — see the storage section below for the shape you need to reproduce. |
| `home_page_wiring.py` | `main/pages/Home/Home.py` | Trimmed excerpt showing exactly how/where `render_news_section()` is called relative to the rest of the page. The full original file also renders a deal-approval queue widget, a key-dates widget, and a changelog table — none of that is news-related and none of it is copied here. |
| `standalone_tests/currents_news_test.py` | `test/currents_news_test.py` | Script-form check: hits the Currents API directly, prints unfiltered vs. whitelist-filtered results. No Streamlit needed. |
| `standalone_tests/yahoo_rss_test.py` | `test/yahoo_rss_test.py` | Script-form check: fetches and parses the Yahoo Finance RSS feed, prints field-by-field output. No Streamlit, no API key. |
| `requirements.txt` | — (new) | Only the packages the *retained* pieces need, annotated with which ones you can drop. |

## What's required to run this

1. **A Currents API key.** Sign up at currentsapi.services. The code reads it
   from `st.secrets["CURRENTS_KEY"]` first, falling back to a local file
   `keys/currents_key.txt` (see `_fetch_raw_news()` in `news_section.py`).
   Check their dashboard for your plan's rate limit before setting your own
   cache TTL — `@st.cache_data(ttl=3600)` here assumes an hourly refresh is
   fine.
2. **A domain whitelist.** `DOMAIN_WHITELIST` in `news_section.py` is a
   hardcoded set of ~45 outlets (Reuters, AP, WSJ, Bloomberg, etc.). Currents
   aggregates from a huge and uneven pool of sources, so this filter exists
   because the raw feed is not consistently trustworthy — the whitelist is
   doing real work, not just tidiness. You'll want your own list. The "Feed
   inspector" expander at the bottom of `render_news_section()` is a cheap way
   to see what a whitelist change actually does to the feed before shipping
   it (renders every article with a ✓/✗ and the domain it matched or missed).
3. **An LLM for the summary.** TCM.io uses Gemini (`google-genai` package) via
   the client in `llm_client_setup.py`, reading the key from
   `st.secrets["GEMINI_KEY"]` or `keys/gemini_key.txt`. Swap for whatever
   provider/SDK your other project already standardizes on — nothing about
   the prompt logic in `news_summarizer.py` is Gemini-specific except the two
   lines that make the actual API call.
4. **Yahoo Finance RSS** — no key, no auth. `news_section.py` fetches
   `https://finance.yahoo.com/rss/topstories` directly with `requests` and
   parses the XML by hand (see `_parse_yahoo_rss`). It's used purely to
   supplement the Currents feed with a second source; if you don't want a
   second source, delete the `_YAHOO_RSS_URL` fetch and the
   `currents_articles + yahoo_articles` concat in `_fetch_raw_news()`.
5. **Ticker price data — deliberately not reproduced.** `finance_ticker.py`'s
   `_fetch_all_quotes()` calls `yf.download(...)`. Per your note, you already
   have a PostgreSQL-backed "universe" for this in the other project, so this
   is the one function you should NOT port — only its **output shape**
   matters (documented below), since every other function in the file
   consumes that shape, not yfinance directly.
6. **A place to persist the generated summary.** See next section — this is
   the one piece that needs a real design decision, not just a key.

## Storage: what you actually need to port (Mongo → Postgres)

`llm_output_store_mongo_reference.py` is TCM.io's general-purpose "reusable
LLM output" collection — it also stores asset summaries and AM reports there,
identified by an `output_type` field. For just the news feature, you need the
narrower subset: somewhere to store "the latest generated briefing paragraph,
with a timestamp." A minimal Postgres equivalent:

```sql
CREATE TABLE news_summary (
    id          SERIAL PRIMARY KEY,
    content     TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);
```

You need three operations, mirrored from the reference file:

- `get_latest_llm_output("news_summary")` → `SELECT ... ORDER BY generated_at DESC LIMIT 1`
- `add_llm_output(output_type="news_summary", content=...)` → `INSERT`, and
  when inserting a *news_summary* row specifically, also set an expiry and
  run the prune step below.
- `_prune_expired_news_summaries` → `DELETE FROM news_summary WHERE expires_at <= now() AND id != :just_inserted_id`

**Two different TTLs are in play here — don't conflate them, the original
code deliberately keeps them separate:**

- **`_SUMMARY_TTL_HOURS = 2`** (in `news_section.py`, inside
  `_get_news_summary()`) — "is the stored summary still fresh enough to skip
  regenerating it?" If the latest row is under 2 hours old, it's reused as-is
  and no LLM call happens.
- **`_NEWS_SUMMARY_TTL_HOURS = 24`** (in `llm_output_store_mongo_reference.py`)
  — a **retention** window, not a freshness window. Once a *new* summary is
  successfully saved, older summaries whose 24-hour window has lapsed are
  deleted — except the one just inserted is always excluded from that delete
  (`output_id != keep_output_id`), and more importantly, **the previous
  summary is never deleted just for being superseded** — only for being both
  superseded *and* past 24 hours old. This is what guarantees that if
  generation ever fails (API down, LLM error), there is always a most-recent
  stale summary sitting in storage to fall back to and display, rather than
  the section going blank. Don't "simplify" this into deleting the old row
  the moment a new one is written.

## The continuity prompt pattern (worth keeping as-is)

`summarize_news_articles()` in `news_summarizer.py` always tries to read the
previously-stored summary and branches the prompt on it:

- **No previous summary** → a plain "summarize today's headlines" prompt.
- **Previous summary from earlier today** → prompt says "rewrite this to
  reflect what's shifted," so the briefing grows/updates through the day
  instead of restarting from scratch every 2 hours.
- **Previous summary from a prior day** → prompt says "open with what's
  changed since yesterday, then cover today fully" — a fresh day's briefing
  that still has continuity with the last one.

This works because a news briefing is a genuinely **cumulative** artifact —
today's version is supposed to build on the last one. If you're tempted to
reuse this same "feed the model its own last output" pattern for some other
summary elsewhere in your app, make sure that other thing is *also*
cumulative and not a point-in-time snapshot recomputed from scratch each
time — feeding a snapshot generator its own last output tends to make stale
content self-perpetuate (it starts treating outdated claims as a draft to
revise rather than dropping them). That's a documented failure mode elsewhere
in this codebase, not a hypothetical.

## Ticker strip data shape (what to feed `finance_ticker.py` instead of yfinance)

Every render function in `finance_ticker.py` consumes this shape — reproduce
it from your Postgres universe and the rest of the file needs no changes:

```python
{
    "today":      [{"name": str, "price": float, "change": float, "pct": float}, ...],
    "five_day":   [{"name": str, "pct": float}, ...],
    "thirty_day": [{"name": str, "pct": float}, ...],
    "ytd":        [{"name": str, "pct": float}, ...],
}
```

- `today` drives the top row (price + absolute change + % change).
- The other three drive the return-only rows (label + % only).
- A ticker can simply be absent from `five_day`/`thirty_day` if you don't
  have enough history yet — `_compute_group` in the original only appends
  once it has enough data points, and `_row_html` returns `""` for an empty
  list, so a short group just doesn't render that row. No null-handling
  needed on the render side.
- `render_finance_ticker()` groups tickers into three named buckets (two
  always-expanded, one collapsed behind a `<details>`) and expects
  `{"index": {...}, "tcm": {...}, "gus": {...}}` — three top-level groups each
  shaped as above. `"tcm"` and `"gus"` are this firm's internal watchlists
  (ticker symbols named after the firm and, apparently, a person's initials);
  rename the groups and pick your own tickers.

## Actual render order inside `render_news_section()`

1. Ensure storage is initialized (`init_llm_output_collection()` in the
   original — a Postgres port would be "ensure the table exists," run once).
2. Fetch raw articles (Currents + Yahoo RSS), cached 1 hour via
   `@st.cache_data(ttl=3600)`.
3. If the fetch failed outright, show a warning and stop.
4. Whitelist-filter the articles.
5. If nothing passed the whitelist, render nothing further (not even a
   summary).
6. Split into `with_image` / `without_image`.
7. Get-or-generate the AI summary (the 2-hour check described above) and
   render it as a paragraph with a "Generated <time>" caption.
8. Render the **Indicators** ticker strip (`render_indicators_strip()`).
9. Render the **image-card slideshow** — 3 cards per slide
   (`CARDS_PER_SLIDE`), Prev/Next buttons, current slide tracked in
   `st.session_state.news_slide`.
10. Render the **Focused** ticker strip (`render_focused_strip()`), pulled up
    with a negative CSS margin to sit close to the slideshow above it.
11. Render the **text-only article list** — first 4 visible, the rest behind
    a native `<details>` "... N more" disclosure (not a Streamlit expander;
    it's raw HTML for a lighter-weight collapse).
12. Render the **Feed inspector** — always, even if nothing else rendered
    this run, as long as `all_articles` is non-empty. Shows every fetched
    article with ✓/✗ against the whitelist.

Note that steps 8 and 10 call into `finance_ticker.py`'s
`render_indicators_strip()` / `render_focused_strip()` — **not**
`render_finance_ticker()`. That third function exists in the source file and
renders all three groups (including the collapsed one) in one call, but as of
this snapshot **nothing in the app calls it** — it's dead code, left in for
reference here because it shows the "collapsed third group" pattern, but you
don't need to preserve it just because it's present.

## Known rough edges — flagging these rather than silently fixing them

Copied verbatim as asked, but worth knowing about before you build on top of
them:

- **`_card_html()` in `news_section.py` does not HTML-escape `url` or
  `image`** before interpolating them into `href="..."` and `src="..."`
  attributes — only `title` gets a narrow three-character `.replace()`
  treatment, not `html.escape()`. Both `url` and `image` come from a
  third-party feed (Currents/Yahoo), not end users, so the practical risk is
  low, but it's still unsanitized external input landing in an HTML
  attribute (a stray `"` in a compromised or malformed feed entry could break
  out of the attribute). Every *other* HTML-building function in this file
  (`_row_html`, `_inspector_row`) does use `html.escape()` correctly — this
  one function is the outlier. If you reuse this card-rendering pattern,
  escape `url`/`image` too.
- Colors throughout (`#ccc`, `#888`, `rgba(255,255,255,0.04)` card
  backgrounds, etc.) are hardcoded for a dark background. There's no
  `.streamlit/config.toml` theme file in this repo — it's relying on
  whichever theme the deployment/browser happens to use. On a light theme
  these will look wrong (low-contrast light-gray text on a light
  background). Worth parameterizing if your other project supports both.
- The two ticker watchlists (`TCM_TICKERS`, `GUS_TICKERS`) and their display
  names are specific to this firm and a specific person — cosmetic to rename,
  but don't miss them since they're separate from `INDEX_TICKERS`.

## What's deliberately not included

- `main/db/client.py` (Mongo connection/constants) and `main/db/changelog.py`
  (audit-log writer) — `llm_output_store_mongo_reference.py` imports from
  both, but neither is news-specific; they're TCM.io's general Mongo
  plumbing. You'll replace both with your existing Postgres connection
  handling and (if you want one) your own audit log, not port these files.
- Everything else on the TCM.io Home page — the deal-approval queue widget,
  the upcoming-key-dates widget, and the changelog table. `home_page_wiring.py`
  shows where `render_news_section()` sits among them but doesn't include
  their code.

## Porting checklist

1. Stand up the Postgres `news_summary` table (or equivalent) and the three
   operations (`get_latest`, `add`, `prune_expired`) from the storage section.
2. Get a Currents API key; store it the way your project already handles
   secrets; pick or copy `DOMAIN_WHITELIST`.
3. Wire an LLM client (Gemini, or whatever you already use) behind the same
   two-argument shape `news_summarizer.py` expects
   (`summarize_news_articles(articles, previous_summary, previous_timestamp)`)
   so you can keep the same-day/new-day branching untouched.
4. Build your own `_fetch_all_quotes()`-equivalent against your PostgreSQL
   universe, returning the exact shape documented above; everything in
   `finance_ticker.py` downstream of that function needs no changes.
5. Decide whether you want the Yahoo RSS supplement; it's optional and
   self-contained (one function, `_parse_yahoo_rss`, plus one fetch call).
6. Fix the `_card_html` escaping gap while you're in there rewriting it
   anyway.
7. Re-theme the hardcoded colors if your project supports a light theme.
