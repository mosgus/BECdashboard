# --- Provenance -------------------------------------------------------------
# Copied verbatim from: test/yahoo_rss_test.py (TCM.io, 2026-09-15)
# Changed: nothing below this header. No path-resolution assumptions here
# (unlike currents_news_test.py in this same directory) — this script only
# hits a public URL and needs no local key file, so it runs unmodified from
# wherever you put it.
# -----------------------------------------------------------------------------
"""
Quick test: fetch Yahoo Finance RSS feed and print top stories.
Shows all available fields so we can compare against Currents article shape.

Run: python yahoo_rss_test.py
No API key needed. Uses only stdlib + requests (already in requirements).

NOTE: Yahoo Finance RSS does NOT include article description/body text --
the <description> element is empty server-side. Title, URL, pubDate, and
image (via media:content from zenfs CDN) are reliably populated. Author is
not present in the feed either. So field parity with Currents is: title,
url, published, image -- same four fields Currents gives us.

Yahoo Finance RSS feeds:
  Top stories : https://finance.yahoo.com/rss/topstories
  Investing   : https://finance.yahoo.com/rss/investing
"""

import sys
import xml.etree.ElementTree as ET
import requests

# Force UTF-8 output on Windows terminal
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FEED_URL = "https://finance.yahoo.com/rss/topstories"
MAX_SHOW = 5

_NS = {
    "media": "http://search.yahoo.com/mrss/",
    "dc":    "http://purl.org/dc/elements/1.1/",
}

def _text(item, tag, ns=None):
    el = item.find(tag) if ns is None else item.find(tag, ns)
    return (el.text or "").strip() if el is not None else ""

def _media_url(item):
    el = item.find("media:content", _NS)
    if el is not None:
        return el.get("url", "")
    enc = item.find("enclosure")
    if enc is not None and "image" in enc.get("type", ""):
        return enc.get("url", "")
    return ""

def _fetch_feed(url):
    headers = {"User-Agent": "Mozilla/5.0 (compatible; TCMio-test/1.0)"}
    resp = requests.get(url, headers=headers, timeout=10)
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    channel = root.find("channel")
    if channel is None:
        raise ValueError("No <channel> element found -- unexpected feed format.")

    articles = []
    for item in channel.findall("item"):
        articles.append({
            "title":       _text(item, "title"),
            "url":         _text(item, "link"),
            "description": _text(item, "description"),
            "published":   _text(item, "pubDate"),
            "author":      _text(item, "dc:creator", _NS) or _text(item, "author"),
            "image":       _media_url(item),
        })
    return articles

# ---------------------------------------------------------------------------

print(f"\nFetching: {FEED_URL}")
try:
    articles = _fetch_feed(FEED_URL)
except Exception as e:
    print(f"ERROR: {e}")
    raise SystemExit(1)

print(f"Total items in feed: {len(articles)}")
print(f"Showing first {min(MAX_SHOW, len(articles))}:\n")

for i, a in enumerate(articles[:MAX_SHOW], 1):
    print("=" * 65)
    print(f"[{i}] {a['title']}")
    print(f"    url        : {a['url']}")
    print(f"    published  : {a['published']}")
    print(f"    author     : {a['author'] or '(none)'}")
    print(f"    image      : {a['image'][:80] if a['image'] else '(none)'}")
    print(f"    description: {a['description'][:160] if a['description'] else '(none -- YF strips this)'}")

# --- field comparison vs Currents shape ------------------------------------
print(f"\n{'='*65}")
print("Field map vs Currents article shape:")
print("  Currents field  | RSS equivalent           | Available?")
print("  ----------------|--------------------------|------------")
print("  title           | <title>                  | yes")
print("  url             | <link>                   | yes")
print("  image           | media:content[@url]      | yes (zenfs CDN)")
print("  published       | <pubDate>                | yes")
print("  author          | dc:creator               | no (YF omits)")
print("  description     | <description>            | no (YF strips)")
print()
print("Bottom line: RSS gives same 4 fields as Currents (title, url, image,")
print("published). No description bonus from YF -- that field is server-side")
print("stripped. Supplementing Currents with YF RSS adds Yahoo Finance source")
print("coverage, not richer per-article data.")
