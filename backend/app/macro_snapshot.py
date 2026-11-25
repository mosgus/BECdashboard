"""The Macro page's snapshot, as plain data.

`econ_card`, `equity_card`, `quadrant_points` and `chart_payload` are the plain-data forms of what the
scorecard project's `render_econ_html`, `render_html`, `charts.quadrant_svg` and `charts._payload` drew,
after `hard_data/build_macro_scorecard.py` lifted them out of the HTML: every string is already in its
final form (no HTML escaping, `<br>` as a newline, non-breaking spaces as spaces, both ends stripped).
`build_snapshot` assembles them for both market groups.
"""

import datetime as dt

import numpy as np
import pandas as pd

from app import macro_econ
from app.macro_econ import GROUP_LABEL, GROUPS, LABEL, LEVEL_ROWS, ROWS, build_econ
from app.macro_equity import (
    COMPOSITE_BAND,
    FIXED_THRESHOLDS,
    SCORED,
    SHIFTS,
    breadth_history,
    build_metrics,
    earnings_breadth_history,
    load_estimates,
    quadrant_data,
    revisions_history,
    rollovers,
)
from app.macro_inputs import MARKETS, MacroInputs

ECON_RAW_FMT = {r: (lambda v: f"{v:.1f}") for r in LEVEL_ROWS}       # raw reading, tooltip only
ECON_RAW_FMT.update({r: (lambda v: f"{v:+.1f}%") for r in ROWS if r not in LEVEL_ROWS})
ECON_COLOR_CLASS = {"green": "g", "yellow": "y", "red": "r", None: "na"}

ECON_NOTE = ("LEI Average = weighted mean of Manufacturing PMI (40%), Services PMI (40%), "
             "Consumer Sentiment (10%) and Housing (10%), reweighted over the rows a country has; GDP, Retail "
             "Sales, Industrial Production and CPI are shown for reference and excluded from the average. Each "
             "cell is a percentile of that country’s own history since 2006 (2008-09 and 2020 excluded; 2021 "
             "also excluded for growth rows; PMI history is shorter, see tooltips). PMIs and Sentiment are levels, "
             "other rows YoY %; nominal retail sales are deflated by CPI; Housing, Retail and IP use a 3-month "
             "average. CPI is scored by distance from the central bank’s target (2%; Brazil 3%). "
             "* = stale: freshest published reading lags more than 4 months (quarterly: 6). "
             "Sources: Bloomberg, S&P Global.")


def group_subtitle(group: str) -> str:
    return " · ".join(MARKETS[k][0] for k in GROUPS[group])


def econ_cell_tooltip(row: str, d: dict) -> str:
    if d["missing"]:
        return f"n/a — {d['missing']}"
    if row == "LEI Average":
        w = ", ".join(f"{r} {v:.0%}" for r, v in d["weights"].items())
        return f"Weighted mean of the LEI rows' own-history percentiles — {w}. CEI rows shown for reference, not included"
    base = f"{ECON_RAW_FMT[row](d['value'])} — {d['pct']:.0%} percentile of own history since {d['hist_start']}"
    stale = f" — STALE: freshest published reading is {d['asof']}" if d["stale"] else f", as of {d['asof']}"
    note = f" | {d['note']}" if d["note"] else ""
    return f"{base}{stale} | {d['measure']}{note}"


def econ_card(econ: dict, group: str, asof: str) -> dict:
    keys = GROUPS[group]
    rows = []
    for row in ROWS + ["LEI Average"]:
        cells = []
        for key in keys:
            d = econ[key][row]
            stale = "*" if d["stale"] else ""
            text = "n/a" if d["color"] is None else f"{d['pct']:.2f}{stale}"
            cells.append({"color": ECON_COLOR_CLASS[d["color"]], "text": text, "tip": econ_cell_tooltip(row, d)})
        rows.append({"label": row, "composite": row == "LEI Average", "cells": cells})
    return {"title": f"{GROUP_LABEL[group]} Economic Scorecard",
            "subtitle": f"{group_subtitle(group)}  |  as of {asof}",
            "headers": [LABEL[k] for k in keys],
            "rows": rows,
            "note": ECON_NOTE}


# --------------------------------------------------------------------------- equity scorecard

COLS = ["Overall Composite", "Macro Score", "Price Momentum", "Price Breadth",
        "Earnings Revisions Momentum", "Earnings Breadth"]
HEADERS = ["Overall\nComposite", "Macro\nScore", "Price\nMomentum", "Price\nBreadth",
           "Earnings\nRevisions\nMomentum", "Earnings\nBreadth"]
FMT = {"Overall Composite": lambda v: f"{v:+.1f}", "Macro Score": lambda v: f"{v:.0%}",
       "Price Momentum": lambda v: f"{v:+.1%}", "Price Breadth": lambda v: f"{v:.0%}",
       "Earnings Revisions Momentum": lambda v: f"{v:+.1%}", "Earnings Breadth": lambda v: f"{v:+.0%}"}
GREEN, YELLOW, RED, NA = "g", "y", "r", "na"   # the cell classes the frontend colors by


def colors_for(df: pd.DataFrame) -> dict:
    """col -> {market key: color}. Metric colors come from their points; the composite from its average points."""
    by_pts = {1: GREEN, 0: YELLOW, -1: RED}
    out = {c: {k: NA if np.isnan(p) else by_pts[int(p)] for k, p in df[f"{c} pts"].items()} for c in SCORED}
    out["Overall Composite"] = {k: GREEN if v >= COMPOSITE_BAND - 1e-9 else RED if v <= -COMPOSITE_BAND + 1e-9 else YELLOW
                                for k, v in df["Overall Composite"].items()}
    return out


def row_order(df: pd.DataFrame) -> pd.Index:
    return df.sort_values(["Overall Composite", "Relative Rank Score"], ascending=False).index


def cell_tooltip(col: str, d: dict, row: pd.Series, thr: dict) -> str:
    """Sub-component breakdown shown when hovering a cell in the scorecard."""
    if col == "Overall Composite":
        p = row[[f"{m} pts" for m in SCORED]]
        na = f", {p.isna().sum()} n/a (reweighted)" if p.isna().any() else ""
        return (f"{(p == 1).sum()} green, {(p == 0).sum()} neutral, {(p == -1).sum()} red{na} "
                f"(weighted average points {row['Overall Composite']:+.1f}; Macro Score 40%, other 4 15% each)")
    m = d[col]
    if col == "Macro Score":
        parts = [f"{r}: n/a" if rd["missing"] else
                 f"{r}: {rd['color']} ({rd['pct']:.0%} pct, as of {rd['asof']}{' [stale]' if rd['stale'] else ''})"
                 for r, rd in m["rows"].items()]
        base = "LEI Average (from Economic Scorecard) — " + " | ".join(parts)
    elif col == "Price Momentum":
        base = f"3M {m['ret_3M']:+.1%} | 6M {m['ret_6M']:+.1%} | 12M {m['ret_12M']:+.1%} (implied index price)"
    elif col == "Price Breadth":
        if not m["n_used"]:
            return f"n/a — no constituent prices available (0/{m['n_total']} priced)"
        base = f"Above 200d MA {m['pct_above_200d']:.0%} | {m['n_used']}/{m['n_total']} constituents"
    elif col == "Earnings Revisions Momentum":
        base = (f"Fwd EPS CY1: 4w {m['eps_chg_4w_cy1']:+.1%}, 13w {m['eps_chg_13w_cy1']:+.1%} | "
                f"CY2: 4w {m['eps_chg_4w_cy2']:+.1%}, 13w {m['eps_chg_13w_cy2']:+.1%}")
    else:
        base = f"Net share of companies revised up minus down (4w avg): CY1 {m['net_cy1']:+.0%} | CY2 {m['net_cy2']:+.0%}"
    lo, hi = thr[col]
    basis = "" if col in FIXED_THRESHOLDS else " (group history)"
    return f"{base} | Green ≥ {FMT[col](hi)}, red ≤ {FMT[col](lo)}{basis}"


def thresholds_note() -> str:
    return ("Price Momentum, Earnings Revisions Momentum and Earnings Breadth are green in the top third and red in "
            "the bottom third of the combined weekly history of the group's markets since 2006. Price Breadth uses "
            "fixed bands (red ≤ 50%, green ≥ 60%); Macro Score is already an own-history percentile. Hover a cell "
            "for its values and cut-offs.")


def equity_card(df: pd.DataFrame, detail: dict, thr: dict, group: str, asof: str) -> dict:
    colors = colors_for(df)
    rows = []
    for key in row_order(df):
        cells = []
        for c in COLS:
            color = colors[c][key]
            cells.append({"color": color, "text": "n/a" if color == NA else "",
                          "tip": cell_tooltip(c, detail[key], df.loc[key], thr[key])})
        rows.append({"label": MARKETS[key][0], "composite": False, "cells": cells})
    return {"title": f"{GROUP_LABEL[group]} Equity Scorecard",
            "subtitle": f"{group_subtitle(group)}  |  as of {asof}",
            "headers": list(HEADERS),
            "rows": rows,
            "note": thresholds_note()}

# --------------------------------------------------------------------------- quadrant


def quadrant_points(points: list) -> list:
    """One entry per market with a macro and a market score now; the fields and rounding of the quadrant tooltip."""
    pts = [p for p in points if not (np.isnan(p["macro"]) or np.isnan(p["market"]["score"]))]
    num = lambda v: None if np.isnan(v) else round(float(v), 4)
    return [{"name": p["name"], "flag": FLAG_CODE[p["key"]], "macro": num(p["macro"]),
             "market": num(p["market"]["score"]),
             "prev": {h: {k: num(v) for k, v in pv.items()} for h, pv in p["prev"].items()},
             "pcts": {k: num(v) for k, v in p["market"]["pcts"].items()}} for p in pts]

# --------------------------------------------------------------------------- chart data

METRICS = [  # panel definitions
    dict(id="pe", key="Forward P/E", title="Forward P/E", decimals=1, suffix="x", rebase=False, baseline=None,
         monthly=False, signed=False,
         sub="Index price ÷ 12-month-forward EPS (blended CY1 / CY2)"),
    dict(id="eps", key="Forward EPS", title="Forward EPS (indexed)", decimals=1, suffix="", rebase=True, baseline=None,
         monthly=False, signed=False,
         sub="12-month-forward EPS, start of selected range = 100"),
    dict(id="pmi", key="PMI", title="Manufacturing PMI", decimals=1, suffix="", rebase=False, baseline=50,
         monthly=True, signed=False,
         sub="S&P Global, monthly. Above 50 = expansion, below 50 = contraction"),
    dict(id="rev", key="Earnings momentum", title="Earnings revisions momentum", decimals=1, suffix="%", rebase=False,
         baseline=0, monthly=False, signed=True,
         sub="Avg. % change in forward EPS over 4 and 13 weeks (CY1 and CY2)"),
    dict(id="pxbr", key="Price Breadth", title="Price Breadth", decimals=0, suffix="%", rebase=False, baseline=50,
         monthly=False, signed=False,
         sub="% of constituents trading above their 200-day moving average"),
    dict(id="ebr", key="Earnings Breadth", title="Earnings Breadth", decimals=0, suffix="%", rebase=False, baseline=0,
         monthly=False, signed=True,
         sub="Net % of companies with forward EPS revised up vs. down (4w avg, CY1/CY2)"),
]
FLAG_CODE = {"US": "us", "CA": "ca", "UK": "gb", "EZ": "eu", "DE": "de", "FR": "fr", "JP": "jp",
             "CN": "cn", "BR": "br", "KR": "kr", "TW": "tw"}


def fiscal_rollovers(cy1: pd.DataFrame, cy2: pd.DataFrame) -> list[pd.Timestamp]:
    """One CY1 -> next-fiscal-year rollover date per calendar year (the biggest flagged jump; early March if none)."""
    flagged = rollovers(cy1, cy2)
    jump = (cy1["EPS"] / cy1["EPS"].shift(1) - 1).abs()
    out = []
    for year in range(cy1.index[0].year + 1, cy1.index[-1].year + 1):
        in_year = flagged[(flagged.index.year == year) & (flagged == 1)]
        if len(in_year):
            out.append(jump[in_year.index].idxmax())
        else:  # not detected: assume the first observation on/after 1 March
            later = cy1.index[cy1.index >= pd.Timestamp(year, 3, 1)]
            if len(later):
                out.append(later[0])
    return out


def blended_forward(inputs: MacroInputs, key: str) -> pd.DataFrame:
    """12-month-forward EPS and P/E on one continuous series.

    CY1 is the fiscal year that ends next 31 Dec (it switches to the following year each March); CY2 is the year after.
    Blend the two by the time left in CY1's year, so the series has no jump when CY1 rolls.
    """
    cy1 = load_estimates(inputs, key, "CY1")
    cy2 = load_estimates(inputs, key, "CY2").reindex(cy1.index)
    rolls = pd.DatetimeIndex(fiscal_rollovers(cy1, cy2))
    last = np.searchsorted(rolls.values, cy1.index.values, side="right") - 1      # index of last rollover <= t
    fy = np.where(last >= 0, rolls.year.values[np.maximum(last, 0)], rolls.year.values[0] - 1)
    year_end = pd.to_datetime([f"{y}-12-31" for y in fy])
    w1 = pd.Series(np.clip((year_end - cy1.index).days / 365.25, 0, 1), index=cy1.index)
    eps = w1 * cy1["EPS"] + (1 - w1) * cy2["EPS"]
    price = cy1["EPS"] * cy1["PE (x)"]
    return pd.DataFrame({"fwd_eps": eps, "fwd_pe": price / eps, "price": price})


def chart_data(inputs: MacroInputs, prices: pd.DataFrame, group: str) -> dict:
    """metric key -> market label -> pd.Series of the plotted values (empty series are left out)."""
    data = {m["key"]: {} for m in METRICS}
    for key in GROUPS[group]:
        label = MARKETS[key][0]
        f = blended_forward(inputs, key)
        series = {"Forward P/E": f["fwd_pe"], "Forward EPS": f["fwd_eps"],
                  "PMI": macro_econ.pmi_series(inputs, key),
                  "Earnings momentum": revisions_history(inputs, key)["value"] * 100,
                  "Price Breadth": breadth_history(inputs, key, prices)["value"] * 100,
                  "Earnings Breadth": earnings_breadth_history(inputs, key)["value"] * 100}
        for metric, s in series.items():
            if not s.dropna().empty:
                data[metric][label] = s.dropna()
    return data


def _series_json(s: pd.Series, decimals: int = 4) -> dict:
    days = ((s.index - pd.Timestamp("1970-01-01")).days).tolist()
    return {"t": days, "v": [round(float(v), decimals) for v in s.values]}


def _regions(group: str) -> list:
    return [{"name": MARKETS[k][0], "cls": f"s{i + 1}"} for i, k in enumerate(GROUPS[group])]


def chart_payload(inputs: MacroInputs, prices: pd.DataFrame, group: str) -> dict:
    data = chart_data(inputs, prices, group)
    regions = _regions(group)
    metrics = [{**{k: v for k, v in m.items() if k != "key"},
                "series": {r["name"]: _series_json(data[m["key"]][r["name"]])
                           for r in regions if r["name"] in data[m["key"]]}} for m in METRICS]
    return {"regions": regions, "metrics": metrics}

# --------------------------------------------------------------------------- snapshot


def build_snapshot(inputs: MacroInputs, prices: pd.DataFrame, today: dt.date) -> dict:
    """Both groups' equity cards, quadrant points, econ cards and chart series, for the Macro page."""
    econ = build_econ(inputs, today)
    metrics = build_metrics(inputs, prices, econ)
    asof_ts = max(load_estimates(inputs, k, "CY1").index[-1] for k in MARKETS)
    asof = asof_ts.strftime("%d %b %Y")
    econ_asof = today.strftime("%d %b %Y")
    econ_prev = {h: build_econ(inputs, today, lag_months=months) for h, (months, _) in SHIFTS.items()}
    groups = []
    for group, (df, detail, thr) in metrics.items():
        quad = quadrant_data(inputs, group, prices, econ, econ_prev, asof_ts)
        groups.append({"key": group, "label": f"{GROUP_LABEL[group]}s",
                       "equity": equity_card(df, detail, thr, group, asof),
                       "quadrant": quadrant_points(quad),
                       "econ": econ_card(econ, group, econ_asof),
                       "charts": chart_payload(inputs, prices, group)})
    return {"groups": groups}
