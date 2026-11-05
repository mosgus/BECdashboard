# Contract 0178 — Sharpe 95% range row in the performance table (frontend only)

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

The performance table gets a new **Sharpe 95% range** row directly under the Sharpe row. The table appears in two places:
- Risk & Perf → Performance;
- the ticker page's Risk & Factor Profile.

The row gives an approximate 95% confidence range for each column's Sharpe ratio. Example: `-0.13 to 2.13`.

## Why

This replaces the "validation suite" that was planned for the Robustness pill. Gunnar dropped that pill on 2026-10-26.
- Three of its seven tests (Lo t-test, bootstrap CI, permutation null) all ask the same question: is this Sharpe distinguishable from zero? One range answers it.
- The answer is usually sobering. Three years of daily data with a Sharpe of 1.0 gives roughly −0.13 to 2.13. That is exactly the point.

The range can be computed entirely in the frontend from `sharpe` and `n_days`, which the response already carries, so there is no backend change.

## Files

Modify:
- `frontend/src/lib/performance.ts` — add `sharpeRange` and insert the new row in `performanceRows`.
- `frontend/src/lib/performance.test.ts` — update the row expectations and add the tests below.

**Touch nothing else.** `PerformanceSection.tsx` and `RiskProfileSection.tsx` already render every row that `performanceRows` returns, so neither needs edits. If the work appears to need another file, stop and report `BLOCKED`.

## Interface

In `performance.ts`, add an exported function:

```ts
export function sharpeRange(sharpe: number | null | undefined, nDays: number): string
```

Logic, with no other branches:
1. If `sharpe` is null or undefined, or `nDays < 20`, return `'—'`.
2. `daily = sharpe / Math.sqrt(252)`
3. `se = Math.sqrt((1 + (daily * daily) / 2) / nDays) * Math.sqrt(252)`. This is Lo (2002) under independent returns, annualised.
4. Return `` `${(sharpe - 1.96 * se).toFixed(2)} to ${(sharpe + 1.96 * se).toFixed(2)}` ``.

In `performanceRows`, insert a row object immediately after the Sharpe row, as a literal `PerformanceRow`. Do not use the `row()` helper, because that would compute a diff.

```ts
{
  label: 'Sharpe 95% range',
  tooltip: 'Approximate 95% range for the true Sharpe given this many trading days (Lo 2002, assumes independent daily returns). A range that crosses 0 means this window cannot tell the result apart from no excess return. Do not rank the two columns by their ranges: the two return series move together, so overlap does not settle which is better.',
  portfolio: sharpeRange(response.metrics.sharpe, response.n_days),
  benchmark: benchmark === null ? '—' : sharpeRange(benchmark.sharpe, response.n_days),
  diff: '—',
  portfolioTone: 'default',
  diffTone: 'muted',
}
```

The Sharpe row stays at index 2, so the existing `[2]` test keeps working. The new row is at index 3.

## Tests (in `performance.test.ts`)

1. Update `formats comparison rows`:
   - the length becomes 7;
   - insert `['Sharpe 95% range', '—', '—', '—', 'muted']` after the Sharpe entry. The fixture has `n_days: 1`, which is below 20, so the cells are `'—'`.
2. Update `hides benchmark metrics without market coverage`: the length becomes 5. The `every(...)` check still holds.
3. New `describe('sharpeRange')` with these exact expectations:
   - `sharpeRange(1.0, 756)` → `'-0.13 to 2.13'`
   - `sharpeRange(1.33, 252)` → `'-0.63 to 3.29'`
   - `sharpeRange(-0.5, 504)` → `'-1.89 to 0.89'`
   - `sharpeRange(null, 756)` → `'—'`
   - `sharpeRange(1.0, 19)` → `'—'`
4. New test: `performanceRows({ ...RESPONSE, n_days: 756 })[3]` has:
   - `portfolio === sharpeRange(RESPONSE.metrics.sharpe, 756)`
   - `benchmark === sharpeRange(RESPONSE.bench_metrics!.sharpe, 756)`
   - `diff === '—'`

   Use whatever non-null access style the file already uses.

The planner computed these values independently in Python.

## Out of scope

- Any backend change, or a new response field.
- Bootstrap, permutation or autocorrelation-adjusted (HAC) versions.
- Colouring the range, or flagging when it crosses 0. Plain text only.
- The CSV export.
- Any change to the other rows.

## Acceptance criteria

1. `cd frontend && npx vitest run` → all pass, at least 414 tests.
2. `cd frontend && npx tsc --noEmit -p tsconfig.app.json` → exit 0.
3. `cd frontend && npm run lint` → only the 2 known warnings (UniversePage.tsx:77, HelpSidebar.tsx:44).
4. `git diff --stat` → only `frontend/src/lib/performance.ts` and `frontend/src/lib/performance.test.ts` changed. The contract file's status line doesn't count.
5. `grep -n "Sharpe 95% range" frontend/src/lib/performance.ts` → exactly 1 match.
6. `awk 'length > 300' frontend/src/lib/performance.ts frontend/src/lib/performance.test.ts` → no output, except the tooltip string line if Prettier keeps it on one line. Report it if so.

## Verification to run and paste

```bash
cd frontend && npx vitest run 2>&1 | tail -5
cd frontend && npx tsc --noEmit -p tsconfig.app.json; echo tsc=$?
cd frontend && npm run lint 2>&1 | tail -4
git diff --stat
```

## Tooltips

There are no new interactive elements. The row label uses the existing `Tooltip` wrapper in both tables, and its copy is given verbatim above.

## Human verification

- **Run the frontend and look at it.**
  - **Risk & Perf → Performance** on a real portfolio: the new row sits under Sharpe, with both columns filled and Diff showing `—`.
  - **`/ticker/MS` → Risk & Factor Profile**: same row. Switch between 1Y, 3Y and 5Y; the range should narrow as the window lengthens.
- The planner smoke-checks rendering on an isolated stub. Coders do not launch browsers.

## Open questions

None. If something seems undecided, report `BLOCKED`.
