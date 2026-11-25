# Contract 0201 — Port the equity scorecard, quadrant and charts; `build_snapshot`

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

**Depends on contracts 0199 and 0200.** Run them first, in that order.

## Goal

After this contract, `build_snapshot(inputs, prices, today)` computes the whole Macro page payload
from `MacroInputs` and a constituent-price frame: both groups' equity cards, quadrant points,
econ cards and chart series. On the 2026-11-09 inputs and prices, with today = 2026-11-09, it
equals `backend/hard_data/macro_scorecard.json` **exactly**, apart from `generated_at`.

## Why

This is the last step of the pipeline-first plan (Gunnar, 2026-11-25; REBUILD.md, Macro tab).
Once it is accepted, the backend can rebuild the Macro page from uploaded files. The upload
storage, rebuild job, price download and Data dialog come next, and they are only worth building
once this reproduces today's page.

Exactness is required for the same reason as in 0200. The planner showed that the original code,
wrapped as a port, passes `contracts/tools/macro_port_check.py full` (`IDENTICAL`, 7.2 s, 232 MB
peak including matplotlib, which the port must not load). A faithful port therefore passes.

**Port, don't redesign.** Keep `scorecard.py`'s and `charts.py`'s function names, constants,
comments and operation order. Read each file through `inputs`. The departures allowed:
- `THRESHOLD_MODE` is fixed at `"pooled"`. Remove the `"own"` branches, the `--thresholds` CLI
  option and every `THRESHOLD_MODE == "own"` conditional, keeping the pooled path's output
  unchanged.
- No HTML, SVG, CSS, JS, PNG or CSV. Each card and the chart payload are built directly as data.
- Prices are a parameter. There is no `download_prices`, `_download`, `CACHE` or yfinance here.

## Files

Create:
- `backend/app/macro_equity.py`: port of the metrics half of `scorecard.py`. That covers
  `load_estimates`, `load_constituents`, the momentum, revisions and breadth histories,
  `price_breadth`, `thresholds`, `points`, `build_metrics`, `market_score` and `quadrant_data`,
  plus `rollovers` and `eps_change`.
- `backend/tests/test_macro_snapshot.py`

Modify:
- `backend/app/macro_snapshot.py`: add the equity card, quadrant points, chart payload and
  `build_snapshot`.

**Touch nothing else.** In particular, do not edit `app/macro_inputs.py` or `app/macro_econ.py`. If
the port seems to need a change there, report `BLOCKED` and name the change. If the work appears to
require editing any other file not on this list, stop and report `BLOCKED` too.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

```python
# app/macro_equity.py — pure; pandas, numpy, stdlib, app.macro_inputs, app.macro_econ
SCORED, FIXED_THRESHOLDS, COMPOSITE_WEIGHTS, COMPOSITE_BAND, PCT_LOW, PCT_HIGH,
MARKET_METRICS, SHIFTS, BREADTH_SCALE                       # same names and values as the reference

def load_estimates(inputs: MacroInputs, key: str, cy: str) -> pd.DataFrame   # cy is "CY1" | "CY2"
def load_constituents(inputs: MacroInputs, key: str) -> list[str]           # uses macro_inputs.yahoo_ticker
def build_metrics(inputs: MacroInputs, prices: pd.DataFrame, econ: dict) -> dict[str, tuple[pd.DataFrame, dict, dict]]
#   group -> (df, detail, thr), as the reference's first return value. econ is passed in, not built here.
def quadrant_data(inputs: MacroInputs, group: str, prices: pd.DataFrame, econ: dict, econ_prev: dict,
                  asof: pd.Timestamp) -> list
```

Every reference function that reads a file gains `inputs` as its first parameter.

```python
# app/macro_snapshot.py — additions
def equity_card(df: pd.DataFrame, detail: dict, thr: dict, group: str, asof: str) -> dict
def quadrant_points(points: list) -> list
def chart_payload(inputs: MacroInputs, prices: pd.DataFrame, group: str) -> dict
def build_snapshot(inputs: MacroInputs, prices: pd.DataFrame, today: date) -> dict
#   -> {"groups": [<DM>, <EM>]}; no "generated_at" (whoever publishes the snapshot stamps it).
#   Each group: {"key", "label", "equity", "quadrant", "econ", "charts"}, as in the committed JSON.
```

**What each piece must equal.** Read `backend/hard_data/build_macro_scorecard.py` for the
extractor's transformations: `<br>` becomes `\n`, entities are unescaped, `\xa0` becomes a space,
and strings are stripped.
- **`equity_card`** is the extracted form of `scorecard.render_html(df, detail, asof, thr, group,
  full_page=False)`:
  - headers come from `HEADERS`, with their `\n`;
  - rows follow `row_order(df)`;
  - each cell's `text` is `"n/a"` for an NA color, else `""`, because `show_values=False` renders
    `&nbsp;`;
  - `tip` comes from `cell_tooltip`;
  - every equity row has `"composite": False`. In the extractor that flag comes from the
    *label* `<div>`'s `cp` class, and `render_html` never puts `cp` on a label. Its per-cell `cp`
    class is not extracted. The committed JSON confirms it: all equity rows are `False`.
  - `note` comes from `thresholds_note()`.
- **`quadrant_points`** reproduces the extractor's `_quadrant` over `charts.quadrant_svg`'s
  `data-tip` JSON:
  - the same filtering of NaN points, the same fields and the same rounding as that tip;
  - `flag` comes from the extractor's `FLAG_CODE`.
- **`chart_payload`** is `json.loads(charts._payload({group: charts.chart_data(prices, group)}))[group]`,
  built without the JSON round trip: `regions`, then `metrics` carrying `METRICS`' fields minus
  `key`, plus `series` built with `_series_json`.
- **`build_snapshot`** follows `scorecard.main()`:
  - `econ = build_econ(inputs, today)`;
  - `econ_prev` from `build_econ(..., lag_months=...)` for each `SHIFTS` horizon;
  - equity `asof` = the newest CY1 date across markets, formatted `%d %b %Y`;
  - econ `asof` = `today` in the same format;
  - group `label`s are the page's group-switch labels (`Developed Markets` / `Emerging Markets`);
  - groups ordered DM, EM.

## Out of scope

- Storing, publishing or serving the snapshot. `routers/macro.py` and `hard_data/` are untouched.
- Downloading prices, and any yfinance import.
- Changing any number, threshold or text the reference produces, even where the reference's
  README admits a limitation (FX in EPS, survivorship bias in breadth).
- matplotlib, and the static PNG/CSV outputs.

## Acceptance criteria

1. **Planner-run.** From `backend/`:
   `DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py full` prints
   `full: IDENTICAL`. Report the `build_snapshot: … s, process peak RSS … MB` line verbatim. Run it
   yourself as you go. **Do not edit the tool.** If you think the tool is wrong, report `BLOCKED`
   with its output.
2. The `econ` check from 0200 still passes:
   `DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py econ` prints
   `econ: IDENTICAL`.
3. Run `grep -cE "yfinance|matplotlib|today\(\)|\.now\(|read_excel|open\(|import html|from html|escape\(|THRESHOLD_MODE" backend/app/macro_equity.py backend/app/macro_snapshot.py`
   It prints `0` for both files. This includes comments and docstrings.
4. `backend/tests/test_macro_snapshot.py` uses the 0199 templates and a **synthetic** price frame
   only. No real file and no `reference files` path. Build the prices in the test:
   - one column per Yahoo symbol that `load_constituents` returns for the templates;
   - business days from 2025-05-01 to 2026-10-30;
   - a seeded random walk starting at 100.

   It covers:
   - a. `build_snapshot(templates, prices, date(2026, 11, 9))`:
     - `[g["key"] for g in result["groups"]] == ["DM", "EM"]`, and the labels are
       `"Developed Markets"` and `"Emerging Markets"`;
     - each equity card has 6 headers and one row per market in the group (7 and 4), and every
       row has 6 cells;
     - each `charts` has one region per market and 6 metrics whose `id`s are, in order,
       `["pe", "eps", "pmi", "rev", "pxbr", "ebr"]`;
     - every quadrant point's `flag` is one of the 11 codes.
   - b. `json.dumps(result)` succeeds.
   - c. **No prices yet.** `build_snapshot(templates, pd.DataFrame(index=pd.DatetimeIndex([])), date(2026, 11, 9))`
     returns normally, with:
     - every equity row's Price Breadth cell having color `"na"` and a `tip` starting with
       `"n/a — no constituent prices available (0/"`;
     - the `pxbr` chart metric having an empty `series`.
     
     This is the state of the first server-side build, before any price download. The planner
     checked on 2026-11-25 that the reference behaves exactly this way.
   - d. `points` and `market_score`, each checked against literal inputs and literal expected
     outputs worked out from the reference code. Include `points` at exactly `lo`, exactly `hi`
     and `nan`. **Write every input and expected output as a literal value.**
5. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q` passes. Report the count. The baseline is
   the count after 0200.

`BLOCKED` is the correct answer to a criterion that cannot be satisfied as written. Never adjust a
constant, a rounding, the tool or the snapshot to make `IDENTICAL` appear. A difference means the
port differs from the reference. Find it.

## Verification to run and paste

Paste the **complete, verbatim** output of each command.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
grep -cE "yfinance|matplotlib|today\(\)|\.now\(|read_excel|open\(|import html|from html|escape\(|THRESHOLD_MODE" backend/app/macro_equity.py backend/app/macro_snapshot.py
cd backend
DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py econ
DATABASE_URL="" .venv/bin/python ../contracts/tools/macro_port_check.py full
PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_macro_snapshot.py
PATH="$PWD/.venv/bin:$PATH" pytest -q
```

Also report:
- every file you edited or created;
- every place where the port departs from the reference's structure beyond the three allowed
  departures above.

## Human verification — does Gunnar need to run anything?

- **Nothing to run.** The equivalence check is the verification, and the planner re-runs it.

## Open questions

None.
