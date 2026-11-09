# Contract 0189 — PDF report: no stranded headings, roomier score rows, no overlapping not-scored line

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, the PDF report never ends a page with a lone heading or a lone table header. The
score rows have room between them. In the not-scored case, the "Not scored. Missing: …" line no
longer prints on top of the colour note. One guide sentence also stops referring to "tiles", which
the PDF doesn't have.

## Why

The planner rendered the 0188 PDF (`contracts/done/0188-pdf-score-ring-and-guide.report.md`) and
found four problems.

1. The section title `How the score is calculated` printed alone at the bottom of page 2, with its
   content on page 3. `heading()` only reserves 10 mm.
2. `Holdings and risk`'s table header printed alone at the bottom of page 1, with its rows on page 2.
3. Each score row's detail line sits about 4 mm above the next row's label. It reads as crowded.
4. With `total === null`, the `Not scored. Missing: …` line is drawn at a fixed `ctx.y + 17`. The
   colour note above it wraps to two lines, so the two overlap.

Also, the guide says the unscored figures are "shown in the tiles below the score". That's true on
the page but false in the PDF, which prints the same text.

## Files

Modify:
- `frontend/src/lib/reportPdf.ts`
- `frontend/src/lib/scoreGuide.ts`: one sentence only (below).

**Touch nothing else.** No test file changes are required: the existing tests must keep passing
unchanged. If the work appears to require editing another file, stop and report `BLOCKED`.

## Interface: exact changes

### `reportPdf.ts`, `createContext`

1. In `heading`, change `if (context.y + 10 > CONTENT_BOTTOM)` to `if (context.y + 30 > CONTENT_BOTTOM)`.
   A heading then always has about 20 mm of its section below it.
2. In `subheading`, change `if (context.y + 8 > CONTENT_BOTTOM)` to `if (context.y + 20 > CONTENT_BOTTOM)`.
3. In `table`, add `context.ensureSpace(20)` as the **first line** of the method, before
   `let tableEndY = context.y`. That keeps a table header and at least one row together.

### `reportPdf.ts`, `scoreSection`

4. **Not-scored line.** Replace the fixed `ctx.y + 17` for the missing note with a position computed
   from the note's real height:
   ```ts
   const noteY = ctx.y + 12
   // draw noteLines at noteY (as now)
   // missing note at:
   noteY + noteLines.length * 3.6 + 1.5
   ```
   Draw the note at `noteY`, which is the value already used.
5. **Row spacing.**
   - `ctx.ensureSpace(12)` becomes `ctx.ensureSpace(15)`.
   - The detail text's `rowY + 10.5` becomes `rowY + 10`.
   - `ctx.y += 12` becomes `ctx.y += 15`.

   The label (`rowY + 2.5`), the track (`rowY + 3.5`) and the points (`rowY + 2.5`) are unchanged.

### `scoreGuide.ts`

6. In the `What is not scored` section, change
   `shown in the tiles below the score for context.` to `shown alongside the score for context.`.
   Nothing else in the file changes.

## Out of scope

- Any other layout, wording, colour or content change.
- New tests. Layout is verified by the planner's render.
- Do not add dependencies.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

1. `grep -c "context.y + 30 > CONTENT_BOTTOM" frontend/src/lib/reportPdf.ts` prints `1`, and
   `grep -c "context.y + 20 > CONTENT_BOTTOM" frontend/src/lib/reportPdf.ts` prints `1`.
2. `grep -n "table(head, body) {" -A1 frontend/src/lib/reportPdf.ts` shows `context.ensureSpace(20)`
   on the next line.
3. `grep -c "ctx.y + 17" frontend/src/lib/reportPdf.ts` prints `0`, and
   `grep -c "noteLines.length \* 3.6" frontend/src/lib/reportPdf.ts` prints `1`.
4. `grep -c "ctx.ensureSpace(15)" frontend/src/lib/reportPdf.ts` prints `1`, and
   `grep -c "ctx.y += 15" frontend/src/lib/reportPdf.ts` prints `1`.
5. `grep -c "tiles below the score" frontend/src/lib/scoreGuide.ts` prints `0`, and
   `grep -c "shown alongside the score for context." frontend/src/lib/scoreGuide.ts` prints `1`.
6. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
7. `cd frontend && npm run test` passes, with **462 tests in 33 files**, unchanged.
8. `cd frontend && npm run lint` shows the 2 known warnings and nothing new.
9. Run
   `cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --write src/lib/reportPdf.ts src/lib/scoreGuide.ts`.
   **If it fails with `ENOTCACHED`, rerun that exact command outside the sandbox.** Then `--check`
   must print `All matched files use Prettier code style!`.

**Planner-run:**

10. The planner renders the full and the all-null fixture PDFs with `contracts/tools/pdf-render.swift`
    and checks:
    - no page ends with a lone heading or table header;
    - the score rows have visible space between them;
    - the not-scored line sits below the colour note without overlapping it.

## Verification to run and paste

```bash
grep -c "context.y + 30 > CONTENT_BOTTOM" frontend/src/lib/reportPdf.ts
grep -c "context.y + 20 > CONTENT_BOTTOM" frontend/src/lib/reportPdf.ts
grep -n "table(head, body) {" -A1 frontend/src/lib/reportPdf.ts
grep -c "ctx.y + 17" frontend/src/lib/reportPdf.ts
grep -c "noteLines.length \* 3.6" frontend/src/lib/reportPdf.ts
grep -c "ctx.ensureSpace(15)" frontend/src/lib/reportPdf.ts
grep -c "ctx.y += 15" frontend/src/lib/reportPdf.ts
grep -c "tiles below the score" frontend/src/lib/scoreGuide.ts
grep -c "shown alongside the score for context." frontend/src/lib/scoreGuide.ts
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?")
(cd frontend && npm run test 2>&1 | tail -6)
(cd frontend && npm run lint 2>&1 | tail -4)
(cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --check src/lib/reportPdf.ts src/lib/scoreGuide.ts)
```

## Human verification — does Gunnar need to run anything?

- Nothing beyond downloading a fresh PDF from BEC and skimming the page breaks.

## Open questions — do not resolve yourself

- None known.
