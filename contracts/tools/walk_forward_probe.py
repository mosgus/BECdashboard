"""Throwaway probe: do Compare Optimizers' holdout rankings hold up across several yearly folds?

Planner tool, not production code. It reads stored prices only and writes nothing. Run it from
backend/ so `app` imports and backend/.env supplies DATABASE_URL:

    cd backend
    python ../contracts/tools/walk_forward_probe.py --holdings "AAPL=1,MSFT=1,NVDA=2"

--holdings takes TICKER=weight pairs. Weights are normalised, so shares × price or percentages both work.
Use --synthetic to run on random prices with no database: DATABASE_URL="" python ... --synthetic

Each fold k = 1..N scores the 365 days ending (k-1)×365 days before the last common bar. It fits
every mode on the --lookback days before that, exactly as run_compare's single holdout does. Fold 1
is the holdout Compare Optimizers shows today. Paste the whole output back to the planner.
"""

from __future__ import annotations

import argparse
import math
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.compare_run import HOLDOUT_DAYS, MODES, _score  # noqa: E402
from app.optimize_run import OptimizeInputError, run_optimize  # noqa: E402
from app.portfolio_series import backtest_series  # noqa: E402

LABELS = {"current": "Current"} | {m: m for m in MODES}


def parse_holdings(text: str) -> dict[str, float]:
    out: dict[str, float] = {}
    for part in text.split(","):
        ticker, _, weight = part.strip().partition("=")
        out[ticker.strip().upper()] = float(weight) if weight else 1.0
    return out


def synthetic_closes(tickers: list[str], years: int = 12, seed: int = 7) -> dict[str, pd.Series]:
    rng = np.random.default_rng(seed)
    days = pd.bdate_range(end="2026-10-23", periods=252 * years).date
    out = {}
    for i, t in enumerate(tickers):
        start = 0 if i % 3 else 252 * (i % 5)  # some young holdings, to exercise exclusion
        rets = rng.normal(0.0003 + 0.0001 * i, 0.012 + 0.002 * i, len(days) - start)
        out[t] = pd.Series(100 * np.cumprod(1 + rets), index=list(days[start:]))
    return out


def run_fold(weights, closes, k, args):
    end = min(closes[t].index[-1] for t in weights)
    score_end = end - timedelta(days=(k - 1) * HOLDOUT_DAYS)
    cut = score_end - timedelta(days=HOLDOUT_DAYS)
    eligible = [t for t in weights if closes[t].index[0] <= cut]
    head = f"Fold {k}: fit ≤ {cut}, score {cut} → {score_end}"
    if len(eligible) < 2:
        return head, None, f"skipped — only {len(eligible)} holdings priced on or before {cut}"
    fit_closes = {t: closes[t].loc[closes[t].index <= cut] for t in eligible}
    fit_weights = {t: weights[t] for t in eligible}
    common = dict(lookback_days=args.lookback, rebalance=args.rebalance, rf=args.rf, vol_target=args.vol_target)
    rows: dict[str, tuple[float | None, float | None]] = {}
    fit_end = None
    skipped: list[str] = []
    for mode in MODES:
        try:
            run = run_optimize(fit_weights, fit_closes, None, mode=mode, **common)
        except OptimizeInputError as exc:
            if mode == "equal_weight":
                return head, None, f"skipped — {exc}"
            skipped.append(f"{mode} ({exc})")
            continue
        if not run.feasible:
            skipped.append(f"{mode} (did not converge)")
            continue
        fit_end = fit_end or run.fit_end
        scored = {t: closes[t].loc[(closes[t].index >= run.fit_end) & (closes[t].index <= score_end)] for t in eligible}
        rows[mode] = (run.metrics["optimized"].get("sharpe"), _score(backtest_series(run.target_weights, scored, args.rebalance).total, args.rf).sharpe)
    scored = {t: closes[t].loc[(closes[t].index >= fit_end) & (closes[t].index <= score_end)] for t in eligible}
    rows["current"] = (None, _score(backtest_series(fit_weights, scored, args.rebalance).total, args.rf).sharpe)
    excluded = [t for t in weights if t not in eligible]
    note = f"{len(eligible)} holdings" + (f"; excluded (too young): {', '.join(excluded)}" if excluded else "")
    if skipped:
        note += f"\n  modes skipped: {'; '.join(skipped)}"
    return head, rows, note


def fmt(x):
    return "    —" if x is None or not math.isfinite(x) else f"{x:5.2f}"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--holdings", default="AAA=1,BBB=1,CCC=1,DDD=1,EEE=1,FFF=1")
    p.add_argument("--folds", type=int, default=4)
    p.add_argument("--lookback", type=int, default=1825)
    p.add_argument("--rebalance", default="none")
    p.add_argument("--rf", type=float, default=0.0427)
    p.add_argument("--vol-target", type=float, default=0.10)
    p.add_argument("--synthetic", action="store_true")
    args = p.parse_args()

    weights = parse_holdings(args.holdings)
    if args.synthetic:
        closes = synthetic_closes(list(weights))
    else:
        from app.routers.portfolio import _load_stored_closes

        closes = _load_stored_closes(list(weights))
    print(f"Holdings {len(weights)} · folds {args.folds} · lookback {args.lookback}d · rebalance {args.rebalance} · rf {args.rf}")
    print("History: " + ", ".join(f"{t} from {closes[t].index[0]}" for t in weights))

    folds: list[dict[str, float]] = []
    in_vs_out: list[float] = []
    for k in range(1, args.folds + 1):
        head, rows, note = run_fold(weights, closes, k, args)
        print(f"\n{head} · {note}")
        if rows is None:
            continue
        print(f"  {'mode':<20} in-sample  holdout")
        for mode, (ins, out) in sorted(rows.items(), key=lambda kv: -(kv[1][1] if kv[1][1] is not None else -1e9)):
            print(f"  {LABELS[mode]:<20} {fmt(ins)}      {fmt(out)}")
        holdout = {m: o for m, (_, o) in rows.items() if o is not None and math.isfinite(o)}
        folds.append(holdout)
        pairs = [(i, o) for m, (i, o) in rows.items() if m != "current" and i is not None and o is not None]
        if len(pairs) >= 3:
            rho = spearmanr([a for a, _ in pairs], [b for _, b in pairs]).statistic
            in_vs_out.append(rho)
            print(f"  in-sample vs holdout rank correlation: {rho:+.2f}")

    print("\n=== Summary ===")
    if len(folds) < 2:
        print(f"Only {len(folds)} usable fold(s). Nothing to compare across folds.")
        return
    stab = []
    for a in range(len(folds)):
        for b in range(a + 1, len(folds)):
            shared = sorted(set(folds[a]) & set(folds[b]))
            if len(shared) >= 3:
                stab.append(spearmanr([folds[a][m] for m in shared], [folds[b][m] for m in shared]).statistic)
    print(f"Usable folds: {len(folds)}")
    print(f"Holdout rank stability across folds (mean pairwise Spearman, 1 = same order every year, 0 = random): {np.mean(stab):+.2f}" if stab else "Stability: n/a")
    print(f"In-sample predicts holdout (mean Spearman): {np.mean(in_vs_out):+.2f}" if in_vs_out else "In-sample vs holdout: n/a")
    print(f"\n  {'mode':<20} mean holdout  folds beating equal_weight  folds beating current")
    for mode in ["current", *MODES]:
        vals = [f[mode] for f in folds if mode in f]
        if not vals:
            continue
        beat_eq = sum(1 for f in folds if mode in f and "equal_weight" in f and f[mode] > f["equal_weight"])
        beat_cur = sum(1 for f in folds if mode in f and "current" in f and f[mode] > f["current"])
        print(f"  {LABELS[mode]:<20} {fmt(float(np.mean(vals)))}         {beat_eq}/{len(vals)}                        {beat_cur}/{len(vals)}")


if __name__ == "__main__":
    main()
