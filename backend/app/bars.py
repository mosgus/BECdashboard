"""Pure normalization of stored OHLCV bars onto the adjusted-close basis."""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class AdjustedBar:
    date: date
    high: float
    low: float
    close: float
    volume: float | None


def adjust_bars(rows: list[tuple]) -> list[AdjustedBar]:
    """Split-adjust raw OHLCV rows onto the adjusted-close basis.

    Prices scale by ``adj_close / close`` and volume divides by that ratio. Rows with missing
    high, low, close, or adjusted close, or a zero close, are deliberately skipped: a chart gap
    is more honest than a partially invented bar.
    """
    adjusted = []
    for bar_date, high, low, close, adj_close, volume in rows:
        if None in (high, low, close, adj_close) or close == 0:
            continue

        ratio = adj_close / close
        adjusted.append(
            AdjustedBar(
                date=bar_date,
                high=high * ratio,
                low=low * ratio,
                close=adj_close,
                volume=None if volume is None else volume / ratio,
            )
        )
    return adjusted
