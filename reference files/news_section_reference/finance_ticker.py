# --- Provenance -------------------------------------------------------------
# Copied verbatim from: main/pages/Home/home_modules/finance.py (TCM.io, 2026-09-15)
# Changed: nothing below this header.
#
# ONLY `_fetch_all_quotes()` (and, transitively, the `yfinance` import) is the
# part your note said to ignore/replace with your own PostgreSQL "universe"
# data. Every other function in this file — the HTML/CSS builders, the two
# render entry points — consumes the plain dict shape `_fetch_all_quotes()`
# returns and needs no changes. See ../README.md, "Ticker strip data shape",
# for exactly what shape to produce instead.
#
# Two entry points exist; only the second pair is actually wired into the app:
#   - render_finance_ticker()      : renders all 3 groups (index/tcm/gus) in
#                                     one call. DEAD CODE as of this snapshot —
#                                     nothing in the app calls it. Kept here
#                                     because it shows the "collapsed third
#                                     group" pattern, in case that's useful.
#   - render_indicators_strip() /
#     render_focused_strip()       : the two functions news_section.py
#                                     actually imports and calls, one strip
#                                     at a time.
# -----------------------------------------------------------------------------
"""Finance ticker strip for the home page — Yahoo Finance via yfinance."""

from datetime import datetime

import streamlit as st
import yfinance as yf

INDEX_TICKERS = ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX", "GC=F", "SI=F", "HG=F", "BTC-USD", "CL=F", "^TNX", "ZQ=F", "OZK"]
INDEX_DISPLAY = {
    "^GSPC":   "S&P 500",
    "^IXIC":   "NASDAQ",
    "^DJI":    "DJIA",
    "^RUT":    "Russell 2000",
    "^VIX":    "VIX",
    "GC=F":    "Gold",
    "SI=F":    "Silver",
    "HG=F":    "Copper",
    "BTC-USD": "Bitcoin",
    "CL=F":    "Crude",
    "NG=F":    "Natural Gas",
    "^TNX":    "10-Yr Treasury",
    "ZQ=F":    "Fed Funds Futures",
    "OZK":     "Bank OZK",
}

TCM_TICKERS = ["PLD", "CPT", "O", "KRG", "DHI", "APLE", "MU", "ORCL", "NVDA", "AMD", "DELL", "IBM", "SPCX"]
TCM_DISPLAY = {
    "PLD":  "Prologis",
    "CPT":  "Camden",
    "O":    "Realty Income",
    "APLE": "Apple Hospitality",
    "KRG":  "Kite Realty",
    "DHI":  "D.R. Horton",
    "MU":   "Micron",
    "ORCL": "Oracle",
    "NVDA": "Nvidia",
    "AMD":  "AMD",
    "DELL": "Dell Technologies",
    "IBM": "IBM",
    "SPCX": "Space X",
}

GUS_TICKERS = ["MU", "UEC", "XIACF", "SPYU"]
GUS_DISPLAY = {
    "MU":    "Micron",
    "UEC":   "Uranium Energy Corp.",
    "XIACF": "Xiaomi",
    "SPYU":  "4X Leveraged S&P 500",
}

_SCROLL_SECONDS = 50  # TDY row base speed; other rows scale from this


def _empty_group() -> dict:
    return {"today": [], "five_day": [], "thirty_day": [], "ytd": []}


def _compute_group(closes, tickers: list, display: dict) -> dict:
    today_list, five_day_list, thirty_day_list, ytd_list = [], [], [], []
    for sym in tickers:
        name = display.get(sym, sym)
        try:
            s = closes[sym].dropna()
            if len(s) < 2:
                continue
            price  = float(s.iloc[-1])
            prev   = float(s.iloc[-2])
            change = price - prev
            pct    = change / prev * 100
            today_list.append({"name": name, "price": price, "change": change, "pct": pct})
            if len(s) >= 6:
                base = float(s.iloc[-6])
                five_day_list.append({"name": name, "pct": (price - base) / base * 100})
            if len(s) >= 31:
                base = float(s.iloc[-31])
                thirty_day_list.append({"name": name, "pct": (price - base) / base * 100})
            ytd_list.append({"name": name, "pct": (price - float(s.iloc[0])) / float(s.iloc[0]) * 100})
        except Exception as e:
            continue
    return {"today": today_list, "five_day": five_day_list, "thirty_day": thirty_day_list, "ytd": ytd_list}


@st.cache_data(ttl=3600)
def _fetch_all_quotes() -> dict:
    """Single download across all groups; splits results per group."""
    all_tickers = list(dict.fromkeys(INDEX_TICKERS + TCM_TICKERS + GUS_TICKERS))
    start = f"{datetime.now().year}-01-01"
    empty = {"index": _empty_group(), "tcm": _empty_group(), "gus": _empty_group()}

    try:
        raw = yf.download(all_tickers, start=start, auto_adjust=True, progress=False)
    except Exception as e:
        return empty

    if raw.empty:
        return empty

    closes = raw["Close"]
    return {
        "index": _compute_group(closes, INDEX_TICKERS, INDEX_DISPLAY),
        "tcm":   _compute_group(closes, TCM_TICKERS,   TCM_DISPLAY),
        "gus":   _compute_group(closes, GUS_TICKERS,   GUS_DISPLAY),
    }


def _today_item_html(q: dict) -> str:
    color = "#5cb85c" if q["change"] >= 0 else "#c0504d"
    return (
        f"<span style='margin:0 28px;white-space:nowrap;'>"
        f"<span style='font-weight:600;color:#ccc;font-size:0.82rem;'>{q['name']}</span>"
        f"&nbsp;&nbsp;"
        f"<span style='color:#aaa;font-size:0.82rem;'>${q['price']:,.2f}</span>"
        f"&nbsp;&nbsp;"
        f"<span style='color:{color};font-size:0.82rem;'>{q['change']:+.2f} ({q['pct']:+.2f}%)</span>"
        f"</span>"
        f"<span style='color:#3a3a3a;'>▪</span>"
    )


def _return_item_html(q: dict) -> str:
    color = "#5cb85c" if q["pct"] >= 0 else "#c0504d"
    return (
        f"<span style='margin:0 28px;white-space:nowrap;'>"
        f"<span style='font-weight:600;color:#ccc;font-size:0.82rem;'>{q['name']}</span>"
        f"&nbsp;&nbsp;"
        f"<span style='color:{color};font-size:0.82rem;'>{q['pct']:+.2f}%</span>"
        f"</span>"
        f"<span style='color:#3a3a3a;'>▪</span>"
    )


def _row_html(label: str, items: list[dict], item_fn, anim: str, speed: int, first: bool = False, reverse: bool = False) -> str:
    if not items:
        return ""
    strip = "".join(item_fn(q) for q in items)
    sep = "" if first else "border-top:1px solid rgba(255,255,255,0.05);"
    direction = "reverse" if reverse else "normal"
    return (
        f"<div style='display:flex;align-items:center;padding:7px 0;{sep}'>"
        f"<div style='width:32px;font-size:0.65rem;color:#555;flex-shrink:0;"
        f"text-align:left;padding-right:6px;line-height:1.2;letter-spacing:0.04em;'>{label}</div>"
        f"<div style='overflow:hidden;flex:1;'>"
        f"<div style='display:flex;width:max-content;animation:{anim} {speed}s linear infinite {direction};'>"
        f"{strip}{strip}"
        f"</div></div></div>"
    )


def _group_strip_html(data: dict, prefix: str) -> str:
    s = _SCROLL_SECONDS
    return (
        _row_html("TDY", data["today"],      _today_item_html,  f"{prefix}-tdy", round(s * 1.0),  first=True)
        + _row_html("5D",  data["five_day"],   _return_item_html, f"{prefix}-5d",  round(s * 1.1),  reverse=True)
        + _row_html("30D", data["thirty_day"], _return_item_html, f"{prefix}-30d", round(s * 1.25))
        + _row_html("YTD", data["ytd"],        _return_item_html, f"{prefix}-ytd", round(s * 1.5),  reverse=True)
    )


_SECTIONS = [
    ("##### Indicators",            "index", "idx", True),
    ("##### Focused",            "tcm",   "tcm", True),
    ("##### ▯", "gus",   "gus", False),
]

_OUTER = "border-top:1px solid rgba(255,255,255,0.07);border-bottom:1px solid rgba(255,255,255,0.07);margin-bottom:4px;"


def render_finance_ticker() -> None:
    data = _fetch_all_quotes()
    if not any(data[key]["today"] for _, key, _, __ in _SECTIONS):
        return

    keyframes = " ".join(
        f"@keyframes {pfx}-{period}{{0%{{transform:translateX(0)}}100%{{transform:translateX(-50%)}}}}"
        for _, _, pfx, __ in _SECTIONS
        for period in ("tdy", "5d", "30d", "ytd")
    )
    st.markdown(f"<style>{keyframes}</style>", unsafe_allow_html=True)

    # st.markdown("##### Le Markets")
    for title, key, prefix, expanded in _SECTIONS:
        group = data[key]
        if not group["today"]:
            continue
        strip = f'<div style="{_OUTER}">{_group_strip_html(group, prefix)}</div>'
        if expanded:
            label = title.lstrip("#").strip()
            st.markdown(f"<div style='font-size:0.65rem;color:#888;margin-bottom:2px;letter-spacing:0.04em;'>{label}</div>", unsafe_allow_html=True)
            st.markdown(strip, unsafe_allow_html=True)
        else:
            label = title.lstrip("#").strip()
            st.markdown(
                f"<details style='margin:4px 0;'>"
                f"<summary style='color:#555;font-size:0.75rem;cursor:pointer;list-style:none;display:block;text-align:center;'>{label}</summary>"
                f"<div style='margin-top:4px;'>{strip}</div>"
                f"</details>",
                unsafe_allow_html=True,
            )


def _render_single_strip(key: str, prefix: str, label: str, margin_top: str | None = None) -> None:
    data = _fetch_all_quotes()
    group = data.get(key, _empty_group())
    if not group["today"]:
        return
    keyframes = " ".join(
        f"@keyframes {prefix}-{period}{{0%{{transform:translateX(0)}}100%{{transform:translateX(-50%)}}}}"
        for period in ("tdy", "5d", "30d", "ytd")
    )
    pull_css = marker = ""
    if margin_top:
        cls = f"strip-pull-{prefix}"
        pull_css = (
            f"div[data-testid='stElementContainer']:has(.{cls}),"
            f"div[data-testid='element-container']:has(.{cls})"
            f"{{margin-top:{margin_top}!important;}}"
        )
        marker = f"<div class='{cls}' style='display:none'></div>"
    st.markdown(
        f"<style>{keyframes}{pull_css}</style>"
        f"{marker}"
        f"<div style='font-size:0.65rem;color:#888;margin-bottom:2px;letter-spacing:0.04em;'>{label}</div>"
        f'<div style="{_OUTER}">{_group_strip_html(group, prefix)}</div>',
        unsafe_allow_html=True,
    )


def render_indicators_strip() -> None:
    _render_single_strip("index", "idx", "Indicators")


def render_focused_strip(margin_top: str | None = None) -> None:
    _render_single_strip("tcm", "tcm", "Focused", margin_top=margin_top)
