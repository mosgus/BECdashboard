from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.macro_econ import (
    COUNTRIES,
    GROUPS,
    MISSING,
    ROWS,
    build_econ,
    color_for,
    lei_average,
    months_behind,
)
from app.macro_inputs import SLOTS, parse_inputs, template_workbook
from app.macro_snapshot import econ_card, econ_cell_tooltip, group_subtitle

TODAY = date(2026, 11, 9)


@pytest.fixture(scope="module")
def inputs():
    return parse_inputs({slot.id: template_workbook(slot.id) for slot in SLOTS})


@pytest.fixture(scope="module")
def econ(inputs):
    return build_econ(inputs, TODAY)


def test_every_country_has_every_row_and_the_lei_average(econ):
    assert list(econ) == COUNTRIES
    assert len(COUNTRIES) == 11
    for key in COUNTRIES:
        assert list(econ[key]) == ROWS + ["LEI Average"]
        assert len(ROWS) == 8


def test_known_missing_series_are_blank_with_their_reason(econ):
    assert len(MISSING) == 5
    for (key, row), reason in MISSING.items():
        assert econ[key][row]["color"] is None
        assert econ[key][row]["missing"] == reason


def test_template_cells_are_scored(econ):
    scored = [d for key in COUNTRIES for row in ROWS if (key, row) not in MISSING
              for d in [econ[key][row]]]

    assert all(d["color"] in ("red", "yellow", "green") for d in scored)
    assert all(0 <= d["pct"] <= 1 for d in scored)
    assert all(d["missing"] is None for d in scored)
    assert all(econ[key]["LEI Average"]["color"] is not None for key in COUNTRIES)


def test_dm_card_shape(econ):
    card = econ_card(econ, "DM", "09 Nov 2026")

    assert card["title"] == "Developed Market Economic Scorecard"
    assert card["subtitle"] == "U.S. · Canada · U.K. · Eurozone · Germany · France · Japan  |  as of 09 Nov 2026"
    assert card["headers"] == ["U.S.", "Canada", "U.K.", "Eurozone", "Germany", "France", "Japan"]
    assert len(card["rows"]) == 9
    assert [row["composite"] for row in card["rows"]] == [False] * 8 + [True]
    assert card["rows"][-1]["label"] == "LEI Average"
    assert all(len(row["cells"]) == 7 for row in card["rows"])
    assert all(cell["color"] in {"g", "y", "r", "na"} for row in card["rows"] for cell in row["cells"])
    assert card["note"].startswith("LEI Average = weighted mean")
    assert card["note"].endswith("Sources: Bloomberg, S&P Global.")


def test_em_card_shape(econ):
    card = econ_card(econ, "EM", "09 Nov 2026")

    assert card["title"] == "Emerging Market Economic Scorecard"
    assert card["headers"] == ["China", "Brazil", "South Korea", "Taiwan"]
    assert len(card["rows"]) == 9
    assert all(len(row["cells"]) == 4 for row in card["rows"])


def test_missing_cells_render_as_na(econ):
    card = econ_card(econ, "DM", "09 Nov 2026")
    canada = GROUPS["DM"].index("CA")
    services = next(row for row in card["rows"] if row["label"] == "Services PMI")

    assert services["cells"][canada] == {
        "color": "na", "text": "n/a", "tip": "n/a — No S&P Global services PMI is published"}


def test_card_strings_are_final_text_not_html(econ):
    for group in GROUPS:
        card = econ_card(econ, group, "09 Nov 2026")
        strings = [card["title"], card["subtitle"], card["note"]]
        strings += [cell["tip"] for row in card["rows"] for cell in row["cells"]]
        assert not any("&amp;" in s or "&#x27;" in s or "<br>" in s for s in strings)
    japan_retail = econ_card(econ, "DM", "09 Nov 2026")["rows"][5]["cells"][-1]["tip"]
    assert japan_retail.endswith("| department stores & supermarkets only")


@pytest.mark.parametrize("pct, expected", [
    (0.0, "red"),
    (0.3333, "red"),
    (1 / 3, "yellow"),  # PCT_LOW is exclusive: exactly a third is yellow
    (0.5, "yellow"),
    (2 / 3, "yellow"),  # PCT_HIGH is exclusive: exactly two thirds is yellow
    (0.6667, "green"),
    (1.0, "green"),
    (float("nan"), None),
])
def test_color_for(pct, expected):
    assert color_for(pct) == expected


@pytest.mark.parametrize("ts, today, expected", [
    (pd.Timestamp("2026-07-31"), date(2026, 11, 9), 4),
    (pd.Timestamp("2026-11-30"), date(2026, 11, 9), 0),
    (pd.Timestamp("2025-12-01"), date(2026, 1, 15), 1),
    (pd.Timestamp("2024-03-01"), date(2026, 11, 9), 32),
    (pd.Timestamp("2027-01-01"), date(2026, 11, 9), -2),
])
def test_months_behind(ts, today, expected):
    assert months_behind(ts, today) == expected


def _country(mfg, services, sentiment, housing):
    return {"Manufacturing PMI": {"pct": mfg}, "Services PMI": {"pct": services},
            "Consumer Sentiment": {"pct": sentiment}, "Housing": {"pct": housing}}


def test_lei_average_with_all_four_rows():
    result = lei_average(_country(0.5, 0.7, 0.2, 0.9))

    assert result["pct"] == pytest.approx(0.59)
    assert result["value"] == result["pct"]
    assert result["color"] == "yellow"
    assert result["missing"] is None
    assert result["weights"] == pytest.approx(
        {"Manufacturing PMI": 0.4, "Services PMI": 0.4, "Consumer Sentiment": 0.1, "Housing": 0.1})


def test_lei_average_reweights_over_the_rows_present():
    nan = float("nan")

    result = lei_average(_country(0.5, nan, 0.2, 0.9))

    assert result["pct"] == pytest.approx(0.31 / 0.6)
    assert result["weights"] == pytest.approx(
        {"Manufacturing PMI": 2 / 3, "Consumer Sentiment": 1 / 6, "Housing": 1 / 6})
    assert "Services PMI" not in result["weights"]
    assert result["color"] == "yellow"


def test_lei_average_green_and_red():
    assert lei_average(_country(0.9, 0.9, 0.9, 0.9))["color"] == "green"
    assert lei_average(_country(0.1, 0.1, 0.1, 0.1))["color"] == "red"


def test_lei_average_with_no_rows():
    nan = float("nan")

    result = lei_average(_country(nan, nan, nan, nan))

    assert np.isnan(result["pct"])
    assert result["color"] is None
    assert result["missing"] == "No LEI rows available"
    assert result["weights"] == {}


def test_group_subtitle():
    assert group_subtitle("EM") == "China · Brazil · South Korea · Taiwan"


def test_tooltip_formats():
    level = {"missing": None, "value": 54.93, "pct": 0.734, "hist_start": "Jan-12", "asof": "Oct-26",
             "stale": False, "measure": "level (S&P Global Manufacturing PMI)", "note": ""}
    rate = {"missing": None, "value": -0.26, "pct": 0.5, "hist_start": "Jan-06", "asof": "Q2-26", "stale": True,
            "measure": "YoY %", "note": "department stores & supermarkets only"}

    assert econ_cell_tooltip("Manufacturing PMI", level) == (
        "54.9 — 73% percentile of own history since Jan-12, as of Oct-26 | level (S&P Global Manufacturing PMI)")
    assert econ_cell_tooltip("Retail Sales", rate) == (
        "-0.3% — 50% percentile of own history since Jan-06 — STALE: freshest published reading is Q2-26"
        " | YoY % | department stores & supermarkets only")
    assert econ_cell_tooltip("GDP", {"missing": "No data in source file"}) == "n/a — No data in source file"
    assert econ_cell_tooltip("LEI Average", {"missing": None, "weights": {"Manufacturing PMI": 2 / 3, "Housing": 1 / 3}}) == (
        "Weighted mean of the LEI rows' own-history percentiles — Manufacturing PMI 67%, Housing 33%."
        " CEI rows shown for reference, not included")


def test_stale_cells_carry_an_asterisk():
    econ = {key: {row: {"color": "green", "pct": 0.8, "stale": True, "missing": None, "value": 1.0,
                        "hist_start": "Jan-06", "asof": "Jun-26", "measure": "m", "note": ""}
                  for row in ROWS} | {"LEI Average": {"color": "yellow", "pct": 0.5, "stale": False, "missing": None,
                                                      "weights": {"Housing": 1.0}}}
            for key in COUNTRIES}

    card = econ_card(econ, "EM", "09 Nov 2026")

    assert card["rows"][0]["cells"][0]["text"] == "0.80*"
    assert card["rows"][-1]["cells"][0]["text"] == "0.50"


def test_one_month_lag_changes_a_percentile(inputs, econ):
    lagged = build_econ(inputs, TODAY, lag_months=1)

    assert list(lagged) == list(econ)
    differing = [(key, row) for key in COUNTRIES for row in ROWS
                 if not np.isnan(econ[key][row]["pct"]) and econ[key][row]["pct"] != lagged[key][row]["pct"]]
    assert differing
