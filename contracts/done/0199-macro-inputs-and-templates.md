# Contract 0199 — Macro inputs: 15 upload slots, their parsers, and format templates

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, `backend/app/macro_inputs.py` exists and is pure. It defines the 15 input
slots the Macro scorecard needs. It turns an uploaded workbook's bytes into exactly the frames the
scorecard project read from disk, or rejects the workbook with a message a user can act on. It can
also generate a synthetic **format template** for every slot.

## Why

Gunnar decided on 2026-11-25 (REBUILD.md, Macro tab):
- Macro data is refreshed by uploading files.
- The "Sample data" download contains **format templates**: real sheet names, header rows and
  columns, with made-up values. The real FactSet / Bloomberg / S&P Global exports must never be
  served.
- The **pipeline is built first**: this contract, then 0200 (economic scorecard) and 0201 (equity
  scorecard and the full snapshot). No upload UI exists until the pipeline reproduces today's
  snapshot exactly.

This contract is the foundation for all of it. Its parsers are what will reject a malformed upload.
Its templates are the sample download, and they are also the test fixtures for 0200 and 0201,
because the real files are licensed and can never be committed.

**Reference project** (read-only): `reference files/new integration/Scorecard_Project_2026-11-09/`.
Its `README.md` documents the inputs. `scorecard.py` (`MARKETS`, `_estimates_book`,
`load_estimates`, `yahoo_ticker`, `load_constituents`) and `econ_scorecard.py` (`macro_sheet`,
`pmi_sheet`, `MACRO_SHEET`, `MACRO_COL`, `PMI_COL`, `MISSING`) show exactly how each file is read.
The real files are in its `data/` folder. Read them to learn their structure, but **no value from
them may end up in this repository**. See Templates.

## Files

Create:
- `backend/app/macro_inputs.py`: slots, parsers and templates. Pure: no database, no network, no
  filesystem.
- `backend/tests/test_macro_inputs.py`

Modify:
- `backend/requirements.txt`: add `openpyxl==3.1.5`. This is the only new dependency.
  `pd.read_excel` needs it, and so does the template writer.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Do not copy its data files
anywhere.

## Interface

```python
MARKETS: dict[str, tuple[str, str, str]]
# Copied verbatim from scorecard.py: key -> (label, CY tab, constituents file prefix).
# "US": ("U.S.", "SPY-USA", "SPX"), ... "TW": ("Taiwan", "EWT-USA", "EWT"). Same order.

@dataclass(frozen=True)
class Slot:
    id: str              # see the table below
    label: str           # shown to users in the upload dialog
    source: str          # "FactSet" | "Bloomberg" | "S&P Global"
    filename: str        # the conventional export name; also the template's download name
    market: str | None   # MARKETS key for a constituents slot, else None

SLOTS: tuple[Slot, ...]  # exactly 15, in the order of the table below

class MacroInputError(ValueError):
    slot_id: str
    def __init__(self, slot_id: str, message: str): ...
    # str(exc) is the message alone, written for the person who uploaded the file.

@dataclass(frozen=True)
class ParsedSlot:
    slot_id: str
    data_through: date | None    # newest date in the file; None for constituents (they carry no date)
    frames: dict[str, pd.DataFrame]

def parse_slot(slot_id: str, content: bytes) -> ParsedSlot   # unknown slot_id -> KeyError
def parse_inputs(files: Mapping[str, bytes]) -> MacroInputs  # needs all 15; first problem -> MacroInputError

@dataclass(frozen=True)
class MacroInputs:
    cy1: dict[str, pd.DataFrame]           # CY tab name -> frame, the 11 MARKETS tabs only
    cy2: dict[str, pd.DataFrame]
    macro: dict[str, pd.DataFrame]         # the six MACRO_SHEET sheet names -> frame
    pmis: dict[str, pd.DataFrame]          # "All PMIs", "All Services PMIs" -> frame
    constituents: dict[str, pd.DataFrame]  # MARKETS key -> frame

TEMPLATE_END: date = date(2026, 10, 30)    # a Friday; the last date in every dated template
def template_workbook(slot_id: str) -> bytes   # an .xlsx that parse_slot(slot_id, ...) accepts
```

### Slots

| id | filename | source | market |
|---|---|---|---|
| `cy1` | `CY1.xlsx` | FactSet | — |
| `cy2` | `CY2.xlsx` | FactSet | — |
| `macro` | `Bloomberg_Macro_Data_Values.xlsx` | Bloomberg | — |
| `pmis` | `PMIs.xlsx` | S&P Global | — |
| `cons_spx` … `cons_ewt` | `<PREFIX>CONS.xlsx` | FactSet | the MARKETS key |

The constituents slots follow `MARKETS` order: `cons_spx`, `cons_ewc`, `cons_ewu`, `cons_ezu`,
`cons_ewg`, `cons_ewq`, `cons_ewj`, `cons_mchi`, `cons_ewz`, `cons_ewy`, `cons_ewt`.

`filename` must match the reference `data/` folder's file names exactly. The planner's tool loads
each real file by `slot.filename`.

Labels are your call. Keep them short and say what the file is, for example "CY1 forward EPS
estimates" or "Japan holdings (EWJ)".

### Frames are exactly what the scorecard project read

The point is that 0200 and 0201 can port the arithmetic unchanged. Each frame must equal what the
reference code got from `pd.read_excel` on the file path. Read `BytesIO(content)` with the same
arguments:
- **CY1 / CY2:** `sheet_name=None, header=2`, then keep only the 11 `MARKETS` tabs.
- **macro:** each of the six `MACRO_SHEET` sheets with `header=None`. Ignore `Credit` and
  `Series Descriptions`.
- **pmis:** `"All PMIs"` and `"All Services PMIs"` with the default header. Do **not** rename the
  China column here. `pmi_sheet` does that, and it is 0200's to port.
- **constituents:** the first sheet with the default header, stored under the key `"holdings"`.

### Validation: what `parse_slot` rejects

Require what the scorecard reads, and nothing more. Raise `MacroInputError` with a message that
names the exact sheet, column or problem:

1. **Not an .xlsx.** The content does not start with the zip signature `PK\x03\x04`, or
   openpyxl/pandas cannot read it. The message says the file must be an .xlsx workbook. Never
   leak a raw stack trace or exception class name into the message.
2. **CY1 / CY2:**
   - every `MARKETS` tab is present;
   - each tab's header row (row 3) has `Date`, `EPS`, `PE (x)`, `Num of Cos Up`,
     `Num of Cos Down` and `Num of Cos Unch`;
   - each tab has at least one row where `Date` parses with format `"%d %b '%y"` and `EPS` is
     numeric.
   
   `data_through` is the newest such date across all tabs.
3. **macro:**
   - all six `MACRO_SHEET` sheets are present;
   - in each sheet, row 1 has a column-pair header for every `MACRO_COL` country, **except**
     the `(country, row)` pairs in `econ_scorecard.MISSING`. Those are never looked up
     (`cell()` returns before `raw_series`).
   
   `data_through` is the newest parseable date across those sheets.
4. **pmis:**
   - both sheets are present, each with a `Date` column;
   - `All PMIs` has a column for every `PMI_COL` country;
   - `All Services PMIs` has a column for every `PMI_COL` country except Canada, South Korea and
     Taiwan (the `MISSING` services pairs).
   
   China matches any column whose name starts with `China`. `data_through` is the newest
   parseable `Date`.
5. **Constituents:**
   - the file has at least 3 columns, and the third is headed `Ticker`;
   - after skipping the first data row (the `Total (Count: N)` row), at least one ticker maps to
     a Yahoo symbol under `scorecard.yahoo_ticker`'s rules. Port `yahoo_ticker` into this module
     to check this; 0201 will reuse it.
   - **wrong-market guard.** Of the tickers shaped `SYMBOL-CC`, at least 50% must carry a country
     code from the slot's expected set:

     | market | expected codes |
     |---|---|
     | US | US |
     | CA | CA |
     | UK | GB |
     | DE | DE |
     | FR | FR |
     | JP | JP |
     | CN | CN, HK |
     | BR | BR |
     | KR | KR |
     | TW | TW |
     | EZ | FR, DE, IT, NL, ES, FI, BE, AT, IE, PT |

     **EZ also needs at least 3 of those codes, each on at least 5% of the coded rows.** That is
     what stops `EWGCONS.xlsx` (96% DE) from passing as Eurozone. The planner checked all 11 real
     files against this rule on 2026-11-25, and all pass. The message names the market the slot
     expects, e.g. "This doesn't look like the Japan (EWJ) holdings file".
   
   `data_through` is `None`.

`parse_inputs` calls `parse_slot` for every slot and assembles `MacroInputs`. A missing slot raises
`MacroInputError(slot_id, "No file uploaded for <label>")`. It does not check anything across
slots.

### Templates

`template_workbook(slot_id)` writes, with openpyxl, a workbook whose **structure copies the real
file's** and whose **every value is synthetic**:
- **Copy from the real file:** sheet names and their order, header rows, column names and order,
  the CY tabs' two title rows (`A1` = tab name, `A2` = `Estimate History`), the date formats
  (CY dates are **text** like `05 Nov '26`, newest first), and the constituents' `Total (Count: N)`
  first row.
- **Generate:** every number, ticker symbol, company name and Bloomberg ticker label. Use
  `numpy.random.default_rng` with a fixed seed per slot, so the values are reproducible.
- **Value shape.** Plausible enough that 0200/0201 can run their full build on templates without
  dividing by zero:
  - EPS positive and drifting;
  - `PE (x)` between 10 and 30;
  - company counts non-negative integers;
  - PMIs between 40 and 60;
  - macro series shaped like the real ones.
- **Date ranges:**
  - CY tabs weekly on Fridays from 2016-01-01 to `TEMPLATE_END`;
  - macro sheets month-end from 2006-01-31 to 2026-10-31, except GDP, which is quarter-end to
    2026-09-30;
  - PMIs month-start from 2006-01-01 to 2026-10-01.
  
  Write each macro value under the country columns the real sheet has.
- **Constituents:** 20 rows, tickers like `SAMPLE7-JP`, names like `Sample Company 7`. Codes must
  satisfy the wrong-market guard (EZ spread over FR/DE/IT/NL). CN uses symbols that `yahoo_ticker`
  maps (digits starting 6 or 0).

**No real value may enter this module.** It reads no file and hard-codes no number taken from a
real workbook. Column names, sheet names and country names are structure, not data, and may be
copied.

## Out of scope

- No HTTP route, no database table, no upload storage, no frontend. Later contracts cover those.
- Do not port any calculation. That includes `_month_start`, the `load_estimates` cleaning
  (weekly grid, dedupe), YoY transforms and scoring. 0200 and 0201 own those. `yahoo_ticker` is
  the one exception.
- No check that relates one slot to another (e.g. CY1 against CY2).
- No upload size limit. That belongs to the HTTP contract.
- Do not add `pyarrow`, `matplotlib`, `xlsxwriter` or any dependency besides `openpyxl`.

## Acceptance criteria

1. `grep -n "^openpyxl==3.1.5$" backend/requirements.txt` prints one line.
2. `grep -cE "read_bytes|open\(|Path\(|\.glob\(" backend/app/macro_inputs.py` prints `0`. The
   module touches no filesystem.
3. **Planner-run.** `DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py parse`
   (from `backend/`) prints `parse: 15/15 real files accepted; parse_inputs OK`. You may run it too.
   The real files are on this machine.
4. `backend/tests/test_macro_inputs.py` covers each item below. Build malformed workbooks in the
   test by loading a template with openpyxl, mutating it, and saving to bytes:
   - a. For every slot, `parse_slot(slot.id, template_workbook(slot.id))` succeeds.
     `data_through` is:
     - `TEMPLATE_END` for `cy1`/`cy2`;
     - `date(2026, 10, 31)` for `macro`, which stores period-end dates (1990-03-31, …); monthly
       sheets end on 2026-10-31 and the quarterly GDP sheet on 2026-09-30;
     - `date(2026, 10, 1)` for `pmis`, which stores month starts (2004-12-01, …);
     - `None` for constituents.
   - b. `parse_inputs({s.id: template_workbook(s.id) for s in SLOTS})` returns `MacroInputs` with
     11 tabs in each CY book, 6 macro sheets, 2 PMI sheets and 11 constituents frames.
   - c. `b"hello"` for `cy1` raises `MacroInputError` whose message contains `.xlsx`.
   - d. `cy1` with the `EWT-USA` sheet deleted: message contains `EWT-USA`.
   - e. `cy2` with `PE (x)` renamed on one tab: message contains `PE (x)` and that tab name.
   - f. `macro` with the `CPI YoY` sheet deleted: message contains `CPI YoY`.
   - g. `macro` with the `Japan` column pair removed from `GDP YoY`: message contains `Japan`.
   - h. `pmis` with `All Services PMIs` deleted: message contains `All Services PMIs`.
   - i. The `cons_spx` template uploaded to `cons_ewj` is rejected, with a message naming Japan.
     The `cons_ewg` template uploaded to `cons_ezu` is rejected too. Build a DE-only 20-row
     workbook if the `cons_ewg` template is not DE-dominated enough to fail.
   - j. The `pmis` template uploaded to `cy1` is rejected.
   - k. `parse_inputs` with `cons_ewt` missing raises `MacroInputError` with
     `slot_id == "cons_ewt"`.
   - l. `yahoo_ticker` matches every example in the reference docstring:
     `'8306-JP' -> '8306.T'`, `'BRK.B-US' -> 'BRK-B'`, `'NDA.FI-FI' -> 'NDA-FI.HE'`,
     `'700-HK' -> '0700.HK'`, `'600519-CN' -> '600519.SS'`, `'000858-CN' -> '000858.SZ'`.
     Also `'-' -> None`.
5. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q` passes. The baseline is 903 (after
   0196). Report the new count. Install the new dependency first with
   `.venv/bin/pip install openpyxl==3.1.5`.

`BLOCKED` is the correct answer if any criterion cannot be satisfied as written. For example: a real
file fails a validation rule stated here; the template's real-format date convention contradicts
4a; or the real structure differs from what this contract describes. Say which, and do not loosen a
rule or edit the tool to make it pass.

## Verification to run and paste

> Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""` (see the template's warning).

Run each command and paste the **complete, verbatim** output.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
grep -n "^openpyxl==3.1.5$" backend/requirements.txt
grep -cE "read_bytes|open\(|Path\(|\.glob\(" backend/app/macro_inputs.py
cd backend
DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py parse
PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_macro_inputs.py
PATH="$PWD/.venv/bin:$PATH" pytest -q
```

Also report every file you edited or created, and the slot labels you chose.

## Human verification — does Gunnar need to run anything?

**Optional: open two templates in Excel.** From `backend/`:

```bash
DATABASE_URL="" .venv/bin/python -c "from app.macro_inputs import template_workbook as t; open('/tmp/CY1_template.xlsx','wb').write(t('cy1')); open('/tmp/EWJCONS_template.xlsx','wb').write(t('cons_ewj'))"
open /tmp/CY1_template.xlsx /tmp/EWJCONS_template.xlsx
```

Each should look like the real export laid out the same way, with obviously fake numbers and
`SAMPLE` tickers.

## Open questions

None. If the real files contradict anything here, report `BLOCKED`.
