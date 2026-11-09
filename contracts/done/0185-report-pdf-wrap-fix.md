# Contract 0185 — PDF report: full-width paragraphs, memo sub-headings, formatting

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, every paragraph in the PDF report wraps at the full content width (180 mm). The
memo's `Rationale`, `Red flags` and `Monitoring plan` labels are smaller than the section titles. The
files from 0183 and 0184 are prettier-formatted.

## Why

The 0184 audit rendered a real report (`contracts/done/0184-research-pdf-report.report.md`) and found two
problems.

1. **Narrow paragraphs.** `ReportContext.paragraph()` calls `doc.splitTextToSize()` *before*
   `context.text()` sets the font. jsPDF measures with whatever font was last set. After a 13pt bold
   heading, a 9pt paragraph wraps at about 65% of the page. This hits the memo rationale, the factor
   attribution summary and the optimizer comparison sentence.
2. **Memo sub-headings look like sections.** `memoSection` draws `Rationale`, `Red flags` and
   `Monitoring plan` with `ctx.heading()`, at the same 13pt primary style as the six section titles.

Prettier could not run inside the coder sandbox during 0183 and 0184 (`ENOTCACHED`), so three files are
unformatted.

## Files

Modify:
- `frontend/src/lib/reportPdf.ts`
- `frontend/src/lib/reportPdf.test.ts`
- `frontend/src/pages/analysis/research/OverviewSection.tsx`: **formatting only**, via the prettier
  command below. No hand edits.
- `frontend/src/pages/analysis/ResearchPage.tsx`: **formatting only**, via the prettier command
  below. No hand edits.

**Touch nothing else.** If the work appears to require editing another file, stop and report `BLOCKED`.

## Interface

### 1. `paragraph()`: set the font before measuring

In `createContext`'s `paragraph`, insert these two lines immediately before the
`doc.splitTextToSize(...)` call:

```ts
doc.setFont('helvetica', options.fontStyle ?? 'normal')
doc.setFontSize(fontSize)
```

Change nothing else in `paragraph`.

### 2. A `subheading` helper

Add to the `ReportContext` interface:

```ts
subheading(text: string): void
```

Implement it in `createContext`, modelled on `heading`:
- If `context.y + 8 > CONTENT_BOTTOM`, add a page and set `context.y = MARGIN`.
- Then `context.text(text, MARGIN, context.y + 4, { fontSize: 10, fontStyle: 'bold', color: TEXT })`.
- Then `context.y += 7`.

In `memoSection`, replace the three `ctx.heading('Rationale')`, `ctx.heading('Red flags')` and
`ctx.heading('Monitoring plan')` calls with `ctx.subheading(...)`. `ctx.heading` stays only in
`buildResearchReport`'s section loop.

## Out of scope

- No other layout, colour, content or section change.
- No change to `toPdfText`, `REPORT_SECTIONS`, the footer, or the header.
- Do not add dependencies.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

1. In `reportPdf.test.ts`, add one test called `wraps paragraphs at the full content width`. It
   uses the existing full fixture with `rationale: 'Long rationale. '.repeat(600)`. It must do exactly
   this:
   ```ts
   const doc = buildResearchReport(longInput)
   const lines = [...doc.output().matchAll(/\(([^)]*rationale\.[^)]*)\) Tj/g)].map((m) => m[1])
   expect(lines.length).toBeGreaterThan(10)
   doc.setFont('helvetica', 'normal')
   doc.setFontSize(9)
   const widest = Math.max(...lines.map((line) => doc.getTextWidth(line)))
   expect(widest).toBeGreaterThan(150)
   expect(widest).toBeLessThanOrEqual(180)
   ```
   **Run this test before making change 1 and confirm it fails.** Paste that failing output into the
   report. Then make the change and confirm it passes. A test that passed before the fix would prove
   nothing.
2. `grep -c "ctx.heading(" frontend/src/lib/reportPdf.ts` prints `0`, and
   `grep -c "ctx.subheading(" frontend/src/lib/reportPdf.ts` prints `3`.
3. Every existing `reportPdf.test.ts` test still passes unchanged. That includes `(Decision memo) Tj`
   and the `\u0000` checks.
4. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
5. `cd frontend && npm run test` passes, with **445 tests in 31 files** (444 + 1).
6. `cd frontend && npm run lint` shows the same 2 known warnings and nothing new.
7. Run
   `cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --write src/lib/reportPdf.ts src/lib/reportPdf.test.ts src/pages/analysis/research/OverviewSection.tsx src/pages/analysis/ResearchPage.tsx`.
   **If it fails with `ENOTCACHED`, rerun that exact command outside the sandbox, as 0184 did for
   `npm install`.** Then the same command with `--check` instead of `--write` must print
   `All matched files use Prettier code style!`. Do not hand-reformat.
8. After formatting, rerun criteria 4–6, and report the results.

**Planner-run:**

9. The planner renders the report with `contracts/tools/pdf-render.swift` and checks that the
   rationale spans the page width and that the memo sub-headings are visibly smaller than the
   section titles.

## Verification to run and paste

```bash
(cd frontend && npx vitest run src/lib/reportPdf.test.ts)
grep -c "ctx.heading(" frontend/src/lib/reportPdf.ts
grep -c "ctx.subheading(" frontend/src/lib/reportPdf.ts
(cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --check src/lib/reportPdf.ts src/lib/reportPdf.test.ts src/pages/analysis/research/OverviewSection.tsx src/pages/analysis/ResearchPage.tsx)
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?")
(cd frontend && npm run test 2>&1 | tail -6)
(cd frontend && npm run lint 2>&1 | tail -4)
```

Also paste the failing run from criterion 1, taken before the fix.

## Human verification — does Gunnar need to run anything?

- **Nothing new beyond 0184's check.** When you download a report from BEC, the rationale and the
  factor summary should run the full width of the page.

## Open questions — do not resolve yourself

- If the new test passes *before* change 1, stop and report `BLOCKED`. The test is not detecting the
  bug, and the planner needs to know.
