"""Records, or checks against, the output of app.compare_run.run_compare on fixed synthetic data.

Written by the planner on 2026-11-09, before contracts 0192 (backtest_series rewrite) and 0193
(frontier only where used), to prove that neither changes what a comparison returns.

    cd backend
    DATABASE_URL="" .venv/bin/python ../contracts/tools/compare_reference.py check
    DATABASE_URL="" .venv/bin/python ../contracts/tools/compare_reference.py record   # planner only

`record` overwrites compare_reference.json. Coders run `check` only.

Floats are compared with a relative tolerance of 1e-6 and an absolute tolerance of 1e-9. NaN equals
NaN. Every other value (dates, strings, None, list lengths, dict keys) must match exactly.

Why not tighter. The tolerance was 1e-9 at first, and that failed correct work in contract 0192.
Under "match current" the target-volatility mode's vol target is the current portfolio's own
volatility, which comes from backtest_series. Summing in a different order moved that target in its
last bit (0.10161879184527994 -> ...989). SLSQP stops at about 1e-9, so it converged to weights
about 1.2e-9 apart. Anything downstream of an iterative optimizer can only be compared to about the
optimizer's own precision. A real error in a rewrite shows up at 1e-3 or worse, far above this
tolerance.
"""

import json
import math
import sys
import time
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from app.compare_run import run_compare  # noqa: E402

REFERENCE = Path(__file__).with_name("compare_reference.json")
REL_TOL = 1e-6
ABS_TOL = 1e-9

CASES = [
    {"name": "default-365-match-current", "lookback_days": 365, "vol_target": None, "rebalance": "none"},
    {"name": "1825-target-10pct-monthly", "lookback_days": 1825, "vol_target": 0.10, "rebalance": "monthly"},
    {"name": "730-capped-quarterly", "lookback_days": 730, "vol_target": 0.12, "rebalance": "quarterly",
     "max_weight": 0.35},
]


def _closes() -> tuple[dict[str, pd.Series], pd.Series]:
    """Seven tickers. T6 lists in mid-2024, so it is pinned in-sample and excluded from older folds.
    T5 trades on a different calendar (every third business day dropped) to exercise forward-fill."""
    rng = np.random.default_rng(20261109)
    idx = pd.bdate_range("2014-01-02", "2026-11-06")
    closes = {}
    for i in range(7):
        drift, vol = 0.0002 + 0.0001 * i, 0.010 + 0.002 * i
        series = pd.Series(100 * np.exp(np.cumsum(rng.normal(drift, vol, len(idx)))), index=idx)
        if i == 5:
            series = series.iloc[[k for k in range(len(idx)) if k % 3 != 2]]
        if i == 6:
            series = series.loc[series.index >= "2024-06-03"]
        closes[f"T{i}"] = series
    benchmark = pd.Series(100 * np.exp(np.cumsum(rng.normal(0.0003, 0.011, len(idx)))), index=idx)
    return closes, benchmark


def _run_all() -> dict:
    closes, benchmark = _closes()
    weights = {"T0": 0.2, "T1": 0.15, "T2": 0.15, "T3": 0.1, "T4": 0.1, "T5": 0.2, "T6": 0.1}
    out = {}
    for case in CASES:
        kwargs = {k: v for k, v in case.items() if k != "name"}
        started = time.perf_counter()
        result = run_compare(weights, closes, benchmark, **kwargs)
        print(f"  {case['name']}: {time.perf_counter() - started:.2f}s")
        out[case["name"]] = json.loads(json.dumps(asdict(result), default=str))
    return out


def _diff(expected, actual, path: str, problems: list[str]) -> None:
    if len(problems) >= 20:
        return
    if isinstance(expected, float) or isinstance(actual, float):
        if not isinstance(expected, (int, float)) or not isinstance(actual, (int, float)):
            problems.append(f"{path}: expected {expected!r}, got {actual!r}")
        elif math.isnan(expected) and math.isnan(actual):
            return
        elif not math.isclose(expected, actual, rel_tol=REL_TOL, abs_tol=ABS_TOL):
            problems.append(f"{path}: expected {expected!r}, got {actual!r}")
    elif isinstance(expected, dict) and isinstance(actual, dict):
        if expected.keys() != actual.keys():
            problems.append(f"{path}: keys differ: {sorted(expected.keys() ^ actual.keys())}")
            return
        for key in expected:
            _diff(expected[key], actual[key], f"{path}.{key}", problems)
    elif isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            problems.append(f"{path}: length {len(expected)} expected, got {len(actual)}")
            return
        for i, (e, a) in enumerate(zip(expected, actual)):
            _diff(e, a, f"{path}[{i}]", problems)
    elif expected != actual:
        problems.append(f"{path}: expected {expected!r}, got {actual!r}")


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ("record", "check"):
        sys.exit("usage: compare_reference.py record|check")
    print("Running run_compare on the reference cases:")
    actual = _run_all()
    if sys.argv[1] == "record":
        REFERENCE.write_text(json.dumps(actual), encoding="utf-8")
        print(f"Recorded {REFERENCE.name}")
        return
    problems: list[str] = []
    _diff(json.loads(REFERENCE.read_text(encoding="utf-8")), actual, "result", problems)
    if problems:
        print("MISMATCH (first 20):")
        print("\n".join(f"  {p}" for p in problems))
        sys.exit(1)
    print(f"MATCH: all {len(CASES)} cases agree with {REFERENCE.name} (rel tol {REL_TOL}, abs tol {ABS_TOL})")


if __name__ == "__main__":
    main()
