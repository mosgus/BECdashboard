"""One-time seed of the macro_price_series table from the scorecard project's local price cache.

    cd backend
    .venv/bin/python hard_data/seed_macro_prices.py "<scorecard project>/prices_cache.pkl"

The cache is a pickle: `{"date": <date>, "prices": <DataFrame of Yahoo closes, one column per ticker>}`.
`pickle.loads` runs arbitrary code, so this reads a trusted local file only. NEVER point it at anything
uploaded, downloaded or otherwise not produced by the scorecard project on this machine.

Needs DATABASE_URL (the script exits without it) and does not create tables: run the migrations first.
The rows are stamped with the pickle's `date` at 16:00 America/New_York (the US close), in UTC.
"""

import pickle
import sys
from datetime import datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.macro_prices import price_coverage, store_series  # noqa: E402


def main(argv: list[str]) -> int:
    # The database check comes first, so a missing database fails the same way whatever the path is.
    if not Settings().database_url:
        sys.exit("DATABASE_URL is not set: the seed writes to a database and refuses to run without one.")
    if len(argv) != 2:
        sys.exit("usage: seed_macro_prices.py <path to prices_cache.pkl>")
    cache = pickle.loads(Path(argv[1]).read_bytes())  # trusted local file; see the module docstring
    prices = cache["prices"]
    fetched_at = datetime.combine(cache["date"], time(16, 0), tzinfo=ZoneInfo("America/New_York")).astimezone(
        timezone.utc)
    written = store_series({ticker: prices[ticker] for ticker in prices.columns}, fetched_at)
    print(f"wrote {written} rows (fetched_at {fetched_at.isoformat()})")
    print(price_coverage())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
