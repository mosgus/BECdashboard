# Contract 0160 — CAPM view: credit Zach's notebook, show its effect per year

**Status:** done
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The CAPM tab's view term `mrp × view` (`backend/app/optimizer.py`, `compute_capm_expected_returns`)
is not textbook CAPM. It comes from Zach's notebook, the team's original CAPM allocation model.
Gunnar has decided to **keep the formula exactly as it is** (option A). The contract makes two changes:

1. Replace the "intent to be confirmed" FLAG comments with a comment that credits Zach's notebook
   and says the term is kept on purpose.
2. Next to each View slider, show what the view adds to that holding's expected return, in % per
   year, at the current market risk premium. For example, a +20% view at a 5% MRP shows `+1.00%/yr`.

**The math does not change.** The API, the request and response shapes, and the CSV all stay as
they are.

## Change

### 1. `backend/app/optimizer.py`: comments only

Replace the 3-line `# FLAG(custom): the `mrp * view` term …` comment above
`compute_capm_expected_returns` (currently lines 99–101) with exactly:

```python
# FLAG(custom): the `mrp * view` term comes from Zach's notebook (the team's original CAPM
# allocation model) and is kept on purpose. A view is the analyst's "undervalued %"; it adds
# mrp * view to the CAPM return (view 0.20 → +1.0%/yr at mrp 5%). It is not part of textbook
# CAPM or Black-Litterman: there is no confidence or risk scaling, and its size follows mrp.
# Only the Outlook CAPM tab (capm_run) uses it. Check with Zach before changing the formula.
```

Replace the 2-line `# FLAG(custom): the method is standard …` comment above
`optimize_max_sharpe_capm` (currently lines 241–242) with exactly:

```python
# FLAG(custom): the method is standard (max Sharpe on CAPM expected returns). The custom part is
# the expected-returns input, which carries the view term from Zach's notebook — see
# compute_capm_expected_returns.
```

Make no other change to this file. Don't touch the function bodies.

### 2. `frontend/src/lib/capm.ts`

Add an exported pure function beside `formatView`:

```ts
/** What a view adds to a holding's expected annual return: MRP × view (Zach's notebook formula).
 *  Null when the view is 0 or the MRP text is not a valid premium (above 0, at most 20). */
export function viewEffect(viewPct: number, mrpPct: string): string | null
```

- Parse `mrpPct` with the module's existing `parse` helper. Return `null` if the result is
  `null`, `<= 0` or `> 20`. These are the same rules `buildCapmRequest` applies.
- Return `null` when `viewPct === 0`.
- Otherwise compute `effect = (viewPct * mrp) / 100`, which is in percentage points. Return
  `` `${effect > 0 ? '+' : ''}${effect.toFixed(2)}%/yr` ``.

### 3. `frontend/src/pages/analysis/outlook/CapmSection.tsx`

- Add a `mrpPct: string` prop to `HoldingsTable`. Pass `mrpPct={settings.mrpPct}` at the
  `<HoldingsTable … />` call site (currently line 298).
- In the View cell, after the existing `<span …>{formatView(input.viewPct / 100)}</span>`, add
  `<span className="w-20 text-right font-mono text-xs text-[var(--color-muted)]">{viewEffect(input.viewPct, mrpPct) ?? ''}</span>`.
  Both spans sit inside the existing `flex items-center gap-2` div.
- Change the slider's `Tooltip` label to:
  `` `Your view on ${position.ticker}: how undervalued you think it is. It adds market risk premium × view to its expected return; the grey figure shows how much per year.` ``
- Add `viewEffect` to the existing import from `'../../../lib/capm'`.

This file is hand-formatted, so **don't run Prettier on it**. Keep each new line under 300
characters; acceptance 7 checks this.

### 4. `frontend/src/lib/capm.test.ts` (+1 test)

Add `viewEffect` to the import, then add one test. All of these must hold:
- `viewEffect(20, '5')` → `'+1.00%/yr'`
- `viewEffect(-50, '5')` → `'-2.50%/yr'`
- `viewEffect(100, '8')` → `'+8.00%/yr'`
- `viewEffect(15, '5')` → `'+0.75%/yr'`
- `viewEffect(0, '5')` → `null`
- `viewEffect(20, '')` → `null`
- `viewEffect(20, 'abc')` → `null`
- `viewEffect(20, '0')` → `null`
- `viewEffect(20, '25')` → `null`

## Out of scope

- Any change to the formula, `capm_run.py`, the API, the CSV or the results tables.
- Zach's name in the UI or the guide. The credit goes in the code comment only.
- The CAPM guide text (`capmGuide.ts`). It already explains `mrp × view` correctly.

## Acceptance criteria

Run these from `backend/`:

1. `DATABASE_URL="" PYTHONPATH=. pytest -q` passes. Baseline 770, and it should still be **770**.
   Paste the totals.
2. `grep -c "Zach's notebook" app/optimizer.py` prints `2`.
3. `grep -n "intent to be confirmed" app/optimizer.py` prints nothing.
4. `grep -n "mrp \* views.get(ticker, 0.0)" app/optimizer.py` prints 1 line. This confirms the
   formula is unchanged.

Run these from `frontend/`:

5. `npx vitest run` passes. Baseline 322; afterwards **323**. Paste the totals.
6. `npx tsc -p tsconfig.app.json --noEmit` is clean, `npm run lint` shows only the 2 known
   warnings, and `npm run build` succeeds.
7. `awk 'length > 300' src/pages/analysis/outlook/CapmSection.tsx` prints nothing.
8. `grep -n "viewEffect(input.viewPct, mrpPct)" src/pages/analysis/outlook/CapmSection.tsx` prints 1 line.
9. From the repo root, `node contracts/tools/smoke-render.mjs outlook "CAPM Allocation"` reports
   no uncaught exception.

`BLOCKED` is a valid outcome. Report any deviation.

## Human verification — Gunnar

On Forward Models → CAPM:
1. Move a View slider to +20%. The grey figure beside it reads `+1.00%/yr`.
2. Change Market risk premium to 8. The same slider now shows `+1.60%/yr`.
3. At a 0% view the grey figure is blank. If MRP is blank or invalid, every grey figure is blank.
4. Run the optimization. The results match what they were before this change for the same inputs.

## Open questions

None.
