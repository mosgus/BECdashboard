#!/usr/bin/env python3
"""Blue Eagle nightly job runner.

Usage:
  python jobs/run_nightly.py [--asof YYYY-MM-DD] [--dry-run]

Environment variables:
  API_BASE_URL  — base URL of the running backend (e.g. http://localhost:8001)
                  Required. No trailing slash.

What it does:
  1. Determines the as-of date (last completed trading day).
  2. Checks job_runs — if already ran for this asof_date, exits cleanly (idempotent).
  3. POSTs to /api/alert_rules/evaluate_now — evaluates all enabled alert rules.
  4. GETs /api/ops/digest — generates the overnight digest.
  5. POSTs to /api/ops/digest/email — emails digest if SMTP is configured.
  6. Records the job run to /api/ops/job_runs.

Exit codes:
  0 — success (or already ran for this date)
  1 — failure
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, timedelta

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip install requests")
    sys.exit(1)


# ── Helpers ───────────────────────────────────────────────────────────────────

def last_trading_day() -> date:
    """Return the last completed US trading day (skips weekends; no holiday calendar)."""
    today = date.today()
    # If Monday, last trading day is Friday (2 days back)
    if today.weekday() == 0:
        return today - timedelta(days=3)
    # If Sunday, go back 2
    if today.weekday() == 6:
        return today - timedelta(days=2)
    # Otherwise yesterday
    return today - timedelta(days=1)


def call(session: requests.Session, method: str, url: str, **kwargs) -> requests.Response:
    try:
        resp = session.request(method, url, timeout=120, **kwargs)
        resp.raise_for_status()
        return resp
    except requests.RequestException as exc:
        print(f"  HTTP error: {exc}")
        raise


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Blue Eagle nightly job runner")
    parser.add_argument("--asof", help="Override as-of date (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen but don't call evaluate_now")
    args = parser.parse_args()

    base_url = os.environ.get("API_BASE_URL", "").rstrip("/")
    if not base_url:
        print("ERROR: API_BASE_URL environment variable is required.")
        return 1

    asof_date = args.asof or last_trading_day().isoformat()
    dry_run = args.dry_run

    print(f"Blue Eagle Nightly Runner")
    print(f"  as-of date : {asof_date}")
    print(f"  API base   : {base_url}")
    print(f"  dry-run    : {dry_run}")
    print()

    session = requests.Session()
    # Include write key if set (for environments with CLASS_WRITE_KEY)
    write_key = os.environ.get("CLASS_WRITE_KEY", "")
    if write_key:
        session.headers["X-Class-Key"] = write_key

    t_start = time.monotonic()

    # ── Step 1: Idempotency check ─────────────────────────────────────────────
    print("Step 1: Checking idempotency...")
    try:
        runs_resp = call(session, "GET", f"{base_url}/api/ops/job_runs?limit=50")
        runs = runs_resp.json().get("job_runs", [])
        already_ran = any(
            r["job_name"] == "nightly" and r["asof_date"] == asof_date
            for r in runs
        )
        if already_ran:
            print(f"  ✓ Nightly job already ran for {asof_date} — nothing to do.")
            return 0
        print("  ✓ Not yet run for this date.")
    except requests.RequestException:
        print("  WARNING: Could not check job_runs — proceeding anyway.")

    # ── Step 2: Evaluate alert rules ──────────────────────────────────────────
    print("Step 2: Evaluating alert rules...")
    eval_result = {}
    if dry_run:
        print("  DRY RUN — skipping evaluate_now")
        eval_result = {"evaluated": 0, "triggered": 0, "skipped": 0, "events": []}
    else:
        try:
            resp = call(session, "POST", f"{base_url}/api/alert_rules/evaluate_now")
            eval_result = resp.json()
            print(f"  ✓ evaluated={eval_result.get('evaluated', '?')}  "
                  f"triggered={eval_result.get('triggered', '?')}  "
                  f"skipped={eval_result.get('skipped', '?')}")
            if eval_result.get("warnings"):
                for w in eval_result["warnings"]:
                    print(f"  ⚠ {w}")
        except requests.RequestException as exc:
            print(f"  ERROR: Alert evaluation failed — {exc}")
            _record_run(session, base_url, asof_date, "failure", t_start,
                        {"step": "evaluate_now", "error": str(exc)})
            return 1

    # ── Step 3: Generate digest ───────────────────────────────────────────────
    print("Step 3: Generating digest...")
    digest = {}
    try:
        resp = call(session, "GET", f"{base_url}/api/ops/digest?asof={asof_date}")
        digest = resp.json()
        portfolio_count = len(digest.get("portfolio_movers", []))
        alert_entry = digest.get("alerts_triggered", {}).get("entry", 0)
        alert_exit = digest.get("alerts_triggered", {}).get("exit", 0)
        print(f"  ✓ digest ready — movers={portfolio_count}, alerts: {alert_entry} entry / {alert_exit} exit")
    except requests.RequestException as exc:
        print(f"  WARNING: Digest generation failed — {exc}")

    # ── Step 4: Email digest ──────────────────────────────────────────────────
    print("Step 4: Emailing digest...")
    if dry_run:
        print("  DRY RUN — skipping email")
    else:
        try:
            resp = call(session, "POST", f"{base_url}/api/ops/digest/email?asof={asof_date}")
            result = resp.json()
            if result.get("sent"):
                print("  ✓ Digest email sent.")
            else:
                print(f"  ℹ Email not sent: {result.get('reason', 'unknown reason')}")
        except requests.RequestException as exc:
            print(f"  WARNING: Email dispatch failed — {exc}")

    # ── Step 5: Record job run ────────────────────────────────────────────────
    print("Step 5: Recording job run...")
    details = {
        "evaluated": eval_result.get("evaluated"),
        "triggered": eval_result.get("triggered"),
        "skipped": eval_result.get("skipped"),
        "warnings": eval_result.get("warnings", []),
        "digest_generated": bool(digest),
    }
    ok = _record_run(session, base_url, asof_date, "success", t_start, details)
    if ok:
        print("  ✓ Job run recorded.")
    else:
        print("  WARNING: Could not record job run (non-fatal).")

    elapsed = time.monotonic() - t_start
    print(f"\nDone in {elapsed:.1f}s")
    return 0


def _record_run(
    session: requests.Session,
    base_url: str,
    asof_date: str,
    status: str,
    t_start: float,
    details: dict,
) -> bool:
    elapsed_ms = int((time.monotonic() - t_start) * 1000)
    try:
        resp = session.post(
            f"{base_url}/api/ops/job_runs",
            json={
                "job_name": "nightly",
                "asof_date": asof_date,
                "status": status,
                "duration_ms": elapsed_ms,
                "details_json": details,
            },
            timeout=15,
        )
        return resp.status_code in (200, 201)
    except Exception:
        return False


if __name__ == "__main__":
    sys.exit(main())
