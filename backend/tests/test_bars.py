from datetime import date

from app.bars import AdjustedBar, adjust_bars


def test_adjust_bars_scales_prices_down_and_volume_up_for_a_split():
    bars = adjust_bars([(date(2026, 1, 2), 404.0, 396.0, 400.0, 100.0, 1_000_000)])

    assert bars == [
        AdjustedBar(
            date=date(2026, 1, 2),
            high=101.0,
            low=99.0,
            close=100.0,
            volume=4_000_000.0,
        )
    ]


def test_adjust_bars_skips_rows_without_a_defined_ratio_or_complete_prices():
    bars = adjust_bars(
        [
            (date(2026, 1, 2), 101.0, 99.0, 0.0, 100.0, 1_000_000),
            (date(2026, 1, 3), 101.0, 99.0, 100.0, None, 1_000_000),
            (date(2026, 1, 4), None, 99.0, 100.0, 100.0, 1_000_000),
        ]
    )

    assert bars == []


def test_adjust_bars_keeps_a_row_with_missing_volume():
    bars = adjust_bars([(date(2026, 1, 2), 202.0, 198.0, 200.0, 100.0, None)])

    assert bars[0].high == 101.0
    assert bars[0].low == 99.0
    assert bars[0].close == 100.0
    assert bars[0].volume is None
