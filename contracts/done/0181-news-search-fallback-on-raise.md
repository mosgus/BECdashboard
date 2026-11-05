# Contract 0181 — Fall back to Search when `Ticker.news` raises

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`fetch_news_for` falls back to `yf.Search` when `yf.Ticker(t).news` **raises**, not only when it
returns an empty list.

## Why

The launch page shows the briefing paragraph but no article cards. `/ops` shows every
`news_refresh` as `partial · 7 feeds · 0 stored`. Planner probe, 2026-11-05, yfinance 1.7.0 (the
pinned version):

```
^GSPC Ticker.news RAISED YFDataException('*** YAHOO! FINANCE IS CURRENTLY DOWN! ***')
^GSPC Search.news: 9  {'Yahoo Finance': 2, "Investor's Business Daily": 2, 'Reuters': 1, ...}
^VIX  Search.news: 10 {'Barrons.com': 3, 'Bloomberg': 1, "Investor's Business Daily": 1, ...}
XLF   Search.news: 10 {'MT Newswires': 9, ...}
```

The 2026-10-01 fallback only runs when `Ticker.news` returns `[]`. It now raises instead, so the
exception escapes `fetch_news_for` before Search is ever tried. All 7 feeds land in `errors`, nothing
is stored, and the 2-day prune has emptied the table. Search still works and returns preferred
publishers. The paragraph on the page is the **last stored briefing**: `refresh_briefing` returns
early when there are no articles, so it is stale, not new.

## Files

Modify:
- `backend/app/news.py`: `fetch_news_for` only.
- `backend/tests/test_news.py`: add one test next to
  `test_fetch_news_for_uses_search_only_when_ticker_news_is_empty`.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

Replace the body of `fetch_news_for` with exactly this. Update the docstring as shown:

```python
def fetch_news_for(ticker: str) -> list[dict]:
    """Fetch one ticker's news, falling back to Search when Ticker.news is empty or raises.

    Yahoo's ncp endpoint began returning 404 on 2026-10-01 (Ticker.news came back empty); by
    2026-11-05 yfinance 1.7.0 raised YFDataException on it instead. Search items are adapted to the
    established shape so parsing and editorial filtering stay exactly the same. A Search failure
    still raises, so refresh_news_if_stale records the ticker in errors."""
    try:
        items = yf.Ticker(ticker).news
    except Exception:
        # Broad on purpose: whatever shape Yahoo's next breakage takes, Search is the remedy.
        logger.warning("app.news: Ticker(%s).news raised; falling back to Search", ticker, exc_info=True)
        items = None
    if isinstance(items, list) and items:
        return items
    return [raw for item in yf.Search(ticker, news_count=10).news if (raw := search_item_to_raw(item)) is not None]
```

New test, `test_fetch_news_for_uses_search_when_ticker_news_raises(monkeypatch)`, with two cases:

1. `yf.Ticker` returns an object whose `news` **property** raises `RuntimeError("down")`, and
   `yf.Search` is the same `Search` stub shape the neighbouring test uses, with
   `news = [{"uuid": "x", "title": "Search title"}]`. Assert
   `fetch_news_for("SPY") == [search_item_to_raw({"uuid": "x", "title": "Search title"})]`.
2. Same raising `Ticker`. `yf.Search`'s constructor raises `RuntimeError("search down")`. Assert
   `pytest.raises(RuntimeError, match="search down")`.

Use a `@property` for the raising `news`. A class attribute cannot raise on access, and the real
yfinance raises on property access.

## Out of scope

- Do not change `refresh_news_if_stale`, `parse_article`, `search_item_to_raw`,
  `PREFERRED_PUBLISHERS` or `MARKET_NEWS_TICKERS`.
- Do not remove the `Ticker.news` primary path.
- Do not change the yfinance version.
- Do not touch the briefing, `/ops` or any frontend file.

## Acceptance criteria

1. `cd backend && .venv/bin/python -m pytest -q tests/test_news.py` passes with **53** tests
   (52 before this contract plus 1).
2. `cd backend && .venv/bin/python -m pytest -q` passes, with nothing failing that passed before.
3. `grep -c "news raised; falling back to Search" backend/app/news.py` prints `1`. (Not a grep for
   `except Exception:`. The file already has two, so that grep would pass without this change.)
4. `grep -c "def test_fetch_news_for_uses_search_when_ticker_news_raises" backend/tests/test_news.py`
   prints `1`.
5. Planner-run: the live probe in Verification shows `fetch_news_for` returning items for `^GSPC`
   without raising. This depends on Yahoo. If Search itself is down at audit time, the planner
   re-runs it; it does not count against the coder.

If a criterion cannot be satisfied without breaking another, report `BLOCKED`. Do not find a clever
way to pass it.

## Verification to run and paste

```bash
cd backend && .venv/bin/python -m pytest -q tests/test_news.py
cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -3
grep -c "news raised; falling back to Search" backend/app/news.py
grep -c "def test_fetch_news_for_uses_search_when_ticker_news_raises" backend/tests/test_news.py
```

Planner only (live network):

```bash
cd backend && DATABASE_URL="" .venv/bin/python -c "from app.news import fetch_news_for; print(len(fetch_news_for('^GSPC')))"
```

## Human verification — does Gunnar need to run anything?

**Run it against the real service.** Tests mock yfinance, so only production proves the fix.

1. Commit and deploy. Then check that Render actually serves the new code, because a failed deploy
   leaves the old code live.
2. On `/ops`, force a refresh. The new `news_refresh` row should show **`stored` > 0** and no longer
   say `partial`. It may still say `partial` if one or two feeds fail outright, but `stored` must be
   non-zero.
3. Load `/`. Article cards should appear under the briefing, and the briefing should be regenerated
   from the new articles. If you want a fresh briefing immediately, the forced run already uses
   `force_briefing=True`.

## Open questions

None.
