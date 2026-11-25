"""Equity scorecards for two market groups, one row per country ETF:
  Developed: U.S. (SPY), Canada (EWC), U.K. (EWU), Eurozone (EZU), Germany (EWG), France (EWQ), Japan (EWJ)
  Emerging:  China (MCHI), Brazil (EWZ), South Korea (EWY), Taiwan (EWT)

Each metric is scored against ABSOLUTE thresholds (so a column can be all green, all red, or mixed):
  green (+1) = at/above the upper threshold, red (-1) = at/below the lower threshold, neutral (0) = in between.

  Macro Score                  LEI Average from the Economic Scorecard (see macro_econ.py)
  Price Momentum               mean of 3M / 6M / 12M % change in the index price implied by fwd EPS x PE
  Price Breadth                % of constituents above their 200d moving average
  Earnings Revisions Momentum  mean % change in fwd EPS over 4w and 13w, across CY1 and CY2
  Earnings Breadth             (cos revised up - down) / all cos, 4w average, across CY1 and CY2
  Overall Composite            weighted mean of the five metric points (Macro Score 40%, other 4 15% each,
                                reweighted over the metrics a market has); green >= +0.4, red <= -0.4

Thresholds: top / bottom third of the weekly history pooled across the markets of the SAME group (EM is
more volatile and would stretch DM's bands); price breadth and Macro Score have no such pooled history to
draw on, so they use fixed 1/3-2/3 (resp. 50%/60%) bands. Macro Score's value is itself already an
own-history percentile (see macro_econ.py's LEI Average), so a fixed 1/3-2/3 band here reproduces
that module's own red/yellow/green decision exactly.

Port of the metrics half of the scorecard project's scorecard.py. The arithmetic is unchanged and runs in
the same order; the port is checked for exact equality against the committed snapshot (see
contracts/tools/macro_port_check.py). What changed: the loaders read the frames of a `MacroInputs`
(app.macro_inputs) instead of a file path, constituent prices and the economic scorecard are parameters,
and thresholds are always pooled across the group.

Data: the CY1 / CY2 estimate workbooks (one tab per ETF, e.g. 'EWC-USA'), the constituents workbooks
(holdings, for price breadth) and constituent prices (a frame with one column per Yahoo symbol).
"""

import numpy as np
import pandas as pd

from app import macro_econ
from app.macro_econ import GROUPS, PCT_HIGH, PCT_LOW
from app.macro_inputs import MARKETS, MacroInputs, yahoo_ticker

# --------------------------------------------------------------------------- data loading


def load_estimates(inputs: MacroInputs, key: str, cy: str) -> pd.DataFrame:
    df = getattr(inputs, cy.lower())[MARKETS[key][1]].copy()
    df["Date"] = pd.to_datetime(df["Date"], format="%d %b '%y", errors="coerce")
    num = df.columns.drop("Date")
    df[num] = df[num].apply(pd.to_numeric, errors="coerce")   # FactSet writes '-' for holidays / pre-inception
    df = df.dropna(subset=["Date", "EPS"])
    # Most tabs are monthly before mid-2015: each month-end snapshot is repeated 4-5 times under one date.
    df = df.drop_duplicates("Date", keep="first").sort_values("Date").set_index("Date")
    if (df.index.to_series().diff().dt.days > 10).any():  # put gappy (monthly / holiday) history on the weekly grid
        grid = pd.date_range(df.index[0], df.index[-1], freq="W-FRI")
        grid = grid.union(df.index[-1:])                     # keep a mid-week latest snapshot
        df = df.reindex(df.index.union(grid)).ffill().loc[grid]
        df.index.name = "Date"
    return df


def load_constituents(inputs: MacroInputs, key: str) -> list[str]:
    c = inputs.constituents[key].iloc[1:]
    return sorted({t for t in map(yahoo_ticker, c.iloc[:, 2]) if t})

# --------------------------------------------------------------------------- metrics

SCORED = ["Macro Score", "Price Momentum", "Price Breadth", "Earnings Revisions Momentum", "Earnings Breadth"]
FIXED_THRESHOLDS = {"Price Breadth": (0.50, 0.60),     # (red at/below, green at/above): no long breadth history
                     "Macro Score": (PCT_LOW, PCT_HIGH)}  # value is already an own-history percentile (0-1)
COMPOSITE_WEIGHTS = {"Macro Score": 0.40, "Price Momentum": 0.15, "Price Breadth": 0.15,          # other 4
                      "Earnings Revisions Momentum": 0.15, "Earnings Breadth": 0.15}               # split evenly
COMPOSITE_BAND = 0.4                                   # composite = weighted mean of +1/0/-1 points


def momentum_history(inputs: MacroInputs, key: str) -> pd.DataFrame:
    """Weekly 3M/6M/12M returns of the index price implied by fwd EPS x fwd PE (USD), and their mean."""
    cy1 = load_estimates(inputs, key, "CY1")
    px = cy1["EPS"] * cy1["PE (x)"]
    out = pd.DataFrame({f"ret_{m}M": px / px.asof(px.index - pd.Timedelta(days=int(m * 30.44))).values - 1
                        for m in (3, 6, 12)}, index=px.index)
    out["value"] = out.mean(axis=1, skipna=False)  # needs the full 12M lookback
    return out


def rollovers(cy1: pd.DataFrame, cy2: pd.DataFrame) -> pd.Series:
    """1 in the week CY1 rolls to the next fiscal year (early March): CY1 jumps to about last week's CY2."""
    a = cy1["EPS"] / cy1["EPS"].shift(1) - 1
    b = cy1["EPS"] / cy2["EPS"].shift(1) - 1
    return ((a.abs() > 0.02) & (b.abs() < a.abs() / 2) & (cy1.index.month <= 3)).astype(int)


def eps_change(cy1: pd.DataFrame, cy2: pd.DataFrame, n: int) -> tuple[pd.Series, pd.Series]:
    """n-week % change in fwd EPS for CY1 and CY2, without the artificial jump at the CY1 rollover."""
    span = rollovers(cy1, cy2).rolling(n).sum()          # rollovers inside the window
    same1 = cy1["EPS"] / cy1["EPS"].shift(n) - 1
    cross = cy1["EPS"] / cy2["EPS"].shift(n) - 1         # window spans a rollover: today's CY1 was then CY2
    same2 = cy2["EPS"] / cy2["EPS"].shift(n) - 1
    return same1.where(span == 0, cross.where(span == 1)), same2.where(span == 0)


def revisions_history(inputs: MacroInputs, key: str) -> pd.DataFrame:
    cy1 = load_estimates(inputs, key, "CY1")
    cy2 = load_estimates(inputs, key, "CY2").reindex(cy1.index)
    out = pd.DataFrame(index=cy1.index)
    for n in (4, 13):
        out[f"eps_chg_{n}w_cy1"], out[f"eps_chg_{n}w_cy2"] = eps_change(cy1, cy2, n)
    out["value"] = out.mean(axis=1)  # CY2 is unavailable for windows spanning the March rollover
    return out


def earnings_breadth_history(inputs: MacroInputs, key: str) -> pd.DataFrame:
    out = pd.DataFrame()
    for cy in ("CY1", "CY2"):
        d = load_estimates(inputs, key, cy)
        net = (d["Num of Cos Up"] - d["Num of Cos Down"]) / d[["Num of Cos Up", "Num of Cos Down", "Num of Cos Unch"]].sum(axis=1)
        out[f"net_{cy.lower()}"] = net.rolling(4).mean()
    out["value"] = out.mean(axis=1)
    return out


def price_momentum(inputs: MacroInputs, key: str) -> dict:
    return momentum_history(inputs, key).iloc[-1].to_dict()


def earnings_revisions(inputs: MacroInputs, key: str) -> dict:
    return revisions_history(inputs, key).iloc[-1].to_dict()


def earnings_breadth(inputs: MacroInputs, key: str) -> dict:
    return earnings_breadth_history(inputs, key).iloc[-1].to_dict()


def macro_score(econ: dict, key: str) -> dict:
    """LEI Average (Option A: value + color pass through from macro_econ.build_econ() unchanged).
    'rows' carries each LEI sub-indicator's own value/color/asof for the tooltip breakdown."""
    region = econ[key]
    return {"value": region["LEI Average"]["pct"], "rows": {r: region[r] for r in macro_econ.LEI_ROWS}}


def breadth_history(inputs: MacroInputs, key: str, prices: pd.DataFrame) -> pd.DataFrame:
    """Daily % of constituents above their 200d moving average, plus the count used each day
    (a ticker only counts on days it has >=200 days of price history behind it, i.e. not yet
    listed / already delisted days are excluded from both the numerator and the denominator)."""
    tickers = [t for t in load_constituents(inputs, key) if t in prices.columns]
    px = prices[tickers].dropna(how="all")   # drop days none of this market's constituents traded
    # `prices` unions every exchange's calendar (US, HK, Shanghai, the Eurozone bourses, ...), so a 200-row window
    # holds fewer than 200 trading days for most tickers. Take each ticker's 200d average over its OWN trading days,
    # then carry price and average across other exchanges' holidays (limit: a delisted ticker drops out after 10 days).
    ma200 = pd.DataFrame({t: px[t].dropna().rolling(200).mean() for t in tickers}, columns=tickers).reindex(px.index)
    px, ma200 = px.ffill(limit=10), ma200.ffill(limit=10)
    valid = px.notna() & ma200.notna()
    used = valid.sum(axis=1)
    pct = (((px > ma200) & valid).sum(axis=1) / used).where(used > 0)
    return pd.DataFrame({"value": pct, "n_used": used}).dropna(subset=["value"])


def price_breadth(inputs: MacroInputs, key: str, prices: pd.DataFrame) -> dict:
    hist = breadth_history(inputs, key, prices)
    n_total = len(load_constituents(inputs, key))
    if hist.empty:
        return {"value": float("nan"), "pct_above_200d": float("nan"), "n_used": 0, "n_total": n_total}
    last = hist.iloc[-1]
    return {"value": float(last["value"]), "pct_above_200d": float(last["value"]),
            "n_used": int(last["n_used"]), "n_total": n_total}


def thresholds(inputs: MacroInputs, keys: list) -> dict:
    """metric -> (red at/below, green at/above), from the history pooled across `keys` (one key = own history)."""
    hist = {"Price Momentum": momentum_history, "Earnings Revisions Momentum": revisions_history,
            "Earnings Breadth": earnings_breadth_history}
    thr = {}
    for name, fn in hist.items():
        v = pd.concat([fn(inputs, k)["value"] for k in keys]).dropna()
        thr[name] = (float(v.quantile(PCT_LOW)), float(v.quantile(PCT_HIGH)))
    thr.update(FIXED_THRESHOLDS)
    return {m: thr[m] for m in SCORED}


def points(v: float, lo: float, hi: float) -> float:
    return np.nan if np.isnan(v) else 1 if v >= hi else -1 if v <= lo else 0


def build_metrics(inputs: MacroInputs, prices: pd.DataFrame, econ: dict) -> dict:
    """group -> (df, detail, thr); thr: market key -> its thresholds (identical across a group: pooled).
    econ is the economic scorecard, built once for every country by macro_econ.build_econ."""
    out = {}
    for group, keys in GROUPS.items():
        raw, detail = {}, {}
        for key in keys:
            d = {"Macro Score": macro_score(econ, key), "Price Momentum": price_momentum(inputs, key),
                 "Price Breadth": price_breadth(inputs, key, prices),
                 "Earnings Revisions Momentum": earnings_revisions(inputs, key),
                 "Earnings Breadth": earnings_breadth(inputs, key)}
            detail[key] = d
            raw[key] = {m: v["value"] for m, v in d.items()}
        df = pd.DataFrame(raw).T.astype(float)
        pooled = thresholds(inputs, keys)
        thr = {k: pooled for k in keys}
        for m in SCORED:
            df[f"{m} pts"] = [points(df.loc[k, m], *thr[k][m]) for k in df.index]
        pts = df[[f"{m} pts" for m in SCORED]]
        w = pd.Series({f"{m} pts": COMPOSITE_WEIGHTS[m] for m in SCORED})
        # reweight over the metrics a market has (e.g. no price breadth when its constituents can't be priced)
        df["Overall Composite"] = (pts * w).sum(axis=1) / pts.notna().mul(w).sum(axis=1)
        z = (df[SCORED] - df[SCORED].mean()) / df[SCORED].std(ddof=0)
        df["Relative Rank Score"] = z.mean(axis=1)  # cross-market z-score: only breaks ties in row order
        out[group] = (df, detail, thr)
    return out

# --------------------------------------------------------------------------- macro vs. market quadrant

MARKET_METRICS = ["Price Momentum", "Price Breadth", "Earnings Revisions Momentum", "Earnings Breadth"]
SHIFTS = {"1M": (1, 4), "3M": (3, 13)}   # comparison horizon -> (months back for macro, weeks back for market)
BREADTH_SCALE = ([0, 0.50, 0.60, 1], [0, PCT_LOW, PCT_HIGH, 1])      # fixed bands -> same 1/3-2/3 cut-offs


def market_score(key: str, hist: dict, breadth: pd.Series, t: pd.Timestamp) -> dict:
    """Mean of the 4 market metrics as percentiles (0-1) as of t: each against the group-pooled history its
    red/green thresholds come from, up to t, so > 2/3 = green -- and price breadth (too short a history)
    mapped linearly through its fixed 50% / 60% bands."""
    pcts = {}
    for m, per in hist.items():
        pooled = pd.concat(per.values())
        pooled, own = pooled[pooled.index <= t], per[key][per[key].index <= t]
        if len(own) and len(pooled):
            pcts[m] = float((pooled <= own.iloc[-1]).mean())
    b = breadth[breadth.index <= t].dropna()
    if len(b):
        pcts["Price Breadth"] = float(np.interp(b.iloc[-1], *BREADTH_SCALE))
    return {"score": float(np.mean(list(pcts.values()))) if pcts else float("nan"),
            "pcts": {m: pcts[m] for m in MARKET_METRICS if m in pcts}}


def quadrant_data(inputs: MacroInputs, group: str, prices: pd.DataFrame, econ: dict, econ_prev: dict,
                  asof: pd.Timestamp) -> list:
    """One point per market: Macro Score (LEI Average percentile) and Market Score, now and for each SHIFTS
    horizon. econ_prev: horizon -> macro_econ.build_econ(lag_months=...)."""
    fns = {"Price Momentum": momentum_history, "Earnings Revisions Momentum": revisions_history,
           "Earnings Breadth": earnings_breadth_history}
    hist = {m: {k: fn(inputs, k)["value"].dropna() for k in GROUPS[group]} for m, fn in fns.items()}
    points = []
    for key in GROUPS[group]:
        breadth = breadth_history(inputs, key, prices)["value"]
        prev = {h: {"macro": econ_prev[h][key]["LEI Average"]["pct"],
                    "market": market_score(key, hist, breadth, asof - pd.Timedelta(weeks=weeks))["score"]}
                for h, (_, weeks) in SHIFTS.items()}
        points.append({"key": key, "name": MARKETS[key][0], "macro": econ[key]["LEI Average"]["pct"],
                       "market": market_score(key, hist, breadth, asof), "prev": prev})
    return points
