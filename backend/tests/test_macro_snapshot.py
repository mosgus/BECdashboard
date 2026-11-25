import json
from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.macro_equity import load_constituents, market_score, points
from app.macro_inputs import MARKETS, SLOTS, parse_inputs, template_workbook
from app.macro_snapshot import FLAG_CODE, build_snapshot, colors_for, quadrant_points

TODAY = date(2026, 11, 9)
EMPTY_PRICES = pd.DataFrame(index=pd.DatetimeIndex([]))


@pytest.fixture(scope="module")
def inputs():
    return parse_inputs({slot.id: template_workbook(slot.id) for slot in SLOTS})


@pytest.fixture(scope="module")
def prices(inputs):
    symbols = sorted({t for key in MARKETS for t in load_constituents(inputs, key)})
    days = pd.bdate_range("2025-05-01", "2026-10-30")
    steps = np.random.default_rng(7).normal(0.0003, 0.01, (len(days), len(symbols)))
    return pd.DataFrame(100 * np.exp(np.cumsum(steps, axis=0)), index=days, columns=symbols)


@pytest.fixture(scope="module")
def snapshot(inputs, prices):
    return build_snapshot(inputs, prices, TODAY)


def test_snapshot_has_both_groups(snapshot):
    assert [g["key"] for g in snapshot["groups"]] == ["DM", "EM"]
    assert [g["label"] for g in snapshot["groups"]] == ["Developed Markets", "Emerging Markets"]
    assert [sorted(g) for g in snapshot["groups"]] == [["charts", "econ", "equity", "key", "label", "quadrant"]] * 2


def test_equity_cards(snapshot):
    for group, markets in zip(snapshot["groups"], (7, 4)):
        card = group["equity"]
        assert card["headers"] == ["Overall\nComposite", "Macro\nScore", "Price\nMomentum", "Price\nBreadth",
                                   "Earnings\nRevisions\nMomentum", "Earnings\nBreadth"]
        assert len(card["rows"]) == markets
        assert all(len(row["cells"]) == 6 for row in card["rows"])
        assert all(row["composite"] is False for row in card["rows"])
        assert all(cell["color"] in {"g", "y", "r", "na"} for row in card["rows"] for cell in row["cells"])
        assert card["subtitle"].endswith("|  as of 30 Oct 2026")
    assert snapshot["groups"][0]["equity"]["title"] == "Developed Market Equity Scorecard"
    assert snapshot["groups"][1]["econ"]["subtitle"].endswith("|  as of 09 Nov 2026")


def test_templates_with_prices_have_breadth_cells(snapshot):
    breadth = [row["cells"][3] for group in snapshot["groups"] for row in group["equity"]["rows"]]

    assert all(cell["color"] != "na" for cell in breadth)
    assert all(cell["tip"].startswith("Above 200d MA ") for cell in breadth)


def test_charts(snapshot):
    for group, markets in zip(snapshot["groups"], (7, 4)):
        charts = group["charts"]
        assert len(charts["regions"]) == markets
        assert [m["id"] for m in charts["metrics"]] == ["pe", "eps", "pmi", "rev", "pxbr", "ebr"]
        assert all("key" not in m for m in charts["metrics"])
        assert all(m["series"] for m in charts["metrics"])
    series = snapshot["groups"][0]["charts"]["metrics"][0]["series"]["U.S."]
    assert len(series["t"]) == len(series["v"]) and isinstance(series["t"][0], int)


def test_quadrant_flags(snapshot):
    quadrant = [p for group in snapshot["groups"] for p in group["quadrant"]]

    assert len(quadrant) == 11
    assert {p["flag"] for p in quadrant} <= set(FLAG_CODE.values())
    assert {p["flag"] for p in quadrant} == set(FLAG_CODE.values())
    assert all(set(p["prev"]) == {"1M", "3M"} for p in quadrant)


def test_snapshot_is_json_serialisable(snapshot):
    text = json.dumps(snapshot, allow_nan=False)

    assert json.loads(text) == snapshot


def test_no_prices_yet(inputs):
    result = build_snapshot(inputs, EMPTY_PRICES, TODAY)

    for group in result["groups"]:
        for row in group["equity"]["rows"]:
            breadth = row["cells"][3]
            assert breadth["color"] == "na"
            assert breadth["text"] == "n/a"
            assert breadth["tip"].startswith("n/a — no constituent prices available (0/")
        pxbr = next(m for m in group["charts"]["metrics"] if m["id"] == "pxbr")
        assert pxbr["series"] == {}
        assert all("Price Breadth" not in p["pcts"] for p in group["quadrant"])
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("value, expected", [
    (0.8, 1),  # exactly hi
    (0.9, 1),
    (0.2, -1),  # exactly lo
    (0.1, -1),
    (0.5, 0),
    (0.2000001, 0),
    (0.7999999, 0),
])
def test_points(value, expected):
    assert points(value, 0.2, 0.8) == expected


def test_points_of_nan_is_nan():
    assert np.isnan(points(float("nan"), 0.2, 0.8))


def _history():
    idx = pd.to_datetime(["2026-01-02", "2026-01-09", "2026-01-16"])
    hist = {"Price Momentum": {"A": pd.Series([0.1, 0.2, 0.3], index=idx),
                               "B": pd.Series([0.0, 0.4, 0.5], index=idx)}}
    breadth = pd.Series([0.40, 0.55], index=idx[:2])
    return idx, hist, breadth


def test_market_score_averages_momentum_percentile_and_mapped_breadth():
    idx, hist, breadth = _history()

    result = market_score("A", hist, breadth, idx[2])

    # momentum: 4 of the 6 pooled values are <= A's latest 0.3. breadth 0.55 is halfway through the
    # 50%-60% band, which maps halfway between 1/3 and 2/3.
    assert result["pcts"] == pytest.approx({"Price Momentum": 4 / 6, "Price Breadth": 0.5})
    assert list(result["pcts"]) == ["Price Momentum", "Price Breadth"]
    assert result["score"] == pytest.approx(7 / 12)


def test_market_score_only_uses_data_up_to_t():
    idx, hist, breadth = _history()

    result = market_score("A", hist, breadth, idx[0])

    # only the first week counts: both pooled values are <= A's 0.1, and breadth 0.40 maps to 0.4 / 0.5 * 1/3
    assert result["pcts"] == pytest.approx({"Price Momentum": 1.0, "Price Breadth": 0.8 / 3})
    assert result["score"] == pytest.approx((1.0 + 0.8 / 3) / 2)


def test_market_score_before_any_data_is_nan():
    idx, hist, breadth = _history()

    result = market_score("A", hist, breadth, pd.Timestamp("2025-12-31"))

    assert np.isnan(result["score"])
    assert result["pcts"] == {}


def test_composite_colors_at_the_band_edges():
    df = pd.DataFrame({
        "Macro Score pts": [1, 0, -1, np.nan], "Price Momentum pts": [1, 0, -1, 1],
        "Price Breadth pts": [1, 0, -1, 1], "Earnings Revisions Momentum pts": [1, 0, -1, 1],
        "Earnings Breadth pts": [1, 0, -1, 1],
        "Overall Composite": [0.4, 0.39, -0.4, -0.39],
    }, index=["A", "B", "C", "D"])

    colors = colors_for(df)

    assert colors["Overall Composite"] == {"A": "g", "B": "y", "C": "r", "D": "y"}
    assert colors["Macro Score"] == {"A": "g", "B": "y", "C": "r", "D": "na"}


def test_quadrant_points_filter_and_round():
    points_in = [
        {"key": "JP", "name": "Japan", "macro": 0.123456, "market": {"score": 0.5, "pcts": {"Price Momentum": 0.66666666}},
         "prev": {"1M": {"macro": 0.2, "market": float("nan")}}},
        {"key": "CN", "name": "China", "macro": float("nan"), "market": {"score": 0.5, "pcts": {}}, "prev": {}},
        {"key": "UK", "name": "U.K.", "macro": 0.5, "market": {"score": float("nan"), "pcts": {}}, "prev": {}},
    ]

    assert quadrant_points(points_in) == [
        {"name": "Japan", "flag": "jp", "macro": 0.1235, "market": 0.5,
         "prev": {"1M": {"macro": 0.2, "market": None}}, "pcts": {"Price Momentum": 0.6667}}]
