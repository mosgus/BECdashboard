#!/usr/bin/env python3
"""Blue Eagle nightly price history refresh.

Fetches daily OHLCV from yfinance for every active universe ticker and upserts
into the price_history table. Gap-aware and idempotent — if the laptop is off
for 4 days, the next run picks up all 4 missing days automatically.

Usage:
    python jobs/refresh_prices.py                         # incremental refresh
    python jobs/refresh_prices.py --backfill-years 10     # full backfill
    python jobs/refresh_prices.py --tickers AAPL,MSFT     # specific tickers
    python jobs/refresh_prices.py --dry-run               # print, don't write

Exit codes:
    0 — success
    1 — failure (at least one critical error)
"""
from __future__ import annotations

import argparse
import sys
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

# Ensure backend/ is on the path when run from repo root
REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from db.base import SessionLocal  # noqa: E402
from db.models import JobRun  # noqa: E402
from core.price_loader import refresh_all_prices  # noqa: E402


def _record_job_run(db, asof, status, started_at, finished_at, details):
    try:
        run = JobRun(
            id=uuid.uuid4(),
            job_name="price_refresh",
            asof_date=asof,
            status=status,
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=int((finished_at - started_at).total_seconds() * 1000),
            details_json=details,
        )
        db.merge(run)
        db.commit()
    except Exception as exc:
        print(f"  WARNING: could not record job run: {exc}", flush=True)


def _progress(idx, batch, msg):
    print(f"  [{idx+1:>3}-{idx+len(batch):<3}] {', '.join(batch)} — {msg}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Blue Eagle price history refresh")
    parser.add_argument("--backfill-years", type=int, default=None)
    parser.add_argument("--tickers", type=str, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    started_at = datetime.now(timezone.utc).replace(tzinfo=None)
    today = date.today()

    print("Blue Eagle Price Refresh")
    print(f"  as-of          : {today}")
    print(f"  backfill years : {args.backfill_years or 'incremental'}")
    print(f"  dry-run        : {args.dry_run}")

    if args.dry_run:
        print("\nDRY RUN — no changes will be made.")
        return 0

    db = SessionLocal()
    try:
        tickers = None
        if args.tickers:
            tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]

        result = refresh_all_prices(
            db,
            tickers=tickers,
            backfill_years=args.backfill_years,
            progress_cb=_progress,
        )

        finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        status = (
            "success" if not result["errors"]
            else ("partial" if result["rows_upserted"] > 0 else "failure")
        )

        print()
        print(f"Done. {result['rows_upserted']} rows upserted across "
              f"{result['batches']} batches in {result['elapsed_s']}s.")
        if result["errors"]:
            print(f"{len(result['errors'])} errors:")
            for e in result["errors"][:5]:
                print(f"  - {e}")

        _record_job_run(
            db,
            asof=today,
            status=status,
            started_at=started_at,
            finished_at=finished_at,
            details={
                "tickers_processed": result["tickers_processed"],
                "batches": result["batches"],
                "rows_upserted": result["rows_upserted"],
                "backfill_years": args.backfill_years,
                "trigger": "cron",
                "errors": result["errors"][:20],
            },
        )

        return 1 if status == "failure" else 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
