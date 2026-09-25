# Contract 0109: Apply optimized weights to the portfolio

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Add an **Apply to portfolio** button to the Optimize tab's Weights card. After a confirm dialog, it
saves the run's Optimized weights, and share counts where the rules allow, into the portfolio in
localStorage, so Holdings reflects them.

## Why

`main` had "Apply to Portfolio". REBUILD.md ("Apply to Portfolio also writes share counts" and
"Short positions can be optimized but not applied") already settles the rules. This contract
implements them. It also resolves three edge cases those rules don't cover, listed under **Design
decisions**.

**The rules from REBUILD.md**, applied to the invested holdings only. Cash stays at its current
weight:
- **Every position has shares:** new shares = `target × investedValue ÷ last_close`, fractional,
  where `investedValue = Σ shares × last_close`. New weight = `target × (100 − cashWeight)`.
- **Some positions have shares:** the weights are applied and **every** share count is removed. The
  confirm dialog must say so.
- **No position has shares:** only the weights are applied.
- **Short positions:** if any target weight is short, Apply is disabled with an explanation.

**Design decisions** (planner, 2026-09-24):
1. **Zero targets remove the holding.** A stored position must have a weight above 0, and `main`
   wrote 0% weights, which this app cannot store.
   - A target is **kept** if it is `≥ APPLY_MIN_FRACTION = 0.0005`, **short** if it is
     `≤ −0.0005`, and otherwise **removed**. 0.0005 is exactly the point below which the table shows
     "0.0%", so every row shown as 0.0% is removed and nothing shown as 0.0% blocks Apply as a short.
   - This also absorbs solver noise: SLSQP returns values such as `−1e−12` on long-only runs, and a
     strict `< 0` test would block Apply for no reason.
   - The kept targets are renormalised to sum to 1, so cash stays exactly as it is.
   - Removed holdings are named in the confirm dialog. Their shares' value goes to the kept holdings
     through the renormalised targets.
2. **Shares that disagree with the weights are still recomputed.** In the shares-mismatch case the
   table was weights-only. On Apply, with all shares present, shares are recomputed from
   `Σ shares × last_close`, and the new shares and new weights agree by construction.
3. **All shares but a missing price blocks Apply.** The share counts can't be worked out, and
   clearing them because a price fetch failed would destroy data for a transient reason.
4. **Stale runs block Apply.** If the portfolio's tickers no longer match the run's tickers, Apply is
   disabled.
5. **A non-converged run blocks Apply.** Its results are the current weights, so there is nothing to
   apply.

Apply is **synchronous**: `savePortfolio` writes to localStorage. So it needs no mounted-ref guard.
The 0107 audit note on reusing the ref-reset pattern applies only to async work, and this contract
adds none.

## Files

Modify:
- `frontend/src/lib/optimize.ts`: add the helpers in **Interface**.
- `frontend/src/lib/optimize.test.ts`: add tests. Existing tests stay **unmodified**.
- `frontend/src/lib/portfolio.ts`: add the `export` keyword to the existing
  `isValidCurrentPortfolio` (line 184). Change nothing else.
- `frontend/src/pages/analysis/OptimizePage.tsx`: the Apply button, the confirm dialog, the applied
  state, and `dismissOnPointerDown` on the Vol target slider's `Tooltip` (to match Max and Min
  weight).

**Touch nothing else.** `frontend/src/components/OptimizeChart.tsx` has an uncommitted edit by
Gunnar (the tooltip `contentStyle`). Leave that file untouched. If the work seems to need another
file, stop and report `BLOCKED`.

## Before you start

Take the test count **before editing anything**: `(cd frontend && npm run test 2>&1 | grep -E "Tests +[0-9]+")`.
It should read 120 passed. Paste it.

## Interface

### `lib/optimize.ts` additions

```ts
import { isValidCurrentPortfolio } from './portfolio'   // plus the existing Portfolio type import

export const APPLY_MIN_FRACTION = 0.0005

export type ApplyBlockedReason = 'tickers-changed' | 'infeasible' | 'short' | 'no-price' | 'invalid'
export type ApplySharesMode = 'recomputed' | 'cleared' | 'none'

export type ApplyPlan =
  | { ok: true; portfolio: Portfolio; sharesMode: ApplySharesMode; removed: string[] }
  | { ok: false; reason: ApplyBlockedReason }

export function applyPlan(portfolio: Portfolio, response: OptimizeResponse, lastCloseByTicker: ReadonlyMap<string, number | null>): ApplyPlan
export function applyBlockedText(reason: ApplyBlockedReason): string
export function applyConfirmLines(plan: Extract<ApplyPlan, { ok: true }>): string[]
```

**`applyPlan`** checks these in order and returns at the first match:
1. **Tickers changed:** the sorted portfolio tickers ≠ the sorted `response.tickers`. Return
   `{ ok: false, reason: 'tickers-changed' }`.
2. **Not converged:** `!response.feasible`. Return `'infeasible'`.
3. **Short:** any `target_weights[t] <= -APPLY_MIN_FRACTION`. Return `'short'`.
4. **Shares mode:**
   - `'recomputed'` if every position has a finite `shares > 0`
   - otherwise `'cleared'` if any position has a `shares` key
   - otherwise `'none'`
5. **Missing price:** in `'recomputed'` mode, if any position's price is missing, `null`,
   non-finite or `<= 0`, return `'no-price'`. The price test is the same as in `tradeBasis`.
6. **Kept and removed:** kept = the positions whose target is `>= APPLY_MIN_FRACTION`. `removed` is
   the other tickers, in portfolio order. `f = target / Σ kept targets`.
7. **New positions**, in **portfolio order**, from the kept positions:
   - `weight = f × (100 − cashWeight)`.
   - In `'recomputed'` mode, add `shares = f × investedValue ÷ price`, where
     `investedValue = Σ shares × price` over **all** current positions, removed ones included.
   - In `'cleared'` and `'none'` modes, the position object has **no `shares` key**. Build
     `{ ticker, weight }`. Do not set `shares: undefined`.
8. **Result:** `portfolio = { id, name, cashWeight (unchanged), positions, updatedAt (unchanged) }`.
   `savePortfolio` restamps `updatedAt`.
9. **Validity:** if `!isValidCurrentPortfolio(portfolio)`, return `'invalid'`. This is a defensive
   check: `listPortfolios` silently drops invalid records, so saving one would make the portfolio
   disappear.

Otherwise return `{ ok: true, portfolio, sharesMode, removed }`.

**`applyBlockedText(reason)`**:

| reason | text |
|---|---|
| `tickers-changed` | `"This portfolio's holdings changed after the run. Run the optimizer again."` |
| `infeasible` | `'The optimizer did not converge, so there is nothing to apply.'` |
| `short` | `"Short positions can't be saved to a portfolio. Turn off Allow short and run again."` |
| `no-price` | `"A holding has no stored closing price, so its new share count can't be worked out."` |
| `invalid` | `"These weights don't make a valid portfolio, so they can't be applied."` |

**`applyConfirmLines(plan)`** returns these lines, in this order:
1. `` `Holdings weights will be replaced by the Optimized column. Cash stays at ${plan.portfolio.cashWeight.toFixed(1)}%.` ``
2. Depending on `sharesMode`:
   - `'recomputed'`: `"Share counts will be recalculated from each holding's last stored close, as fractional shares."`
   - `'cleared'`: `'Only some holdings have share counts, so all share counts will be removed.'`
   - `'none'`: no line.
3. If `removed` is not empty: `` `${list} ${removed.length === 1 ? 'has' : 'have'} a 0.0% target and will be removed from the portfolio.` ``
   The list is `'AAA'`, `'AAA and BBB'`, or `'AAA, BBB and CCC'` (Oxford-comma-free).
4. `'There is no undo.'`

### `OptimizePage.tsx`

#### Run state and the Apply plan

- **Run state:** the `ready` state gains `applied: boolean`. A new run sets it to `false`.
- **Plan:** compute
  `plan = applyPlan(current, run.response, prices.status === 'ready' ? prices.lastClose : new Map())`
  on render, and pass it into `OptimizeResults`. Prices are always ready once a run exists, but guard
  anyway.

#### Weights card header: the Apply button

- **Placement and style:** to the right of Export CSV, `gap-2` between the two buttons:
  `Apply to portfolio`, `text-sm font-semibold px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text hover:opacity-90 disabled:opacity-50`.
- **Disabled when:** `run.applied || !plan.ok`.
- **Tooltip label:**
  - applied: `'Already applied. Run again to optimize the new weights.'`
  - blocked: `applyBlockedText(plan.reason)`
  - otherwise: `"Save the Optimized weights to this portfolio's Holdings"`
- **Click:** opens the confirm dialog.

#### Confirm dialog

Copy the PortfoliosPage delete-confirm markup (`PortfoliosPage.tsx:327-362`):
- the overlay `fixed inset-0 bg-overlay … z-[110]`, where clicking the overlay closes the dialog
- `role="dialog" aria-modal="true" aria-labelledby="apply-portfolio-heading"`, and the same card
  classes

Its contents:
- **Heading:** `` `Apply to ${current.name}?` ``
- **Body:** each `applyConfirmLines(plan)` line as its own `<p className="text-sm text-[var(--color-muted)] leading-relaxed">`.
  Wrap them in a `space-y-2 mb-4` div.
- **Buttons:**
  - `Cancel`, with `autoFocus` and the same classes as the delete dialog's Cancel.
  - `Apply`, with `bg-btn-action text-btn-action-text`. It runs the confirm handler.

  Add no `Tooltip` to the dialog buttons: the delete dialog has none, and their labels say what
  they do.

#### Confirm handler

1. `savePortfolio(plan.portfolio)`. Import it from `portfolioStore`.
2. Re-read the portfolio with `listPortfolios().find(p => p.id === current.id)`.
3. **Check that it saved:** if it is missing, or its `updatedAt` equals the pre-save
   `current.updatedAt`, the save failed silently (`savePortfolio` swallows storage errors). Show
   `"Couldn't save to this browser's storage. Nothing was changed."` as a `text-brand-negative`
   line under the Weights table, and leave `applied` false.
4. **Otherwise:** set `applied: true` on the run state.
5. Close the dialog either way.

#### After applying

- **Success line:** when `applied`, show a `text-sm text-brand-positive` line directly under the
  Weights card header: `'Applied. Holdings now use the Optimized weights. Run again to compare against them.'`
- **Stale "Current" is expected:** after Apply the page re-reads the portfolio, so "Current" in the
  results is stale. That is intentional. The success line tells the user to run again.

#### Vol target slider

Add `dismissOnPointerDown` to its `Tooltip`, as on the Max and Min weight sliders.

## Tests

Existing tests pass **unmodified**. Reuse `RESPONSE`, `PORTFOLIO`, `DOLLAR_PORTFOLIO` and `CLOSES`
from the file. Every expected value below was checked by hand. Use `toBeCloseTo(x, 6)` for weights
and shares.

**Required tests** (at least one `it` each):

1. **Mixed shares, cleared:** `applyPlan(PORTFOLIO, RESPONSE, CLOSES)` →
   - `ok: true`, `sharesMode: 'cleared'`, `removed: []`
   - positions AAA 55.8, BBB 16.2, YNG 18, in that order
   - `cashWeight` 10
   - **no** position has a `shares` key (`'shares' in p` is false for each)
   - `id`, `name` and `updatedAt` equal `PORTFOLIO`'s
2. **No shares:** `PORTFOLIO` with every `shares` key stripped → `sharesMode: 'none'`, with the same
   weights and no `shares` keys.
3. **All shares, recomputed:** `applyPlan(DOLLAR_PORTFOLIO, RESPONSE, CLOSES)` →
   - `sharesMode: 'recomputed'`
   - AAA 55.8 / 12.4 shares
   - BBB 16.2 / 12
   - YNG 18 / 4
4. **Shares-mismatch still recomputes:** `DOLLAR_PORTFOLIO` with BBB `shares: 21` →
   - `sharesMode: 'recomputed'`
   - weights 55.8 / 16.2 / 18
   - shares AAA 12.586, BBB 12.18, YNG 4.06 (investedValue 913.5)
5. **Zero and noise targets are removed:**
   - `applyPlan(PORTFOLIO, { ...RESPONSE, target_weights: { AAA: 0.8, BBB: -1e-12, YNG: 0.2 } }, CLOSES)`
     → `ok: true`, `removed: ['BBB']`, positions AAA 72 and YNG 18 only, `sharesMode: 'cleared'`.
   - `applyPlan(DOLLAR_PORTFOLIO, { ...RESPONSE, target_weights: { AAA: 0.8, BBB: 0.0004, YNG: 0.2 } }, CLOSES)`
     → `removed: ['BBB']`, AAA 72 / 16 shares, YNG 18 / 4 shares.
6. **Blocked reasons:**

   | input | reason |
   |---|---|
   | `target_weights { AAA: 0.9, BBB: -0.1, YNG: 0.2 }` with `PORTFOLIO` | `'short'` |
   | `{ ...RESPONSE, feasible: false }` | `'infeasible'` |
   | `PORTFOLIO` with only its first two positions | `'tickers-changed'` |
   | `DOLLAR_PORTFOLIO` with a map holding only AAA and BBB | `'no-price'` |

7. **A missing price doesn't block weights-only modes:**
   `applyPlan(PORTFOLIO, RESPONSE, new Map())` → `ok: true`, `sharesMode: 'cleared'`.
8. **`applyBlockedText`:** each of the five reasons returns its exact string.
9. **`applyConfirmLines`:**
   - For test 1's plan:
     ```
     ['Holdings weights will be replaced by the Optimized column. Cash stays at 10.0%.',
      'Only some holdings have share counts, so all share counts will be removed.',
      'There is no undo.']
     ```
   - For test 3's plan, the middle line is
     `"Share counts will be recalculated from each holding's last stored close, as fractional shares."`
   - For test 2's plan: 2 lines (no shares line).
   - For the first plan in test 5: `'BBB has a 0.0% target and will be removed from the portfolio.'`
     is at index 2.
   - For a hand-built plan with `removed: ['AAA', 'BBB', 'CCC']` (use test 1's plan spread with a new
     `removed`): `'AAA, BBB and CCC have a 0.0% target and will be removed from the portfolio.'`.

**Test count:** at least 120 + 9.

## Out of scope

- Undo, and any history of applied runs (`main` saved a "target set" to the database; this app has
  no equivalent).
- Changing the Holdings page.
- CAPM, conviction views, κ and tilt (0110).
- Restyling anything beyond what is listed above.
- Any backend change, and any new dependency.

## Acceptance criteria

1. The before test count is pasted (expected 120).
2. `(cd frontend && npm run build)` exits 0.
3. `(cd frontend && npm run test)` passes with at least 129 tests, and every existing test passes
   unmodified.
4. `(cd frontend && npm run lint)` reports only `HelpSidebar.tsx:44` and `UniversePage.tsx:60`.
5. `grep -n "^export function isValidCurrentPortfolio" frontend/src/lib/portfolio.ts` prints one line.
6. `git diff --stat frontend/src/lib/portfolio.ts` shows `1 file changed, 1 insertion(+), 1 deletion(-)`.
7. `grep -n "apply-portfolio-heading" frontend/src/pages/analysis/OptimizePage.tsx` prints at least 2
   lines: the `aria-labelledby` and the heading `id`.
8. `grep -c "dismissOnPointerDown" frontend/src/pages/analysis/OptimizePage.tsx` prints `3`.
9. `grep -n "savePortfolio" frontend/src/pages/analysis/OptimizePage.tsx` prints at least 2 lines:
   the import and the call.
10. `grep -n " title=" frontend/src/pages/analysis/OptimizePage.tsx` prints nothing.
11. `git status --short frontend` lists exactly these, and nothing else:
    - `optimize.ts`, `optimize.test.ts`, `portfolio.ts` and `OptimizePage.tsx`
    - `OptimizeChart.tsx` may also appear, but only if Gunnar has not committed his edit yet. You must not change it.
      If it appears, `git diff frontend/src/components/OptimizeChart.tsx` must show only the `contentStyle`
      block.

If a criterion can't be met as written, **report `BLOCKED` and name the conflict**. Don't bend the
code or the check to make it pass.

## Verification to run and paste

From the repo root. Paste the complete, verbatim output.

```bash
(cd frontend && npm run build 2>&1 | tail -2)
(cd frontend && npm run test 2>&1 | grep -E "Tests +[0-9]+|FAIL")
(cd frontend && npm run test 2>&1 | grep -iE "apply" | head -40)
(cd frontend && npm run lint 2>&1 | grep -E "warning|error")
grep -n "^export function isValidCurrentPortfolio" frontend/src/lib/portfolio.ts
git diff --stat frontend/src/lib/portfolio.ts
grep -n "apply-portfolio-heading" frontend/src/pages/analysis/OptimizePage.tsx
grep -c "dismissOnPointerDown" frontend/src/pages/analysis/OptimizePage.tsx
grep -n "savePortfolio" frontend/src/pages/analysis/OptimizePage.tsx
grep -n " title=" frontend/src/pages/analysis/OptimizePage.tsx; echo "title exit=$?"
git status --short frontend
git diff frontend/src/components/OptimizeChart.tsx | grep -c "^[+-] "
```

The last command prints `9` if Gunnar's `contentStyle` edit is still uncommitted, or `0` if he committed it first. Either is fine. Anything
else means the file was touched: say so.

## Tooltips

| Element | Tooltip label |
|---|---|
| Apply to portfolio, enabled | "Save the Optimized weights to this portfolio's Holdings" |
| Apply to portfolio, blocked | `applyBlockedText(reason)` |
| Apply to portfolio, applied | "Already applied. Run again to optimize the new weights." |
| Dialog buttons | none (matches the delete dialog) |

## Human verification: does Gunnar need to run anything?

**Yes: run it and click through.** Use a throwaway copy of a portfolio. Apply overwrites
localStorage and has no undo.
1. **No shares:** Apply → confirm → the Holdings tab shows the Optimized weights, with cash
   unchanged.
2. **All shares:** the dialog says share counts will be recalculated. Afterwards Holdings shows
   fractional shares whose values match the new weights.
3. **Only some holdings have shares:** the dialog says the share counts will be removed, and
   afterwards none remain.
4. **Allow short:** a run with a short target leaves Apply disabled, and its tooltip explains why.
5. **Removed holding:** set Min weight to 0 with Max Sharpe. If any row shows 0.0%, the dialog names
   it, and Holdings no longer lists it.

## Open questions

None. The zero-target rule (decision 1) is new policy. Gunnar can overrule it before dispatch.
