> ## ⚠ REVISED 2026-11-08 (before first run): three guide paragraphs no longer contain `→`
> They now say "Risk & Perf's Health tab" instead, and criterion 2 checks for this. Contract 0188 prints
> this guide in the PDF, where `→` would become "to". Copy the paragraphs exactly as they now read.

# Contract 0187 — Overview: score help guide, compact score card, clearer component wording

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract:
- The Overview has a **Help** button at the top. It opens a side guide that explains how each part
  of the Research Score is calculated.
- The score card no longer stretches to the height of the breakdown card.
- Two component descriptions read correctly: risk concentration names what "risk" means, and
  "1 of 1 years" becomes "1 of 1 year".

## Why

Gunnar, 2026-11-08 (`reference files/images/overview2.png`):
- He dislikes the score card stretching to the bottom of the breakdown.
- He asked whether Risk concentration scores 0 "because MS makes up most of the risk". It does:
  MS drives 51.5% of portfolio volatility, and the zero point is 50%. But the measured text,
  `MS carries 51.5% of the risk`, didn't say *which* risk.
- He asked for a help button explaining how the scores are determined.

The app already has the pattern for this: `HelpButton` and `GuidePanel` from
`components/GuidePanel.tsx`, with the content in a `lib/*Guide.ts` file. See `lib/forecastGuide.ts`
and `pages/analysis/outlook/ForecastGuide.tsx`. Follow them exactly.

## Files

Create:
- `frontend/src/lib/scoreGuide.ts`: guide content. Data only.
- `frontend/src/lib/scoreGuide.test.ts`
- `frontend/src/pages/analysis/research/ScoreGuide.tsx`: a copy of `ForecastGuide.tsx`'s structure,
  with title `Research Score guide`, rendering `SCORE_GUIDE`.

Modify:
- `frontend/src/lib/score.ts`: the two `measured` strings only (below).
- `frontend/src/lib/score.test.ts`: update the two expected strings, and add one test (below).
- `frontend/src/pages/analysis/research/OverviewSection.tsx`:
  - Add `guideOpen` state, the `HelpButton` and the conditional `<ScoreGuide …/>`.
  - Change the top row's class from `flex justify-end` to `flex items-start justify-end gap-2`, and
    put the `HelpButton` before the PDF button `Tooltip`.
  - Add `self-start` to the **score card's** `<section>`, the one containing `Research Score`. Its
    class becomes `` `${CARD} shadow-sm self-start` ``.

  Change nothing else in the file.

**Touch nothing else.** If the work appears to require editing another file, stop and report `BLOCKED`.

## Interface

### `lib/score.ts`: two string changes

```ts
// risk_concentration, was: `${largestTicker} carries ${pct}% of the risk`
`${largestTicker} drives ${(largestRiskShare * 100).toFixed(1)}% of portfolio volatility`
// robustness, was: `Beat equal weight in ${wins} of ${of} years`
`Beat equal weight in ${wins} of ${of} year${of === 1 ? '' : 's'}`
```

No other change to `score.ts`.

### `lib/scoreGuide.ts`

```ts
import type { GuideSection } from './capmGuide'
import { SCORE_LABELS, SCORE_POINTS } from './score'

export const SCORE_GUIDE: GuideSection[] = [ /* the six sections below, in order */ ]
```

Headings 2–5 are **built from the constants**, so they can't drift from the score:
`` `${SCORE_LABELS.diversification} (${SCORE_POINTS.diversification} points)` ``, and likewise for
`risk_concentration`, `volatility` and `robustness`. Every paragraph is copied **verbatim** from below,
one string per paragraph. `entries` is `[]` in every section.

**1. `How the score works`**
- `The Research Score adds up four components to a number from 0 to 100. Each component is first scored from 0 to 1, then multiplied by its points: 35, 25, 20 and 20.`
- `It describes how the portfolio is built: how spread out its money is, how spread out its risk is, how volatile it is next to the market, and whether it has held up against a simple equal-weight version of itself. It does not predict returns, and the weights are a judgment call, not fitted to any outcome.`
- `Colours are a reading aid, not a recommendation. The ring and each bar are green at 70% of their maximum or more, amber from 45%, and red below that. The cut-offs are the old app's.`
- `If any component can't be computed, there is no partial score: the page says Not scored and names what is missing.`

**2. Diversification (35 points)**
- `Effective holdings is 1 ÷ HHI of the invested money: the number of equal-sized positions the portfolio behaves like. Ten holdings where one is half the money behave like about 3.6.`
- `Points = effective holdings ÷ 20 × 35, capped at 35. Twenty or more effective holdings scores full points; two equal holdings score 3.5; five score 8.75.`
- `It uses the one-year window of Risk & Perf's Health tab. Cash is left out.`

**3. Risk concentration (25 points)**
- `Money and risk are different. A holding's share of the risk is how much of the portfolio's volatility it causes, given its weight, its own volatility and how it moves with everything else. The shares add up to 100%. A volatile holding that moves with the rest carries more risk than money; a steady or offsetting one carries less, and a hedge can be negative.`
- `Only the largest share counts. 10% or less scores full points; 50% or more scores zero; in between, points fall in a straight line, so 30% scores 12.5 and 40% scores 6.25.`
- `Example: a holding that is 35% of the money but the portfolio's most volatile name can drive more than half of its volatility. That scores zero here even if the portfolio as a whole is calm. Risk & Perf's Health tab shows every holding's share.`

**4. Volatility vs market (20 points)**
- `The portfolio's annualised volatility divided by SPY's over the same days, using the default one-year window of Risk & Perf's Performance tab. Cash counts as zero-volatility money.`
- `At or below the market's volatility (1.0×) scores full points; twice the market's (2.0×) or more scores zero; in between it falls in a straight line, so 1.5× scores 10.`
- `This row treats lower volatility as better. A deliberately aggressive portfolio loses points here by design.`

**5. Holdout robustness (20 points)**
- `Taken from Compare Optimizers. In each of the last four years, the portfolio at today's weights and an equal-weight (1/N) version of the same holdings are compared on that year's Sharpe ratio.`
- `Points = years the portfolio beat equal weight ÷ years that could be tested × 20. Ties count as losses. A year is left out when a holding has too little price history for it.`
- `Comparing against equal weight of the same holdings, rather than against zero, takes the market's good and bad years out of the result: it asks whether the weighting helped, not whether the year was kind.`

**6. `What is not scored`**
- `Sharpe, volatility, drawdown, beta and the largest holding are shown in the tiles below the score for context. Past returns and drawdowns vary a lot from one year to the next and say little about the following year, so they are not scored.`
- `The old app's statistical validation tests are not used. They gave the same answer for almost every stock portfolio.`

### `OverviewSection.tsx`

```tsx
import { HelpButton } from '../../../components/GuidePanel'
import { ScoreGuide } from './ScoreGuide'
const [guideOpen, setGuideOpen] = useState(false)
// in the top row, before the PDF button's Tooltip:
<HelpButton tooltip="How the Research Score is calculated, component by component" onClick={() => setGuideOpen(true)} />
// at the end of the returned root <div>:
{guideOpen && <ScoreGuide onClose={() => setGuideOpen(false)} />}
```

## Out of scope

- Any change to how the score is computed: thresholds, weights or formulas.
- The PDF. It picks up the new `measured` strings automatically, through `computeScore`.
- Restyling `GuidePanel` or `HelpButton`.
- Any other layout change on the Overview.
- Do not add dependencies.

## Tooltips

| Element | Tooltip |
|---|---|
| `Help` button | `How the Research Score is calculated, component by component` |

`GuidePanel`'s close button already has its tooltip. Never use `title=`.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

1. `score.test.ts`: the two existing expectations become
   `'C drives 45.0% of portfolio volatility'` and `'Beat equal weight in 2 of 3 years'` (unchanged).
   Add one test. It reuses the full fixture, but sets folds 2 and 3 to
   `unavailable: 'Too little history'`, `current: null` and `score_start: null`, and every
   `equal_weight` holdout in those folds to `null`. The fixture's fold 4 is already unavailable. The
   test asserts:
   - `components[3].measured === 'Beat equal weight in 1 of 1 year'`;
   - `components[3].points` is close to `20`, with `toBeCloseTo(20, 6)`.
2. `scoreGuide.test.ts` asserts:
   - The headings equal exactly
     `['How the score works', 'Diversification (35 points)', 'Risk concentration (25 points)', 'Volatility vs market (20 points)', 'Holdout robustness (20 points)', 'What is not scored']`.
   - Every section has at least one paragraph, and every paragraph is non-empty and ends with `.`.
   - The risk-concentration section's joined paragraphs contain `10% or less`, `50% or more` and
     `30% scores 12.5`.
   - No paragraph contains `→`. The guide is also printed in the PDF (0188), where `→` would
     become `to`.
3. `grep -c "carries" frontend/src/lib/score.ts` prints `0`.
4. `grep -c "self-start" frontend/src/pages/analysis/research/OverviewSection.tsx` prints `1`, and
   `grep -n "Research Score</h3>" -B1 frontend/src/pages/analysis/research/OverviewSection.tsx`
   shows that `self-start` is on the line just above it.
5. `grep -c "<HelpButton" frontend/src/pages/analysis/research/OverviewSection.tsx` prints `1`, and
   `grep -c "<ScoreGuide" frontend/src/pages/analysis/research/OverviewSection.tsx` prints `1`.
6. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
7. `cd frontend && npm run test` passes, with **454 + the tests you added** in **33** files. Report both numbers.
8. `cd frontend && npm run build` exits 0.
9. `cd frontend && npm run lint` shows the same 2 known warnings and nothing new.
10. `grep -n ' title=' frontend/src/pages/analysis/research/OverviewSection.tsx frontend/src/pages/analysis/research/ScoreGuide.tsx` prints nothing.
11. Run
    `cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --write src/lib/score.ts src/lib/score.test.ts src/lib/scoreGuide.ts src/lib/scoreGuide.test.ts src/pages/analysis/research/ScoreGuide.tsx src/pages/analysis/research/OverviewSection.tsx`.
    **If it fails with `ENOTCACHED`, rerun that exact command outside the sandbox.** Then the same
    command with `--check` must print `All matched files use Prettier code style!`. Do not hand-reformat.
12. State in the report every file you created or modified.

**Planner-run:**

13. At 1400 px against a stub API, the score card ends just below the ring instead of running down to
    the breakdown's bottom. Clicking `Help` opens `Research Score guide` with all six headings.

## Verification to run and paste

```bash
(cd frontend && npx vitest run src/lib/score.test.ts src/lib/scoreGuide.test.ts)
grep -c "carries" frontend/src/lib/score.ts
grep -c "self-start" frontend/src/pages/analysis/research/OverviewSection.tsx
grep -n "Research Score</h3>" -B1 frontend/src/pages/analysis/research/OverviewSection.tsx
grep -c "<HelpButton" frontend/src/pages/analysis/research/OverviewSection.tsx
grep -c "<ScoreGuide" frontend/src/pages/analysis/research/OverviewSection.tsx
grep -n ' title=' frontend/src/pages/analysis/research/OverviewSection.tsx frontend/src/pages/analysis/research/ScoreGuide.tsx
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?")
(cd frontend && npm run test 2>&1 | tail -6)
(cd frontend && npm run build 2>&1 | tail -6)
(cd frontend && npm run lint 2>&1 | tail -4)
(cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --check src/lib/score.ts src/lib/score.test.ts src/lib/scoreGuide.ts src/lib/scoreGuide.test.ts src/pages/analysis/research/ScoreGuide.tsx src/pages/analysis/research/OverviewSection.tsx)
```

## Human verification — does Gunnar need to run anything?

Yes, it's frontend only. Open BEC → Research → Overview.
- The score card should now be only as tall as the ring.
- Risk concentration should read `MS drives 51.5% of portfolio volatility`.
- Click `Help` and read the guide. **Is the explanation clear to you?** It is the one part of this
  contract a test can't judge.

## Open questions — do not resolve yourself

- None known.
