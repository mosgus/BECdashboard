# Contract 0184 — Research → Overview: one-click PDF report (jsPDF, vector text)

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

**Depends on 0182 and 0183.** If `frontend/src/lib/score.ts` or
`frontend/src/pages/analysis/research/OverviewSection.tsx` does not exist, stop and report `BLOCKED`.

## Goal

After this contract, the Overview pill has a **Download PDF report** button. One click downloads an
A4 PDF with real, selectable text. It contains:
- a header;
- the Research Score with its breakdown and disclaimer;
- performance against the market;
- holdings and risk;
- Fama-French factor attribution;
- the optimizer comparison;
- the latest decision memo;
- a footer with the page number and the disclaimer on every page.

The report is built from data the page already holds. It computes nothing new.

## Why

Gunnar, 2026-11-08: he wants an exportable report like `main`'s tear sheet, as a single-click
download, with more content than `main` had, and **he expects to add sections later**. So the
builder is a list of independent sections, and adding one is a single function plus one array entry.

Read `main`'s version first: `git show main:frontend/components/research/TearsheetPDF.tsx`. **Do not
port its method.** It screenshots a hidden div with html2canvas and slices the bitmap into pages.
That gives:
- unsearchable, blurry text;
- page breaks that cut through lines (its `pageBreakBefore` div does nothing to a bitmap);
- multi-megabyte files.

Also, html2canvas 1.4 cannot parse `oklch()` colours, which Tailwind v4 uses. Here, text and tables are
drawn directly with `jspdf` and `jspdf-autotable`.

**Verified by the planner on 2026-11-08, against jspdf 4.2.1 and jspdf-autotable 5.0.9 in Node:**
- The built-in fonts use `WinAnsiEncoding`.
- **One character outside WinAnsi makes jsPDF encode the whole string as two-byte text, and the line
  prints as garbage.** Examples are `→` (every window string in this app), `★` (`loadingRows`' `tText`)
  and `−` (U+2212). `—`, `·`, `×` and `÷` are inside WinAnsi and print correctly.
- A garbled string leaves NUL bytes (`\u0000`) in `doc.output()`. Clean output has none.
- `import { jsPDF } from 'jspdf'` and `import { autoTable } from 'jspdf-autotable'` both work in
  Vitest's `node` environment. Plain text appears in `doc.output()` as `(text) Tj`.

## Files

Create:
- `frontend/src/lib/reportPdf.ts`: the builder. It imports `jspdf` and `jspdf-autotable` statically.
  It must be imported **only dynamically** by UI code, so both libraries stay out of the main bundle.
- `frontend/src/lib/reportPdf.test.ts`

Modify:
- `frontend/package.json` and `frontend/package-lock.json`, **only** through
  `cd frontend && npm install jspdf@^4.2.1 jspdf-autotable@^5.0.9`. Both go under `dependencies`.
  **Do not touch `backend/requirements.txt`.** These are npm packages. Listing them there would
  break the backend's `pip install` on Render.
- `frontend/src/lib/download.ts`: add `downloadBlob`. Leave `downloadTextFile` unchanged.
- `frontend/src/pages/analysis/research/OverviewSection.tsx`:
  - add the attribution request;
  - add the button and its busy and error states;
  - pass the data to the builder.

  Change nothing else in the file.

**Touch nothing else.** If the work appears to require editing another file, stop and report `BLOCKED`.

`reference files/` and the `main` branch are read-only.

## Interface

### `lib/reportPdf.ts`

```ts
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { AttributionResponse, CompareResponse, PerformanceResponse, RiskResponse } from '../api/client'
import type { DecisionMemo } from './memo'
import type { ResearchScore } from './score'

export type ReportSource = 'risk' | 'performance' | 'compare' | 'attribution'

export interface ReportInput {
  portfolioName: string
  generatedOn: string            // local date, YYYY-MM-DD
  holdingsCount: number          // portfolio.positions.length
  cashPct: number                // percent, as Portfolio.cashWeight
  score: ResearchScore
  risk: RiskResponse | null
  performance: PerformanceResponse | null
  compare: CompareResponse | null
  attribution: AttributionResponse | null
  /** Error message per failed request. Used for the 'Unavailable: …' line. */
  errors: Partial<Record<ReportSource, string>>
  memo: DecisionMemo | null      // latest memo, or null
  memoHoldingsChanged: boolean
}

export interface ReportSection {
  title: string
  render: (ctx: ReportContext, input: ReportInput) => void
}

/** Your design. It must carry the jsPDF doc and a vertical cursor, and give sections helpers for a
 * heading, wrapped paragraphs and tables. Those helpers start a new page when content would run past
 * the bottom margin. A section never computes page breaks itself. */
export interface ReportContext { /* … */ }

export const REPORT_SECTIONS: ReportSection[]   // order and titles below

/** Map the known non-WinAnsi characters, then replace any remaining character outside WinAnsi with '?'. */
export function toPdfText(text: string): string

export function reportFilename(portfolioName: string, generatedOn: string): string
// `${portfolioName.replace(/[^A-Za-z0-9_-]/g, '_')}_research_${generatedOn}.pdf`

export function buildResearchReport(input: ReportInput): jsPDF
// new jsPDF({ unit: 'mm', format: 'a4' }). Do NOT enable `compress`.
```

**Every string drawn, whether via `doc.text` or in an `autoTable` head or body cell, goes through
`toPdfText`.** Route all drawing through the `ReportContext` helpers so there is one place where that
happens.

`toPdfText` mapping, applied first: `→` → `to`, `−` (U+2212) → `-`, `≤` → `<=`, `≥` → `>=`, `★` → `*`,
`≈` → `~`. Then every character is kept only if it is one of:
- `\n`;
- U+0020–U+007E;
- U+00A0–U+00FF;
- one of `€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ`.

Anything else becomes `?`.

**Colours.** The PDF is always light. Define hex constants in `reportPdf.ts` with a comment that they
mirror `styles/globals.css`'s light theme:
- primary `#012169`
- text `#111111`
- muted `#4a5d7a`
- border `#dde3f0`
- GO `#16a34a`
- NO-GO `#dc2626`
- CONDITIONAL `#F2A900`

Font: `helvetica`.

### Page 1 header (drawn by `buildResearchReport` before the sections)

- `Blue Eagle Capital`, bold, in primary.
- `Portfolio Research Report`, muted.
- The portfolio name, bold.
- `` `Generated ${generatedOn} · ${holdingsCount} holdings · ${cashPct.toFixed(1)}% cash` ``.
- A primary-coloured rule.

### `REPORT_SECTIONS`: exact titles and order

Each section starts with its title as a heading. **Every section whose source response is `null`
prints exactly** `` `Unavailable: ${input.errors[source] ?? 'not loaded'}` `` and nothing else.

Reuse the existing row builders, listed below, and do not recompute what they already compute.

| # | `title` | Source | Content |
|---|---|---|---|
| 1 | `Research Score` | `score` (never null) | `` `${Math.round(total)} / 100` ``, or `Not scored. Missing: ${missing.join(', ')}.`. Then a table `Component \| Measured \| Window \| Points`, formatted as in 0183. Then `SCORE_DISCLAIMER`, imported from `lib/score.ts`. |
| 2 | `Performance` | `performance` | `performanceSummary(performance)`, then a table `Metric \| Portfolio \| ${market_ticker} \| Difference` from `performanceRows(performance)`, using its `label`, `portfolio`, `benchmark` and `diff` strings. |
| 3 | `Holdings and risk` | `risk` | `riskSummary(risk)`, then one line: portfolio vol, beta, effective holdings, top-5 weight. Then a table `Ticker \| Weight \| Volatility \| Beta \| Risk share` from `riskRows(risk)`, with **every** holding. autoTable paginates. |
| 4 | `Factor attribution` | `attribution` | `attributionSummary(attribution)`, then a loadings table `Factor \| Beta \| t` from `loadingRows` (`label`, `betaText`, `tText`). Then a contributions table `Component \| Contribution` from `contributionRows` (`label`, `text`). Then `attributionFootnote(attribution)`. |
| 5 | `Optimizer comparison` | `compare` | One line: `` `Each optimizer is fit on ${lookbackLabel(compare.lookback_days)} of prices and scored on the following year, across ${usableFolds(compare)} yearly holdouts.` `` Then a table from `compareRows(compare)`: `Portfolio \| Mean holdout Sharpe \| Worst year \| Beat equal weight \| Beat current \| In-sample Sharpe`. Sharpes use `toFixed(2)`. Win counts are `` `${wins}/${of}` ``, or `—`. A row with `error` shows the error in the second column and `—` elsewhere. |
| 6 | `Decision memo` | `memo` | If null: `No decision memo recorded.` Otherwise: the recommendation, bold, in its colour, with `new Date(createdAt).toLocaleDateString()`. Then `Holdings have changed since this memo.` if `memoHoldingsChanged`. Then `Rationale`, `Red flags` (`severity · title — detail` per flag, or `None.`) and `Monitoring plan`, each as a sub-heading plus a wrapped paragraph. |

Section 6's null case is **not** an error. It does not use the `Unavailable:` line.

If any helper named above (`lookbackLabel`, `usableFolds`, `performanceSummary`, `riskSummary`,
`attributionSummary`, `attributionFootnote`, `loadingRows`, `contributionRows`, `compareRows`,
`performanceRows`, `riskRows`) is not exported, or has a different shape, stop and report `BLOCKED`.
Do not edit the lib file to export it.

### Footer (drawn on every page after all sections, so the total is known)

- Line 1, muted: `` `Blue Eagle Capital · ${portfolioName} · generated ${generatedOn} · Page ${i} of ${n}` ``
- Line 2, muted: `For research and educational purposes only. Not investment advice.`

### `lib/download.ts`

```ts
export function downloadBlob(filename: string, blob: Blob): void   // same anchor/objectURL pattern as downloadTextFile
```

### `OverviewSection.tsx` changes

- **A fourth request,** started with the other three: `attributionPortfolio(request)`, using the
  **same** request object built for performance. It has its own `running`/`error`/`ready` state.
  The score does not wait for it.
- **A button, `Download PDF report`,** at the top of the Overview, above the score card.
  - It is disabled until all four requests have settled (`ready` or `error`), and while a build is
    in progress.
  - While building, its label is `Building PDF…`.
  - On click:
    ```ts
    const { buildResearchReport, reportFilename } = await import('../../../lib/reportPdf')
    const doc = buildResearchReport(input)
    downloadBlob(reportFilename(portfolio.name, generatedOn), doc.output('blob'))
    ```
  - `generatedOn = new Date().toLocaleDateString('en-CA')`.
  - `memo` is the memo card's `memos[0] ?? null`. `memoHoldingsChanged` is
    `memo !== null && holdingsChanged(memo, portfolio)`.
  - `errors` is filled from each request in the `error` state, plus the 0183 compare message for
    fewer than two holdings.
  - On a thrown error: `` `Could not build the PDF: ${message}` `` below the button, in `text-brand-negative`.
- **No static import of any kind**, type-only included, of `lib/reportPdf`, `jspdf` or
  `jspdf-autotable` anywhere under `src/pages` or `src/components`. Build the input object inline in
  the `buildResearchReport(...)` call. Its type is checked through the dynamic import.

## Out of scope

- **Charts in the PDF.** Gunnar may add sections later. Each will be its own contract that appends
  to `REPORT_SECTIONS`.
- Custom or embedded fonts, and logo images.
- Report options: section toggles, a page size choice, a preview.
- Server-side PDF generation and backend changes. **`backend/requirements.txt` must not change.**
- Showing attribution on the Overview page itself. It is fetched only for the report.
- Changes to `lib/score.ts`, `lib/memo.ts`, `lib/research.ts`, `lib/performance.ts`, `lib/risk.ts`,
  `lib/attribution.ts`, or any other section.
- No dependencies beyond `jspdf` and `jspdf-autotable`.

## Tooltips

| Element | Tooltip |
|---|---|
| `Download PDF report` button (enabled or disabled) | `Download this portfolio's research as a PDF: score, performance, risk, factor attribution, optimizer comparison and the latest memo` |

Use the project's `Tooltip`. Never use `title=`.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

`reportPdf.test.ts`, with literal fixtures written in the test file:

1. `toPdfText`:
   - `'2023-01-01 → 2026-01-01'` gives `'2023-01-01 to 2026-01-01'`;
   - `'t = 2.4 ★'` gives `'t = 2.4 *'`;
   - `'−0.50'` gives `'-0.50'`;
   - `'x ≥ 1'` gives `'x >= 1'`;
   - `'a — b · c × d'` is unchanged;
   - `'日本'` gives `'??'`;
   - `'line1\nline2'` is unchanged.
2. `reportFilename('BEC Growth / 2026', '2026-11-08')` is `'BEC_Growth___2026_research_2026-11-08.pdf'`.
3. `REPORT_SECTIONS.map(s => s.title)` equals
   `['Research Score', 'Performance', 'Holdings and risk', 'Factor attribution', 'Optimizer comparison', 'Decision memo']`.
4. **Full fixture.** All four responses are non-null, and the memo is non-null.
   - The fixture **must** include:
     - an attribution loading with `t_stat: 2.5`, so a `★` reaches the builder;
     - the normal `→` window strings;
     - a memo whose `rationale` contains `→` and `日`.
   - With `out = buildResearchReport(input).output()`:
     - `out` contains `(Research Score) Tj`, `(Performance) Tj`, `(Holdings and risk) Tj`,
       `(Factor attribution) Tj`, `(Optimizer comparison) Tj` and `(Decision memo) Tj`;
     - `out.includes('\u0000')` is `false`. This is the check that the sanitizer is applied
       everywhere. It cannot pass if any string bypasses `toPdfText`;
     - with `n = doc.getNumberOfPages()`, `out` contains `` `Page ${n} of ${n}` ``.
5. **All-null fixture:** `risk`, `performance`, `compare`, `attribution` and `memo` all null,
   `score = computeScore(null, null, null)`, and `errors: { risk: 'boom' }`.
   - It builds without throwing.
   - `out` contains `(Unavailable: boom) Tj`, `(Unavailable: not loaded) Tj` and
     `(No decision memo recorded.) Tj`.
   - `out.includes('\u0000')` is `false`.
6. **Pagination of long text:** the full fixture with `rationale` set to `'Long rationale. '.repeat(600)`
   has a **greater** `getNumberOfPages()` than the full fixture as in criterion 4, and its output has
   no `\u0000`.

Global:

7. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
8. `cd frontend && npm run test` passes, with **the count after 0183 + the tests you added**, in **31** files. Report both numbers.
9. `cd frontend && npm run build` exits 0.
10. `cd frontend && npm run lint` shows the same 2 known warnings and nothing new.
11. `grep -nE '"jspdf": "\^4\.|"jspdf-autotable": "\^5\.' frontend/package.json` prints 2 lines, and both are in the `dependencies` block.
12. `grep -c "jspdf" backend/requirements.txt` prints `0`.
13. `grep -rnE "from '[^']*(lib/reportPdf|jspdf)" frontend/src/pages frontend/src/components` prints nothing.
    It matches the `from` clause, so a multi-line import cannot slip past it.
14. `grep -c "import('../../../lib/reportPdf')" frontend/src/pages/analysis/research/OverviewSection.tsx` prints `1`.
15. `grep -n ' title=' frontend/src/pages/analysis/research/OverviewSection.tsx` prints nothing.
16. Format the three source files you created or edited with
    `cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --write src/lib/reportPdf.ts src/lib/reportPdf.test.ts src/pages/analysis/research/OverviewSection.tsx`.
    Then `awk 'length > 300 {print FILENAME": "FNR}'` over those three files must print nothing. If
    prettier fails, report it. Do not hand-reformat.
17. In the report:
    - list every file you created or modified;
    - give the installed versions from `npm ls jspdf jspdf-autotable`;
    - say in two sentences how a future contract would add a seventh section.

**Planner-run** (coders skip these, and write "browser checks left for the Planner" under Not done):

18. After `npm run build`, the entry chunk in `frontend/dist/assets/` does not contain jsPDF. A
    separate chunk does.
19. `node contracts/tools/smoke-render.mjs research`: no `EXCEPTION:`, and PAGE TEXT contains `Download PDF report`.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output, including failures.

```bash
(cd frontend && npm ls jspdf jspdf-autotable)
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?")
(cd frontend && npx vitest run src/lib/reportPdf.test.ts)
(cd frontend && npm run test 2>&1 | tail -6)
(cd frontend && npm run build 2>&1 | tail -10)
(cd frontend && npm run lint 2>&1 | tail -4)
grep -nE '"jspdf": "\^4\.|"jspdf-autotable": "\^5\.' frontend/package.json
grep -c "jspdf" backend/requirements.txt
grep -rnE "from '[^']*(lib/reportPdf|jspdf)" frontend/src/pages frontend/src/components
grep -c "import('../../../lib/reportPdf')" frontend/src/pages/analysis/research/OverviewSection.tsx
grep -n ' title=' frontend/src/pages/analysis/research/OverviewSection.tsx
awk 'length > 300 {print FILENAME": "FNR}' frontend/src/lib/reportPdf.ts frontend/src/lib/reportPdf.test.ts frontend/src/pages/analysis/research/OverviewSection.tsx
```

## Human verification — does Gunnar need to run anything?

Yes. Frontend only, so nothing needs restarting, but `npm install` must have run, since there are new
dependencies. Open BEC → Research → Overview, wait for the button to enable, and click it.

- Open the PDF in Preview and in Chrome. **Select some text and search for a ticker.** If the text
  can't be selected, the wrong method shipped.
- Read every line for garbage characters, especially the date windows (they should read
  `2025-11-07 to 2026-11-06`) and the factor `t` column.
- Check page breaks: no table row or paragraph line should be cut in half, and every page should carry
  `Page X of Y`.
- Check the numbers against the Overview page and Risk & Perf. They must match, because they come
  from the same requests.
- Tell the planner what to add next. Each addition is its own small contract.

## Open questions — do not resolve yourself

- If `npm install` reports a peer-dependency conflict between `jspdf` 4.x and `jspdf-autotable` 5.x,
  stop and report `BLOCKED`. Do not use `--force` or `--legacy-peer-deps`.
- If `jspdf-autotable`'s named `autoTable` export, or `doc.lastAutoTable.finalY`, isn't typed in the
  installed version, report what you used instead. Do not add `any` casts without saying so.
