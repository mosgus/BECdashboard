# Contract 0175 — Research → Decision Memo pill (localStorage, evidence from risk + compare)

**Status:** open
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

After this contract, Research has a second pill, **Decision Memo**. It lets Gunnar record a
GO / CONDITIONAL / NO-GO decision for the portfolio, with:
- a rationale;
- red flags, suggested automatically from evidence and editable;
- a monitoring plan;
- a snapshot of the evidence and holdings at the time.

Saved memos are kept in this browser (localStorage), newest first, below the form.

## Why

Gunnar, 2026-10-26: the Memo comes next, ahead of Asset and Robustness. Overview waits until after
Robustness. Read `main`'s page first: `git show main:frontend/app/research/decision/page.tsx`.

**What changes from `main`, and why:**

| `main` | Here |
|---|---|
| The scorecard, the default flags and the GO/NO-GO hint all come from `composite_score`, 30% of which is the validation suite. | No score. That suite is the Robustness step, and the reworked 0–100 score comes with Overview. The memo shows **evidence**: plain numbers, each with its window, from `/portfolio/risk` and `/portfolio/compare`. Red flags derive from those numbers. |
| Memos in a server table (`0009_research_decision_memos`). | localStorage key `bec-research-memos`, because portfolios themselves live only in this browser (REBUILD.md). |
| Flags only from the score, removable. | Suggested flags from evidence, dismissible, plus flags Gunnar adds himself. |
| No list of saved memos on the page, and no delete. | Saved memos listed below the form, expandable, deletable. Each memo says when the portfolio's holdings have changed since it was written. |
| Fixed `bg-green-600`, `bg-red-600`, `bg-amber-50` colours. | Theme tokens only, so light and dark both work. |
| Deleting a portfolio left its memos behind. | Deleting a portfolio deletes its memos. |

## Files

Create:
- `frontend/src/lib/memo.ts`: pure types and helpers. No storage, no React.
- `frontend/src/lib/memo.test.ts`
- `frontend/src/lib/memoStore.ts`: localStorage access, guarded the way `lib/portfolioStore.ts` is.
- `frontend/src/lib/memoStore.test.ts`: stub `localStorage` with `vi.stubGlobal`, as `portfolioStore.test.ts` does.
- `frontend/src/pages/analysis/research/MemoSection.tsx`

Modify:
- `frontend/src/pages/analysis/ResearchPage.tsx`: add the pill, as specified below.
- `frontend/src/pages/PortfoliosPage.tsx`: in `handleDeletePortfolio` only, call
  `deleteMemosForPortfolio(selected.id)` after `deletePortfolio(selected.id)`. In the delete
  dialog's paragraph, append the sentence ` Its decision memos are deleted too.` after
  `cannot be recovered.`. Change nothing else in that file.

**Touch nothing else.** No backend change; both endpoints already exist. If the work appears to
require editing another file, stop and report `BLOCKED`.

`reference files/` and the `main` branch are read-only.

## Interface

### `lib/memo.ts`

```ts
export type Recommendation = 'GO' | 'CONDITIONAL' | 'NO-GO'
export const RECOMMENDATIONS: readonly Recommendation[] = ['GO', 'CONDITIONAL', 'NO-GO']
export type FlagSeverity = 'high' | 'medium'

export interface RedFlag { id: string; severity: FlagSeverity; title: string; detail: string }

export interface MemoHolding { ticker: string; weight: number; shares?: number }   // weight: % of the whole portfolio, as Position.weight

export interface MemoEvidence {
  effectiveHoldings: number | null                               // risk.effective_holdings
  holdingsCount: number | null                                   // risk.holdings.length
  largest: { ticker: string; investedWeight: number } | null      // the risk.holdings entry with the max invested_weight
  topRiskShare: { ticker: string; share: number } | null          // the max non-null risk_share; null if none
  riskWindow: { start: string; end: string } | null               // risk.start, risk.end
  holdoutSharpe: number | null                                   // compare.current.holdout?.sharpe
  equalWeightHoldoutSharpe: number | null                        // the equal_weight mode's holdout?.sharpe
  holdoutWindow: { start: string; end: string } | null            // compare.holdout?.score_start / score_end
  maxDrawdown: number | null                                     // compare.current.in_sample.max_dd
  drawdownWindow: { start: string; end: string } | null           // compare.fit_start / fit_end
  untested: string[]                                             // compare.pinned ∪ compare.holdout?.excluded, de-duplicated, sorted
}

export interface DecisionMemo {
  id: string
  portfolioId: string
  createdAt: string                 // ISO 8601
  recommendation: Recommendation
  rationale: string
  monitoringPlan: string
  redFlags: RedFlag[]
  holdings: MemoHolding[]
  cashWeight: number
  cashDollars?: number
  evidence: MemoEvidence | null     // null only when both evidence requests failed
}

export const EFFECTIVE_HOLDINGS_MIN = 5
export const EFFECTIVE_HOLDINGS_HIGH = 3
export const LARGEST_HOLDING_MAX = 0.25
export const LARGEST_HOLDING_HIGH = 0.4
export const RISK_SHARE_MAX = 0.4
export const DRAWDOWN_LIMIT = -0.2

export function buildEvidence(risk: RiskResponse | null, compare: CompareResponse | null): MemoEvidence | null
// null when both are null. Every field drawn from a null response is null, or [] for `untested`.

export function deriveRedFlags(evidence: MemoEvidence | null): RedFlag[]
export function holdingsChanged(memo: DecisionMemo, portfolio: Portfolio): boolean
export function memoHoldings(portfolio: Portfolio): MemoHolding[]   // positions → MemoHolding, copying shares only when present
```

**`deriveRedFlags`** returns `[]` for `null`. Otherwise it returns these flags in this order,
each only when its condition holds. All comparisons are strict. Percentages are × 100, to
1 decimal. Sharpe values have 2 decimals.

| id | condition | severity | title | detail |
|---|---|---|---|---|
| `concentration` | `effectiveHoldings < EFFECTIVE_HOLDINGS_MIN` | `high` if `< EFFECTIVE_HOLDINGS_HIGH`, else `medium` | `Concentrated portfolio` | `Effective holdings {x.toFixed(1)} of {holdingsCount} (1 ÷ HHI of the invested money).` |
| `largest-holding` | `largest.investedWeight > LARGEST_HOLDING_MAX` | `high` if `> LARGEST_HOLDING_HIGH`, else `medium` | `One holding dominates` | `{ticker} is {pct}% of the invested money.` |
| `risk-share` | `topRiskShare.share > RISK_SHARE_MAX` | `medium` | `One holding drives the risk` | `{ticker} contributes {pct}% of portfolio volatility.` |
| `holdout-negative` | `holdoutSharpe < 0` | `high` | `Negative Sharpe over the last 12 months` | `Sharpe {x} on {holdoutWindow.start} → {holdoutWindow.end}.` |
| `behind-equal-weight` | `holdoutSharpe < equalWeightHoldoutSharpe` | `medium` | `Equal weight did better over the last 12 months` | `Sharpe {x} vs {y} for equal weight (1/N), on {holdoutWindow.start} → {holdoutWindow.end}.` |
| `drawdown` | `maxDrawdown < DRAWDOWN_LIMIT` | `medium` | `Deep drawdown` | `Max drawdown {pct}% on {drawdownWindow.start} → {drawdownWindow.end}.` |
| `short-history` | `untested.length > 0` | `medium` | `Too little history to test` | `{untested.join(', ')}: not enough prices for the optimizer fit or the holdout.` |

A condition involving a `null` value is false. `behind-equal-weight` needs both Sharpes non-null.

**`holdingsChanged(memo, portfolio)`** is true when any of these holds:
- the ticker sets differ;
- for any ticker where **both** sides have `shares`, the shares differ;
- for any other ticker, the weights differ by more than `0.5` (percentage points);
- when both have `cashDollars`, they differ; otherwise `cashWeight` differs by more than `0.5`.

Shares-based portfolios re-mark their weights from prices, so for them only shares and cash
dollars count. Price drift alone must not show "changed".

### `lib/memoStore.ts`

```ts
export const MEMO_STORAGE_KEY = 'bec-research-memos'
export function listMemos(portfolioId: string): DecisionMemo[]   // newest createdAt first
export function saveMemo(memo: DecisionMemo): boolean            // appends; false when storage throws
export function deleteMemo(id: string): void
export function deleteMemosForPortfolio(portfolioId: string): void
```

- Storage shape: one JSON array of `DecisionMemo` across all portfolios.
- Every access goes in `try`/`catch`, as `portfolioStore.ts` does. A read failure returns `[]`.
- On read, drop entries that fail a shape check. An entry is valid when:
  - `id`, `portfolioId`, `createdAt`, `rationale` and `monitoringPlan` are strings;
  - `recommendation` is in `RECOMMENDATIONS`;
  - `redFlags` and `holdings` are arrays;
  - `cashWeight` is a finite number;
  - `evidence` is `null` or an object.
- `saveMemo` returns `false` instead of swallowing a failure, so the UI can say so.

### `ResearchPage.tsx`

`TABS` gains a second entry, and the union widens to `'portfolio' | 'memo'`:

```ts
['memo', 'Decision Memo', 'Record a go / no-go decision for this portfolio, with the evidence behind it']
```

Render `<MemoSection />` when `tab === 'memo'`. Leave the first entry exactly as Gunnar left it:
`'Compare Optimizers'`.

### `MemoSection.tsx`

The structure follows `PortfolioSection.tsx`: the portfolio comes from `useParams`, `getUniverse()`
supplies last closes for `tradeBasis`, and there is a `mountedRef`. Once the universe is ready, it
fires **both** evidence requests once, in parallel:
- `riskPortfolio(buildRiskRequest(portfolio, DEFAULT_RISK_SETTINGS, basis))`. If `buildRiskRequest` returns `ok: false`, treat it as that request's error.
- `comparePortfolio(buildCompareRequest(portfolio, DEFAULT_COMPARE_SETTINGS, basis))`. Skip this when the portfolio has fewer than 2 positions; the error text is `Add at least two holdings to run the holdout comparison.`

Each request has its own state: running, error or ready. When both have settled, call
`buildEvidence`, then `deriveRedFlags`, and use the result as the form's suggested flags.

Top to bottom:

1. **Disclaimer.** A muted `text-xs` paragraph in a `bg-brand-surface border border-brand-border` box, this copy verbatim:
   > A memo records your decision and the evidence you had when you made it. It is not investment advice. The evidence comes from past prices over the windows shown, and past results don't predict future ones.
2. **Two columns** at `lg:` (`grid gap-6 lg:grid-cols-2`), one column below that.
   - **Left: an `Evidence` card.** While running, it shows `Checking the portfolio…`. Otherwise a definition list:
     - `Effective holdings`: `{x.toFixed(1)} of {n}`;
     - `Largest holding`: `{ticker} {pct}%`;
     - `Largest risk share`: `{ticker} {pct}%`;
     - `Sharpe, last 12 months`: `{x}`;
     - `Equal weight, same 12 months`: `{y}`;
     - `Max drawdown`: `{pct}%`.

     A missing value shows `—`. Under the list, in muted `text-xs`, show each window that is
     non-null: `Concentration and risk: {start} → {end}.`, `Holdout: {start} → {end}.` and
     `Drawdown: {start} → {end}.`. Then show each request's error text, if any, in `text-brand-negative`.
   - **Right: the form.**
     - **Recommendation:** three buttons from `RECOMMENDATIONS`, default `CONDITIONAL`, using `aria-pressed`.
       - The selected one gets a 2px border and a `color-mix(in srgb, <token> 12%, transparent)` background via `style`, where `<token>` is `var(--color-positive)` for GO, `var(--color-accent)` for CONDITIONAL and `var(--color-negative)` for NO-GO.
       - The selected one's text uses `text-brand-positive` for GO, `text-foreground` for CONDITIONAL and `text-brand-negative` for NO-GO.
       - Unselected buttons are bordered and muted.
     - **Rationale:** a textarea, 4 rows, placeholder `Why this recommendation?`.
     - **Red flags:**
       - The suggested flags, then any Gunnar adds. Each is a row with a 4px left border (`var(--color-negative)` for high, `var(--color-accent)` for medium), a severity word (`High` in `text-brand-negative`, `Medium` in muted text), the title in semibold, the detail in muted `text-xs`, and a dismiss `×` button.
       - With no flags, show `No red flags.` in muted text. Do **not** say "none detected", because the evidence may have failed.
       - Under the list, an **Add a flag** row: a text input (placeholder `Describe the concern`), a `High`/`Medium` select defaulting to Medium, and an `Add` button. The button is disabled while the input is blank. A new flag has `id` `custom-{crypto.randomUUID()}`, the input as `title`, and `detail` `''`.
     - **Monitoring plan:** a textarea, 3 rows, placeholder `What would change your mind? Drift limits, rebalance triggers, metrics to watch.`
     - **Save memo button.** It is disabled while either evidence request is running, or while the rationale is blank after trimming.
       - On save, build a `DecisionMemo` with `crypto.randomUUID()`, `new Date().toISOString()`, `memoHoldings(portfolio)`, the portfolio's `cashWeight` and `cashDollars`, the current flags and the evidence. Then call `saveMemo`.
       - On `true`: prepend the memo to the list, reset the form (CONDITIONAL, empty texts, flags back to the suggested set), and show `Saved.` in muted text.
       - On `false`: show `Couldn't save: this browser's storage is unavailable or full.` in `text-brand-negative`.
3. **Saved memos.** Heading `Saved memos ({n})`. With none, show `No memos yet for this portfolio.`
   - Each memo is a row showing:
     - the date, as `createdAt.slice(0, 10)`;
     - a recommendation badge: text only, coloured as on the buttons;
     - the rationale's first line, truncated with `truncate`;
     - when `holdingsChanged(memo, portfolio)`, the muted `text-xs` note `Holdings have changed since this memo.`
   - Clicking the row toggles it open (`aria-expanded`). Open, it shows the full rationale (`whitespace-pre-wrap`), the red flags as above but without dismiss buttons, the monitoring plan, and the holdings at the time (`{ticker} {weight.toFixed(1)}%`, comma-separated, then `Cash {cashWeight.toFixed(1)}%`).
   - A `Delete` button per memo asks inline: `Delete this memo?` with `Delete` / `Cancel`. Confirming calls `deleteMemo` and removes the memo from the list.

## Out of scope

- Any score, scorecard or GO/NO-GO hint. That arrives with Overview, after Robustness.
- Editing a saved memo. A memo is a dated record; write a new one.
- Server storage, syncing, export, PDF, or the `main` Tearsheet.
- Warning about unsaved changes on navigation.
- A re-run button for evidence. It runs once per visit.
- Changing `PortfolioSection.tsx`, `lib/research.ts`, `lib/risk.ts`, `lib/portfolioStore.ts` or any backend file.
- New dependencies.

## Tooltips

Use `Tooltip` from `components/Tooltip`, never `title`. Wrap exactly **one** element per
`Tooltip`, because it calls `Children.only`. Exact copy:

| element | tooltip |
|---|---|
| Decision Memo pill | `Record a go / no-go decision for this portfolio, with the evidence behind it` |
| GO | `Proceed with this portfolio as it stands` |
| CONDITIONAL | `Proceed only if the conditions in the rationale are met` |
| NO-GO | `Do not proceed with this portfolio as it stands` |
| dismiss `×` | `Remove this flag from the memo` |
| Add | `Add your own red flag to this memo` |
| Save memo | `Save this memo in this browser, with the evidence and holdings as they are now` |
| saved-memo row toggle | `Show or hide this memo` |
| Delete | `Delete this memo from this browser` |

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

`memo.test.ts`, with literal fixtures written in the test file:

1. `deriveRedFlags(null)` is `[]`.
2. Evidence with:
   - `effectiveHoldings: 2.5, holdingsCount: 4`;
   - `largest: {ticker: 'MS', investedWeight: 0.36}`;
   - `topRiskShare: {ticker: 'MS', share: 0.5}`;
   - `holdoutSharpe: -0.1, equalWeightHoldoutSharpe: 0.38`;
   - `maxDrawdown: -0.25`;
   - `untested: ['SETM']`;
   - all three windows non-null.

   This gives ids, in order, `['concentration', 'largest-holding', 'risk-share', 'holdout-negative', 'behind-equal-weight', 'drawdown', 'short-history']`.
   - `concentration` has severity `high`. `largest-holding` has severity `medium`.
   - The `largest-holding` detail is `MS is 36.0% of the invested money.`
3. Boundaries are strict. `effectiveHoldings: 5`, `investedWeight: 0.25`, `share: 0.4`,
   `holdoutSharpe: 0.38` with `equalWeightHoldoutSharpe: 0.38`, and `maxDrawdown: -0.2`, with
   `untested: []`, together give `[]`.
4. Evidence with every numeric field `null` and `untested: []` gives `[]`.
5. `buildEvidence(null, null)` is `null`. With a literal `RiskResponse`, the `null` compare gives
   `holdoutSharpe === null`, `untested` equal to `[]`, and `largest.ticker` equal to the holding
   with the highest `invested_weight`.
6. `buildEvidence` with a compare whose `pinned` is `['B', 'A']` and whose `holdout.excluded` is
   `['A', 'C']` gives `untested` equal to `['A', 'B', 'C']`.
7. `holdingsChanged`:
   - shares-based memo and portfolio with equal shares and cash dollars, but weights 10 points apart → `false`;
   - one share different → `true`;
   - weights-only, 0.4 points apart → `false`;
   - weights-only, 0.6 points apart → `true`;
   - a ticker added → `true`.

`memoStore.test.ts`:

8. `listMemos('p1')` returns only `p1`'s memos, newest first. It drops an entry with
   `recommendation: 'MAYBE'`, and returns `[]` when `getItem` throws.
9. `saveMemo` returns `false` when `setItem` throws, and `true` otherwise. It writes under `MEMO_STORAGE_KEY`.
10. `deleteMemosForPortfolio('p1')` writes an array with no `p1` memo and keeps the other portfolios' memos.

Global:

11. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
12. `cd frontend && npm run test` passes, with **387 + the tests you added** in **28** files. Report both numbers.
13. `cd frontend && npm run build` exits 0.
14. `cd frontend && npm run lint` shows the same 2 known warnings and nothing new.
15. `grep -n ' title=' frontend/src/pages/analysis/research/MemoSection.tsx frontend/src/pages/analysis/ResearchPage.tsx` prints nothing.
16. `grep -nE 'bg-(green|red|amber)-|text-(green|red|amber)-' frontend/src/pages/analysis/research/MemoSection.tsx` prints nothing.
17. `grep -n "deleteMemosForPortfolio" frontend/src/pages/PortfoliosPage.tsx` shows the import and one call.
18. Format, then check for collapse. Run
    `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write <each file you created>`.
    Then `awk 'length > 300 {print FILENAME": "FNR}'` over every created file must print nothing.
    If `/tmp/prettier3` is missing, report it; do not hand-reformat.
19. State in the report the full list of files you created or modified. Several of them are
    untracked, so read them directly rather than relying on `git diff`.

**Planner-run** (coders skip these, and write "browser checks left for the Planner" under Not done):

20. `SMOKE_CLICKS="Decision Memo" node contracts/tools/smoke-render.mjs research` shows no `EXCEPTION:`.
    PAGE TEXT contains `Recommendation`, `Rationale`, `Red flags`, `Monitoring plan`, `Save memo` and `Saved memos (0)`.
21. Against stubbed risk and compare responses: the expected flags render, and saving adds a row under `Saved memos (1)`.

## Human verification — does Gunnar need to run anything?

Yes. Restart nothing; it's frontend only. Open BEC, then Research → Decision Memo, in both themes.
- **The flags are the main thing to judge.** On BEC, `MS` is about 36% of the invested money, so expect `One holding dominates` (medium). Effective holdings are about 5.1 against a threshold of 5, so `Concentrated portfolio` should **not** appear, but only barely. Are the thresholds right for how you run portfolios? They are constants in `lib/memo.ts`.
- Write and save a memo. Reload the page and check that it's still listed. Delete it.
- Change a holding on the Holdings tab, come back, and check that the old memo says `Holdings have changed since this memo.`

## Open questions — do not resolve yourself

- None known. If `RiskResponse` or `CompareResponse` lacks a field named above, stop and report `BLOCKED`.
