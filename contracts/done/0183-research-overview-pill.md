# Contract 0183 — Research → Overview pill (Research Score + latest memo)

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

**Depends on 0182** (`lib/score.ts`). If `frontend/src/lib/score.ts` does not exist, stop and report `BLOCKED`.

## Goal

After this contract, Research has an **Overview** pill, first in the bar and selected by default. It
shows the Research Score from `computeScore`, with each component's measured value, window and points,
and the plain disclaimer. Below that, it summarises the portfolio's latest Decision Memo.

## Why

`REBUILD.md`, "### Next: a Research tab inside Portfolios", step 5. The score design was approved by
Gunnar on 2026-11-08. Overview is the summary page, so it becomes the landing pill. It is also what
the PDF report (0184) prints, so **every number the PDF shows comes from data this page already holds.**
`main`'s tear sheet re-fetched with its own lookback and could disagree with its own page. This
design rules that out.

Read `main`'s page first, for reference only: `git show main:frontend/app/research/overview/page.tsx`.

| `main` | Here |
|---|---|
| Score from validation tests, HHI, in-sample Sharpe and drawdown. | `computeScore` from 0182: diversification, risk concentration, volatility vs market, beat-equal-weight across holdout years. |
| Score coloured green, amber or red by band, plus a GO/NO-GO hint. | **No colour bands and no verdict.** The total is printed in the normal text colour. The memo owns the recommendation, and two verdicts on one page would contradict each other. |
| A single score number. | Every component shows its measured input, its window and its points, so a reader can disagree with the weights. |

## Files

Create:
- `frontend/src/pages/analysis/research/OverviewSection.tsx`

Modify:
- `frontend/src/pages/analysis/ResearchPage.tsx`: add the `overview` pill **first**, make it the
  default tab, and pass `onOpenMemo={() => setTab('memo')}` to `OverviewSection`. Change nothing else.

**Touch nothing else.** Do not refactor `MemoSection.tsx`'s fetching into a shared hook. The
duplication is accepted (REBUILD.md: Gunnar accepts duplication across tabs). If the work appears to
require editing another file, stop and report `BLOCKED`.

`reference files/` and the `main` branch are read-only.

## Interface

### `ResearchPage.tsx`

```ts
type ResearchTab = 'overview' | 'portfolio' | 'memo'
const TABS: ReadonlyArray<readonly [ResearchTab, string, string]> = [
  ['overview', 'Overview', 'A 0–100 summary of how this portfolio is built, plus its latest decision memo'],
  ['portfolio', 'Compare Optimizers', /* unchanged */],
  ['memo', 'Decision Memo', /* unchanged */],
]
// useState<ResearchTab>('overview')
```

### `OverviewSection.tsx`

```ts
export function OverviewSection({ onOpenMemo }: { onOpenMemo: () => void }): JSX.Element | null
```

**Data.** Follow `MemoSection.tsx`'s pattern exactly: find the portfolio from the route, return `null`
for a missing or legacy portfolio, load the universe for `tradeBasis`, start requests once (with
`startedRef` and `mountedRef`), and keep per-request state of `running`, `error` or `ready`. Three
requests, all started together:

| Request | Built with |
|---|---|
| `riskPortfolio` | `buildRiskRequest(portfolio, DEFAULT_RISK_SETTINGS, basis)` |
| `performancePortfolio` | `buildPerformanceRequest(portfolio, { start: '', end: '' }, basis)`, the same default window Risk & Perf → Performance opens with |
| `comparePortfolio` | `buildCompareRequest(portfolio, DEFAULT_COMPARE_SETTINGS, basis)`, **only if** `portfolio.positions.length >= 2`. Otherwise the compare state is the error `Add at least two holdings to run the holdout comparison.` |

A builder returning `{ ok: false, message }` puts that request in the `error` state with that
message.

Once all three have settled, call `computeScore(riskOrNull, performanceOrNull, compareOrNull)` inside
`useMemo`.

**Layout**, top to bottom, in cards using the same `CARD` class string as `MemoSection.tsx`:

1. **Score card**, heading `Research Score`.
   - While any request is running: `Computing the score…`.
   - When `total !== null`: the total as `` `${Math.round(total)}` ``, large, followed by ` / 100` in muted text.
   - When `total === null`: `Not scored`, then `` `Missing: ${missing.join(', ')}.` `` Then, for each
     request in the `error` state, one muted line: `` `${Risk|Performance|Comparison}: ${message}` ``.
   - A table with columns `Component | Measured | Window | Points`, with one row per component in
     `components` order:
     - Measured shows `measured ?? '—'`. Window shows `window ?? '—'`.
     - Points shows `` `${points.toFixed(1)} / ${maxPoints}` ``, or `` `— / ${maxPoints}` `` when null.
   - Below the table, in muted small text, this source note verbatim:
     `Diversification and risk concentration use Risk & Perf → Health's one-year window. Volatility uses Risk & Perf → Performance's default window. Holdout robustness counts the years in Compare Optimizers where this portfolio's holdout Sharpe beat equal weight's.`
   - Then `SCORE_DISCLAIMER`, imported from `lib/score.ts`, never retyped.
2. **Memo card**, heading `Latest decision memo`. Read with `listMemos(portfolioId)` once, at mount,
   in a `useState` initializer. Switching pills unmounts the section, so this is fresh each visit.
   - **With memos:**
     - Take `memos[0]`. Show its recommendation, styled as `MemoSection.tsx` styles recommendations.
       Copy its colour mapping locally; do not export it from `MemoSection`.
     - Then `new Date(createdAt).toLocaleDateString()` and `` `Latest of ${memos.length} saved` ``.
     - Then the rationale (`whitespace-pre-wrap`), and the red flags as `severity · title` lines, or
       `No red flags.`.
     - Then the monitoring plan, if non-empty.
     - If `holdingsChanged(memo, portfolio)`, add `Holdings have changed since this memo.`
     - Finally, a button `Open Decision Memo` that calls `onOpenMemo`.
   - **With no memos:** `No decision memo yet.` and a button `Write a memo` that calls `onOpenMemo`.

Theme tokens only (`text-brand-positive`, `var(--color-muted)` and so on). No fixed Tailwind palette
colours.

## Out of scope

- **The PDF button and the attribution request.** Those are 0184.
- No settings controls (lookback, folds, market ticker). The page uses the defaults, so its numbers
  match the tabs they summarise.
- No caching of responses across pills, and no shared fetch hook.
- No change to `lib/score.ts`, `lib/memo.ts`, `lib/memoStore.ts` or `MemoSection.tsx`.
- No colour bands, grades or verdict on the score.
- Do not add dependencies.

## Tooltips

Use the project's `Tooltip` component. Never use `title=`.

| Element | Tooltip |
|---|---|
| `Overview` pill | `A 0–100 summary of how this portfolio is built, plus its latest decision memo` |
| `Open Decision Memo` button | `Go to the Decision Memo pill to see every saved memo or write a new one` |
| `Write a memo` button | `Go to the Decision Memo pill to record a decision for this portfolio` |
| Each component name in the score table | `diversification`: `1 ÷ HHI of the invested money. 20 or more effective holdings scores full points.` · `risk_concentration`: `The largest single holding's share of portfolio volatility. 10% or less scores full points; 50% or more scores zero.` · `volatility`: `Portfolio volatility divided by the market's over the same days. Up to 1.0× scores full points; 2.0× or more scores zero.` · `robustness`: `Years in which this portfolio's holdout Sharpe beat equal weight's (1/N), out of the years that could be tested.` |

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
2. `cd frontend && npm run test` passes with the **same test count and file count as after 0182**.
   This contract adds no lib code, so no tests. Report both numbers.
3. `cd frontend && npm run build` exits 0.
4. `cd frontend && npm run lint` shows the same 2 known warnings and nothing new.
5. `grep -n ' title=' frontend/src/pages/analysis/research/OverviewSection.tsx frontend/src/pages/analysis/ResearchPage.tsx` prints nothing.
6. `grep -nE '(bg|text|border)-(green|red|amber|yellow|emerald|rose)-[0-9]' frontend/src/pages/analysis/research/OverviewSection.tsx` prints nothing.
7. `grep -c "computeScore(" frontend/src/pages/analysis/research/OverviewSection.tsx` prints `1`.
8. `grep -c "SCORE_DISCLAIMER" frontend/src/pages/analysis/research/OverviewSection.tsx` prints `2`: the import and the use.
   `grep -c "does not predict returns" frontend/src/pages/analysis/research/OverviewSection.tsx` prints `0`, so the text is not retyped.
9. `grep -n "\['overview', 'Overview'" frontend/src/pages/analysis/ResearchPage.tsx` matches, and
   `grep -n "useState<ResearchTab>('overview')" frontend/src/pages/analysis/ResearchPage.tsx` matches.
10. Format both files with
    `cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --write src/pages/analysis/research/OverviewSection.tsx src/pages/analysis/ResearchPage.tsx`.
    Then `awk 'length > 300 {print FILENAME": "FNR}'` over both files must print nothing. If prettier
    fails, report it. Do not hand-reformat.
11. State in the report the full list of files you created or modified.

**Planner-run** (coders skip these, and write "browser checks left for the Planner" under Not done):

12. `node contracts/tools/smoke-render.mjs research` shows no `EXCEPTION:`. PAGE TEXT contains
    `Research Score`, `Diversification`, `Holdout robustness`, `does not predict returns` and
    `No decision memo yet`.
13. `SMOKE_CLICKS="Write a memo" node contracts/tools/smoke-render.mjs research`: PAGE TEXT contains `Rationale`.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output, including failures.

```bash
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?")
(cd frontend && npm run test 2>&1 | tail -6)
(cd frontend && npm run build 2>&1 | tail -6)
(cd frontend && npm run lint 2>&1 | tail -4)
grep -n ' title=' frontend/src/pages/analysis/research/OverviewSection.tsx frontend/src/pages/analysis/ResearchPage.tsx
grep -nE '(bg|text|border)-(green|red|amber|yellow|emerald|rose)-[0-9]' frontend/src/pages/analysis/research/OverviewSection.tsx
grep -c "computeScore(" frontend/src/pages/analysis/research/OverviewSection.tsx
grep -c "SCORE_DISCLAIMER" frontend/src/pages/analysis/research/OverviewSection.tsx
grep -c "does not predict returns" frontend/src/pages/analysis/research/OverviewSection.tsx
grep -n "\['overview', 'Overview'" frontend/src/pages/analysis/ResearchPage.tsx
grep -n "useState<ResearchTab>('overview')" frontend/src/pages/analysis/ResearchPage.tsx
awk 'length > 300 {print FILENAME": "FNR}' frontend/src/pages/analysis/research/OverviewSection.tsx frontend/src/pages/analysis/ResearchPage.tsx
```

## Human verification — does Gunnar need to run anything?

Yes. It's frontend only, so nothing needs restarting. Open BEC → Research. Overview should be the pill
that opens. Check it in both themes, at full width and at ~800 px.

- **Judge the score itself.** BEC has about 5.1 effective holdings (from 0175), so expect
  Diversification at about `8.9 / 35`. With MS near 36% of the money, Risk concentration will also be
  low. **A total in the 30s or 40s is what this design produces for a concentrated conviction
  portfolio.** If that feels wrong, the anchors are constants in `lib/score.ts`
  (`DIVERSIFICATION_FULL = 20` is the one that bites). Changing them is a decision for the planner,
  not a code tweak.
- Check the Window column: the three windows should end on the latest trading day.
- With a saved memo, the memo card shows it. Change a holding and come back: it should say
  `Holdings have changed since this memo.` `Open Decision Memo` should switch pills.

## Open questions — do not resolve yourself

- None known. If any client function or builder named above has a different signature, stop and
  report `BLOCKED`.
