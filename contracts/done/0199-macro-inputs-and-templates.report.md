# Report — Contract 0199 (macro inputs, parsers, templates)

## Audit

**Accepted, 2026-11-25 (planner).** I re-ran every check myself:
- `macro_port_check.py parse`: 15/15 real files accepted.
- Both grep criteria print 0.
- The full suite passes: 1009 after 0200 and 0201, of which 58 tests are this contract's.

**What's good.**
- The error messages name the exact sheet, column or market.
- The `except Exception` blocks are narrow in effect. They exist only to turn an unreadable workbook into the ".xlsx" message, and the validation's own `MacroInputError`s are raised outside them.
- The templates are seeded, hard-code no real value, and are used as fixtures by 0200 and 0201.
- The coder renamed `_open` → `_load_book` to satisfy a grep. That is correct here, because the hit was a false positive of the criterion, not a hidden file access. I am noting it so the next grep criterion avoids bare `open\(`.

**Follow-ups, carried into the storage contract:**
1. **The missing-series list is duplicated.** `macro_inputs._MISSING_MACRO` and `_MISSING_SERVICES_PMI` copy the relevant part of `macro_econ.MISSING`. They have to, because tier rules forbid `macro_inputs` importing `macro_econ`. If a pair is removed from `MISSING` (say the Canada IP series is re-pulled), the parser stops requiring that column, while the build starts looking it up. The result is a `KeyError` during the build instead of a rejection at upload time. **Fix:** a test asserting both sets equal their projections of `macro_econ.MISSING`. The templates' `_LEVEL_HOUSING` / `_ANNUALIZED_GDP` copies of `QUOTED` are template-only, so drift there is harmless.
2. **The real macro file reports `data_through` 2026-11-30.** Germany Consumer Sentiment has a forward-dated reading, and the file was exported on Nov 4. This is correct under the contract's "newest parseable date". It still matters for the undecided "data through" display: cap it at the upload date, or take the newest date per required column. Decide when the display is decided.
3. Memory for parsing the two 4 MB CY books is not measured separately. See the 0201 report.
