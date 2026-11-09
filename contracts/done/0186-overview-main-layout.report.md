# Report — Contract 0186 (Overview: main-style layout)

## Audit

**Accepted, 2026-11-08.** The first run was correctly `BLOCKED`. The contract asked for gold
`#F2A900` text on its own 10% tint, which is 1.87:1. The planner revised it: tone colours are now
graphics only, and the text is always foreground or muted. The second run implemented the revision
faithfully.

**Re-run by the planner:**
- tsc 0; 454 tests in 32 files; build OK; lint shows the 2 known warnings.
- No fixed palette classes and no `title=`.
- Counts: `deriveRedFlags(` 1, `overviewTiles(` 1, `scoreTone(` 3, and the dynamic `reportPdf` import 1.
- Prettier `--check` is clean.

**Planner-run (16, 17), against a stub API:** Vite on :5180 and Chrome on :9334, with full-page
screenshots added to a `/tmp` copy of the smoke tool.
- **Light, 1400 px:** no exception.
  - The ring is red (36), with the numerals in foreground colour and legible.
  - The bars are red (0.1), empty (0), gold (0.61) and green (1.0), each matching `scoreTone`.
  - The six tiles render, the "not part of the score" line is present, and Key risks shows 3 flags
    with no red text.
- **Dark:** the same, all legible.
- **800 px:** the grid stacks to one column, and the tiles go 3 × 2.

**What's good:**
- **`overviewTiles` is pure, and tested on the literal fixture,** including the null and
  undefined-beta paths. The coder's first verification run caught a null-risk bug, which was fixed
  before reporting.
- **The PDF path, the requests and the state are untouched.** Only the render changed, as the
  contract scoped.

**Cosmetic, not blocking:**
- At `lg` widths the score card stretches to the right column's height, leaving a tall empty card.
  `main`'s stays compact. The fix is one class (`items-start`, or `self-start` on the card).
- `Beat equal weight in 1 of 1 years` is plural on 1. That string comes from `lib/score.ts` (0182).
