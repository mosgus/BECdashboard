# Contract 0180 — Compare Optimizers: walk-forward columns, by-year table, "match current" vol target (frontend)

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

On Portfolios → Research → Compare Optimizers, the "Holdout, last 12 months" column group is replaced by a **Walk-forward** group built from 0179's `folds`:
- mean Sharpe;
- worst year;
- years it beat equal weight, out of N;
- years it beat current, out of N.

A new **Holdout Sharpe by year** table sits below. Green no longer marks the best single-year value. It marks an optimizer that beat equal weight in more than half the scored years.

The vol target gets a **Match current** option, which is on by default.

## Why

On the Mag 7 the single-year holdout winner changed every year. Mean rank stability was −0.29, and equal weight had the best mean holdout Sharpe (probe run, 2026-10-26). Highlighting one year's best value therefore crowns noise.

"Beat equal weight in X of N years" is the honest framing. It is the main thing walk-forward adds.

Match current fixes Target Volatility failing on all-equity portfolios: with a 10% default and a 24–29% floor, it never ran.

## Files

Modify:
- `frontend/src/lib/research.ts`:
  - walk-forward summary helpers;
  - `CompareRow` changes;
  - sort keys;
  - settings and request changes for the nullable vol target;
  - remove `bestHoldout`.
- `frontend/src/lib/research.test.ts`: tests below. Remove the `bestHoldout` tests and update fixtures.
- `frontend/src/pages/analysis/research/PortfolioSection.tsx`: table columns, by-year table, RunNotes, explanatory paragraph, vol-target control.

**Touch nothing else.**
- `lib/memo.ts` and `MemoSection.tsx` keep reading the legacy `holdout` fields, which 0179 keeps equal to fold 1. Do not change them.
- Do not touch `lib/optimize.ts` or `OptimizePage.tsx`: Historical Optimize keeps its numeric vol target.
- `MemoSection.tsx` builds its compare request from `DEFAULT_COMPARE_SETTINGS`, so it switches to match current automatically. That is intended. Do not edit it.

If the work seems to need another file, stop and report `BLOCKED`.

## Interface (`lib/research.ts`)

```ts
export interface CompareSettings {
  lookbackDays: number
  maxWeightPct: number
  volTargetPct: number | null   // null = match current
}
export const DEFAULT_COMPARE_SETTINGS: CompareSettings = { lookbackDays: 365, maxWeightPct: 100, volTargetPct: null }

export interface WalkForwardStat { wins: number; of: number }
export interface WalkForwardSummary {
  byFold: (number | null)[]            // holdout Sharpe per response.folds entry, same order; null if fold unavailable, mode not run, errored, or sharpe null
  mean: number | null                  // mean of non-null byFold; null if none
  worst: number | null                 // min of non-null byFold
  beatEqual: WalkForwardStat | null    // null on the equal_weight row
  beatCurrent: WalkForwardStat | null  // null on the current row
}
export function walkForward(response: CompareResponse): Record<string, WalkForwardSummary>  // keys: 'current' and each mode name
export function beatsMostYears(stat: WalkForwardStat | null): boolean  // stat !== null && stat.of >= 2 && stat.wins * 2 > stat.of
export function usableFolds(response: CompareResponse): number          // folds with unavailable === null
```

- **Per-fold Sharpe.**
  - The current row uses `fold.current?.sharpe ?? null`.
  - A mode uses `fold.modes.find(m => m.mode === key)?.holdout?.sharpe ?? null`.
- **Win counting.** `wins` counts folds where both the row's Sharpe and the comparator's Sharpe are non-null and the row's is strictly greater. `of` counts folds where both are non-null. The comparator is the equal_weight row for `beatEqual`, and the current row for `beatCurrent`.
- **`CompareRow` changes:**
  - drop `holdout` and `holdoutError`;
  - add `walkForward: WalkForwardSummary`, filled by `compareRows` from `walkForward(response)`.
- **Sort keys:**
  - replace the four `holdout.*` keys with `'wf.mean' | 'wf.worst' | 'wf.beat_equal' | 'wf.beat_current'`;
  - the beat keys sort by `wins / of`, with null (or `of === 0`) treated as null;
  - the in-sample keys, `mode` and `traded` are unchanged;
  - null ordering and current-first / errors-last rules are unchanged;
  - the default sort becomes `{ key: 'wf.mean', ascending: false }`, whatever the current default is.
- **Request.** `buildCompareRequest` sends `vol_target: settings.volTargetPct === null ? null : settings.volTargetPct / 100`. Do not send `folds`; the backend default of 4 applies. `sameCompareRequest` is unchanged, since `===` handles null.
- **Remove `bestHoldout`.** Delete it and its tests. In the page, delete `isBestHoldout`.

## UI (`PortfolioSection.tsx`)

1. **Column group.**
   - The header is `Walk-forward, {usable} of {N} years`, where N = `response.folds.length`, spanning 4 columns.
   - The column labels are `Mean Sharpe`, `Worst year`, `Beat equal wt`, `Beat current`. All four are SortHeaders with the keys above.
   - Cells:
     - mean and worst use `toFixed(2)`, or `—`;
     - beat cells show `${wins}/${of}`, or `—` when the stat is null or `of === 0`;
     - the `Beat equal wt` cell gets `POSITIVE` when `beatsMostYears(row.walkForward.beatEqual)`. **No other cell in the table is highlighted.**
   - Rows with an in-sample error keep their single `colSpan={10}` error cell.
2. **Holdout Sharpe by year** table, placed directly under the comparison table, in its own `bg-brand-surface` card. Use the same `TH`, `TD` and `NUMERIC` classes.
   - Columns: `Mode`, then one column per fold in `response.folds` order (most recent first).
     - Header for an available fold: `${fold.score_start} → ${fold.score_end}`.
     - Header for an unavailable fold: `${fold.cut} → ${fold.score_end} (skipped)`, wrapped in a `Tooltip` whose label is `fold.unavailable`.
   - Rows: `compareRows` order, unsorted (current first, then MODES order). Skip rows with an in-sample error.
   - Cells: Sharpe `toFixed(2)`, or `—`. If the fold-mode has a non-null `error`, wrap the `—` in a `Tooltip` with the error as its label.
   - No highlighting in this table.
3. **RunNotes.**
   - Replace the "Holdout: fit on…" line with `Walk-forward: {usable} of {N} yearly folds scored. Each fold fits on the lookback before its cut and scores the following 12 months.`
   - For each fold with `excluded.length > 0`, add a line: `Fold {k} (cut {cut}): not included (no prices on or before {cut}): {excluded.join(', ')}.`
   - For each unavailable fold, add a line: `Fold {k} skipped: {unavailable}`.
   - Keep the pinned, warnings and stale lines.
4. **Explanatory paragraph.** Replace it verbatim with:
   > In-sample numbers show how each optimizer did on the same prices it was fit to, so each one tends to win at its own goal. The walk-forward columns are the real test: for each of the last {N} years, weights are fit on the prior period only and scored on that year. Green marks an optimizer that beat equal weight in more than half the scored years. If the by-year ranking changes from year to year, no single winner should be trusted.
5. **Vol target control.**
   - Above the existing slider, add a checkbox labelled `Match current`, checked when `volTargetPct === null`.
     - Unchecking sets `volTargetPct` to `20`.
     - Checking sets it to `null`.
   - The slider is `disabled` while matching, and shows the value 20 when disabled.
   - Label text:
     - while matching, `Vol target: matches current` + (when `run.status === 'ready'`) ` (${(run.response.vol_target * 100).toFixed(1)}%)` + ` (Target Volatility only)`;
     - otherwise the existing `Vol target: {n}% (Target Volatility only)`.

## Tooltips (exact copy)

- Match current checkbox: `Aim Target Volatility at the current portfolio's own volatility over the same fit window`
- Mean Sharpe header (`tipName` usage as the existing SortHeaders do): whatever SortHeader generates from `tipName="Walk-forward mean Sharpe"`.
- Worst year: `tipName="Walk-forward worst year Sharpe"`
- Beat equal wt: `tipName="Years beating equal weight"`
- Beat current: `tipName="Years beating the current portfolio"`
- The skipped-fold header and fold-mode error cells use the backend's message as their label, as specified above.

Use the `Tooltip` component; never `title=`.

## Tests (`research.test.ts`)

Build a fixture `CompareResponse` with 3 folds: fold 1 and fold 2 available, fold 3 `unavailable`.

1. `walkForward`:
   - **a mode:** Sharpes 0.5 and 1.0 give `byFold [0.5, 1.0, null]`, mean 0.75, worst 0.5.
   - **equal_weight**, with Sharpes 0.6 and 0.9: `beatEqual` is null on its row, and the mode gets `beatEqual {wins: 1, of: 2}`.
   - **current**, with Sharpes 0.4 and 1.2: `beatCurrent` is null on its row, and the mode gets `{wins: 1, of: 2}`.
   - **a mode with `error` in fold 2:** that fold counts as null, so `of` is 1 against equal weight.
   - **a mode with an in-sample error** (`holdout: null, error: null` in every fold): `mean === null`.
2. `beatsMostYears`:
   - `{2,4}` → false
   - `{3,4}` → true
   - `{1,1}` → false
   - `null` → false
3. `usableFolds(fixture) === 2`.
4. `sortCompareRows` by `wf.mean` descending puts the higher mean first, nulls last, and keeps current first.
5. `buildCompareRequest` with `volTargetPct: null` gives `vol_target: null`. With `12` it gives `0.12`. Update the existing test's settings object to match.
6. `DEFAULT_COMPARE_SETTINGS.volTargetPct === null`.

## Out of scope

- Memo, Overview and score changes. The memo keeps using fold 1 via the legacy fields.
- Charts of fold results.
- A folds selector in the UI.
- Historical Optimize's vol target.
- Any backend change.

## Acceptance criteria

1. `cd frontend && npx vitest run` → all pass. Report the count; it will be about 415 minus the removed `bestHoldout` tests plus the new ones.
2. `cd frontend && npx tsc --noEmit -p tsconfig.app.json` → exit 0.
3. `cd frontend && npm run lint` → only the 2 known warnings.
4. `grep -rn "bestHoldout\|isBestHoldout\|Holdout, last 12 months" frontend/src` → no output.
5. `grep -n "title=" frontend/src/pages/analysis/research/PortfolioSection.tsx` → no new matches compared with before. Report the before and after counts. Component `title` props such as `ExpandableChart` don't count.
6. `git diff --stat` → only the 3 files listed.
7. Run `awk 'length > 300' frontend/src/pages/analysis/research/PortfolioSection.tsx frontend/src/lib/research.ts` → it must print nothing except the verbatim paragraph text line(s). If the file was collapsed, run `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write` on the changed files only.

## Verification to run and paste

```bash
cd frontend && npx vitest run 2>&1 | tail -4
cd frontend && npx tsc --noEmit -p tsconfig.app.json; echo tsc=$?
cd frontend && npm run lint 2>&1 | tail -4
grep -rn "bestHoldout\|isBestHoldout\|Holdout, last 12 months" frontend/src
git diff --stat
```

## Human verification

- **Run the frontend and look at it.** Restart uvicorn first, so 0179's backend is live.
  - Open Mag 7 → Research → Compare Optimizers.
  - The walk-forward header should read "4 of 4 years".
  - Equal weight's mean Sharpe should be about 1.56 at a 5-year lookback. The probe used 1825 days; the UI default is 365, so the numbers will differ from the probe.
  - Green should appear only on Beat equal wt cells.
  - Target Volatility should now have numbers, with the label showing the matched percentage.
  - On a portfolio with a recent holding, check the "not included" fold notes.
- The planner smoke-checks rendering on an isolated stub. Coders do not launch browsers.

## Open questions

None. If something seems undecided, report `BLOCKED`.
