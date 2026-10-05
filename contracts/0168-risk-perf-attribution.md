# Contract 0168 — Risk & Perf: Attribution sub-tab (port of `main`'s Attribution)

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Risk & Perf gets a fourth pill, **Attribution**. It renders a new `AttributionSection`, a port of `main`'s Attribution section, built on 0167's `POST /portfolio/attribution`. The section has three parts:
- an **Attribution Summary** banner;
- **Factor Loadings (Fama-French 3)** bars;
- a **Return Contribution Breakdown**.

There is no backend change.

## Why

This is the last contract of the Risk & Perf port (see REBUILD.md, "Risk & Perf port (0164)" and the "Attribution backend (0167)" paragraph). Gunnar wants `main`'s UI with correct math. The backend already does the math; this contract presents it honestly.

Read `main`'s version first: `git show 'main:frontend/app/portfolios/[id]/risk/page.tsx' | sed -n 447,595p`.

**What changes from `main`, and why:**

| `main` | Here |
|---|---|
| A lookback picker (default 252 days) ending today. | The same optional Start / End date inputs as Performance. The backend clips the end to the last factor date, and the footnote always shows that date. |
| The contribution chart was one stacked bar sized by `|value|`. A negative part looked like a positive slice, and only its label said otherwise. | One row per part, with a bar diverging from a centre line: positive bars go right in `bg-brand-positive`, negative bars go left in `bg-brand-negative`. Six rows replace the legend. |
| A "Residual" segment, which was really the compounding gap. | A **Compounding** row, labelled and explained. The six rows add up exactly to the total. |
| Loading bars were scaled at 40% of the track per 1.0 of beta and capped there, so every β above 1 looked the same. | Scale = `max(1, max |β|)`, so the largest bar fills its half of the track. |
| The summary named only market, tilts and alpha, so its numbers didn't add up. | The summary also states the T-bill and compounding parts. |
| Hex colours (`#8b5cf6`, …), `bg-blue-500` and `bg-red-500`. | Theme tokens only. |
| Nothing about cash. | The backend's cash warning shows under the summary. Cash at 0% pulls alpha down, and the warning puts a number on it. |

## Files

Create:
- `frontend/src/lib/attribution.ts`
- `frontend/src/lib/attribution.test.ts`
- `frontend/src/pages/analysis/risk/AttributionSection.tsx`

Modify:
- `frontend/src/api/client.ts`: add the types and `attributionPortfolio`. Put them next to `performancePortfolio`, one line each, in that block's style.
- `frontend/src/pages/analysis/RiskPage.tsx`: add the fourth pill.

**Touch nothing else.** If the work needs another file, stop and report `BLOCKED`. `reference files/` and the `main` branch are read-only.

## Interface

### `api/client.ts`

```ts
export type AttributionRequest = PerformanceRequest
export interface FactorLoading { key: 'market' | 'size' | 'value'; label: string; beta: number; t_stat: number | null }
export interface AttributionContributions { alpha: number; market: number; size: number; value: number; risk_free: number; compounding: number }
export interface AttributionResponse { market_ticker: string; start: string; end: string; factor_end: string; n_obs: number; cash_weight: number; coverage: number; period_return: number; alpha_daily: number; alpha_annual: number; r_squared: number | null; loadings: FactorLoading[]; contributions: AttributionContributions; source: string; warnings: string[] }
export async function attributionPortfolio(body: AttributionRequest): Promise<AttributionResponse> { return request<AttributionResponse>('/portfolio/attribution', { method: 'POST', body }) }
```

The request is identical to Performance's. Reuse `buildPerformanceRequest` and `samePerformanceRequest` from `lib/performance.ts`; don't write new versions.

### `lib/attribution.ts`

All values in the response are fractions (0.192 means 19.2%).

```ts
export function signedPct(value: number): string          // (value * 100).toFixed(2), with '+' if > 0: 0.192 → '+19.20%', -0.0123 → '-1.23%', 0 → '0.00%'
export function attributionSummary(r: AttributionResponse): string
export function attributionFootnote(r: AttributionResponse): string
export interface LoadingRow { key: string; label: string; betaText: string; tText: string; significant: boolean; positive: boolean; leftPct: number; widthPct: number }
export function loadingRows(r: AttributionResponse): LoadingRow[]
export interface ContributionRow { key: keyof AttributionContributions; label: string; tooltip: string; value: number; text: string; positive: boolean; leftPct: number; widthPct: number }
export function contributionRows(r: AttributionResponse): ContributionRow[]
```

**`attributionSummary`** joins these sentences with single spaces, in this order:
1. `The portfolio returned ${signedPct(period_return)} from ${start} to ${end} (${n_obs} trading days).`
2. If `|β_market| > 0.1`: `Market exposure (beta ${β.toFixed(2)}) contributed ${signedPct(c.market)}.`
3. If `|β_size| > 0.15`: `${β > 0 ? 'Small-cap' : 'Large-cap'} tilt (SMB beta ${β.toFixed(2)}) contributed ${signedPct(c.size)}.`
4. If `|β_value| > 0.15`: `${β > 0 ? 'Value' : 'Growth'} tilt (HML beta ${β.toFixed(2)}) contributed ${signedPct(c.value)}.`
5. `Alpha contributed ${signedPct(c.alpha)} (${signedPct(alpha_annual)} a year).`
6. `T-bills contributed ${signedPct(c.risk_free)} and compounding ${signedPct(c.compounding)}.`

Look up betas by `key`, never by array position.

**`attributionFootnote`** returns `R² = ${r_squared === null ? '—' : r_squared.toFixed(3)} · ${n_obs} observations · factor data through ${factor_end}`.

**`loadingRows`**
- Rows follow the response's `loadings` order (market, size, value).
- `scale = Math.max(1, ...loadings.map((l) => Math.abs(l.beta)))`.
- `widthPct = Math.abs(beta) / scale * 50`.
- `leftPct = beta >= 0 ? 50 : 50 - widthPct`, and `positive = beta >= 0`.
- `betaText = beta.toFixed(3)`.
- `significant = t_stat !== null && Math.abs(t_stat) > 1.96`.
- `tText` is `'t = —'` when `t_stat` is `null`. Otherwise it is `` `t = ${t_stat.toFixed(1)}` `` with `' ★'` appended when significant.

**`contributionRows`** returns six rows in this order:

| key | label | tooltip |
|---|---|---|
| `alpha` | `Alpha` | `Return not explained by the three factors or T-bills: the daily intercept × the number of days.` |
| `market` | `Market (excess over T-bills)` | `Market beta × the sum of the market's daily return above T-bills.` |
| `size` | `Size (SMB)` | `Size beta × the sum of SMB, small caps minus big caps.` |
| `value` | `Value (HML)` | `Value beta × the sum of HML, cheap stocks minus expensive ones.` |
| `risk_free` | `Risk-free (T-bills)` | `What one-month T-bills paid over the window, part of every return.` |
| `compounding` | `Compounding` | `The compounded return minus the plain sum of daily returns. The other five add up to that plain sum.` |

- `text = signedPct(value)`.
- `max = Math.max(...rows.map(|value|))`, with `widthPct = max === 0 ? 0 : |value| / max * 50`.
- `leftPct` and `positive` follow the loadings rule.

### `AttributionSection.tsx`

Copy `PerformanceSection`'s structure: `useParams`, the portfolio lookup, the universe load for `tradeBasis`, `mountedRef`, `autoRunRef` (runs once when the universe is ready) and the `RunState` union. Drop the signals parts. Everything above the results:

- The **Start (optional)** and **End (optional)** date inputs, with Performance's tooltips. The End tooltip becomes: `Last day of the window. Leave empty for the latest Fama-French data, which runs about a month behind.`
- A **Run Attribution** button with the tooltip `Re-run the Fama-French regression for these dates with the current holdings`.
- The **Buy & hold** chip, as in Performance.
- `running`: `Running Fama-French regression…` (muted).
- `error`: the message in `text-brand-negative`. A 503 from the backend says the factor data isn't downloaded yet; show it as is.
- A "Dates or holdings have changed since this run. Click Run Attribution to update." note when `samePerformanceRequest` fails, exactly as in Performance.

When the run is `ready`, render three `section`s, with Health's section classes (`bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4`):

1. **Attribution Summary**
   - An `h2` "Attribution Summary".
   - A `<p className="text-sm leading-6">` holding `attributionSummary`.
   - The footnote, muted `text-xs`.
   - Each warning as its own muted `text-xs` `<p>`.
2. **Factor Loadings (Fama-French 3)**
   - The `h2` is wrapped in a `Tooltip` with the label `OLS slopes from regressing the portfolio's daily return minus the T-bill rate on Mkt-RF, SMB and HML. ★ marks |t| > 1.96. These are plain OLS standard errors, which overstate significance somewhat when daily returns are autocorrelated.`
   - One row per `loadingRows` item, in a `grid grid-cols-[10rem_1fr_4rem_6rem] items-center gap-3 text-xs`:
     - the label (muted);
     - a track `relative h-5 rounded bg-[var(--color-bg)]`, containing a centre line `absolute inset-y-0 left-1/2 w-px bg-[var(--color-border)]` and a bar `absolute inset-y-0 rounded` with `style={{ left: \`${leftPct}%\`, width: \`${widthPct}%\` }}`, coloured `bg-brand-primary` if positive and `bg-brand-negative` if not;
     - `betaText`, right-aligned, `font-mono`;
     - `tText`, right-aligned, muted.
3. **Return Contribution Breakdown**
   - The `h2` is wrapped in a `Tooltip` with the label `The period return split into alpha, the three factor exposures, T-bills and the compounding gap. The six rows add up exactly to the total period return.`
   - Below it: `Total period return:` followed by `signedPct(period_return)` in `<strong>`.
   - Then one row per `contributionRows` item, in the same grid shape with `grid-cols-[12rem_1fr_5rem]`:
     - the label, wrapped in a `Tooltip` with the row's tooltip;
     - the same diverging track, coloured `bg-brand-positive` / `bg-brand-negative`;
     - the text, right-aligned, `font-mono`.

`Tooltip` calls `Children.only`. Give it exactly one element child; wrap text in a `<span>`. This bug once blanked a whole tab (0119).

No recharts and no lazy imports: these are plain divs.

### `RiskPage.tsx`

- Add `['attribution', 'Attribution', 'What drove the return: market, size and value exposure, alpha and T-bills (Fama-French 3)']` as the fourth `TABS` entry.
- Widen the state's union type to include `'attribution'`.
- Render `<AttributionSection />` for it. Rewrite the nested ternary as a lookup or a small `switch` if that reads more clearly; behaviour must not change for the other three pills.

## Tests: `lib/attribution.test.ts`, 7 tests

Fixture:

```ts
const R: AttributionResponse = {
  market_ticker: 'SPY', start: '2025-09-02', end: '2026-08-31', factor_end: '2026-08-31', n_obs: 250,
  cash_weight: 0.4, coverage: 1, period_return: 0.192, alpha_daily: 0.00006, alpha_annual: 0.0154, r_squared: 0.646,
  loadings: [
    { key: 'market', label: 'Market (Mkt-RF)', beta: 0.742, t_stat: 19.04 },
    { key: 'size', label: 'Size (SMB)', beta: 0.008, t_stat: 0.21 },
    { key: 'value', label: 'Value (HML)', beta: 0.108, t_stat: 2.61 },
  ],
  contributions: { alpha: 0.0151, market: 0.1165, size: 0.0001, value: 0.0109, risk_free: 0.0396, compounding: 0.0097 },
  source: 'Kenneth R. French Data Library — daily Fama/French 3 factors',
  warnings: ['Cash (40.0% at the start) is counted at 0% return, so alpha is about 1.60% a year lower than if it earned the T-bill rate.'],
}
```

1. `signedPct`: `0.192 → '+19.20%'`, `-0.0123 → '-1.23%'`, `0 → '0.00%'`.
2. `attributionSummary(R)` equals exactly:
   `The portfolio returned +19.20% from 2025-09-02 to 2026-08-31 (250 trading days). Market exposure (beta 0.74) contributed +11.65%. Alpha contributed +1.51% (+1.54% a year). T-bills contributed +3.96% and compounding +0.97%.`
3. Tilts. With size β `-0.3` and contribution `-0.0123`, and value β `0.25` and contribution `0.02`, the summary contains `Large-cap tilt (SMB beta -0.30) contributed -1.23%.` and `Value tilt (HML beta 0.25) contributed +2.00%.` With size β `0.3` and value β `-0.25`, it contains `Small-cap tilt` and `Growth tilt`.
4. `attributionFootnote(R)` is `R² = 0.646 · 250 observations · factor data through 2026-08-31`. With `r_squared: null` it starts `R² = — ·`.
5. `loadingRows(R)`:
   - `betaText` is `['0.742', '0.008', '0.108']`;
   - `tText` is `['t = 19.0 ★', 't = 0.2', 't = 2.6 ★']`;
   - the market row has `leftPct 50` and `widthPct ≈ 37.1`.
6. `loadingRows` with the market β `1.6` and the value β `-0.4` with `t_stat: null`:
   - market `widthPct` is 50;
   - value `widthPct ≈ 12.5`, `leftPct ≈ 37.5`, `positive` is false, and `tText` is `'t = —'`.
7. `contributionRows(R)`:
   - keys are in table order;
   - labels match the table;
   - the market row has `widthPct` 50 and `text '+11.65%'`;
   - with `alpha: -0.05`, the alpha row has `positive` false, `leftPct ≈ 50 − 0.05/0.1165·50` and `text '-5.00%'`.

**Expected totals:** the baseline is **364 tests in 24 files**; afterwards there are **371 in 25 files**.

## Out of scope

- Factor Replay for Scenarios presets (a later contract, on the same factor table).
- A CSV export.
- Any backend change.
- A guide panel.

## Acceptance criteria

Run these from `frontend/`:

1. `npx vitest run` passes with **371 tests in 25 files**. Paste the totals.
2. `npx tsc -p tsconfig.app.json --noEmit` is clean, `npm run lint` shows only the 2 known warnings (`UniversePage:77`, `HelpSidebar:44`), and `npm run build` succeeds.
3. Run `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write` on the **three new files only**. Never run it on `client.ts` or `RiskPage.tsx`. Afterwards, `awk 'length > 300'` prints nothing for the three new files and `RiskPage.tsx`.
4. This command prints nothing:
   ```
   grep -nE "bg-(red|amber|green|blue|purple)-[0-9]|text-(red|green|amber|blue)-[0-9]|#[0-9a-fA-F]{6}\b|rgb\(" src/lib/attribution.ts src/pages/analysis/risk/AttributionSection.tsx
   ```
5. `grep -c "buildPerformanceRequest\|samePerformanceRequest" src/pages/analysis/risk/AttributionSection.tsx` prints at least `2`, and `src/lib/attribution.ts` defines no request builder.
6. `git status --short ../backend` prints nothing.

**Planner-run** (coders skip this and write "browser checks left for the Planner" under Not done):

7. `SMOKE_WAIT_MS=12000 node contracts/tools/smoke-render.mjs risk "Attribution"` shows `SUB-TAB CLICKED: true` and no `EXCEPTION:` line.
   - Once migration 0010 is applied and the factors have loaded, PAGE TEXT contains `Attribution Summary`, `Factor Loadings (Fama-French 3)`, `Return Contribution Breakdown` and `factor data through`.
   - Before that, it shows the 503 message instead.
   - `risk "Performance"`, `risk "Health"` and `risk "Scenarios"` still render.

`BLOCKED` is a valid outcome. Report any deviation.

## Human verification — Gunnar

1. **Risk & Perf → Attribution** loads by itself. The summary reads as plain English, and its numbers match the breakdown rows.
2. The six breakdown rows add up to the total, give or take rounding. A negative row's bar points left in red.
3. On BEC the cash warning shows under the summary, and the footnote says "factor data through 2026-08-31" (or later).
4. Set End to today. The window still ends at the factor date, and a warning says why.
5. Switch the theme: bars and text stay readable in both.

## Open questions

None.
