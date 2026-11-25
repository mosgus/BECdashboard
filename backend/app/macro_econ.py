"""Economic scorecard by country, split into a Developed and an Emerging market group.

  Developed: U.S., Canada, U.K., Eurozone, Germany, France, Japan
  Emerging:  China, Brazil, South Korea, Taiwan

8 rows, fixed order, flat table:
  Manufacturing PMI, Services PMI, Consumer Sentiment, Housing,           <- LEI
  GDP, Retail Sales, Industrial Production, CPI                          <- CEI

Each cell = percentile of that country's OWN history (2006+, excluding 2008-09 and 2020; growth rows
also exclude 2021, whose YoY rates are inflated by the 2020 base). PMIs and Sentiment are scored as
levels; everything else as YoY % change:
  - GDP comes as QoQ (plain or annualized) for most countries -> compounded over 4 quarters into YoY
  - Housing comes as levels, MoM % or YoY % depending on the country -> all turned into YoY
  - Retail Sales quoted in nominal terms is deflated by that country's CPI (real ~ nominal - CPI)
  - Housing, Retail Sales and Industrial Production are smoothed with a 3-month average
  - CPI is scored as distance from the central bank's target (closer = better), not lower = better

LEI Average = weighted mean of the 4 LEI rows' percentiles (see LEI_WEIGHTS: 80% PMIs [40/40 Mfg/Services],
20% Sentiment + Housing [10/10]), reweighted over the rows a country has. CEI rows are shown but excluded
from the average. Color bands: red < 1/3, yellow 1/3-2/3, green > 2/3. A series whose latest reading lags
the current date by more than STALE_MONTHS is flagged stale (still scored).

Port of the scorecard project's econ_scorecard.py. The arithmetic is unchanged and runs in the same
order; the port is checked for exact equality against the committed snapshot (see
contracts/tools/macro_port_check.py). The one structural change: the loaders read the frames of a
`MacroInputs` (app.macro_inputs) instead of a file path, and the current date is a parameter.

Sources (uploaded workbooks, see app.macro_inputs):
  Bloomberg macro values   Sentiment, Housing, GDP, Retail, IP, CPI (one tab per indicator,
                           one date/value column pair per country)
  PMIs                     'All PMIs' (manufacturing) + 'All Services PMIs' tabs, S&P Global
"""

import datetime as dt

import numpy as np
import pandas as pd

from app.macro_inputs import MACRO_COL, MACRO_SHEET, PMI_COL, MacroInputs

LABEL = {"US": "U.S.", "CA": "Canada", "UK": "U.K.", "EZ": "Eurozone", "DE": "Germany", "FR": "France",
         "JP": "Japan", "CN": "China", "BR": "Brazil", "KR": "South Korea", "TW": "Taiwan"}
GROUPS = {"DM": ["US", "CA", "UK", "EZ", "DE", "FR", "JP"], "EM": ["CN", "BR", "KR", "TW"]}
GROUP_LABEL = {"DM": "Developed Market", "EM": "Emerging Market"}
COUNTRIES = [k for g in GROUPS.values() for k in g]

LEI_ROWS = ["Manufacturing PMI", "Services PMI", "Consumer Sentiment", "Housing"]
LEI_WEIGHTS = {"Manufacturing PMI": 0.40, "Services PMI": 0.40,        # PMIs: 80%, split evenly
               "Consumer Sentiment": 0.10, "Housing": 0.10}            # Sentiment + Housing: 20%, split evenly
CEI_ROWS = ["GDP", "Retail Sales", "Industrial Production", "CPI"]
ROWS = LEI_ROWS + CEI_ROWS
LEVEL_ROWS = {"Manufacturing PMI", "Services PMI", "Consumer Sentiment"}   # scored as level; rest as YoY
GROWTH_ROWS = {"Housing", "GDP", "Retail Sales", "Industrial Production"}  # also exclude 2021 from history
SMOOTH_ROWS = {"Housing", "Retail Sales", "Industrial Production"}         # 3-month average

HIST_START = "2006-01-01"
CRISIS_WINDOWS = [("2008-01-01", "2009-12-31"), ("2020-01-01", "2020-12-31")]
BASE_EFFECT_WINDOWS = [("2021-01-01", "2021-12-31")]
PCT_LOW, PCT_HIGH = 1 / 3, 2 / 3
STALE_MONTHS = {"monthly": 4, "quarterly": 6}    # max lag (months) from the current date before a reading is flagged

CPI_TARGET = {k: 2.0 for k in COUNTRIES} | {"BR": 3.0}   # % YoY; China's target is "around 2%" since 2025

# --------------------------------------------------------------------------- what each Bloomberg series is
# MACRO_SHEET, MACRO_COL and PMI_COL (imported above) map a scorecard row / country key to the workbook's
# sheet name and column headers.

# How the raw series is quoted (default: "level" for LEVEL_ROWS, "yoy" otherwise):
#   yoy       already YoY %            mom      MoM %, compounded over 12 months
#   level     index/count, YoY taken   qoq      QoQ %, compounded over 4 quarters
#   qoq_saar  annualized QoQ %, de-annualized then compounded over 4 quarters
QUOTED = {
    ("US", "Housing"): "mom", ("EZ", "Housing"): "level", ("DE", "Housing"): "level",
    ("UK", "Housing"): "level", ("BR", "Housing"): "level", ("KR", "Housing"): "level",
    **{(k, "GDP"): "qoq" for k in ("EZ", "DE", "FR", "UK", "CN", "BR", "KR")},
    **{(k, "GDP"): "qoq_saar" for k in ("US", "CA", "JP")},
}
NOMINAL_RETAIL = {"US", "CA", "CN", "JP", "TW"}   # value-based retail series -> deflated by CPI

# Series we know are wrong/unavailable: shown as n/a, left out of the average.
MISSING = {
    ("CA", "Industrial Production"): "Bloomberg CAIPYOY is producer prices, not output - needs re-pull",
    ("TW", "Housing"): "Bloomberg TWBPYOY returns 'Invalid Security' - needs re-pull",
    **{(k, "Services PMI"): "No S&P Global services PMI is published" for k in ("CA", "KR", "TW")},
}
# Shown in the tooltip: where a series measures something other than the row's name suggests.
NOTES = {
    ("US", "Consumer Sentiment"): "UMich headline sentiment",
    ("JP", "Consumer Sentiment"): "BoJ opinion survey, quarterly",
    ("CA", "Consumer Sentiment"): "Bloomberg Nanos weekly index (monthly last)",
    ("US", "Housing"): "building permits",
    ("CA", "Housing"): "OECD construction orders",
    ("EZ", "Housing"): "residential permits", ("DE", "Housing"): "building permits",
    ("FR", "Housing"): "authorized new dwellings", ("KR", "Housing"): "building permits",
    ("UK", "Housing"): "housing starts (England), quarterly",
    ("CN", "Housing"): "floor space started, year-to-date YoY",
    ("BR", "Housing"): "Sao Paulo only (Secovi)", ("JP", "Housing"): "housing starts",
    ("JP", "Retail Sales"): "department stores & supermarkets only",
}

# --------------------------------------------------------------------------- loaders


def _month_start(s: pd.Series) -> pd.Series:
    """Re-date to the 1st of the month, keeping the last reading in each month (weekly -> monthly)."""
    s = s.copy()
    s.index = pd.DatetimeIndex(s.index).to_period("M").to_timestamp()
    return s.groupby(level=0).last()


def macro_sheet(inputs: MacroInputs, sheet: str) -> dict[str, tuple[str, pd.Series]]:
    """country column header -> (Bloomberg ticker, series), from one tab of the Bloomberg macro file."""
    df = inputs.macro[sheet]
    out = {}
    for c in range(0, df.shape[1] - 1, 2):
        d = pd.to_datetime(df.iloc[2:, c], errors="coerce")
        v = pd.to_numeric(df.iloc[2:, c + 1], errors="coerce")
        ok = d.notna() & v.notna()
        out[str(df.iat[0, c]).strip()] = (str(df.iat[1, c]).strip(),
                                          _month_start(pd.Series(v[ok].values, index=d[ok].values)))
    return out


def pmi_sheet(inputs: MacroInputs, sheet: str) -> pd.DataFrame:
    df = inputs.pmis[sheet]
    df = df[pd.to_datetime(df["Date"], errors="coerce").notna()]
    df = df.set_index(pd.to_datetime(df["Date"])).drop(columns="Date").apply(pd.to_numeric, errors="coerce")
    df.columns = ["China" if c.startswith("China") else c for c in df.columns]   # 'China (S&P Global/HSBC)'
    return df


def pmi_series(inputs: MacroInputs, key: str, sheet: str = "All PMIs") -> pd.Series:
    df = pmi_sheet(inputs, sheet)
    return df[PMI_COL[key]].dropna() if PMI_COL[key] in df else pd.Series(dtype=float)


def raw_series(inputs: MacroInputs, key: str, row: str) -> tuple[pd.Series, str]:
    """(series as published, source label)."""
    if row == "Manufacturing PMI":
        return pmi_series(inputs, key, "All PMIs"), "S&P Global Manufacturing PMI"
    if row == "Services PMI":
        return pmi_series(inputs, key, "All Services PMIs"), "S&P Global Services PMI"
    ticker, s = macro_sheet(inputs, MACRO_SHEET[row])[MACRO_COL[key]]
    return s, ticker

# --------------------------------------------------------------------------- transforms


def frequency(s: pd.Series) -> str:
    return "quarterly" if pd.Series(s.index).diff().dt.days.median() > 60 else "monthly"


def _grid(s: pd.Series) -> pd.Series:
    """Put on a gap-free monthly (or quarterly) grid so shifts/rolls count periods, not rows."""
    step = "3MS" if frequency(s) == "quarterly" else "MS"
    return s.reindex(pd.date_range(s.index[0], s.index[-1], freq=step))


def drop_placeholder(s: pd.Series) -> pd.Series:
    """A trailing exact 0 in a series otherwise quoted to 2+ decimals is an unpublished placeholder."""
    if len(s) > 12 and s.iloc[-1] == 0 and ((s.iloc[:-1] * 10).round(6) % 1 != 0).mean() > 0.5:
        return s.iloc[:-1]
    return s


def to_yoy(s: pd.Series, quoted: str) -> pd.Series:
    g = _grid(s)
    periods = 4 if frequency(s) == "quarterly" else 12
    if quoted == "yoy":
        return s
    if quoted == "level":
        return (g / g.shift(periods) - 1) * 100
    if quoted == "mom":
        return ((1 + g / 100).rolling(12).apply(np.prod, raw=True) - 1) * 100
    if quoted in ("qoq", "qoq_saar"):
        q = (1 + g / 100) ** (0.25 if quoted == "qoq_saar" else 1)
        return (q.rolling(4).apply(np.prod, raw=True) - 1) * 100
    raise ValueError(quoted)


def scored_series(inputs: MacroInputs, key: str, row: str) -> tuple[pd.Series, pd.Series, str]:
    """(series shown as the cell's value, series that gets percentile-ranked, measure description)."""
    raw, source = raw_series(inputs, key, row)
    raw = drop_placeholder(raw.dropna().sort_index())
    if row in LEVEL_ROWS:
        return raw, raw, f"level ({source})"
    quoted = QUOTED.get((key, row), "yoy")
    s = to_yoy(raw, quoted).dropna()
    measure = "YoY %" + {"mom": " (compounded from MoM)", "qoq": " (compounded from QoQ)",
                         "qoq_saar": " (from annualized QoQ)", "level": " (from level)"}.get(quoted, "")
    if row == "Retail Sales" and key in NOMINAL_RETAIL:
        cpi = macro_sheet(inputs, MACRO_SHEET["CPI"])[MACRO_COL[key]][1]
        s = (((1 + s / 100) / (1 + cpi.reindex(s.index) / 100)) - 1).dropna() * 100
        measure += ", real (nominal deflated by CPI)"
    if row in SMOOTH_ROWS and frequency(s) == "monthly":
        s = _grid(s).rolling(3, min_periods=2).mean().dropna()
        measure += ", 3-month avg"
    if row == "CPI":
        return s, -(s - CPI_TARGET[key]).abs(), f"{measure} ({source}); scored by distance from {CPI_TARGET[key]:g}% target"
    return s, s, f"{measure} ({source})"

# --------------------------------------------------------------------------- percentile scoring


def history(scored: pd.Series, row: str) -> pd.Series:
    hist = scored[scored.index >= HIST_START]
    for lo, hi in CRISIS_WINDOWS + (BASE_EFFECT_WINDOWS if row in GROWTH_ROWS else []):
        hist = hist[(hist.index < lo) | (hist.index > hi)]
    return hist


def color_for(pct: float) -> str | None:
    if np.isnan(pct):
        return None
    return "red" if pct < PCT_LOW else "green" if pct > PCT_HIGH else "yellow"


def asof_label(ts: pd.Timestamp, freq: str) -> str:
    return f"Q{(ts.month - 1) // 3 + 1}-{ts:%y}" if freq == "quarterly" else ts.strftime("%b-%y")


def months_behind(ts: pd.Timestamp, today: dt.date) -> int:
    return (today.year - ts.year) * 12 + today.month - ts.month


def cell(inputs: MacroInputs, key: str, row: str, today: dt.date, lag_months: int = 0) -> dict:
    """lag_months > 0: the cell as it read that many months earlier -- each series cut off that far before its
    latest reading (same publication lag as now), percentile history cut off with it. Uses today's revised data."""
    blank = {"value": float("nan"), "pct": float("nan"), "color": None, "asof": "", "stale": False,
             "measure": "", "note": NOTES.get((key, row), ""), "missing": None}
    if (key, row) in MISSING:
        return blank | {"missing": MISSING[(key, row)]}
    shown, scored, measure = scored_series(inputs, key, row)
    scored = scored.dropna()
    if lag_months and not scored.empty:
        scored = scored[scored.index <= scored.index[-1] - pd.DateOffset(months=lag_months)]
    if scored.empty:
        return blank | {"missing": "No data in source file"}
    hist = history(scored, row)
    latest_ts = scored.index[-1]
    freq = frequency(scored)
    # a quarterly figure dated by its first month (Apr-26 = Q2) is only complete 2 months later
    lag = months_behind(latest_ts, today) - (2 if freq == "quarterly" and latest_ts.month % 3 == 1 else 0)
    pct = float((hist <= scored.iloc[-1]).mean()) if len(hist) else float("nan")
    return {"value": float(shown.loc[latest_ts]), "pct": pct, "color": color_for(pct),
            "asof": asof_label(latest_ts, freq), "stale": lag > STALE_MONTHS[freq],
            "measure": measure, "note": NOTES.get((key, row), ""), "missing": None,
            "hist_start": hist.index[0].strftime("%b-%y") if len(hist) else ""}

# --------------------------------------------------------------------------- build


def lei_average(country: dict) -> dict:
    avail = {r: country[r]["pct"] for r in LEI_ROWS if not np.isnan(country[r]["pct"])}
    w_sum = sum(LEI_WEIGHTS[r] for r in avail)
    avg = sum(LEI_WEIGHTS[r] * v for r, v in avail.items()) / w_sum if w_sum else float("nan")
    weights = {r: LEI_WEIGHTS[r] / w_sum for r in avail} if w_sum else {}
    return {"value": avg, "pct": avg, "color": color_for(avg), "asof": "", "stale": False,
            "measure": "", "note": "", "missing": None if avail else "No LEI rows available", "weights": weights}


def build_econ(inputs: MacroInputs, today: dt.date, lag_months: int = 0) -> dict:
    """country key -> {row: cell dict} for every row in ROWS, plus 'LEI Average'. See cell() for lag_months."""
    out = {}
    for key in COUNTRIES:
        out[key] = {row: cell(inputs, key, row, today, lag_months) for row in ROWS}
        out[key]["LEI Average"] = lei_average(out[key])
    return out
