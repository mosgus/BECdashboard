# --- Provenance -------------------------------------------------------------
# Copied verbatim from: main/pages/Home/home_modules/news.py (TCM.io, 2026-09-15)
# Changed: nothing below this header. Imports are left exactly as in the
# original — `from db import ...`, `from LLM.news_summarizer import ...`, and
# `from home_modules.finance import ...` will NOT resolve in this reference
# directory. See ../README.md for what each import needs to be replaced with.
#
# This is the main orchestrator: it renders the AI summary, both ticker
# strips (by calling into finance_ticker.py), the image-card slideshow, the
# text-only article list, and the "Feed inspector" debug expander — in that
# order, all from one function, render_news_section().
#
# Known issue, copied as-is rather than fixed (see README "Known rough
# edges"): _card_html() below does not html.escape() `url` or `image` before
# interpolating them into href="..."/src="..." attributes.
# -----------------------------------------------------------------------------
"""News feed section for the home page — Currents API with domain whitelist."""

import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime as _dt, timezone as _tz
from math import ceil
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import requests
import streamlit as st
from db import add_llm_output, get_latest_llm_output, init_llm_output_collection
from LLM.news_summarizer import summarize_news_articles
from home_modules.finance import render_indicators_strip, render_focused_strip

DOMAIN_WHITELIST = {
    "reuters.com",
    "apnews.com",
    "wsj.com",
    "bloomberg.com",
    "ft.com",
    "marketwatch.com",
    "investing.com",
    "abcnews.com",
    "cnbc.com",
    "forbes.com",
    "businessinsider.com",
    "economist.com",
    "nytimes.com",
    "washingtonpost.com",
    "politico.com",
    "axios.com",
    "thehill.com",
    "prnewswire.com",
    "thestreet.com",
    "nasdaq.com",
    "nationalreview.com",
    "npr.org",
    "texastribune.org",
    "financialpost.com",
    "benzinga.com",
    "winnipegfreepress.com",
    "forexfactory.com",
    "scmp.com",
    "nypost.com",
    "news.alphastreet.com",
    "breitbart.com",
    "seekingalpha.com",
    "pbs.org",
    "fortune.com",
    "bizjournals.com",
    "pressdemocrat.com",
    "statnews.com",
    "inc.com",
    "france24.com",
    "defector.com",
    "foxnews.com",
    "foreignpolicy.com",
    "nbcnews.com",
    "finance.yahoo.com",
    "investors.com",
    "realclearpolitics.com"
}

CARDS_PER_SLIDE = 3
_SUMMARY_TTL_HOURS = 2
_ENDPOINT = "https://api.currentsapi.services/v1/latest-news"
_YAHOO_RSS_URL = "https://finance.yahoo.com/rss/topstories"
_YAHOO_RSS_NS = {"media": "http://search.yahoo.com/mrss/"}
_YAHOO_MAX = 8
_BY_SOURCE_RE = re.compile(r"\s+By\s+\S+$")
_ET_TZ = ZoneInfo("America/New_York")


def _get_domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().removeprefix("www.")
    except Exception:
        return ""


def _has_valid_image(article: dict) -> bool:
    img = article.get("image", "None")
    if not img or img == "None":
        return False
    if img.count("https://") > 1 or img.count("http://") > 1:
        return False
    return True


def _is_whitelisted(article: dict) -> bool:
    return _get_domain(article.get("url", "")) in DOMAIN_WHITELIST


def _clean_title(title: str) -> str:
    """Strip 'By Source' suffixes Currents appends to some titles."""
    return _BY_SOURCE_RE.sub("", title).strip()


def _parse_yahoo_rss(content: bytes) -> list[dict]:
    """Parse Yahoo Finance RSS bytes into Currents-shaped article dicts."""
    try:
        root = ET.fromstring(content)
        channel = root.find("channel")
        if channel is None:
            return []
        articles = []
        for item in channel.findall("item")[:_YAHOO_MAX]:
            title = (item.findtext("title") or "").strip()
            url = (item.findtext("link") or "").strip()
            pub = (item.findtext("pubDate") or "").strip()
            media = item.find("media:content", _YAHOO_RSS_NS)
            if media is not None:
                image = media.get("url", "")
            else:
                enc = item.find("enclosure")
                image = enc.get("url", "") if enc is not None and "image" in enc.get("type", "") else ""
            if title and url:
                articles.append({"title": title, "url": url, "image": image, "published": pub})
        return articles
    except Exception:
        return []


@st.cache_data(ttl=3600)
def _fetch_raw_news() -> tuple[list, str | None]:
    """Returns (articles, error_msg). error_msg is None on success."""
    try:
        api_key = st.secrets["CURRENTS_KEY"]
    except Exception:
        try:
            with open("keys/currents_key.txt") as f:
                api_key = f.read().strip()
        except Exception:
            return [], "Currents API key not found in secrets or keys/currents_key.txt."

    try:
        resp = requests.get(
            _ENDPOINT,
            params={"apiKey": api_key, "language": "en", "country": "US", "category": "business,finance,politics", "domain_not": "prnewswire.com"},
            timeout=8,
        )
        resp.raise_for_status()
        currents_articles = resp.json().get("news", [])
    except requests.HTTPError as e:
        return [], f"Currents API error {e.response.status_code}: {e}"
    except Exception as e:
        return [], f"News fetch failed: {e}"

    try:
        yahoo_resp = requests.get(
            _YAHOO_RSS_URL,
            headers={"User-Agent": "Mozilla/5.0 (compatible; TCMio/1.0)"},
            timeout=8,
        )
        yahoo_resp.raise_for_status()
        yahoo_articles = _parse_yahoo_rss(yahoo_resp.content)
    except Exception:
        yahoo_articles = []

    return currents_articles + yahoo_articles, None


def _get_news_summary() -> tuple[str, str | None]:
    """Return (summary, generated_utc_iso): MongoDB if fresh, otherwise generate and persist.

    Previous summary is always passed to Gemini as context so the briefing
    grows through the day (same-day) or opens with a yesterday comparison (new day).
    If regeneration fails, falls back to the stale stored summary with its
    original timestamp — an old "Generated" time in the caption signals the outage.
    """
    stored = get_latest_llm_output("news_summary")
    prev_content   = None
    prev_timestamp = None

    if stored and stored.get("content"):
        try:
            age_secs = (_dt.utcnow() - _dt.fromisoformat(stored["timestamp"])).total_seconds()
        except Exception as e:
            age_secs = float("inf")  # malformed timestamp — treat as stale
        if age_secs < _SUMMARY_TTL_HOURS * 3600:
            return stored["content"], stored.get("timestamp")
        prev_content   = stored["content"]
        prev_timestamp = stored["timestamp"]

    articles, err = _fetch_raw_news()
    if err or not articles:
        return prev_content or "", prev_timestamp
    whitelisted = [a for a in articles if _is_whitelisted(a)]
    if not whitelisted:
        return prev_content or "", prev_timestamp
    summary = summarize_news_articles(
        whitelisted,
        previous_summary=prev_content,
        previous_timestamp=prev_timestamp,
    )
    if summary:
        add_llm_output(output_type="news_summary", content=summary, page="home")
        return summary, _dt.utcnow().isoformat()
    return prev_content or "", prev_timestamp


def _card_html(article: dict) -> str:
    url = article["url"]
    title = _clean_title(article["title"]).replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
    image = article.get("image", "")
    domain = _get_domain(url)

    return f"""
<a href="{url}" target="_blank" style="text-decoration:none;color:inherit;display:block;height:100%;">
  <div style="
    border-radius:10px;overflow:hidden;
    background:rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.1);
    height:100%;display:flex;flex-direction:column;
  ">
    <img src="{image}" style="width:100%;height:160px;object-fit:cover;display:block;">
    <div style="padding:10px 12px;flex:1;display:flex;flex-direction:column;gap:4px;">
      <div style="font-size:0.7rem;color:#888;font-weight:500;">{domain}</div>
      <div style="font-size:0.85rem;font-weight:600;line-height:1.35;">{title}</div>
    </div>
  </div>
</a>"""


def render_news_section() -> None:
    # Home is the producer of news summaries, so it owns initialization of the
    # retention metadata and removal of the old TTL index.
    init_llm_output_collection()
    all_articles, err = _fetch_raw_news()

    if err:
        st.markdown("#### ❌ ") # was "Fuck you" 😔
        st.warning(f"News unavailable: {err}")
        return

    whitelisted = [a for a in all_articles if _is_whitelisted(a)]

    if whitelisted:
        with_image    = [a for a in whitelisted if _has_valid_image(a)]
        without_image = [a for a in whitelisted if not _has_valid_image(a)]

        st.markdown("#### News")

        summary, generated_ts = _get_news_summary()
        if summary:
            ts_label = ""
            if generated_ts:
                try:
                    ts_local = _dt.fromisoformat(generated_ts).replace(tzinfo=_tz.utc).astimezone(_ET_TZ)
                    ts_label = f" - Generated {ts_local.strftime('%b %d, %I:%M %p %Z')}"
                except Exception:
                    ts_label = f" - Generated {generated_ts}"
            st.markdown(
                f"<div style='font-size:0.75rem;color:#888;margin-bottom:2px;'>✦ AI Briefing - Refreshes bi-hourly{html.escape(ts_label)}</div>"
                f"<div style='font-size:1.05rem;line-height:1.5;margin-bottom:10px;'>{html.escape(summary)}</div>",
                unsafe_allow_html=True,
            )



        render_indicators_strip()

        # --- Image card slideshow ---
        if with_image:
            total_slides = ceil(len(with_image) / CARDS_PER_SLIDE)

            if "news_slide" not in st.session_state:
                st.session_state.news_slide = 0

            # Clamp in case the cached article count shrinks between reruns
            st.session_state.news_slide = min(st.session_state.news_slide, total_slides - 1)
            slide = st.session_state.news_slide

            cards = with_image[slide * CARDS_PER_SLIDE : (slide + 1) * CARDS_PER_SLIDE]
            cards_html = "".join(f'<div style="min-width:0;">{_card_html(a)}</div>' for a in cards)
            cards_html += "<div></div>" * (CARDS_PER_SLIDE - len(cards))

            st.markdown(
                f'<div style="display:grid;grid-template-columns:repeat({CARDS_PER_SLIDE},1fr);gap:12px;">'
                f"{cards_html}</div>",
                unsafe_allow_html=True,
            )

            st.markdown(
                "<style>"
                "div:has(.news-nav-ghost) + div button{"
                "background:transparent!important;border:none!important;"
                "box-shadow:none!important;color:#999!important;"
                "font-size:0.85rem!important;"
                "}"
                "div:has(.news-nav-ghost) + div button:hover{"
                "color:#ccc!important;background:transparent!important;"
                "}"
                "div:has(.news-nav-ghost) + div button:disabled{"
                "color:#444!important;background:transparent!important;"
                "}"
                "div[data-testid='stElementContainer']:has(.news-nav-ghost),"
                "div[data-testid='element-container']:has(.news-nav-ghost)"
                "{margin-top:-1rem!important;}"
                "</style>"
                "<div class='news-nav-ghost' style='display:none'></div>",
                unsafe_allow_html=True,
            )

            prev_col, mid_col, next_col = st.columns([1, 3, 1])
            if prev_col.button("← Prev", width="stretch", disabled=slide == 0, key="news_prev"):
                st.session_state.news_slide -= 1
                st.rerun()
            mid_col.markdown(
                f"<div style='text-align:center;padding-top:0.35rem;font-size:0.85rem;color:#888;'>"
                f"{slide + 1} / {total_slides}</div>",
                unsafe_allow_html=True,
            )
            if next_col.button("Next →", width="stretch", disabled=slide >= total_slides - 1, key="news_next"):
                st.session_state.news_slide += 1
                st.rerun()

        render_focused_strip(margin_top="-1.5rem")

        # --- Text-only rows ---
        if without_image:
            def _row_html(a: dict) -> str:
                title  = html.escape(_clean_title(a["title"]))
                domain = html.escape(_get_domain(a["url"]))
                return (
                    f"<div><a href='{a['url']}' target='_blank'>{title}</a>"
                    f" · <em style='color:#888;'>{domain}</em></div>"
                )

            visible_html = "".join(_row_html(a) for a in without_image[:4])
            overflow     = without_image[4:]

            if overflow:
                overflow_html = "".join(_row_html(a) for a in overflow)
                st.markdown(
                    "<style>"
                    "details.news-more>summary{list-style:none;color:#666;font-size:0.82rem;"
                    "cursor:pointer;padding:2px 0;user-select:none;}"
                    "details.news-more>summary::-webkit-details-marker{display:none;}"
                    "details.news-more>summary:hover{color:#aaa;}"
                    "</style>"
                    f"<div style='height:4px'></div>"
                    f"{visible_html}"
                    f"<details class='news-more'>"
                    f"<summary>... {len(overflow)} more</summary>"
                    f"<div style='margin-top:4px;'>{overflow_html}</div>"
                    f"</details>",
                    unsafe_allow_html=True,
                )
            else:
                st.markdown(
                    f"<div style='height:4px'></div>{visible_html}",
                    unsafe_allow_html=True,
                )

    # --- Feed inspector ---
    if all_articles:
        shown = len(whitelisted)
        filtered = len(all_articles) - shown
        def _inspector_row(a: dict) -> str:
            domain = _get_domain(a.get("url", ""))
            passed = domain in DOMAIN_WHITELIST
            accent = "#5cb85c" if passed else "#c0504d"
            marker = "✓" if passed else "✗"
            title  = html.escape(_clean_title(a.get("title", "")))
            return (
                f"<div style='margin:2px 0;'>"
                f"<span style='color:{accent};'>{marker} "
                f"<code style='background:none;color:{accent};'>{html.escape(domain)}</code></span>"
                f"<span style='color:#999;'> — {title}</span>"
                f"</div>"
            )

        rows_html = "\n".join(_inspector_row(a) for a in all_articles)
        st.markdown(
            f"<details style='margin-top:8px;'>"
            f"<summary style='color:#888;font-size:0.75rem;cursor:pointer;list-style:none;'>"
            f"Feed inspector — {shown} shown, {filtered} filtered ({len(all_articles)} total)"
            f"</summary>"
            f"<div style='font-size:1.0rem;margin-top:6px;line-height:1.7;'>{rows_html}</div>"
            f"</details>",
            unsafe_allow_html=True,
        )
