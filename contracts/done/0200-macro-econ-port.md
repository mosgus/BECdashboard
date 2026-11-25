# Contract 0200 — Port the economic scorecard into the backend

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

**Depends on contract 0199** (`app/macro_inputs.py`, `openpyxl`). Run it first.

## Goal

After this contract, two pure backend modules exist:
- `app/macro_econ.py` computes the economic scorecard from a `MacroInputs`.
- `app/macro_snapshot.py` formats it into the exact `econ` card the Macro page renders today.

On the 2026-11-09 inputs, with today = 2026-11-09, the output equals the committed snapshot
**exactly**.

## Why

This is step two of the pipeline-first plan (Gunnar, 2026-11-25; REBUILD.md, Macro tab). The Macro
page renders `backend/hard_data/macro_scorecard.json`, which was lifted out of the scorecard
project's HTML by hand. Uploads can only update the page once the backend computes that JSON
itself.

**Exactness is achievable, so it is required.** On 2026-11-25 the planner re-ran the original
`scorecard.py` offline, with today frozen at 2026-11-09. It reproduced the snapshot with zero
differing values, both on its own pandas 2.2.3 and on the backend's pandas 3.0.5 / numpy 2.5.3.
The planner also ran `contracts/tools/macro_port_check.py` against the original code wrapped as a
port: it reported `IDENTICAL`, and it reported a deliberate one-character error at the exact cell.
A faithful port therefore passes, and an unfaithful one cannot.

**Port, don't redesign.** Keep the functions, names, constants, comments and operation order of
`econ_scorecard.py`. The one structural change: each loader reads frames from `MacroInputs`
instead of a file path. Reordering arithmetic or "simplifying" a transform can move a percentile
across a color boundary and fail the check, legitimately.

## Files

Create:
- `backend/app/macro_econ.py`: port of
  `reference files/new integration/Scorecard_Project_2026-11-09/econ_scorecard.py`.
- `backend/app/macro_snapshot.py`: the `econ` card formatting (see Interface). 0201 extends this
  file.
- `backend/tests/test_macro_econ.py`

**Touch nothing else.** In particular, do not edit `app/macro_inputs.py`. If the port seems to need
a change there, report `BLOCKED`. If the work appears to require editing any other file not on this
list, stop and report `BLOCKED` too.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

```python
# app/macro_econ.py — pure; imports only pandas, numpy, stdlib, app.macro_inputs
LABEL, GROUPS, GROUP_LABEL, COUNTRIES, LEI_ROWS, LEI_WEIGHTS, CEI_ROWS, ROWS, LEVEL_ROWS, GROWTH_ROWS,
SMOOTH_ROWS, HIST_START, CRISIS_WINDOWS, BASE_EFFECT_WINDOWS, STALE_MONTHS, CPI_TARGET, MACRO_SHEET,
MACRO_COL, PMI_COL, QUOTED, NOMINAL_RETAIL, MISSING, NOTES   # same names and values as the reference

def build_econ(inputs: MacroInputs, today: date, lag_months: int = 0) -> dict
# Same return value as econ_scorecard.build(today, lag_months): country key -> {row: cell dict},
# including "LEI Average".
```

- **Loaders.**
  - `macro_sheet(sheet)` becomes `macro_sheet(inputs, sheet)` over `inputs.macro[sheet]`, which
    is the `header=None` frame.
  - `pmi_sheet(sheet)` becomes `pmi_sheet(inputs, sheet)` over `inputs.pmis[sheet]`. It keeps its
    China-column rename.
  - `_latest`, `DATA_DIR`, `MACRO_GLOB`, `PMI_GLOB` and `lru_cache` go: there is no filesystem.
  - Thread `inputs` through `raw_series`, `scored_series` and `cell` as their first parameter.
- **`today` is a parameter, never `date.today()`.** `grep "today()"` must find nothing (criterion
  2).
- Drop the `if __name__ == "__main__":` printing block.

```python
# app/macro_snapshot.py — pure; imports app.macro_econ (and app.macro_inputs if needed)
def group_subtitle(group: str) -> str                        # port of scorecard.group_subtitle
def econ_cell_tooltip(row: str, d: dict) -> str              # port of scorecard.econ_cell_tooltip
def econ_card(econ: dict, group: str, asof: str) -> dict
```

`econ_card` returns the plain-data form of what `scorecard.render_econ_html(econ, asof, group)`
rendered, **after** `backend/hard_data/build_macro_scorecard.py` extracted it. Read both. The
extractor's `_text()`:
- turns `<br>` into `\n`;
- unescapes HTML entities (`&amp;` → `&`);
- turns non-breaking spaces into spaces;
- strips both ends.

It also unescapes `title` attributes. So build the strings directly, in their final form, with no
HTML escaping at all. Shape:

```python
{"title": str, "subtitle": str,
 "headers": [str, ...],                       # LABEL[k] for k in GROUPS[group]
 "rows": [{"label": str, "composite": bool,   # composite only for "LEI Average"
           "cells": [{"color": "g"|"y"|"r"|"na", "text": str, "tip": str}, ...]}, ...],
 "note": str}                                 # the footer text
```

Carry over `ECON_RAW_FMT` and `ECON_COLOR_CLASS` from `scorecard.py`. Do not import anything from
the reference project at runtime. Copy it.

## Out of scope

- The equity scorecard, quadrant, charts and `build_snapshot`. Those are contract 0201.
- Any HTML, CSS, PNG, CSV, or `matplotlib`.
- Any route, table, upload or frontend change.
- Fixing anything the reference does oddly, including the data gaps its README lists. Faithful
  first; improvements are separate contracts.

## Acceptance criteria

1. **Planner-run.** From `backend/`:
   `DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py econ` prints
   `econ: IDENTICAL`. Run it yourself as you go; the real files are on this machine. **Do not edit
   the tool.** If you believe the tool is wrong, report `BLOCKED` with the diff it printed.
2. `grep -cE "today\(\)|\.now\(" backend/app/macro_econ.py backend/app/macro_snapshot.py` prints
   `0` for both files. This includes comments and docstrings, so write "the current date", not
   `date.today()`, in prose.
3. `grep -cE "read_excel|read_bytes|open\(|Path\(|lru_cache|matplotlib|import html|from html|escape\(" backend/app/macro_econ.py backend/app/macro_snapshot.py`
   prints `0` for both files. `econ_card` emits final strings; it neither escapes nor unescapes
   HTML. (`escape\(` also matches `unescape(`.)
4. `backend/tests/test_macro_econ.py` runs on the 0199 templates and literal values only. No real
   file, and no `reference files` path. It covers:
   - a. `build_econ(parse_inputs(<all templates>), date(2026, 11, 9))` returns all 11
     `COUNTRIES`, each with exactly the 8 `ROWS` plus `"LEI Average"`.
   - b. For every `(key, row)` in `MISSING`, that cell has `color is None` and
     `missing == MISSING[(key, row)]`.
   - c. `econ_card(econ, "DM", "09 Nov 2026")` has 7 headers and 9 rows. Only the last row is
     `composite`, and its label is `"LEI Average"`. Every row has 7 cells, and every color is in
     `{"g","y","r","na"}`. `"EM"` gives 4 headers, and its rows have 4 cells each.
   - d. `color_for`, `months_behind` and `lei_average`, each checked against literal inputs and
     literal expected outputs you work out from the reference code, including at least one exact
     color boundary for `color_for`. **Write every input and expected output as a literal value;
     do not describe it in prose.**
   - e. `build_econ(..., lag_months=1)` runs on templates and differs from `lag_months=0` in at
     least one cell's `pct`.
5. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q` passes. Report the count. The baseline is
   the count after 0199.

`BLOCKED` is the correct answer to a criterion that cannot be satisfied as written, as well as to
an undecided design question. Never adjust a constant, a rounding or the tool to make
`econ: IDENTICAL` appear. A difference means the port differs from the reference. Find it.

## Verification to run and paste

Paste the **complete, verbatim** output of each command.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
grep -cE "today\(\)|\.now\(" backend/app/macro_econ.py backend/app/macro_snapshot.py
grep -cE "read_excel|read_bytes|open\(|Path\(|lru_cache|matplotlib|import html|from html|escape\(" backend/app/macro_econ.py backend/app/macro_snapshot.py
cd backend
DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py econ
PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_macro_econ.py
PATH="$PWD/.venv/bin:$PATH" pytest -q
```

Also report every file you edited or created, and every place where the port deliberately departs
from the reference's structure, other than the loader change described above.

## Human verification — does Gunnar need to run anything?

- **Nothing to run.** The equivalence check is the verification, and the planner re-runs it.

## Open questions

None.
