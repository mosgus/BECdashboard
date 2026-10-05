# Contract 0165 — Risk & Perf: Health sub-tab (port of `main`'s Health)

**Status:** done
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The **Health** pill renders a new `HealthSection`, a port of `main`'s Health section:
- five summary cards;
- a Risk Contributions bar chart;
- a Risk Contribution Detail table with MCTR;
- the Risk Mitigation Recommendations panel.

It uses the rebuild's existing `POST /portfolio/risk`, with no backend change.

## Why

This is contract 2 of 4 in the Risk & Perf port (see REBUILD.md, "Risk & Perf port (0164)"). Gunnar
wants `main`'s UI with corrected math.

Read `main`'s version first:
- `git show 'main:frontend/app/portfolios/[id]/risk/page.tsx' | sed -n 323,447p` (HealthSection);
- `… | sed -n 628,722p` (MitigationPanel);
- `git show main:frontend/components/RiskContributionChart.tsx`;
- `git show main:backend/core/risk.py`.

**No backend work is needed.** `backend/app/risk_run.py` already returns every number `main` showed.
- **MCTR** is derived on the client: `MCTR_i = (Σw)_i / σ_p = risk_share_i × portfolio_vol / weight_i`.
  `weight_i` here is the total-portfolio weight (`holding.weight`, cash counted). That's the weight the
  risk share was computed with.

**What changes from `main`, and why:**

| `main` | Here |
|---|---|
| Cash ignored: weights renormalised, so vol and beta are for the invested part only | Vol and beta are for the whole portfolio, cash counted, from `run_risk` |
| HHI, N_eff and Top 5 on renormalised weights | Same idea, on invested weights (`run_risk` already does this) |
| Fixed 252-row lookback against SPY | `run_risk`'s lookback (default 365 days) against SPY, with a `LookbackPicker` |
| Mitigation links to `/targets`, which doesn't exist here, and to "the Outlook tab" | Links to `/portfolios/:id/optimize` and `/outlook`, named "Historical Optimize" and "Forward Models" |
| Mitigation cards use light-only `bg-red-50` and similar classes | Translucent tints that work in both themes |
| Thresholds presented as analysis | Labelled **Rules of thumb**, with a footnote naming the thresholds |
| Table: Ticker, Weight, RC, MCTR | The same, plus **Vol** and **Beta**, which `run_risk` already returns and which explain the RC |

The old Breakdown's "market move" calculator is **not** carried into Health. `main` had none there.
It comes back as the beta-based **Market Shock** in Scenarios (0166).

## Files

Create:
- `frontend/src/lib/health.ts`
- `frontend/src/lib/health.test.ts`
- `frontend/src/components/RiskContributionChart.tsx`, default export, lazy-loaded
- `frontend/src/pages/analysis/risk/HealthSection.tsx`

Modify:
- `frontend/src/pages/analysis/RiskPage.tsx`: the `health` pill renders `<HealthSection />` in place of `<RiskSection />`.
  Remove the `RiskSection` import if nothing else in the file uses it.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. Specifically:
- **Do not delete or edit `RiskSection.tsx`.** `StressSection` imports `Tiles` from it, and 0166 retires both.
- Do not edit `risk.ts`, `risk_run.py`, the schemas or the router.

`reference files/` and the `main` branch are read-only.

## Frontend

### 1. New `frontend/src/lib/health.ts`

```ts
import type { RiskResponse } from '../api/client'
import type { MetricItem } from './optimize'

export interface HealthRow {
  ticker: string
  weight: number        // invested weight (holding.invested_weight)
  rc: number | null     // holding.risk_share
  mctr: number | null
  vol: number
  beta: number
}
export interface Mitigation {
  severity: 'high' | 'medium' | 'low'
  title: string
  body: string
  action?: string
  link?: { to: string; label: string }
}

export function healthCards(r: RiskResponse): MetricItem[]
export function healthRows(r: RiskResponse): HealthRow[]
export function healthChartData(rows: HealthRow[]): { ticker: string; weightPct: number; rcPct: number; mctr: number | null }[]
export function mitigations(r: RiskResponse, portfolioId: string): Mitigation[]
```

**`healthCards`**

Five cards, in this order. Labels and tooltips are verbatim; replace `SPY` with `r.market_ticker`.

| label | value | tooltip |
|---|---|---|
| `HHI` | `r.hhi.toFixed(4)` | `Herfindahl-Hirschman Index: the sum of squared weights of the invested money. 1/N is perfectly spread, 1.0 is a single holding. Higher means more concentrated.` |
| `N_eff` | `r.effective_holdings.toFixed(2)` | `Effective N = 1 / HHI: how many equal-sized holdings would be this concentrated.` |
| `Top 5` | `(r.top5_weight * 100).toFixed(1) + '%'` | `Share of the invested money in the five largest holdings.` |
| `Beta` | `r.portfolio_beta.toFixed(3)` | `How much the whole portfolio moves per 1% move in SPY over the lookback. Cash counts as a beta of 0.` |
| `Ann. Vol` | `(r.portfolio_vol * 100).toFixed(2) + '%'` | `Annualised volatility of the whole portfolio, cash included, over the lookback.` |

**`healthRows`**

One row per holding:
- `weight = invested_weight`
- `rc = risk_share`
- `mctr = risk_share === null || holding.weight <= 0 ? null : risk_share * r.portfolio_vol / holding.weight`

Here `holding.weight` is the total-portfolio weight, not the invested weight.

Sort by `rc`, largest first, with null `rc` last.

**`healthChartData`**
- Keep rows with non-null `rc`, take the first 20, and map them to:
  - `weightPct: weight * 100`
  - `rcPct: rc * 100`
  - `mctr`
- Don't round. The chart formats.

**`mitigations`**

Port `main`'s `MitigationPanel` logic. The thresholds are strict `>`, exactly as in `main`:
- concentration from `r.hhi`: high above 0.15, medium above 0.08;
- beta from `r.portfolio_beta`: high above 1.3, medium above 1.1;
- vol from `r.portfolio_vol`: high above 0.25, medium above 0.20.

Order: concentration, beta, vol. If nothing triggers, return the single `low` item.

Use `main`'s titles and bodies verbatim, with only these changes:
- **High concentration**
  - action: `Consider the Risk Parity or Max Diversification modes in Historical Optimize.`
  - link: `{ to: `/portfolios/${portfolioId}/optimize`, label: 'Go to Historical Optimize →' }`
- **Moderate concentration:** no action, no link (as in `main`).
- **High market sensitivity**
  - action: `main`'s action verbatim
  - link: `{ to: …/outlook, label: 'Go to Forward Models →' }`
- **Above-market sensitivity**
  - body: replace `Run CAPM optimization in the Outlook tab to explore alternatives.` with
    `CAPM Allocation in Forward Models can explore alternatives.`
  - link: the Forward Models link.
- **Elevated volatility**
  - action: `Consider the Target Volatility mode in Historical Optimize to scale down to a comfortable vol level.`
  - link: the Historical Optimize link.
- **Above-average volatility**
  - body: `main`'s, with `Min Variance optimization` changed to `Min Variance in Historical Optimize`
  - link: the Historical Optimize link.
- **Portfolio health looks good:** `main`'s text verbatim.

### 2. New `frontend/src/lib/health.test.ts` (+7)

Base fixture, a literal `RiskResponse`:
- `tickers ['A','B']`
- holdings:
  - `A {weight: 0.4, invested_weight: 0.5, vol: 0.3, beta: 1.2, risk_share: 0.7}`
  - `B {weight: 0.4, invested_weight: 0.5, vol: 0.15, beta: 0.6, risk_share: 0.3}`
- `market_ticker 'SPY'`, `lookback_days 365`, `start '2025-01-02'`, `end '2026-01-02'`, `n_returns 250`
- `cash_weight 0.2`, `portfolio_vol 0.2`, `portfolio_beta 0.72`
- `hhi 0.5`, `effective_holdings 2`, `top5_weight 1`, `warnings []`

Tests:

1. `healthCards`:
   - labels are `['HHI','N_eff','Top 5','Beta','Ann. Vol']`;
   - values are `['0.5000','2.00','100.0%','0.720','20.00%']`.
2. `healthRows`:
   - order is `A`, `B`;
   - A has `weight 0.5`, `rc 0.7` and `mctr ≈ 0.35` (0.7 × 0.2 / 0.4);
   - B has `mctr ≈ 0.15`;
   - use `toBeCloseTo`.
3. A holding with `risk_share: null` gets `rc` and `mctr` null and sorts last.
4. `healthChartData`:
   - drops the null-rc row;
   - caps at 20 rows, built from 25 synthetic rows;
   - A maps to `weightPct ≈ 50` and `rcPct ≈ 70`.
5. `mitigations` with `hhi 0.2`, `portfolio_beta 1.4` and `portfolio_vol 0.3`:
   - three items, all `high`;
   - titles in order: `High concentration risk`, `High market sensitivity`, `Elevated volatility`;
   - the first link's `to` is `'/portfolios/p1/optimize'` and the second's is `'/portfolios/p1/outlook'`.
6. `mitigations` with `hhi 0.1`, `portfolio_beta 1.2` and `portfolio_vol 0.22`:
   - three `medium` items;
   - `hhi 0.15`, `portfolio_beta 1.3` and `portfolio_vol 0.25` also give three `medium` items, because the thresholds are strict.
7. `mitigations` with `hhi 0.05`, `portfolio_beta 0.9` and `portfolio_vol 0.12` gives exactly one item: `low`, `Portfolio health looks good`.

### 3. New `frontend/src/components/RiskContributionChart.tsx`

Port `main`'s component onto `healthChartData`'s shape: `{ data }: { data: ReturnType<typeof healthChartData> }`.
- A vertical-layout `BarChart`.
- Height `Math.max(200, data.length * 36)`.
- `Weight %` bar: `fill="var(--color-primary)"`, `opacity={0.35}`.
- `Risk Contrib %` bar: solid primary.
- Grid stroke: `var(--color-border)`.
- Custom tooltip, as in `main`:
  - `Weight: x.x%`
  - `Risk contribution: x.x%`
  - `MCTR: 0.0000` when non-null
- An empty `data` array renders `Insufficient data to compute risk contributions.`
- Animations off: `isAnimationActive={false}`, as in `StressChart`.

### 4. New `frontend/src/pages/analysis/risk/HealthSection.tsx`

**Data loading**
- Load the portfolio, universe, trade basis and `mountedRef` exactly as `PerformanceSection.tsx` does.
- Build the request with `buildRiskRequest(portfolio, { lookbackDays, marketTicker: 'SPY' }, basis)` and call `riskPortfolio`.
- Settings state: `lookbackDays`, starting from `DEFAULT_RISK_SETTINGS.lookbackDays`.
- Auto-run once when the universe is ready, guarded by a ref, as in Performance.

**Layout**

Follow `main`'s order. Cards are `bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4`.

1. **Controls row**, `flex flex-wrap items-end gap-3`:
   - a `LookbackPicker`;
   - a **Recompute** primary button, styled like Performance's Load Analytics.
2. **Status**:
   - `Computing health metrics…` while running;
   - the error in `text-brand-negative`;
   - `riskSummary(response)` as a muted `text-xs` line;
   - warnings as muted `text-xs` lines;
   - when the built request isn't `sameRiskRequest` to the last run's:
     `Lookback or holdings have changed since this run. Click Recompute to update.`
3. **Summary cards**, `main`'s markup:
   - grid `grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5`;
   - each card shows its label as `text-xs text-[var(--color-muted)]`, wrapped in `Tooltip`, and its value as `mt-1 text-xl font-bold`.
4. **"Risk Contributions" card**:
   - The heading is wrapped in `Tooltip`:
     `Share of the portfolio's variance each holding drives: RC = w × (Σw) / (w′Σw). They add up to 100%. A bar much longer than its faded weight bar means the holding is riskier than its size.`
   - Below it, the lazy `RiskContributionChart` inside `Suspense`.
5. **"Risk Contribution Detail" card**:
   - A `text-xs` table with columns `Ticker | Weight | RC | MCTR | Vol | Beta`.
   - Ticker is a react-router `Link` to `/ticker/${ticker}`, styled like Performance's.
   - Weight, RC and Vol show as `x.x%`. MCTR shows as `toFixed(4)`. Beta shows as `toFixed(2)`. Null shows as `—`.
   - Numbers are right-aligned and `tabular-nums`.
   - Each header is wrapped in `Tooltip`:
     - Weight: `Share of the invested money.`
     - RC: `Share of portfolio variance this holding drives.`
     - MCTR: `Marginal contribution to risk: how much portfolio volatility rises per unit of extra weight in this holding.`
     - Vol: `This holding's own annualised volatility.`
     - Beta: `How much this holding moves per 1% move in SPY.`
6. **"Risk Mitigation Recommendations" card**:
   - Next to the heading, a pill: `Rules of thumb`, styled `rounded-full border border-brand-border px-2 py-0.5 text-[11px] text-[var(--color-muted)]`.
   - One box per `mitigations(...)` item: `rounded-[var(--radius-btn)] border px-4 py-3 text-xs`, plus a severity class:
     - high: `border-red-500/40 bg-red-500/10`
     - medium: `border-amber-500/40 bg-amber-500/10`
     - low: `border-green-500/40 bg-green-500/10`
   - Text inherits `text-foreground`.
   - Inside each box:
     - the title, `font-semibold`;
     - the body;
     - the action, `font-medium`, when present;
     - the link as a react-router `Link`, `font-semibold underline`, when present.
   - Footnote, muted `text-xs`:
     `Rules of thumb, not calculations: concentration flags above HHI 0.08 / 0.15, beta above 1.1 / 1.3, volatility above 20% / 25%. Not investment advice.`

### 5. Formatting

Run Prettier on the four **new** files only:
`node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write <files>`.

If `/tmp/prettier3` is missing, report it and skip this step. Don't run Prettier on `RiskPage.tsx`.

## Tooltips

| Element | Copy |
|---|---|
| LookbackPicker | Its built-in tooltips |
| Recompute | `Measure risk again with this lookback and the current holdings` |
| Ticker link | `Open ${ticker}'s chart and indicators` |
| Mitigation link | `Open ${label without the arrow}` |
| Card labels, chart heading, table headers | As specified above |

## Out of scope

- Any backend change, including adding MCTR to the API. It is derived on the client on purpose.
- Deleting or editing `RiskSection.tsx`, `risk.ts` or `StressSection.tsx`.
- The market-move calculator. It returns as Market Shock in 0166.
- A benchmark picker. SPY is fixed, as in `main`.

## Acceptance criteria

Run these from `frontend/`:

1. `npx vitest run` passes. The baseline is 348 tests in 22 files; afterwards there are **355 in 23 files**. Paste the totals.
2. `npx tsc -p tsconfig.app.json --noEmit` is clean, `npm run lint` shows only the 2 known warnings,
   and `npm run build` succeeds.
3. `awk 'length > 300' src/lib/health.ts src/pages/analysis/risk/HealthSection.tsx src/components/RiskContributionChart.tsx src/pages/analysis/RiskPage.tsx`
   prints nothing.
4. `grep -n "bg-red-50\|bg-amber-50\|bg-green-50\|/targets" src/lib/health.ts src/pages/analysis/risk/HealthSection.tsx`
   prints nothing.
5. `git status --short ../backend` prints nothing.

**Planner-run** (coders skip this: write "browser checks left for the Planner" under Not done):

6. `node contracts/tools/smoke-render.mjs risk "Health"` shows `SUB-TAB CLICKED: true` and no `EXCEPTION:`
   line. Its PAGE TEXT contains `HHI`, `N_eff`, `Risk Contribution Detail`, `MCTR` and
   `Risk Mitigation Recommendations`.

`BLOCKED` is a valid outcome. Report any deviation.

## Human verification — Gunnar

1. **Risk & Perf → Health** loads by itself and shows the five cards, the bar chart, the detail table
   and the mitigation panel, laid out like `main`.
2. On a portfolio with cash:
   - Ann. Vol and Beta are lower than `main` showed, because cash now counts;
   - HHI, N_eff and Top 5 are about the same, because they're on invested weights.
3. In the chart, a holding whose solid bar is much longer than its faded bar is taking more than its
   share of risk. The RC column adds up to about 100%.
4. Switch the theme. The mitigation boxes stay readable in both themes. The links open Historical
   Optimize or Forward Models.
5. Change the lookback to 3Y and click **Recompute**. The cards and table update.

## Open questions

None.
