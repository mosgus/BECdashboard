from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.portfolio_series import build_portfolio_series, value_series
from app.portfolio_series import backtest_series


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


def S(values, dates):
    return pd.Series(values, index=list(dates), dtype=float)


X3 = [10, 20, 10]
Y3 = [10, 10, 10]
QTR = (date(2024, 3, 28), date(2024, 4, 1), date(2024, 4, 2))
YEAR = (date(2023, 12, 29), date(2024, 1, 2), date(2024, 1, 3))
MID = (date(2024, 1, 10), date(2024, 1, 11), date(2024, 1, 12))

D5 = (date(2024, 1, 2), date(2024, 1, 3), date(2024, 1, 4), date(2024, 1, 5), date(2024, 1, 8))


@pytest.mark.parametrize(
    "dates, rebalance, expected_total, expected_rebalance_index",
    [
        (QTR, "none", 100, None),
        (QTR, "monthly", 112.5, 1),
        (QTR, "quarterly", 112.5, 1),
        (QTR, "annual", 100, None),
        (YEAR, "none", 100, None),
        (YEAR, "monthly", 112.5, 1),
        (YEAR, "quarterly", 112.5, 1),
        (YEAR, "annual", 112.5, 1),
        (MID, "none", 100, None),
        (MID, "monthly", 100, None),
        (MID, "quarterly", 100, None),
        (MID, "annual", 100, None),
    ],
)
def test_rebalance_table(dates, rebalance, expected_total, expected_rebalance_index):
    closes = {"X": S(X3, dates), "Y": S(Y3, dates)}
    result = backtest_series({"X": 0.5, "Y": 0.5}, closes, rebalance)

    assert result.total[-1] == pytest.approx(expected_total)
    if expected_rebalance_index is None:
        assert result.rebalance_dates == []
    else:
        assert result.rebalance_dates == [dates[expected_rebalance_index]]


def test_full_series_monthly_on_qtr():
    closes = {"X": S(X3, QTR), "Y": S(Y3, QTR)}
    result = backtest_series({"X": 0.5, "Y": 0.5}, closes, "monthly")

    assert result.total == pytest.approx([100, 150, 112.5])
    assert result.by_holding == {
        "X": pytest.approx([50, 75, 37.5]),
        "Y": pytest.approx([50, 75, 75]),
    }


def test_buy_and_hold_none_on_qtr():
    closes = {"X": S(X3, QTR), "Y": S(Y3, QTR)}
    result = backtest_series({"X": 0.5, "Y": 0.5}, closes, "none")

    assert result.total == pytest.approx([100, 150, 100])
    assert result.by_holding == {
        "X": pytest.approx([50, 100, 50]),
        "Y": pytest.approx([50, 50, 50]),
    }


def test_late_start_no_flat_fill():
    x = S([10, 20, 20, 10, 10], D5)
    y = S([10, 10, 20], D5[2:])
    result = backtest_series({"X": 0.5, "Y": 0.5}, {"X": x, "Y": y}, "none")

    assert result.start == D5[2]
    assert result.dates == list(D5[2:])
    assert result.total == pytest.approx([100, 75, 125])
    assert result.by_holding["X"] == pytest.approx([50, 25, 25])


def test_interior_gap_forward_fills():
    x = S(X3, MID)
    y = S([10, 30], (MID[0], MID[2]))
    result = backtest_series({"X": 0.5, "Y": 0.5}, {"X": x, "Y": y}, "none")

    assert result.dates == list(MID)
    assert result.total == pytest.approx([100, 150, 200])


def test_normalisation_and_extra_ticker_ignored():
    closes = {"X": S(X3, QTR), "Y": S(Y3, QTR), "Z": S(Y3, QTR)}
    unnormalised = backtest_series({"X": 2, "Y": 2}, closes, "none")
    normalised = backtest_series({"X": 0.5, "Y": 0.5}, closes, "none")

    assert unnormalised.total == pytest.approx(normalised.total)
    assert "Z" not in unnormalised.by_holding


def test_shorts():
    closes = {"X": S(X3, QTR), "Y": S(Y3, QTR)}
    result = backtest_series({"X": 1.5, "Y": -0.5}, closes, "none")

    assert result.total == pytest.approx([100, 250, 100])
    assert result.by_holding["Y"] == pytest.approx([-50, -50, -50])


@pytest.mark.parametrize("rebalance", ["none", "monthly", "quarterly", "annual"])
def test_sum_invariant_on_random_data(rebalance):
    rng = np.random.default_rng(3)
    dates = pd.bdate_range("2023-01-02", periods=300)
    tickers = ["A", "B", "C"]
    closes = {
        ticker: pd.Series(
            100 * np.cumprod(1 + rng.normal(0, 0.01, size=len(dates))),
            index=list(dates.date),
        )
        for ticker in tickers
    }
    weights = {"A": 0.5, "B": 0.3, "C": 0.2}
    result = backtest_series(weights, closes, rebalance)

    assert result.total[0] == pytest.approx(100, abs=1e-9)
    for index in range(len(result.total)):
        holdings_sum = sum(result.by_holding[ticker][index] for ticker in weights)
        assert holdings_sum == pytest.approx(result.total[index], abs=1e-9)


@pytest.mark.parametrize(
    "weights, closes, rebalance",
    [
        ({}, {"X": S(X3, QTR)}, "none"),
        ({"X": 1, "Y": -1}, {"X": S(X3, QTR), "Y": S(Y3, QTR)}, "none"),
        ({"X": 1}, {}, "none"),
        ({"X": 1}, {"X": S(X3, QTR)}, "weekly"),
    ],
)
def test_backtest_series_errors(weights, closes, rebalance):
    with pytest.raises(ValueError):
        backtest_series(weights, closes, rebalance)
