# Report — Contract 0188 (PDF score ring, bars, guide)

## Audit

**Accepted, 2026-11-08, with layout follow-up 0189.** The contract's substance landed:
- the ring and bars are drawn from a pure, tested `pdfScoreVisual`;
- the colours come from the shared `scoreTone`, with no re-implemented thresholds;
- the guide is printed from `SCORE_GUIDE` and never retyped;
- the old table is gone;
- the text stays out of the tone colours.

**Re-run by the planner:**
- tsc 0; 462 tests in 33 files; build OK; lint shows the 2 known warnings; prettier is clean.
- All structural greps as specified.

**Rendered with `pdf-render.swift`, for the full and the all-null fixture:**
- **Full fixture:** the red ring has a legible black `36`. The bars are red (short), empty, gold
  (~61%) and green (full), with points right-aligned. The guide is on page 3, every paragraph
  full-width, with no garbled characters.
- **All-null fixture:** the grey ring shows `—`, the tracks are empty and the sections read
  `Unavailable`.

**Defects found by looking. All are layout; none is caught by the text criteria. Filed as 0189:**
1. The section title `How the score is calculated` is stranded at the bottom of page 2.
   `heading()` reserves only 10 mm. This pre-dates 0188, but 0188's new section exposed it.
2. The `Holdings and risk` table header is stranded at the bottom of page 1. The `table()` helper
   has no space check.
3. The score rows are crowded: each detail line sits about 4 mm above the next label.
4. **Real bug:** with `total === null`, the `Not scored. Missing: …` line is drawn at a fixed
   `y + 17`, on top of the colour note's wrapped second line.
5. The guide's "shown in the tiles below the score" is false in the PDF, which has no tiles. This is
   planner copy from 0187.

Items 1–3 and 5 are spec gaps (the planner's). Item 4 is the coder's: it used a fixed offset under
text it had itself wrapped.
