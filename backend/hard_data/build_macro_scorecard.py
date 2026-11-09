"""Builds hard_data/macro_scorecard.json from the scorecard project's built scorecard.html.

Stopgap storage for the Macro tab (2026-11-09). The scorecard project (Python, pandas, FactSet /
Bloomberg / S&P Global exports, Yahoo constituent prices) still does all of the computation; this
script only lifts its finished output out of the self-contained HTML page into JSON that the
frontend renders natively. Nothing here recomputes a score.

To refresh after a new data drop:

    cd "<scorecard project>" && python scorecard.py
    python backend/hard_data/build_macro_scorecard.py "<scorecard project>/scorecard.html"

The page's markup is generated deterministically by scorecard.py / charts.py, so the patterns below
match it exactly. If the generator changes shape, this raises rather than writing a partial file.
"""

import json
import re
import sys
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

OUT_PATH = Path(__file__).resolve().parent / "macro_scorecard.json"

# Quadrant flags (frontend/public/flags/<code>.svg), keyed by the market label the page uses.
FLAG_CODE = {"U.S.": "us", "Canada": "ca", "U.K.": "gb", "Eurozone": "eu", "Germany": "de", "France": "fr",
             "Japan": "jp", "China": "cn", "Brazil": "br", "South Korea": "kr", "Taiwan": "tw"}

_PANEL = re.compile(r'<div data-panel="(equity|econ)" data-panel-group="(\w+)"')
_GROUP_BUTTON = re.compile(r'<button data-group="(\w+)"[^>]*>([^<]+)</button>')
_TITLE = re.compile(r'<div class="ttl"><h2>(.*?)</h2><div class="sub">(.*?)</div>')
_GRID_ITEM = re.compile(r'<div class="(hd|lb(?: cp)?|c [^"]*)"(?: title="([^"]*)")?>(.*?)</div>')
_FOOT = re.compile(r'<div class="foot">(.*?)</div>')
_QUAD_POINT = re.compile(r'<g class="qpt" tabindex="0" data-tip="([^"]*)"')
_CHART_DATA = "const CHART_DATA = "


def _text(fragment: str) -> str:
    return unescape(fragment.replace("<br>", "\n")).replace("\xa0", " ").strip()


def _one(pattern: re.Pattern, html: str, what: str) -> re.Match:
    match = pattern.search(html)
    if not match:
        raise ValueError(f"scorecard.html: {what} not found")
    return match


def _grid(panel: str) -> dict:
    """The colored grid of one scorecard: header labels, then one row per label with its cells."""
    start = panel.index('<div class="scroll">')
    end = panel.index('<div class="lg">', start)
    headers, rows = [], []
    for kind, title, body in _GRID_ITEM.findall(panel[start:end]):
        if kind == "hd":
            headers.append(_text(body))
        elif kind.startswith("lb"):
            rows.append({"label": _text(body), "composite": kind.endswith("cp"), "cells": []})
        else:
            classes = kind.split()[1:]
            color = next(c for c in classes if c in ("g", "y", "r", "na"))
            rows[-1]["cells"].append({"color": color, "text": _text(body), "tip": unescape(title)})
    for row in rows:
        if len(row["cells"]) != len(headers):
            raise ValueError(f"scorecard.html: row {row['label']!r} has {len(row['cells'])} cells, "
                             f"expected {len(headers)}")
    return {"headers": headers, "rows": rows}


def _scorecard(panel: str) -> dict:
    title, sub = _one(_TITLE, panel, "scorecard title").groups()
    return {"title": _text(title), "subtitle": _text(sub), **_grid(panel),
            "note": _text(_one(_FOOT, panel, "scorecard footnote").group(1))}


def _quadrant(panel: str) -> list:
    points = []
    for raw in _QUAD_POINT.findall(panel):
        tip = json.loads(unescape(raw))
        points.append({"name": tip["name"], "flag": FLAG_CODE[tip["name"]], "macro": tip["macro"],
                       "market": tip["market"], "prev": tip["prev"], "pcts": tip["pcts"]})
    if not points:
        raise ValueError("scorecard.html: no quadrant points found")
    return points


def _chart_data(html: str) -> dict:
    start = html.index(_CHART_DATA) + len(_CHART_DATA)
    data, _ = json.JSONDecoder().raw_decode(html, start)
    return data


def build(html: str) -> dict:
    labels = dict(_GROUP_BUTTON.findall(html))
    marks = list(_PANEL.finditer(html))
    panels = {(m.group(1), m.group(2)): html[m.end():(marks[i + 1].start() if i + 1 < len(marks) else len(html))]
              for i, m in enumerate(marks)}
    charts = _chart_data(html)
    groups = []
    for key, label in labels.items():
        equity = panels[("equity", key)]
        groups.append({"key": key, "label": label, "equity": _scorecard(equity), "quadrant": _quadrant(equity),
                       "econ": _scorecard(panels[("econ", key)]), "charts": charts[key]})
    return {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "groups": groups}


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python build_macro_scorecard.py <path to scorecard.html>")
    snapshot = build(Path(sys.argv[1]).read_text(encoding="utf-8"))
    OUT_PATH.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes): "
          + ", ".join(f"{g['key']} {len(g['equity']['rows'])} markets" for g in snapshot["groups"]))


if __name__ == "__main__":
    main()
