# Contract 0188 — PDF report: coloured score ring, breakdown bars, and the score guide

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

**Depends on 0187** (`lib/scoreGuide.ts`) **and 0186** (`lib/overview.ts`). If either file is missing,
stop and report `BLOCKED`.

## Goal

After this contract, the PDF's **Research Score** section matches the Overview page:
- a ring coloured by the total;
- one horizontal bar per component, filled to its sub-score and coloured by it, with points, the
  measured value and the window.

The report also ends with a new section, **How the score is calculated**, which prints the same
guide text as the Overview's Help panel.

## Why

Gunnar, 2026-11-08: the PDF should carry the colour-coded score and breakdown, and explain how the
scores were calculated.

- **The guide is printed from `SCORE_GUIDE` (0187). It is never retyped,** so the page and the PDF
  cannot disagree.
- **The colours use `scoreTone` from `lib/overview.ts`, never a re-implementation,** so the
  thresholds stay shared.
- **The explanation goes at the end, as an appendix.** Page 1 stays a summary, and readers who want
  the method find it in one place.

Rules carried over from earlier contracts:
- **Tone colours are for graphics only** (0186): the ring's border and fill, and the bar fills.
  Every piece of text stays in the text or muted colour.
- **Every string goes through `toPdfText`** (0184).
- **Sections never compute page breaks themselves.** They ask `ReportContext` (0184).

## Files

Modify:
- `frontend/src/lib/reportPdf.ts`
- `frontend/src/lib/reportPdf.test.ts`

**Touch nothing else.** `lib/score.ts`, `lib/overview.ts`, `lib/scoreGuide.ts` and the Overview page
do not change. If the work appears to require editing another file, stop and report `BLOCKED`.

## Interface

### New exports in `lib/reportPdf.ts`

```ts
import { scoreTone } from './overview'
import type { ScoreTone } from './overview'
import { SCORE_GUIDE } from './scoreGuide'

/** Light-theme hexes, mirroring styles/globals.css. */
export const TONE_HEX: Record<ScoreTone, string> = { positive: '#16a34a', accent: '#F2A900', negative: '#dc2626' }

/** Mix `percent`% of `hex` into white. Integer arithmetic, exactly:
 *  channel = Math.round((255 * (100 - percent) + c * percent) / 100); lower-case '#rrggbb'. */
export function tintHex(hex: string, percent: number): string

export interface PdfScoreBar {
  label: string            // component.label
  fraction: number | null  // component.subscore
  fillHex: string | null   // TONE_HEX[scoreTone(subscore)], or null when subscore is null
  points: string           // `${points.toFixed(1)} / ${maxPoints}`, or `— / ${maxPoints}`
  detail: string           // `${measured ?? '—'} · ${window ?? '—'}`
}
export interface PdfScoreVisual {
  ring: { text: string; strokeHex: string; fillHex: string }
  bars: PdfScoreBar[]      // one per score.components entry, same order
}

/** Pure. total !== null → text String(Math.round(total)), stroke TONE_HEX[scoreTone(total / 100)],
 *  fill tintHex(that stroke, 10). total === null → { text: '—', strokeHex: BORDER, fillHex: '#ffffff' }. */
export function pdfScoreVisual(score: ResearchScore): PdfScoreVisual
```

The existing `GO`, `NO_GO` and `CONDITIONAL` constants may be re-expressed via `TONE_HEX`. Their values
must not change.

### `ReportContext` additions

- **`ensureSpace(height: number): void`.** If `context.y + height > CONTENT_BOTTOM`, add a page and
  set `context.y = MARGIN`. Use it before the ring block and before each bar row, so a row is never
  split across pages.
- **`ParagraphOptions` gains `align?: 'left' | 'center' | 'right'`.** `context.text` passes it to
  `doc.text` as `{ align }`. Use it for the ring number and right-aligned points.

### `scoreSection`: replace the table with the visual

Draw this from `pdfScoreVisual(input.score)`. The layout is your call; these sizes are the planner's
suggestion.

1. **The ring.** `ctx.ensureSpace(32)`. Draw a circle of radius about 13 mm, at the left margin.
   - Use `doc.setLineWidth(1.2)`, the draw colour `ring.strokeHex`, the fill colour `ring.fillHex`,
     and `doc.circle(…, 'FD')`.
   - `ring.text` is centred inside it: 20pt bold, in the **text colour**. `/ 100` goes below it:
     8pt, muted.
   - To the right of the ring, one muted 8pt line, wrapped to the remaining width:
     `Out of 100. Green at 70 or more, amber at 45 or more, red below. The colours are a reading aid, not a recommendation.`
   - If `score.total === null`, add a second line: `` `Not scored. Missing: ${score.missing.join(', ')}.` ``
2. **One row per bar.** `ctx.ensureSpace(12)` before each.
   - The label: 9pt bold, in the text colour, at the left margin.
   - A rounded track about 100 mm × 2.6 mm, in `BORDER`. If `fraction` is `> 0` and `fillHex` is not
     null, draw a fill of `100 × fraction` mm in `fillHex` over it.
   - The points: 9pt, right-aligned at the right margin, in the text colour.
   - The detail: 8pt muted, on the next line, aligned under the track.
3. **A muted 8pt pointer line:**
   `How each component is scored is explained under "How the score is calculated" at the end of this report.`
4. **`SCORE_DISCLAIMER`,** as now.

The old `Component | Measured | Window | Points` table is **removed** from the PDF.

### New last section

Append `{ title: 'How the score is calculated', render: guideSection }` to `REPORT_SECTIONS`, after
`Decision memo`. `guideSection` loops over `SCORE_GUIDE`:
- each `section.heading` goes through `ctx.subheading`;
- each paragraph goes through `ctx.paragraph`.

Nothing is retyped.

## Out of scope

- The six metric tiles and the Key risks card in the PDF. Not asked for; a later section can add them.
- Any change to the score, the guide text, `toPdfText`, the header or the footer.
- Embedded fonts, images or a chart library. The ring and bars are jsPDF primitives
  (`circle`, `roundedRect`/`rect`).
- Do not add dependencies.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

`reportPdf.test.ts`, using the existing fixtures:

1. `tintHex('#16a34a', 10) === '#e8f6ed'`, `tintHex('#F2A900', 10) === '#fef6e6'` and
   `tintHex('#dc2626', 10) === '#fce9e9'`. These were planner-computed with the formula above.
2. `pdfScoreVisual(computeScore(risk, performance, compare))`, on the existing full fixture:
   - `ring` equals `{ text: '36', strokeHex: '#dc2626', fillHex: '#fce9e9' }`;
   - `bars.map(b => b.fillHex)` equals `['#dc2626', '#dc2626', '#F2A900', '#16a34a']`;
   - `bars.map(b => b.points)` equals `['3.5 / 35', '0.0 / 25', '12.2 / 20', '20.0 / 20']`.

   (The planner's 0186 audit rendered this fixture as 36 / 100, with bars 3.5, 0.0, 12.2 and 20.0.)
3. `pdfScoreVisual(computeScore(null, null, null))`:
   - `ring` equals `{ text: '—', strokeHex: '#dde3f0', fillHex: '#ffffff' }`;
   - every `fillHex` is `null`;
   - `points` are `['— / 35', '— / 25', '— / 20', '— / 20']`.
4. `REPORT_SECTIONS.map(s => s.title)` ends with `'Decision memo', 'How the score is calculated'` and
   has length 7. Update the existing order test to the full 7-title list.
5. For the full fixture, `out = buildResearchReport(fullInput).output()`:
   - it contains `(How the score is calculated) Tj`, `(How the score works) Tj` and
     `(What is not scored) Tj`. The other guide headings contain parentheses, which jsPDF escapes as
     `\(` `\)`, so don't assert those literally;
   - it still has no `\u0000`;
   - the existing `Page ${n} of ${n}` check still passes.
6. The all-null fixture still builds. Its output has no `\u0000` and contains `(/ 100) Tj`, so the
   empty ring is drawn. (`—` is WinAnsi byte 0x97 in the output, so assert on `/ 100`.)

Structural:

7. `grep -c "'Component', 'Measured', 'Window', 'Points'" frontend/src/lib/reportPdf.ts` prints `0`.
8. `grep -c "from './overview'" frontend/src/lib/reportPdf.ts` prints at least `1`, and
   `grep -cE ">= ?0\.7|>= ?0\.45|TONE_HIGH|TONE_MID" frontend/src/lib/reportPdf.ts` prints `0`.
   The thresholds are not re-implemented.
9. `grep -c "SCORE_GUIDE" frontend/src/lib/reportPdf.ts` prints at least `2` (the import and the
   use), and `grep -c "How the score works" frontend/src/lib/reportPdf.ts` prints `0`. The guide is
   not retyped.

Global:

10. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
11. `cd frontend && npm run test` passes, with **the count after 0187 + the tests you added**, in the
    same file count as after 0187. Report both numbers.
12. `cd frontend && npm run build` exits 0. `cd frontend && npm run lint` shows the 2 known warnings and nothing new.
13. Run
    `cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --write src/lib/reportPdf.ts src/lib/reportPdf.test.ts`.
    **If it fails with `ENOTCACHED`, rerun that exact command outside the sandbox.** Then `--check`
    must print `All matched files use Prettier code style!`.
14. State in the report every file you modified.

**Planner-run:**

15. The planner renders the full-fixture PDF with `contracts/tools/pdf-render.swift` and checks:
    - the ring is red with `36` legible in the text colour;
    - the four bars show red (short), an empty track, gold (~61%) and green (full);
    - no row is split across pages;
    - the guide appendix is on the last page or pages, with every paragraph full-width.

## Verification to run and paste

```bash
(cd frontend && npx vitest run src/lib/reportPdf.test.ts)
grep -c "'Component', 'Measured', 'Window', 'Points'" frontend/src/lib/reportPdf.ts
grep -c "from './overview'" frontend/src/lib/reportPdf.ts
grep -cE ">= ?0\.7|>= ?0\.45|TONE_HIGH|TONE_MID" frontend/src/lib/reportPdf.ts
grep -c "SCORE_GUIDE" frontend/src/lib/reportPdf.ts
grep -c "How the score works" frontend/src/lib/reportPdf.ts
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?")
(cd frontend && npm run test 2>&1 | tail -6)
(cd frontend && npm run build 2>&1 | tail -6)
(cd frontend && npm run lint 2>&1 | tail -4)
(cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --check src/lib/reportPdf.ts src/lib/reportPdf.test.ts)
```

## Human verification — does Gunnar need to run anything?

Yes. Download the PDF from BEC → Research → Overview.
- Page 1 should show the coloured ring and the four bars, matching the page.
- The last page or pages should carry the guide.
- Print one copy in black and white. The ring and bars lose their colour there, but every number
  stays readable. That's by design: colour is never the only carrier of information.

## Open questions — do not resolve yourself

- If jsPDF 4.2.1's `circle` or `roundedRect` signatures differ from what is described here, report
  what you used. Do not cast to `any` without saying so.
