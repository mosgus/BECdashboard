from datetime import date

import pandas as pd
import pytest

from app.portfolio_series import build_portfolio_series, value_series


d1 = date(2024, 1, 2)
d2 = date(2024, 1, 3)
d3 = date(2024, 1, 4)


def _series(values, dates=(d1, d2, d3)):
    return pd.Series(values, index=list(dates), dtype=float)


def _case_a():
    return {"AAA": _series([10, 11, 12]), "BBB": _series([20, 20, 25])}


def test_buy_and_hold_case_a():
    result = build_portfolio_series({"AAA": 60, "BBB": 40}, 0, _case_a())

    assert result.total == pytest.approx([82, 87, 100], abs=0.01)


def test_cash_is_included_and_normalized():
    result = build_portfolio_series({"AAA": 45, "BBB": 30}, 25, _case_a())

    assert result.total == pytest.approx([86.5, 90.25, 100], abs=0.01)
    assert result.cash_value == pytest.approx(25)


def test_new_holding_is_flat_before_first_bar():
    closes = {"AAA": _series([10, 11, 12]), "NEWB": _series([30, 40], (d2, d3))}
    result = build_portfolio_series({"AAA": 50, "NEWB": 50}, 0, closes)

    assert result.total == pytest.approx([79.17, 83.33, 100], abs=0.01)
    assert result.by_holding["NEWB"][0] == pytest.approx(37.5)
    assert result.first_bar["NEWB"] == d2


def test_gaps_forward_fill():
    closes = {"AAA": _series([10, 12], (d1, d3)), "BBB": _series([20, 20, 25])}
    result = build_portfolio_series({"AAA": 60, "BBB": 40}, 0, closes)

    assert result.total == pytest.approx([82, 82, 100], abs=0.01)


def test_weights_are_normalized_with_cash():
    result = build_portfolio_series({"AAA": 30, "BBB": 20}, 0, _case_a())

    assert result.total == pytest.approx([82, 87, 100], abs=0.01)


def test_holding_values_plus_cash_equal_total():
    closes = {"AAA": _series([10, 11, 12]), "NEWB": _series([30, 40], (d2, d3))}
    result = build_portfolio_series({"AAA": 50, "NEWB": 50}, 0, closes)

    for index, total in enumerate(result.total):
        assert sum(values[index] for values in result.by_holding.values()) + result.cash_value == pytest.approx(total)


def test_value_series_does_not_choose_units():
    total, by_holding = value_series({"AAA": 2.0}, 5, pd.DataFrame({"AAA": [10, 20]}))

    assert total.tolist() == [25, 45]
    assert by_holding["AAA"].tolist() == [20, 40]
