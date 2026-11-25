"""The 15 uploaded files the Macro scorecard is built from, their parsers, and format templates.

Pure: no database, no network, no filesystem. Bytes in, frames out.

`parse_slot` turns one uploaded workbook into exactly the frames the scorecard project read from
disk with `pd.read_excel`, or raises `MacroInputError` with a message a user can act on. It checks
only what the scorecard actually reads. `template_workbook` writes a workbook with the real
export's structure (sheet names, header rows, column order, date formats) and entirely synthetic
values. It is the "Sample data" download: the licensed FactSet / Bloomberg / S&P Global exports
themselves are never served.

Port of the loaders in the scorecard project's `scorecard.py` and `econ_scorecard.py`. The
calculations that consume these frames are not ported here.
"""

import re
import zlib
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from io import BytesIO

import numpy as np
import pandas as pd
from openpyxl import Workbook

MARKETS = {  # key -> (label, CY1/CY2 tab, constituents file prefix)
    "US": ("U.S.", "SPY-USA", "SPX"), "CA": ("Canada", "EWC-USA", "EWC"), "UK": ("U.K.", "EWU-USA", "EWU"),
    "EZ": ("Eurozone", "EZU-USA", "EZU"), "DE": ("Germany", "EWG-USA", "EWG"), "FR": ("France", "EWQ-USA", "EWQ"),
    "JP": ("Japan", "EWJ-USA", "EWJ"),
    "CN": ("China", "MCHI-USA", "MCHI"), "BR": ("Brazil", "EWZ-USA", "EWZ"), "KR": ("South Korea", "EWY-USA", "EWY"),
    "TW": ("Taiwan", "EWT-USA", "EWT"),
}

# FactSet country code (the part after the last "-" in a holdings ticker) -> Yahoo suffix.
YF_SUFFIX = {"FR": ".PA", "DE": ".DE", "IT": ".MI", "NL": ".AS", "ES": ".MC", "FI": ".HE",
             "BE": ".BR", "AT": ".VI", "IE": ".IR", "PT": ".LS", "GB": ".L", "JP": ".T",
             "CA": ".TO", "BR": ".SA", "KR": ".KS", "TW": ".TW"}

MACRO_SHEET = {"Consumer Sentiment": "Consumer Sentiment", "Housing": "Housing Permits YoY", "GDP": "GDP YoY",
               "Retail Sales": "Retail Sales YoY", "Industrial Production": "Industrial Prod YoY", "CPI": "CPI YoY"}
MACRO_COL = {"US": "US", "CA": "Canada", "UK": "UK", "EZ": "Eurozone", "DE": "Germany", "FR": "France",
             "JP": "Japan", "CN": "China", "BR": "Brazil", "KR": "South Korea", "TW": "Taiwan"}
PMI_COL = {"US": "United States", "CA": "Canada", "UK": "United Kingdom", "EZ": "Euro Area", "DE": "Germany",
           "FR": "France", "JP": "Japan", "CN": "China", "BR": "Brazil", "KR": "South Korea", "TW": "Taiwan"}

# The (country, row) pairs the economic scorecard never looks up: it shows them as n/a before reading
# the series. A workbook need not have them.
_MISSING_MACRO = {("CA", "Industrial Production"), ("TW", "Housing")}
_MISSING_SERVICES_PMI = {"CA", "KR", "TW"}

_CY_COLUMNS = ["Date", "EPS", "Earnings Growth (%)", "PE (x)", "PEG (x)", "Num of Cos Up", "Num of Cos Down",
               "Num of Cos Unch"]
_CY_REQUIRED = ["Date", "EPS", "PE (x)", "Num of Cos Up", "Num of Cos Down", "Num of Cos Unch"]
_CY_DATE_FORMAT = "%d %b '%y"
_ZIP_SIGNATURE = b"PK\x03\x04"

# Constituents wrong-market guard: the FactSet country codes a market's holdings are expected to carry.
_EXPECTED_CODES = {
    "US": {"US"}, "CA": {"CA"}, "UK": {"GB"}, "DE": {"DE"}, "FR": {"FR"}, "JP": {"JP"}, "CN": {"CN", "HK"},
    "BR": {"BR"}, "KR": {"KR"}, "TW": {"TW"},
    "EZ": {"FR", "DE", "IT", "NL", "ES", "FI", "BE", "AT", "IE", "PT"},
}
_MIN_EXPECTED_SHARE = 0.5
_EZ_MIN_CODES = 3
_EZ_MIN_CODE_SHARE = 0.05
_CODED_TICKER = re.compile(r".+-([A-Z]{2})")

TEMPLATE_END = date(2026, 10, 30)  # a Friday; the last date in every dated template


@dataclass(frozen=True)
class Slot:
    id: str
    label: str  # shown to users in the upload dialog
    source: str  # "FactSet" | "Bloomberg" | "S&P Global"
    filename: str  # the conventional export name; also the template's download name
    market: str | None  # MARKETS key for a constituents slot, else None


SLOTS: tuple[Slot, ...] = (
    Slot("cy1", "CY1 forward EPS estimates", "FactSet", "CY1.xlsx", None),
    Slot("cy2", "CY2 forward EPS estimates", "FactSet", "CY2.xlsx", None),
    Slot("macro", "Bloomberg macro series", "Bloomberg", "Bloomberg_Macro_Data_Values.xlsx", None),
    Slot("pmis", "S&P Global PMIs", "S&P Global", "PMIs.xlsx", None),
    *(Slot(f"cons_{prefix.lower()}", f"{label} holdings ({prefix})", "FactSet", f"{prefix}CONS.xlsx", key)
      for key, (label, _tab, prefix) in MARKETS.items()),
)
_SLOT_BY_ID = {slot.id: slot for slot in SLOTS}


class MacroInputError(ValueError):
    """An uploaded workbook the scorecard cannot use. str(exc) is for the person who uploaded it."""

    def __init__(self, slot_id: str, message: str):
        super().__init__(message)
        self.slot_id = slot_id


@dataclass(frozen=True)
class ParsedSlot:
    slot_id: str
    data_through: date | None  # newest date in the file; None for constituents (they carry no date)
    frames: dict[str, pd.DataFrame]


@dataclass(frozen=True)
class MacroInputs:
    cy1: dict[str, pd.DataFrame]  # CY tab name -> frame, the 11 MARKETS tabs only
    cy2: dict[str, pd.DataFrame]
    macro: dict[str, pd.DataFrame]  # the six MACRO_SHEET sheet names -> frame
    pmis: dict[str, pd.DataFrame]  # "All PMIs", "All Services PMIs" -> frame
    constituents: dict[str, pd.DataFrame]  # MARKETS key -> frame


def yahoo_ticker(code: str) -> str | None:
    """'8306-JP' -> '8306.T', 'BRK.B-US' -> 'BRK-B', 'NDA.FI-FI' -> 'NDA-FI.HE', '700-HK' -> '0700.HK',
    '600519-CN' -> '600519.SS', '000858-CN' -> '000858.SZ'. None for cash/other rows."""
    if not isinstance(code, str) or "-" not in code or code == "-" or code.startswith("FOUSA"):
        return None
    sym, country = code.rsplit("-", 1)
    if country == "US":
        return sym.replace(".", "-")
    if country == "HK":
        return sym.zfill(4) + ".HK"
    if country == "CN":  # A-shares: 6xxxxx / 9xxxxx Shanghai, 0xxxxx / 3xxxxx Shenzhen
        return sym + (".SS" if sym[0] in "69" else ".SZ")
    if country not in YF_SUFFIX:
        return None
    return sym.replace(".", "-") + YF_SUFFIX[country]


# --------------------------------------------------------------------------- parsing


def _not_xlsx(slot: Slot) -> MacroInputError:
    return MacroInputError(slot.id, f"{slot.label}: the file must be an .xlsx workbook, and this one could not be opened.")


def _load_book(slot: Slot, content: bytes) -> pd.ExcelFile:
    if not content.startswith(_ZIP_SIGNATURE):
        raise _not_xlsx(slot)
    try:
        return pd.ExcelFile(BytesIO(content), engine="openpyxl")
    except Exception:  # BadZipFile, InvalidFileException, XML errors: all mean "not a usable workbook"
        raise _not_xlsx(slot) from None


def _read(slot: Slot, book: pd.ExcelFile, **kwargs):
    try:
        return pd.read_excel(book, **kwargs)
    except Exception:  # a sheet whose XML is damaged is as unusable as a file that is not a workbook
        raise _not_xlsx(slot) from None


def _quoted(names) -> str:
    return ", ".join(f"'{name}'" for name in names)


def _require_sheets(slot: Slot, book: pd.ExcelFile, names: list[str]) -> None:
    missing = [name for name in names if name not in book.sheet_names]
    if missing:
        plural = "sheets" if len(missing) > 1 else "sheet"
        raise MacroInputError(slot.id, f"{slot.label}: missing {plural} {_quoted(missing)}.")


def _newest(dates: pd.Series) -> date | None:
    newest = pd.to_datetime(dates, errors="coerce").max()
    return None if pd.isna(newest) else newest.date()


def _later(a: date | None, b: date | None) -> date | None:
    return b if a is None else a if b is None else max(a, b)


def _parse_cy(slot: Slot, book: pd.ExcelFile) -> ParsedSlot:
    tabs = [tab for _label, tab, _prefix in MARKETS.values()]
    _require_sheets(slot, book, tabs)
    frames = _read(slot, book, sheet_name=tabs, header=2)
    data_through = None
    for tab in tabs:
        df = frames[tab]
        missing = [column for column in _CY_REQUIRED if column not in df.columns]
        if missing:
            raise MacroInputError(
                slot.id, f"{slot.label}: sheet '{tab}' has no {_quoted(missing)} column in its header row (row 3).")
        dates = pd.to_datetime(df["Date"], format=_CY_DATE_FORMAT, errors="coerce")
        usable = dates.notna() & pd.to_numeric(df["EPS"], errors="coerce").notna()
        if not usable.any():
            raise MacroInputError(
                slot.id, f"{slot.label}: sheet '{tab}' has no row with a date like 05 Nov '26 and a numeric EPS.")
        data_through = _later(data_through, dates[usable].max().date())
    return ParsedSlot(slot.id, data_through, dict(frames))


def _parse_macro(slot: Slot, book: pd.ExcelFile) -> ParsedSlot:
    sheets = list(MACRO_SHEET.values())
    _require_sheets(slot, book, sheets)
    frames = _read(slot, book, sheet_name=sheets, header=None)
    data_through = None
    for row, sheet in MACRO_SHEET.items():
        df = frames[sheet]
        pairs = range(0, df.shape[1] - 1, 2)
        headers = {str(df.iat[0, c]).strip() for c in pairs} if len(df) else set()
        missing = [MACRO_COL[key] for key in MACRO_COL if (key, row) not in _MISSING_MACRO
                   and MACRO_COL[key] not in headers]
        if missing:
            raise MacroInputError(
                slot.id, f"{slot.label}: sheet '{sheet}' has no column pair headed {_quoted(missing)} in row 1.")
        for c in pairs:
            data_through = _later(data_through, _newest(df.iloc[2:, c]))
    return ParsedSlot(slot.id, data_through, dict(frames))


def _parse_pmis(slot: Slot, book: pd.ExcelFile) -> ParsedSlot:
    sheets = ["All PMIs", "All Services PMIs"]
    _require_sheets(slot, book, sheets)
    frames = _read(slot, book, sheet_name=sheets)
    data_through = None
    for sheet in sheets:
        df = frames[sheet]
        if "Date" not in df.columns:
            raise MacroInputError(slot.id, f"{slot.label}: sheet '{sheet}' has no 'Date' column.")
        names = [str(column) for column in df.columns]
        skipped = _MISSING_SERVICES_PMI if sheet == "All Services PMIs" else set()
        missing = []
        for key, name in PMI_COL.items():
            if key in skipped:
                continue
            found = any(n.startswith("China") for n in names) if key == "CN" else name in names
            if not found:
                missing.append(name)
        if missing:
            raise MacroInputError(slot.id, f"{slot.label}: sheet '{sheet}' has no column {_quoted(missing)}.")
        data_through = _later(data_through, _newest(df["Date"]))
    return ParsedSlot(slot.id, data_through, dict(frames))


def _wrong_market(slot: Slot) -> MacroInputError:
    label, _tab, prefix = MARKETS[slot.market]
    return MacroInputError(slot.id, f"This doesn't look like the {label} ({prefix}) holdings file.")


def _parse_constituents(slot: Slot, book: pd.ExcelFile) -> ParsedSlot:
    df = _read(slot, book, sheet_name=0)
    if df.shape[1] < 3 or str(df.columns[2]).strip() != "Ticker":
        raise MacroInputError(
            slot.id, f"{slot.label}: the third column must be headed 'Ticker' (holdings export: name, weight, ticker).")
    tickers = df.iloc[1:, 2]  # the first data row is the "Total (Count: N)" row
    if not any(yahoo_ticker(t) for t in tickers):
        raise MacroInputError(slot.id, f"{slot.label}: no ticker in the 'Ticker' column maps to a Yahoo symbol.")
    codes = [m.group(1) for m in (_CODED_TICKER.fullmatch(t) for t in tickers if isinstance(t, str)) if m]
    expected = _EXPECTED_CODES[slot.market]
    if not codes or sum(code in expected for code in codes) / len(codes) < _MIN_EXPECTED_SHARE:
        raise _wrong_market(slot)
    if slot.market == "EZ":
        counts = Counter(code for code in codes if code in expected)
        if sum(n / len(codes) >= _EZ_MIN_CODE_SHARE for n in counts.values()) < _EZ_MIN_CODES:
            raise _wrong_market(slot)
    return ParsedSlot(slot.id, None, {"holdings": df})


_PARSERS = {"cy1": _parse_cy, "cy2": _parse_cy, "macro": _parse_macro, "pmis": _parse_pmis}


def parse_slot(slot_id: str, content: bytes) -> ParsedSlot:
    slot = _SLOT_BY_ID[slot_id]  # unknown slot_id -> KeyError
    book = _load_book(slot, content)
    return _PARSERS.get(slot_id, _parse_constituents)(slot, book)


def parse_inputs(files: Mapping[str, bytes]) -> MacroInputs:
    parsed = {}
    for slot in SLOTS:
        if slot.id not in files:
            raise MacroInputError(slot.id, f"No file uploaded for {slot.label}")
        parsed[slot.id] = parse_slot(slot.id, files[slot.id])
    return MacroInputs(
        cy1=parsed["cy1"].frames,
        cy2=parsed["cy2"].frames,
        macro=parsed["macro"].frames,
        pmis=parsed["pmis"].frames,
        constituents={slot.market: parsed[slot.id].frames["holdings"] for slot in SLOTS if slot.market},
    )


# --------------------------------------------------------------------------- templates
# Structure is copied from the real exports: sheet names and order, header rows, column order and
# date formats. Every value is generated.

# The real CY books list the tabs in this order, which is not MARKETS' order.
_CY_TAB_ORDER = ["SPY-USA", "EWJ-USA", "EZU-USA", "EWY-USA", "EWT-USA", "MCHI-USA", "EWZ-USA", "EWU-USA",
                 "EWC-USA", "EWQ-USA", "EWG-USA"]
_CY_FORMATS = [None, "#,##0.00", "#,##0.0", "#,##0.0", "#,##0.0", "#,##0", "#,##0", "#,##0"]

# The real Bloomberg workbook: one tab per indicator, then two the scorecard ignores. Each indicator tab
# holds one (date, value) column pair per country, in this order, country name in row 1, ticker in row 2.
_MACRO_COUNTRY_ORDER = ["US", "Canada", "Eurozone", "Germany", "France", "UK", "China", "Brazil", "South Korea",
                        "Japan", "Taiwan"]
_MACRO_SHEET_ORDER = [*MACRO_SHEET.values(), "Credit", "Series Descriptions"]
_DESCRIPTION_COLUMNS = ["Category (Tab)", "Country", "Ticker", "Name", "Short Description", "Frequency", "Source",
                        "Long Description (spills right)"]
# Series the scorecard divides by or compounds: these must stay positive levels, not +/- rates.
_LEVEL_HOUSING = {"Eurozone", "Germany", "UK", "Brazil", "South Korea"}
_ANNUALIZED_GDP = {"US", "Canada", "Japan"}

_MANUFACTURING_PMI_COLUMNS = [
    "Date", "Global", "United States", "Canada", "United Kingdom", "Euro Area", "Germany", "France", "Italy",
    "Spain", "Greece", "Ireland", "China (S&P Global/HSBC)", "Japan", "Brazil", "India", "Russia", "Mexico",
    "South Korea", "Indonesia", "Taiwan", "Turkey", "Czech Republic", "Poland"]
_SERVICES_PMI_COLUMNS = [
    "Date", "Global", "United States", "United Kingdom", "Euro Area", "Germany", "France", "Italy", "Spain",
    "Ireland", "China", "Japan", "Brazil", "India", "Russia"]

_TEMPLATE_ROWS = 20
_TEMPLATE_CODES = {"US": ["US"], "CA": ["CA"], "UK": ["GB"], "EZ": ["FR", "DE", "IT", "NL"], "DE": ["DE"],
                   "FR": ["FR"], "JP": ["JP"], "CN": ["CN", "HK"], "BR": ["BR"], "KR": ["KR"], "TW": ["TW"]}


def _rng(slot_id: str) -> np.random.Generator:
    return np.random.default_rng(zlib.crc32(slot_id.encode()))  # not hash(): that varies per process


def _walk(rng: np.random.Generator, n: int, mean: float, sd: float, persistence: float = 0.9) -> np.ndarray:
    """A mean-reverting random series, so the values drift without running away."""
    out = np.empty(n)
    x = mean
    for i in range(n):
        x = mean + persistence * (x - mean) + sd * rng.standard_normal()
        out[i] = x
    return out


def _bytes(workbook: Workbook) -> bytes:
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _cy_template(slot_id: str, rng: np.random.Generator) -> bytes:
    weeks = pd.date_range("2016-01-01", TEMPLATE_END, freq="W-FRI")[::-1]  # newest first, like the export
    n = len(weeks)
    dates = [f"{d.strftime('%d %b')} '{d.strftime('%y')}" for d in weeks]
    wb = Workbook()
    wb.remove(wb.active)
    for tab in _CY_TAB_ORDER:
        base = rng.uniform(3, 30) * (1.08 if slot_id == "cy2" else 1.0)
        eps = base * np.exp(np.cumsum(rng.normal(0.0008, 0.01, n)))[::-1]  # oldest first drifting up, then flipped
        growth = rng.normal(8, 4, n)
        pe = np.clip(_walk(rng, n, 20, 1.2), 10, 30)
        peg = np.abs(pe / np.maximum(np.abs(growth), 1.0))
        up = rng.integers(1, 41, n)
        down = rng.integers(1, 41, n)
        unch = rng.integers(0, 15, n)
        ws = wb.create_sheet(tab)
        ws["A1"] = tab
        ws["A2"] = "Estimate History"
        ws.append(_CY_COLUMNS)
        for i in range(n):
            ws.append([dates[i], float(eps[i]), float(growth[i]), float(pe[i]), float(peg[i]),
                       int(up[i]), int(down[i]), int(unch[i])])
        for row in ws.iter_rows(min_row=4, max_row=n + 3):
            for cell, fmt in zip(row, _CY_FORMATS):
                if fmt:
                    cell.number_format = fmt
    return _bytes(wb)


def _macro_series(rng: np.random.Generator, sheet: str, country: str, n: int) -> np.ndarray:
    if sheet == "Consumer Sentiment":
        values = _walk(rng, n, rng.uniform(60, 100), 3.0)
    elif sheet == "Housing Permits YoY":
        values = _walk(rng, n, rng.uniform(100, 160), 4.0) if country in _LEVEL_HOUSING else _walk(rng, n, 2, 3.0)
    elif sheet == "GDP YoY":
        values = _walk(rng, n, 0.6, 0.6, 0.6) * (4 if country in _ANNUALIZED_GDP else 1)
    elif sheet == "Retail Sales YoY":
        values = _walk(rng, n, 3, 1.5)
    elif sheet == "Industrial Prod YoY":
        values = _walk(rng, n, 1.5, 2.0)
    elif sheet == "CPI YoY":
        values = _walk(rng, n, 2.5, 0.4)
    else:  # Credit
        values = _walk(rng, n, 1, 0.5)
    values = np.round(values, 2)
    if values[-1] == 0:  # a trailing exact 0 is read as an unpublished placeholder
        values[-1] = 0.1
    return values


def _macro_template(rng: np.random.Generator) -> bytes:
    monthly = pd.date_range("2006-01-31", "2026-10-31", freq="ME")
    quarterly = pd.date_range("2006-01-31", "2026-09-30", freq="QE")
    wb = Workbook()
    wb.remove(wb.active)
    ticker_no = 0
    for sheet in _MACRO_SHEET_ORDER[:-1]:
        ws = wb.create_sheet(sheet)
        dates = quarterly if sheet == "GDP YoY" else monthly
        n = len(dates)
        py_dates = [d.to_pydatetime() for d in dates]
        for j, country in enumerate(_MACRO_COUNTRY_ORDER):
            ticker_no += 1
            ws.cell(row=1, column=2 * j + 1, value=country)
            ws.cell(row=2, column=2 * j + 1, value=f"SAMPLE{ticker_no} Index")
            values = _macro_series(rng, sheet, country, n)
            for i in range(n):
                date_cell = ws.cell(row=i + 3, column=2 * j + 1, value=py_dates[i])
                date_cell.number_format = "mm-dd-yy"
                ws.cell(row=i + 3, column=2 * j + 2, value=float(values[i]))
    ws = wb.create_sheet("Series Descriptions")
    ws.append(_DESCRIPTION_COLUMNS)
    number = 0
    for sheet in _MACRO_SHEET_ORDER[:-1]:
        for country in _MACRO_COUNTRY_ORDER:
            number += 1
            ws.append([sheet, country, f"SAMPLE{number} Index", f"Sample series {number}",
                       f"Sample series {number}", "Quarterly" if sheet == "GDP YoY" else "Monthly",
                       "Synthetic", "Made-up values in the layout of the real export."])
    return _bytes(wb)


def _pmi_template(rng: np.random.Generator) -> bytes:
    months = pd.date_range("2006-01-01", "2026-10-01", freq="MS")
    n = len(months)
    wb = Workbook()
    wb.remove(wb.active)
    for sheet, columns in (("All PMIs", _MANUFACTURING_PMI_COLUMNS), ("All Services PMIs", _SERVICES_PMI_COLUMNS)):
        ws = wb.create_sheet(sheet)
        ws.append(columns)
        series = [np.round(np.clip(_walk(rng, n, 50, 1.5), 40, 60), 1) for _ in columns[1:]]
        for i, month in enumerate(months):
            ws.append([month.to_pydatetime(), *(float(s[i]) for s in series)])
            ws.cell(row=i + 2, column=1).number_format = "mmm-yy"
            for c in range(2, len(columns) + 1):
                ws.cell(row=i + 2, column=c).number_format = "0.0"
        ws.cell(row=n + 2, column=1,
                value="Source: synthetic format template (PMI levels; made-up values, not S&P Global data).")
    return _bytes(wb)


def _cons_template(slot: Slot, rng: np.random.Generator) -> bytes:
    codes = _TEMPLATE_CODES[slot.market]
    weights = np.sort(rng.dirichlet(np.ones(_TEMPLATE_ROWS)))[::-1] * 100
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append([None, "EQ %Port", "Ticker"])
    ws.append([f"Total (Count: {_TEMPLATE_ROWS})", float(weights.sum()), "-"])
    for i in range(1, _TEMPLATE_ROWS + 1):
        code = codes[(i - 1) % len(codes)]
        if slot.market == "CN":  # A-share digits starting 6 or 0, or Hong Kong digits
            symbol = f"{6 if (i // 2) % 2 else 0}{i:05d}" if code == "CN" else str(9000 + i)
        else:
            symbol = f"SAMPLE{i}"
        ws.append([f"Sample Company {i}", float(weights[i - 1]), f"{symbol}-{code}"])
    for row in ws.iter_rows(min_row=2, min_col=2, max_col=2):
        row[0].number_format = "#,##0.00"
    for column, width in (("A", 33), ("B", 9.6), ("C", 16.4)):
        ws.column_dimensions[column].width = width
    return _bytes(wb)


def template_workbook(slot_id: str) -> bytes:
    """An .xlsx in the real export's layout with made-up values, which parse_slot accepts."""
    slot = _SLOT_BY_ID[slot_id]
    rng = _rng(slot_id)
    if slot_id in ("cy1", "cy2"):
        return _cy_template(slot_id, rng)
    if slot_id == "macro":
        return _macro_template(rng)
    if slot_id == "pmis":
        return _pmi_template(rng)
    return _cons_template(slot, rng)
