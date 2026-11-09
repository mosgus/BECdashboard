# Contract 0182 — Research Score: pure scoring function (`lib/score.ts`)

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, `frontend/src/lib/score.ts` turns the existing `/portfolio/risk`,
`/portfolio/performance` and `/portfolio/compare` responses into a 0–100 **Research Score** with four
documented components, and every formula is pinned by a test with literal values. No UI.

## Why

Gunnar approved the score on 2026-11-08 (see `REBUILD.md`, "### Next: a Research tab inside
Portfolios", "Score components decided 2026-11-08"). It replaces `main`'s score (validation tests 30%,
HHI 25%, in-sample Sharpe 25%, drawdown 20%). The design rule: **score only what persists**, meaning
diversification, risk concentration and volatility, plus one return test measured **relative to equal
weight**, so that the market's year cancels out. The walk-forward probe (0179) showed holdout Sharpe
ranks are close to noise, so no absolute Sharpe enters the score.

The Overview pill (0183) and the PDF report (0184) both consume this function. Keep it pure.

## Files

Create:
- `frontend/src/lib/score.ts`: types, constants and `computeScore`. No React, no fetching, no storage.
- `frontend/src/lib/score.test.ts`

**Touch nothing else.** In particular, do not edit `lib/research.ts`, `lib/memo.ts` or `api/client.ts`.
If the work appears to require editing a file not on this list, stop and report `BLOCKED` instead of
editing it.

**`reference files/` and the `main` branch are read-only.**

## Interface

```ts
import type { CompareResponse, PerformanceResponse, RiskResponse } from '../api/client'
import { walkForward } from './research'

export type ScoreKey = 'diversification' | 'risk_concentration' | 'volatility' | 'robustness'

export const SCORE_KEYS: readonly ScoreKey[] = ['diversification', 'risk_concentration', 'volatility', 'robustness']

export const SCORE_POINTS: Record<ScoreKey, number> = {
  diversification: 35,
  risk_concentration: 25,
  volatility: 20,
  robustness: 20,
}

export const SCORE_LABELS: Record<ScoreKey, string> = {
  diversification: 'Diversification',
  risk_concentration: 'Risk concentration',
  volatility: 'Volatility vs market',
  robustness: 'Holdout robustness',
}

/** Effective holdings at which diversification scores 1. */
export const DIVERSIFICATION_FULL = 20
/** Largest single risk share at or below which risk concentration scores 1. */
export const RISK_SHARE_FULL = 0.1
/** Largest single risk share at or above which risk concentration scores 0. */
export const RISK_SHARE_ZERO = 0.5
/** Portfolio vol ÷ market vol at or below which volatility scores 1. */
export const VOL_RATIO_FULL = 1.0
/** Portfolio vol ÷ market vol at or above which volatility scores 0. */
export const VOL_RATIO_ZERO = 2.0

export const SCORE_DISCLAIMER =
  'This score describes how the portfolio is built: how spread out its money and its risk are, how volatile ' +
  'it is next to the market, and how often it beat an equal-weight version of itself in past one-year ' +
  'holdouts. It does not predict returns. The weights (35, 25, 20, 20) are a judgment call, not fitted to ' +
  'any outcome. A high score does not mean the portfolio will do well, and a low score does not mean it ' +
  'will do badly.'

export interface ScoreComponent {
  key: ScoreKey
  label: string            // SCORE_LABELS[key]
  measured: string | null  // human text of the input; null when unavailable (formats below)
  window: string | null    // 'YYYY-MM-DD → YYYY-MM-DD'; null when unavailable
  subscore: number | null  // 0..1
  points: number | null    // subscore × maxPoints, unrounded
  maxPoints: number        // SCORE_POINTS[key]
}

export interface ResearchScore {
  /** Sum of the four `points`, unrounded. null if any component is null; there is no partial score. */
  total: number | null
  /** Always four entries, in SCORE_KEYS order. */
  components: ScoreComponent[]
  /** Labels of the components whose subscore is null, in SCORE_KEYS order. */
  missing: string[]
}

export function diversificationSubscore(effectiveHoldings: number): number
export function riskConcentrationSubscore(largestRiskShare: number): number
export function volatilitySubscore(volRatio: number): number

export function computeScore(
  risk: RiskResponse | null,
  performance: PerformanceResponse | null,
  compare: CompareResponse | null,
): ResearchScore
```

### Subscore formulas (exact)

- `diversificationSubscore(n)` = `n <= 0 ? 0 : Math.min(n / DIVERSIFICATION_FULL, 1)`
- `riskConcentrationSubscore(s)` = `1` if `s <= RISK_SHARE_FULL`; `0` if `s >= RISK_SHARE_ZERO`;
  otherwise `(RISK_SHARE_ZERO - s) / (RISK_SHARE_ZERO - RISK_SHARE_FULL)`
- `volatilitySubscore(r)` = `1` if `r <= VOL_RATIO_FULL`; `0` if `r >= VOL_RATIO_ZERO`;
  otherwise `(VOL_RATIO_ZERO - r) / (VOL_RATIO_ZERO - VOL_RATIO_FULL)`

### Inputs, `measured` and `window` per component

| key | Input | null when | `measured` | `window` |
|---|---|---|---|---|
| `diversification` | `risk.effective_holdings` | `risk === null` | `` `${n.toFixed(1)} effective holdings` `` | `` `${risk.start} → ${risk.end}` `` |
| `risk_concentration` | the `risk.holdings` entry with the largest non-null `risk_share` | `risk === null`, or every `risk_share` is null | `` `${ticker} carries ${(share * 100).toFixed(1)}% of the risk` `` | `` `${risk.start} → ${risk.end}` `` |
| `volatility` | `r = performance.metrics.vol / performance.bench_metrics.vol` | `performance === null`, `metrics.vol` null/undefined, `bench_metrics` null, `bench_metrics.vol` null/undefined, or `bench_metrics.vol <= 0` | `` `${(pv * 100).toFixed(1)}% vs ${(bv * 100).toFixed(1)}% for ${performance.market_ticker} (${r.toFixed(2)}×)` `` | `` `${performance.start} → ${performance.end}` `` |
| `robustness` | `walkForward(compare)['current'].beatEqual`; subscore `wins / of` | `compare === null`, `beatEqual === null`, or `of === 0` | `` `Beat equal weight in ${wins} of ${of} years` `` | earliest `score_start` → latest `score_end` over the `compare.folds` entries with `unavailable === null` and `score_start !== null`, formatted `` `${start} → ${end}` `` |

When a component is null, all of `measured`, `window`, `subscore` and `points` are null.

Reuse `walkForward` from `lib/research.ts` for robustness. Do not re-implement the fold
comparison: ties count as losses there, and the score must agree with the Compare Optimizers table.

## Out of scope

- No UI, no component, no page. That is 0183.
- No rounding inside `computeScore`. Display code rounds.
- No colour bands, grades or GO/NO-GO from the score. The Decision Memo owns the recommendation.
- Do not change `walkForward`, `buildEvidence` or any memo thresholds.
- Do not add dependencies.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

`score.test.ts`, with literal fixtures written in the test file. Build typed fixtures the way
`research.test.ts` does, with small helper functions returning full `RiskResponse`,
`PerformanceResponse` and `CompareResponse` objects. Use `toBeCloseTo(x, 6)` for every
non-integer number.

1. `diversificationSubscore`: `0 → 0`, `-1 → 0`, `5 → 0.25`, `20 → 1`, `25 → 1`.
2. `riskConcentrationSubscore`: `0.05 → 1`, `0.1 → 1`, `0.3 → 0.5`, `0.45 → 0.125`, `0.5 → 0`, `0.6 → 0`.
3. `volatilitySubscore`: `0.8 → 1`, `1.0 → 1`, `1.2 → 0.8`, `1.5 → 0.5`, `2.0 → 0`, `2.5 → 0`.
4. **Full fixture.** Use these values:
   - **risk:** `effective_holdings: 5`, `start: '2025-11-07'`, `end: '2026-11-06'`, and three holdings with
     `risk_share` `A 0.30`, `B 0.25`, `C 0.45`.
   - **performance:** `metrics.vol: 0.18`, `bench_metrics.vol: 0.15`, `market_ticker: 'SPY'`,
     `start: '2025-11-08'`, `end: '2026-11-06'`.
   - **compare `folds`:** four entries. Each has an `equal_weight` mode in `modes`, with that holdout
     Sharpe.

     | fold | `score_start` | `score_end` | `unavailable` | `current.sharpe` | `equal_weight` Sharpe |
     |---|---|---|---|---|---|
     | 1 | `'2025-01-01'` | `'2026-01-01'` | `null` | `0.5` | `0.4` |
     | 2 | `'2024-01-01'` | `'2025-01-01'` | `null` | `0.1` | `0.3` |
     | 3 | `'2023-01-01'` | `'2024-01-01'` | `null` | `0.8` | `0.2` |
     | 4 | `null` | `'2023-01-01'` | `'Too little history'` | `current: null` | `holdout: null` |

   The result must be:
   - points `8.75`, `3.125`, `16`, `13.333333`, and `total` `41.208333`;
   - `missing` equal to `[]`;
   - `components.map(c => c.key)` equal to `SCORE_KEYS`;
   - `components[1].measured === 'C carries 45.0% of the risk'`;
   - `components[2].measured === '18.0% vs 15.0% for SPY (1.20×)'`;
   - `components[3].measured === 'Beat equal weight in 2 of 3 years'`;
   - `components[3].window === '2023-01-01 → 2026-01-01'`.
5. `computeScore(null, null, null)` gives `total: null`, four components with `points: null`, and
   `missing` equal to `['Diversification', 'Risk concentration', 'Volatility vs market', 'Holdout robustness']`.
6. Criterion 4's fixture with `compare` replaced by `null` gives `total: null`,
   `missing: ['Holdout robustness']`, and the other three points unchanged.
7. Criterion 4's fixture with `bench_metrics: null` gives `missing: ['Volatility vs market']`. With
   `bench_metrics.vol: 0` it gives the same.
8. A risk fixture whose every `risk_share` is `null` gives `missing: ['Risk concentration']`, and
   diversification is still scored.
9. A compare whose four folds all have `unavailable` set, `current: null` and every `holdout: null` (so `of === 0`) gives
   `missing: ['Holdout robustness']`.

Global:

10. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
11. `cd frontend && npm run test` passes, with **420 + the tests you added** in **30** files. Report both numbers.
12. `cd frontend && npm run lint` shows the same 2 known warnings (`UniversePage.tsx:77`, `HelpSidebar.tsx:44`) and nothing new.
13. `grep -c "import.*walkForward.*from './research'" frontend/src/lib/score.ts` prints `1`.
14. Format both files with
    `cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --write src/lib/score.ts src/lib/score.test.ts`.
    Then `awk 'length > 300 {print FILENAME": "FNR}' frontend/src/lib/score.ts frontend/src/lib/score.test.ts`
    must print nothing. If the prettier command fails, report it. Do not hand-reformat.
15. State in the report the full list of files you created or modified.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report, including failures.

```bash
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?")
(cd frontend && npx vitest run src/lib/score.test.ts)
(cd frontend && npm run test 2>&1 | tail -6)
(cd frontend && npm run lint 2>&1 | tail -4)
grep -c "import.*walkForward.*from './research'" frontend/src/lib/score.ts
awk 'length > 300 {print FILENAME": "FNR}' frontend/src/lib/score.ts frontend/src/lib/score.test.ts
```

## Human verification — does Gunnar need to run anything?

- **Nothing to run.** No visible surface. The tests and the audit are the whole verification. The
  score first becomes visible in 0183.

## Open questions — do not resolve yourself

- None known. If `RiskResponse`, `PerformanceResponse`, `CompareResponse` or `FoldOut` lacks a field
  named above, stop and report `BLOCKED`.
