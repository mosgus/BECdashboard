# Contract 0159 — Prophet: don't show a chance of loss

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

At the moment, Forward Models → Forecast prints
`Chance of ending below the starting value: N%` for every method
(`frontend/src/pages/analysis/outlook/ForecastSection.tsx:274`).

For Prophet, that number misleads:
- Prophet is labelled untested.
- Its bands only reflect how uncertain the trend is, not market volatility.
- Calibration excludes it, so we have never checked this probability against real outcomes.

**For a Prophet result, replace the line with a plain statement that it isn't estimated.**
Every other method stays exactly as it is.

## Change

### 1. `frontend/src/lib/forecast.ts`

Add an exported pure function beside `volatilitySummary`:

```ts
/** The results line about finishing below the starting value. Prophet's figure is withheld:
 *  its bands only reflect trend uncertainty and calibration does not cover it. */
export function lossChanceText(response: ForecastResponse): string
```

- When `response.model === 'prophet'`, return exactly:
  `Chance of ending below the starting value: not estimated for Prophet. Its bands only reflect how uncertain the trend is, and they have not been checked against real outcomes.`
- Otherwise, return
  `` `Chance of ending below the starting value: ${(response.terminal.prob_loss * 100).toFixed(1)}%` ``.
  This is the same text the section renders today.

Base the check on `response.model`, the model that produced the result, and not on the
currently selected setting. That way a stale Prophet result never shows a number.

### 2. `frontend/src/pages/analysis/outlook/ForecastSection.tsx`

- Replace the body of the `<p className="text-sm">` at line 273–275 with `{lossChanceText(response)}`.
- Add `lossChanceText` to the existing import from `'../../../lib/forecast'`, or whatever relative
  path that import already uses.

Make no other change to this file. It is hand-formatted, so **don't run Prettier on it**.

### 3. `frontend/src/lib/forecast.test.ts` (+2 tests)

Add `lossChanceText` to the import, then add these two tests:
1. `lossChanceText({ ...RESPONSE, terminal: { ...RESPONSE.terminal, prob_loss: 0.123 } })`
   equals `'Chance of ending below the starting value: 12.3%'`.
2. `lossChanceText({ ...RESPONSE, model: 'prophet', terminal: { ...RESPONSE.terminal, prob_loss: 0.123 } })`
   equals the full Prophet sentence above, and contains no `%`.

## Out of scope

- Any backend change. The API still returns `prob_loss` for Prophet.
- The CSV export.
- The terminal-value table.
- The Monte Carlo section.
- The guide.

## Acceptance criteria

Run these from `frontend/`:

1. `npx vitest run` passes. Baseline 320; afterwards **322**. Paste the totals.
2. `npx tsc -p tsconfig.app.json --noEmit` is clean.
3. `npm run lint` shows only the 2 known warnings.
4. `npm run build` succeeds.
5. `grep -n "prob_loss" src/pages/analysis/outlook/ForecastSection.tsx` prints nothing.
6. `grep -n "lossChanceText(response)" src/pages/analysis/outlook/ForecastSection.tsx` prints 1 line.

`BLOCKED` is a valid outcome. Report any deviation.

## Human verification — Gunnar

On Forward Models → Forecast:
1. Run **GARCH**. The loss line still shows a percentage.
2. Run **Prophet**. The line reads "not estimated for Prophet…", with no percentage.
3. Run Prophet, then switch the method to GARCH without re-running. The Prophet result still shows
   "not estimated", next to the "settings have changed" note.

## Open questions

None.
