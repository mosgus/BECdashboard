"""Checks the backend port of the scorecard project against the committed Macro snapshot.

Written by the planner on 2026-11-25 for contracts 0199 (inputs + economic scorecard) and 0200
(equity scorecard, quadrant, charts, build_snapshot).

    cd backend
    DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py parse
    DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py econ
    DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py full

The reference is backend/hard_data/macro_scorecard.json, built on 2026-11-09 from the scorecard
project in `reference files/new integration/Scorecard_Project_2026-11-09`. The inputs are that
project's `data/*.xlsx` and `prices_cache.pkl`. Those are licensed FactSet / Bloomberg / S&P Global
exports. They are not in git and exist only on Gunnar's machine, which is why this is a tool and not
a test.

Comparison is EXACT: no float tolerance. That is safe, not strict. On 2026-11-25 the planner re-ran
the original scorecard.py with today frozen at 2026-11-09 and the network blocked. It reproduced the
snapshot exactly (zero differing values) on pandas 2.2.3 / numpy 2.5.1, and again on the backend's
pandas 3.0.5 / numpy 2.5.3. A faithful port runs the same arithmetic in the same order, so it lands
on the same bits. Every chart value is rounded to 4 decimals and every cell is a formatted string.
A diff here is a porting error, not noise.

`today` is frozen at 2026-11-09 because the economic scorecard's stale flags, its "as of" subtitle
and the 1M/3M comparisons all depend on it.
"""

import json
import math
import pickle
import resource
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

PROJECT = ROOT / "reference files" / "new integration" / "Scorecard_Project_2026-11-09"
DATA = PROJECT / "data"
PRICES = PROJECT / "prices_cache.pkl"
SNAPSHOT = ROOT / "backend" / "hard_data" / "macro_scorecard.json"
TODAY = date(2026, 11, 9)
MAX_DIFFS_SHOWN = 25


def load_files() -> dict[str, bytes]:
    from app.macro_inputs import SLOTS

    return {slot.id: (DATA / slot.filename).read_bytes() for slot in SLOTS}


def as_json(value):
    """What the API would actually serve: numpy scalars become floats, tuples become lists."""
    return json.loads(json.dumps(value))


def diff(expected, actual, path: str, out: list) -> None:
    if isinstance(expected, float) and isinstance(actual, float) and math.isnan(expected) and math.isnan(actual):
        return
    if type(expected) is not type(actual):
        out.append(f"{path}: type {type(expected).__name__} != {type(actual).__name__} ({actual!r:.80})")
        return
    if isinstance(expected, dict):
        for key in expected.keys() | actual.keys():
            if key not in actual:
                out.append(f"{path}.{key}: missing from port output")
            elif key not in expected:
                out.append(f"{path}.{key}: not in snapshot")
            else:
                diff(expected[key], actual[key], f"{path}.{key}", out)
    elif isinstance(expected, list):
        if len(expected) != len(actual):
            out.append(f"{path}: length {len(expected)} != {len(actual)}")
            return
        for i, (e, a) in enumerate(zip(expected, actual)):
            diff(e, a, f"{path}[{i}]", out)
    elif isinstance(expected, str) and expected != actual:
        at = next((i for i, (e, a) in enumerate(zip(expected, actual)) if e != a), min(len(expected), len(actual)))
        start = max(0, at - 30)
        out.append(f"{path}: strings differ at char {at}: expected …{expected[start:at + 50]!r} "
                   f"got …{actual[start:at + 50]!r}")
    elif expected != actual:
        out.append(f"{path}: expected {expected!r:.100} got {actual!r:.100}")


def report(diffs: list, what: str) -> int:
    if not diffs:
        print(f"{what}: IDENTICAL")
        return 0
    print(f"{what}: {len(diffs)} DIFFERENCES")
    for line in diffs[:MAX_DIFFS_SHOWN]:
        print("  " + line)
    if len(diffs) > MAX_DIFFS_SHOWN:
        print(f"  ... and {len(diffs) - MAX_DIFFS_SHOWN} more")
    return 1


def check_parse() -> int:
    from app.macro_inputs import SLOTS, MacroInputError, parse_inputs, parse_slot

    failures = 0
    for slot in SLOTS:
        try:
            parse_slot(slot.id, (DATA / slot.filename).read_bytes())
            print(f"  {slot.id:10s} {slot.filename:36s} OK")
        except MacroInputError as exc:
            failures += 1
            print(f"  {slot.id:10s} {slot.filename:36s} REJECTED: {exc}")
    parse_inputs(load_files())
    print(f"parse: {len(SLOTS) - failures}/{len(SLOTS)} real files accepted; parse_inputs OK")
    return 1 if failures else 0


def check_econ() -> int:
    from app.macro_econ import build_econ
    from app.macro_inputs import parse_inputs
    from app.macro_snapshot import econ_card

    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    econ = build_econ(parse_inputs(load_files()), TODAY)
    asof = TODAY.strftime("%d %b %Y")
    diffs: list = []
    for group in snapshot["groups"]:
        diff(group["econ"], as_json(econ_card(econ, group["key"], asof)), f"groups[{group['key']}].econ", diffs)
    return report(diffs, "econ")


def check_full() -> int:
    from app.macro_inputs import parse_inputs
    from app.macro_snapshot import build_snapshot

    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    snapshot.pop("generated_at")
    prices = pickle.loads(PRICES.read_bytes())["prices"]  # the planner's own local cache file, not uploaded data
    files = load_files()
    started = time.perf_counter()
    built = build_snapshot(parse_inputs(files), prices, TODAY)
    elapsed = time.perf_counter() - started
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_mb = peak / 1e6 if sys.platform == "darwin" else peak / 1e3  # bytes on macOS, KB on Linux
    print(f"build_snapshot: {elapsed:.1f} s, process peak RSS {peak_mb:.0f} MB (includes loading the inputs)")
    diffs: list = []
    diff(snapshot, as_json(built), "snapshot", diffs)
    return report(diffs, "full")


def check_full_db() -> int:
    """`full`, but with every input taking the database round trip (added 2026-11-25 for contracts
    0202/0203). The 15 real files go in through macro_store.store_upload and come back through
    macro_store.live_versions; the cached prices go in through macro_prices.store_series and come
    back through macro_prices.load_prices. Uses a throwaway SQLite file, never the real database:
    DATABASE_URL must be "" at import (the config guard), and is pointed at the file afterwards."""
    import os
    import tempfile
    from datetime import datetime, timezone

    if os.environ.get("DATABASE_URL"):
        sys.exit('run with DATABASE_URL="" — this mode must never touch a real database')
    from app.db import get_engine
    from app.macro_inputs import SLOTS, parse_inputs
    from app.macro_prices import load_prices, store_series
    from app.macro_snapshot import build_snapshot
    from app.macro_store import live_versions, store_upload
    from app.models import Base

    db_path = Path(tempfile.mkdtemp(prefix="macro_check_")) / "check.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    Base.metadata.create_all(get_engine())

    now = datetime(2026, 11, 9, 17, 0, tzinfo=timezone.utc)
    for slot in SLOTS:
        store_upload(slot.id, slot.filename, (DATA / slot.filename).read_bytes(), "Planner check", now)
    prices = pickle.loads(PRICES.read_bytes())["prices"]
    store_series({ticker: prices[ticker] for ticker in prices.columns}, now)

    files = {slot_id: version.content for slot_id, version in live_versions().items()}
    loaded = load_prices()
    print(f"database round trip: {len(files)} files, prices {loaded.shape[0]} dates x {loaded.shape[1]} tickers")

    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    snapshot.pop("generated_at")
    built = build_snapshot(parse_inputs(files), loaded, TODAY)
    diffs: list = []
    diff(snapshot, as_json(built), "snapshot", diffs)
    return report(diffs, "full-db")


if __name__ == "__main__":
    modes = {"parse": check_parse, "econ": check_econ, "full": check_full, "full-db": check_full_db}
    if len(sys.argv) != 2 or sys.argv[1] not in modes:
        sys.exit("usage: macro_port_check.py parse|econ|full|full-db")
    sys.exit(modes[sys.argv[1]]())
