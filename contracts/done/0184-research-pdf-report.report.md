# Report — Contract 0184 (research PDF report)

## Audit

**Accepted, with follow-up 0185 for a layout bug that every criterion missed.** The builder's
structure, sanitizer, pagination, footers, lazy loading and download all work. However,
`paragraph()` measures text before setting its font, so paragraphs that follow a heading wrap at about
65% of the page width.

**Re-run by the planner, 2026-11-08:**
- tsc 0; 444 tests in 31 files; build OK; lint shows the 2 known warnings.
- All greps as specified. `backend/requirements.txt` has no jspdf.
- **Bundle (criterion 18):** the entry chunk `index-*.js` contains no jsPDF code. It lives only in
  `reportPdf-*.js` (435 kB, 141 kB gzip), which loads on click.
- **Smoke (12, 13, 19):** run against a stub API, with Vite on :5180 and Chrome on :9334, so nothing
  touched production.
  - Overview renders with no exception.
  - The score shows `36 / 100`, with the breakdown, the source note and the disclaimer.
  - `Write a memo` switches to the Memo pill.
- **Real browser download:** the CDP download behaviour was set to `/tmp/audit/dl`. Clicking
  `Download PDF report` saved `Smoke_test_research_2026-11-08.pdf` (36 kB), with no
  `Could not build the PDF` message.
- **Rendered and looked at:** the coder's fixture, with a long rationale, was built into a 4-page PDF
  and drawn with PDFKit (`contracts/tools/pdf-render.swift`, added in this audit).
  - The text is clean: `t = 2.5 *`, and windows read `2025-11-07 to 2026-11-06`.
  - Every page carries `Page X of 4`, and no table row is split.

**What's good, concretely:**
- **All drawing goes through `ReportContext`,** so `toPdfText` is applied in exactly one place, and
  the NUL-byte test proves it.
- **The coder avoided an untyped API.** `didDrawPage`'s `cursor` replaces the untyped
  `lastAutoTable.finalY`, with no casts.
- **`rowPageBreak: 'avoid'`** keeps table rows whole across pages.
- **The coder reported the npm-audit warnings rather than "fixing" them.** All 4 are in pre-existing
  dev tooling (`vite`, `vitest`, `source-map-js`), not jspdf.

**Defects, filed as 0185:**
1. **`paragraph()` calls `splitTextToSize` before `setFontSize`.** It measures at the previous
   element's size (a 13pt bold heading), so the memo rationale, the factor summary and the comparison
   sentence wrap at about 117 of 180 mm.
2. **The memo's `Rationale`, `Red flags` and `Monitoring plan` use `heading()`,** so they look like
   new top-level sections. The contract said "sub-heading", but defined no helper for it. That
   ambiguity is partly the contract's.
3. **Prettier did not run.** In the coder sandbox, `npx --offline` cannot read `~/.npm`
   (`ENOTCACHED`). It works from the planner shell. Three files are unformatted
   (`reportPdf.ts`, `OverviewSection.tsx`, `ResearchPage.tsx`). None is collapsed: the longest line is
   under 300.

**Lesson for the planner:** text criteria (`(title) Tj`, no NUL) prove what's in the PDF, not what it
looks like. Any future PDF contract gets a planner-run render via `pdf-render.swift`, and a
width-based test for any layout property that matters.
