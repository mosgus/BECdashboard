# --- Provenance -------------------------------------------------------------
# Copied verbatim from: test/currents_news_test.py (TCM.io, 2026-09-15)
# Changed: nothing below this header, EXCEPT one thing you must fix yourself
# before running it — see below.
#
# ⚠️ PATH ASSUMPTION BREAKS ON RELOCATION. In the original repo this file
# lives at <repo root>/test/currents_news_test.py, so
# `Path(__file__).resolve().parent.parent` (two levels up) correctly lands on
# the repo root, where `keys/currents_key.txt` lives. Copied here into
# `news_section_reference/standalone_tests/`, that same expression now
# resolves to `news_section_reference/`, NOT your project's real root. Either:
#   (a) drop a `keys/currents_key.txt` under `news_section_reference/`, or
#   (b) edit PROJECT_ROOT below to point wherever your key file actually is.
# Left unfixed, this raises FileNotFoundError on the `open(API_KEY_FILE)` line.
#
# Also note: this file's DOMAIN_WHITELIST is a smaller, slightly different
# copy of the one in news_section.py (it has three accidental duplicate
# entries as set literals — politico.com, forexfactory.com, marketwatch.com —
# harmless since sets dedupe, but it confirms the two whitelist copies had
# already drifted apart in the source app before this bundle was made). Use
# news_section.py's DOMAIN_WHITELIST as the authoritative one going forward;
# this smaller copy is kept here only because it's what the original test
# script actually used.
# -----------------------------------------------------------------------------
"""
Quick test: hit Currents API, print unfiltered then whitelist-filtered results.
Run: python currents_news_test.py
"""

import json
from pathlib import Path
from urllib.parse import urlparse
import requests

# This script lives in test/, so repo root is two levels up.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
API_KEY_FILE = PROJECT_ROOT / "keys" / "currents_key.txt"
ENDPOINT = "https://api.currentsapi.services/v1/latest-news"

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
    "politico.com",
    "thestreet.com",
    "winnipegfreepress.com",
    "forexfactory.com",
    "nasdaq.com",
    "nationalreview.com",
    "forexfactory.com",
    "marketwatch.com",
    "npr.org",
    "texastribune.org",
    "financialpost.com",
}

def get_domain(url):
    try:
        host = urlparse(url).netloc.lower()
        # strip www.
        return host.removeprefix("www.")
    except Exception:
        return ""

def has_valid_image(article):
    img = article.get("image", "None")
    if not img or img == "None":
        return False
    # catch malformed doubled-domain URLs from the test run
    url = article.get("url", "")
    domain = get_domain(url)
    img_domain = get_domain(img)
    if img.count("https://") > 1:
        return False
    return True

def is_whitelisted(article):
    domain = get_domain(article.get("url", ""))
    return domain in DOMAIN_WHITELIST

with open(API_KEY_FILE) as f:
    api_key = f.read().strip()

params = {
    "apiKey": api_key,
    "language": "en",
    "category": "business, finance, politics",
}

resp = requests.get(ENDPOINT, params=params)
resp.raise_for_status()

data = resp.json()
articles = data.get("news", [])

# --- UNFILTERED ---
print(f"\n{'#'*60}")
print(f"UNFILTERED — {len(articles)} articles")
print('#'*60)

for i, article in enumerate(articles, 1):
    img = article.get("image", "None")
    domain = get_domain(article.get("url", ""))
    print(f"\n[{i:02d}] {domain}")
    print(f"     title : {article['title']}")
    print(f"     image : {img[:80] if img and img != 'None' else 'NONE'}")
    print(f"     author: {article.get('author', '')}")
    print(f"     URL: {article.get('url', '')}")

# --- FILTERED ---
filtered = [a for a in articles if is_whitelisted(a) and has_valid_image(a)]

print(f"\n\n{'#'*60}")
print(f"FILTERED (whitelisted domain + valid image) — {len(filtered)} articles")
print('#'*60)

if not filtered:
    print("\n  No articles passed the filter.")
else:
    for i, article in enumerate(filtered, 1):
        print(f"\n{'='*60}")
        print(f"Article {i}")
        print('='*60)
        print(json.dumps(article, indent=2))
