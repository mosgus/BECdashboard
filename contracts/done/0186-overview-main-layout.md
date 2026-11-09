> ## ⚠ REVISED 2026-11-08: re-read this file before executing
> The first run correctly reported `BLOCKED`: `--color-accent` text on its 10% tint is 1.87:1.
> Green fails too (2.96:1 in light mode). **What changed:** the score ring's *text* no longer uses
> the tone colour. The number uses the theme text colour (`text-foreground`) and `/ 100` uses
> `var(--color-muted)`. The tone is carried only by the ring's border and background tint. The planner
> measured the new pairing: 5.7:1 or better in light mode and 10:1 or better in dark mode, on every
> tone. Nothing else changed.
> **Do not** add a token, darken `--color-accent`, or apply tone colours to the text this contract adds:
> the ring, the breakdown, the tiles or Key risks. Bars and the ring border are graphics, not text, and
> keep the tone colours. The memo badge is unchanged from 0183.

# Contract 0186 — Overview: `main`-style layout (score ring, breakdown bars, metric tiles, key risks)

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, Research → Overview looks like `main`'s overview, using this rebuild's score and
theme tokens:
- a **coloured score ring** in its own card;
- a compact **latest-memo** card;
- a **score breakdown** card, with one horizontal bar per component, filled to its sub-score and
  coloured by it;
- a row of **six unscored metric tiles**;
- a **Key risks** card.

The PDF button sits top right. No data changes: every number comes from requests the page already
makes.

## Why

Gunnar, 2026-11-08, comparing `reference files/images/overview-main.png` with
`reference files/images/overview-rebuild.png`: he wants `main`'s look. That means separate cards, a
coloured circle for the score, and bars filled to each component's score and coloured by it. He also
asked for `main`'s scored metrics (Validation, Concentration, Performance, Drawdown). The planner's
answer, recorded in `REBUILD.md`, is to **show them as tiles, not score them**:
- `main`'s own screenshot shows its breakdown scoring `Sharpe=0.00` and `Max DD=-100.0%`, while its
  tiles show −0.52 and −21.52%. Its score ran on a broken series.
- The validation suite was dropped on 2026-10-26, and has no backend here.
- HHI is already scored, as effective holdings.

Colour reverses 0183's "no colour bands" at Gunnar's request. The thresholds are `main`'s, and are as
arbitrary as the weights.

Look at both images before starting. `main`'s source is at
`git show main:frontend/app/research/overview/page.tsx`. Read it for layout only. **Do not copy its
fixed colours** (`bg-green-500`, `text-red-600` and so on). Use theme tokens.

## Files

Create:
- `frontend/src/lib/overview.ts`: pure helpers. No React.
- `frontend/src/lib/overview.test.ts`

Modify:
- `frontend/src/pages/analysis/research/OverviewSection.tsx`: layout only. Keep every request, state
  and handler exactly as they are (including `handleDownload`). Change only what is rendered, and
  add the derived values below.

**Touch nothing else.** In particular, do not touch `lib/score.ts`, `lib/memo.ts`, `lib/reportPdf.ts`
or `ResearchPage.tsx`. The PDF is unchanged. If the work appears to require editing another file,
stop and report `BLOCKED`.

`reference files/` and the `main` branch are read-only.

## Interface

### `lib/overview.ts`

```ts
import type { PerformanceResponse, RiskResponse } from '../api/client'

export type ScoreTone = 'positive' | 'accent' | 'negative'
export const TONE_HIGH = 0.7   // main's thresholds (70 / 45 on the total, 0.7 / 0.45 on a component)
export const TONE_MID = 0.45

/** fraction in 0..1. ≥ TONE_HIGH → 'positive'; ≥ TONE_MID → 'accent'; otherwise 'negative'. */
export function scoreTone(fraction: number): ScoreTone

/** CSS colour for a tone: 'var(--color-positive)' | 'var(--color-accent)' | 'var(--color-negative)'. */
export const TONE_COLOR: Record<ScoreTone, string>

export interface OverviewTile { label: string; value: string; sub: string; tooltip: string }

/** Always six tiles, in this order. */
export function overviewTiles(risk: RiskResponse | null, performance: PerformanceResponse | null): OverviewTile[]
```

`overviewTiles`, exact strings. `pct2(x)` is `` `${(x * 100).toFixed(2)}%` ``. A tile whose source is
null, or whose value is `null`/`undefined`, has value `—` and sub `Unavailable`.

| # | label | value | sub | tooltip |
|---|---|---|---|---|
| 1 | `Sharpe` | `performance.metrics.sharpe.toFixed(2)` | `` `${performance.start} → ${performance.end}` `` | `Annualised return over the risk-free rate, divided by volatility, over the window shown.` |
| 2 | `Volatility` | `pct2(performance.metrics.vol)` | `Annualised` | `Annualised standard deviation of daily returns, cash included.` |
| 3 | `Max drawdown` | `pct2(performance.metrics.max_dd)` | `Peak to trough` | `The largest fall from a high to a later low over the window.` |
| 4 | `Effective holdings` | `risk.effective_holdings.toFixed(1)` | `` `HHI ${risk.hhi.toFixed(3)}` `` | `1 ÷ HHI of the invested money: how many equal-sized holdings the portfolio behaves like.` |
| 5 | `Beta` | `performance.metrics.beta.toFixed(2)` | `` `vs ${performance.market_ticker}` `` | `How much the portfolio's daily returns move with the market's.` |
| 6 | `Largest holding` | `` `${ticker} ${(invested_weight * 100).toFixed(1)}%` ``, from the `risk.holdings` entry with the max `invested_weight` | `Of the invested money` | `The single biggest position, as a share of the money that is invested.` |

### `OverviewSection.tsx`: layout, top to bottom

All cards use the existing `CARD` class string, plus `shadow-sm`.

1. **The PDF button,** right-aligned (`flex justify-end`). Its behaviour and tooltip are unchanged.
2. **A two-column grid** (`grid gap-5 lg:grid-cols-[16rem_1fr]`). It stacks on narrow screens.
   - **Left: the score card,** heading `Research Score`.
     - While not settled: `Computing the score…`.
     - When `total !== null`: a ring, `h-28 w-28 rounded-full border-4`, centred.
       - Its tone is `scoreTone(total / 100)`.
       - The border colour is `TONE_COLOR[tone]`. The background is
         `color-mix(in srgb, ${TONE_COLOR[tone]} 10%, transparent)`, set via `style`.
       - Inside it: `Math.round(total)`, large and bold, in `text-foreground`, over `/ 100`, small, in
         `var(--color-muted)`. **Never colour this text with the tone.** Gold on its tint is 1.87:1 and
         green is 2.96:1 in light mode (planner-measured).
     - When `total === null`: the same ring with border `var(--color-border)`, text `—` in muted
       colour. Below it, `Not scored`, then `` `Missing: …` `` and the request-error lines exactly as
       0183 renders them now.
   - **Right: a column of two cards.**
     - **Latest decision memo.**
       - **With a memo:**
         - The recommendation badge, styled as now.
         - The date.
         - `` `Latest of ${n} saved` ``.
         - The rationale (`whitespace-pre-wrap`).
         - One muted line, `` `${k} red flag${k === 1 ? '' : 's'} recorded` `` or
           `No red flags recorded`.
         - `Holdings have changed since this memo.` when applicable.
         - The `Open Decision Memo` button.
       - **With no memo:** `No decision memo yet.` and the `Write a memo` button.
       - **Drop** the monitoring plan and the flag list from this card. Both stay in the Memo pill
         and the PDF.
     - **Score breakdown.** One row per `score.components` entry. Each row is a grid of four parts:
       - the label (with its existing `COMPONENT_TIPS` tooltip), about `w-40`;
       - a bar track, `h-2 rounded-full`, background `var(--color-border)`. Its fill is width
         `` `${subscore * 100}%` `` and background `TONE_COLOR[scoreTone(subscore)]`. There is no
         fill when `subscore === null`;
       - the points, `` `${points.toFixed(1)} / ${maxPoints}` `` or `` `— / ${maxPoints}` ``,
         `tabular-nums`, right-aligned;
       - the `measured` text, with the `window` below it in muted `text-xs` (each `—` when null).

       Below the rows, the existing source note and then `SCORE_DISCLAIMER`, both unchanged.
3. **Metric tiles:** `grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6`, one card per
   `overviewTiles(riskResponse, performanceResponse)` entry.
   - The label is muted `text-sm`, wrapped in a `Tooltip` with the tile's `tooltip`.
   - The value is `text-2xl font-semibold tabular-nums`.
   - The sub is muted `text-xs`.
   - Above the grid, one muted `text-xs` line: `For context only: these figures are not part of the score.`
   - While not settled, render nothing here.
4. **Key risks card.** Heading `Key risks`.
   - Background `color-mix(in srgb, var(--color-accent) 8%, transparent)`, via `style`.
   - Content: `deriveRedFlags(buildEvidence(riskResponse, compareResponse))`, computed in `useMemo`
     once settled. These are the same rules the Decision Memo uses to suggest flags.
   - Each flag is a list item: `` `${severity} · ${title}: ${detail}` ``. High-severity items render
     their `high` prefix in `font-semibold`. All text stays `text-foreground`. Red on the gold tint is
     under 4.5:1.
   - When there are no flags: `No flags raised by the current evidence.`
   - While not settled, render nothing here.

Theme tokens only. Check both themes. **No text this contract adds uses a tone colour** (ring, breakdown, tiles,
Key risks). Tone colours appear only on the ring border and tint, and on the bar fills. The memo
badge keeps its 0183 styling.

## Out of scope

- **Any change to the score:** components, weights, formulas or `lib/score.ts`. Validation,
  Performance and Drawdown are **not** scored.
- The PDF (`lib/reportPdf.ts`). It does not get the ring, bars, tiles or key risks in this contract.
- New requests, endpoints or backend work.
- Icons, new dependencies, or a chart library for the ring. It is a bordered `div`.
- Changes to `MemoSection.tsx`, `ResearchPage.tsx` or `lib/memo.ts`.

## Tooltips

| Element | Tooltip |
|---|---|
| Each tile label | The tile's `tooltip` string from the table above |
| Breakdown labels, PDF button, memo buttons | Unchanged from 0183/0184 |

Never use `title=`.

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written. Do not find a
clever way past one.

`overview.test.ts`, with literal fixtures written in the test file:

1. `scoreTone`: `1 → 'positive'`, `0.7 → 'positive'`, `0.69 → 'accent'`, `0.45 → 'accent'`,
   `0.44 → 'negative'`, `0 → 'negative'`.
2. `overviewTiles` with this performance fixture:
   - `metrics: { cagr: 0.1, vol: 0.2183, sharpe: -0.523, max_dd: -0.2152, beta: 1.234, alpha: 0.01 }`
   - `start: '2025-11-10'`, `end: '2026-11-06'`, `market_ticker: 'SPY'`

   and this risk fixture:
   - `effective_holdings: 7.04`, `hhi: 0.142`
   - holdings `TSLA` (`invested_weight: 0.21`) and `AAPL` (`invested_weight: 0.18`)

   It must give values `['-0.52', '21.83%', '-21.52%', '7.0', '1.23', 'TSLA 21.0%']` and subs
   `['2025-11-10 → 2026-11-06', 'Annualised', 'Peak to trough', 'HHI 0.142', 'vs SPY', 'Of the invested money']`.
3. `overviewTiles(null, null)` gives six tiles, every value `—` and every sub `Unavailable`. The
   labels match criterion 2's order.
4. With the performance fixture but `metrics.beta` omitted (`undefined`), tile 5 is `—` / `Unavailable`
   and the other performance tiles are unchanged.

Global:

5. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
6. `cd frontend && npm run test` passes, with **445 + the tests you added** in **32** files. Report both numbers.
7. `cd frontend && npm run build` exits 0.
8. `cd frontend && npm run lint` shows the same 2 known warnings and nothing new.
9. `grep -nE '(bg|text|border)-(green|red|amber|yellow|emerald|rose|orange)-[0-9]' frontend/src/pages/analysis/research/OverviewSection.tsx frontend/src/lib/overview.ts` prints nothing.
10. `grep -n ' title=' frontend/src/pages/analysis/research/OverviewSection.tsx` prints nothing.
11. `grep -c "deriveRedFlags(" frontend/src/pages/analysis/research/OverviewSection.tsx` prints `1`, and `grep -c "overviewTiles(" frontend/src/pages/analysis/research/OverviewSection.tsx` prints `1`.
12. `grep -c "scoreTone(" frontend/src/pages/analysis/research/OverviewSection.tsx` prints at least `2`: the ring and the bars.
13. `grep -c "import('../../../lib/reportPdf')" frontend/src/pages/analysis/research/OverviewSection.tsx`
    still prints `1`, so the PDF path is untouched.
14. Run
    `cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --write src/lib/overview.ts src/lib/overview.test.ts src/pages/analysis/research/OverviewSection.tsx`.
    **If it fails with `ENOTCACHED`, rerun that exact command outside the sandbox.** Then the same
    command with `--check` must print `All matched files use Prettier code style!`. Do not hand-reformat.
15. State in the report every file you created or modified.

**Planner-run** (coders skip these, and write "browser checks left for the Planner" under Not done):

16. Against a stub API, the page renders with no `EXCEPTION:`. PAGE TEXT contains `Research Score`,
    `Score breakdown`, `Effective holdings`, `Largest holding`, `Key risks` and
    `not part of the score`.
17. A screenshot in light and dark themes, compared with `overview-main.png`: the ring, the coloured
    bars, the tile row and the key-risks card are all present and legible.

## Verification to run and paste

```bash
(cd frontend && npx vitest run src/lib/overview.test.ts)
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?")
(cd frontend && npm run test 2>&1 | tail -6)
(cd frontend && npm run build 2>&1 | tail -6)
(cd frontend && npm run lint 2>&1 | tail -4)
grep -nE '(bg|text|border)-(green|red|amber|yellow|emerald|rose|orange)-[0-9]' frontend/src/pages/analysis/research/OverviewSection.tsx frontend/src/lib/overview.ts
grep -n ' title=' frontend/src/pages/analysis/research/OverviewSection.tsx
grep -c "deriveRedFlags(" frontend/src/pages/analysis/research/OverviewSection.tsx
grep -c "overviewTiles(" frontend/src/pages/analysis/research/OverviewSection.tsx
grep -c "scoreTone(" frontend/src/pages/analysis/research/OverviewSection.tsx
grep -c "import('../../../lib/reportPdf')" frontend/src/pages/analysis/research/OverviewSection.tsx
(cd frontend && npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --check src/lib/overview.ts src/lib/overview.test.ts src/pages/analysis/research/OverviewSection.tsx)
```

## Human verification — does Gunnar need to run anything?

Yes, it's frontend only. Open BEC → Research → Overview in both themes, at full width and at ~800 px,
next to `overview-main.png`.
- Is this the look you wanted? Aesthetics are your call, not the planner's.
- With your current numbers (38 total; Diversification 12.3/35 is 0.35, so red; Risk concentration
  18.2/25 is 0.73, so green; Volatility 7.8/20 is 0.39, so red; Holdout 0/20, so an empty bar), the
  ring should be **red**. That's `main`'s thresholds at work. If red on a 38 feels too harsh, that's a
  threshold decision for the planner, not a code tweak.

## Open questions — do not resolve yourself

- None known. If a field named above is missing from `RiskResponse` or `PerformanceResponse`, stop and
  report `BLOCKED`.
