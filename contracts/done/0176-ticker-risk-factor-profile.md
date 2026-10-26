# Contract 0176 — Ticker page: Risk & Factor Profile section (frontend only)

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

After this contract, `/ticker/:symbol` ends with a **Risk & Factor Profile** section for that
ticker on its own, compared with SPY. It has:
- a window switch (1Y / 3Y / 5Y, default 3Y);
- the metrics table that Risk & Performance → Performance uses: CAGR, vol, Sharpe, max drawdown, beta and alpha;
- a rolling 63-day volatility chart;
- the Fama-French 3 loadings with t-stats, plus a one-paragraph factor summary.

## Why

Gunnar, 2026-10-26: Asset Research is dropped as a Research pill. Its ticker-only content moves to the
ticker page, where any ticker can be looked up, not just holdings. `main`'s portfolio-relative parts
are dropped: the "Portfolio Role" classifier and the correlation-vs-holdings chart. Compare
Optimizers' heatmap already covers correlation.

**No new backend, and no new statistics beyond a rolling standard deviation.** A single ticker at
weight 1 with cash 0 is a valid request to the existing `POST /portfolio/performance` and
`POST /portfolio/attribution`. The numbers therefore come from the same engines, already checked on
real data, as the portfolio tabs.

**Departures from `main`:**
- **Sortino, Calmar and up/down capture are not ported.** Calmar is CAGR ÷ |max DD|, both of which are already shown. The others would need backend math for a marginal gain. Gunnar can ask for them later.
- **The default window is 3Y.** The chart and the portfolio tabs default to 1Y. But one stock's SMB and HML loadings over one year are usually indistinguishable from zero, and this section is the long-horizon view.
- **Loadings without ★ are called out in plain words**, not just marked by a missing star.

## Files

Create:
- `frontend/src/lib/tickerProfile.ts`: pure helpers.
- `frontend/src/lib/tickerProfile.test.ts`
- `frontend/src/pages/ticker/RiskProfileSection.tsx`

Modify:
- `frontend/src/lib/attribution.ts`: `attributionSummary(r, subject = 'The portfolio')`. Use the subject in the first sentence in place of the literal `The portfolio`. Nothing else changes.
- `frontend/src/lib/performance.ts`: `performanceRows(response, subject = 'the portfolio')`. Use the subject in the Beta tooltip in place of the literal `the portfolio`. Nothing else changes.
- `frontend/src/lib/attribution.test.ts` and `frontend/src/lib/performance.test.ts`: add one test each for the subject argument. Do not edit existing tests.
- `frontend/src/pages/TickerPage.tsx`: render `<RiskProfileSection symbol={symbol} firstBarDate={…} />` as the **last** child of the non-`unknownTicker` fragment, after the Signal States section.
  - `firstBarDate` is `undefined` while `history.status === 'loading'`.
  - It is `bars[0]?.date ?? null` when history is ready.
  - It is `null` when history errored.

  Change nothing else in that file.

**Touch nothing else.** No backend file. If the work appears to require one, stop and report `BLOCKED`.

## Interface

### `lib/tickerProfile.ts`

```ts
export type ProfileYears = 1 | 3 | 5
export const PROFILE_YEARS: readonly ProfileYears[] = [1, 3, 5]
export const DEFAULT_PROFILE_YEARS: ProfileYears = 3
export const ROLLING_VOL_DAYS = 63

export function profileWindowStart(years: ProfileYears, today: string, firstBarDate: string | null): { start: string; clamped: boolean }
export function profileRequest(symbol: string, start: string): PerformanceRequest
export function rollingVol(path: StressPointOut[], window?: number): { date: string; value: number }[]
```

- **`profileWindowStart`**: `today` and `firstBarDate` are ISO `YYYY-MM-DD` strings.
  - The candidate is the same month and day, `years` earlier: `${Number(today.slice(0, 4)) - years}${today.slice(4)}`. If that is `YYYY-02-29` and the year isn't a leap year, use `YYYY-02-28`.
  - If `firstBarDate !== null` and `firstBarDate > candidate` (plain string comparison), return `{ start: firstBarDate, clamped: true }`. Otherwise return `{ start: candidate, clamped: false }`.
  - **Why the clamp:** `run_stress` counts a holding as covered only when its prices start on or before the window start. A single young ticker would otherwise get a 422 that talks about "invested money".
- **`profileRequest`** returns `{ tickers: [symbol], weights: [1], cash: 0, start, end: null, market_ticker: 'SPY' }`.
- **`rollingVol`**:
  - The daily return at `i ≥ 1` is `path[i].value / path[i - 1].value - 1`.
  - For each `i ≥ window`, emit `{ date: path[i].date, value }`. `value` is the **sample** standard deviation (n − 1) of returns `i − window + 1 … i`, times `√252`.
  - The default window is `ROLLING_VOL_DAYS`. Return `[]` when `path.length <= window`.

### `RiskProfileSection.tsx`

Props: `{ symbol: string; firstBarDate: string | null | undefined }`.

- **State:** the selected years (default `DEFAULT_PROFILE_YEARS`), and one run state each for performance and attribution: `running`, `error` with a message, or `ready` with the response.
- **Requests:**
  - While `firstBarDate === undefined`, render the section with `Loading…` and send nothing.
  - Otherwise compute `profileWindowStart(years, <today ISO>, firstBarDate)`. Fire `performancePortfolio(profileRequest(…))` and `attributionPortfolio(profileRequest(…))` in parallel.
  - Re-fire both when `symbol`, `years` or `firstBarDate` change. Ignore late responses with a `cancelled` flag in the effect cleanup, as `TickerPage` does.
  - Error text is `error.message` when `error instanceof Error`, otherwise `The request failed.`
- **SeriesChart** is lazy-imported, as in `TickerPage`, with a `Loading chart…` Suspense fallback.

Layout: one `bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4` section, `space-y-4`:

1. **Header row.** An `h2` `Risk & Factor Profile` (text-sm, semibold) wrapped in a Tooltip. On the right, three window buttons `1Y` `3Y` `5Y` with `aria-pressed`. The selected one is `bg-btn-action text-btn-action-text`; the others are bordered and muted.
2. **Window line.** Muted `text-xs`, showing `performanceSummary(response)` once performance is ready. When `clamped`, add a second line: `{symbol} has stored prices only from {start}, so the window starts there.`
3. **Metrics table.** Same markup and tone classes as `PerformanceResults` in `pages/analysis/risk/PerformanceSection.tsx`. Columns: `Metric`, `{symbol}`, `{market_ticker}`, `Diff`. Rows come from `performanceRows(response, symbol)`. Copy the `tone` map from `PerformanceSection.tsx` instead of exporting it.
4. **Rolling volatility.**
   - `SeriesChart` with `title={`${symbol} — Rolling 63-day volatility`}`, `valueName="Volatility"`, `points={rollingVol(response.path)}`, and `formatValue={(v) => `${(v * 100).toFixed(1)}%`}`.
   - With no points, show the muted line `Not enough history in this window for a 63-day rolling volatility.`
5. **Factor loadings.**
   - An `h3` `Factor Loadings (Fama-French 3)` wrapped in the **same** Tooltip copy as AttributionSection's heading.
   - One row per `loadingRows(response)` entry: label (muted), `betaText` (font-mono) and `tText` (muted), in a `grid grid-cols-[10rem_4rem_6rem] gap-3 text-xs`. No bar track.
   - If any row has `significant === false`, add a muted `text-xs` line: `Loadings without ★ can't be told apart from zero over this window. Treat them as noise, not a tilt.`
   - Then `attributionSummary(response, symbol)` (text-sm), `attributionFootnote(response)` (muted text-xs), and each attribution warning (muted text-xs).
6. **Errors.** Each request's error shows in `text-xs text-brand-negative` in place of its own parts: performance covers 2–4; attribution covers 5. One failing never hides the other. Performance warnings show as muted `text-xs` lines under the table.

While a request is running, its parts show a muted `Loading…`.

## Out of scope

- Any backend change. Any new metric (Sortino, Calmar, capture ratios). The contribution breakdown bars.
- Tying this window to the chart's Start/End inputs.
- A benchmark picker. SPY only.
- Correlation, "role", or anything that needs a portfolio.
- Changing `PerformanceSection.tsx` or `AttributionSection.tsx`.
- New dependencies.

## Tooltips

Use `Tooltip` from `components/Tooltip`, never `title` (SeriesChart's `title` prop is fine). Wrap exactly
one element per Tooltip.

| element | tooltip |
|---|---|
| `Risk & Factor Profile` heading | `This ticker alone, bought at the start of the window and held, compared with SPY. Same engine as the portfolio Performance and Factor Attribution tabs.` |
| `1Y` | `Trailing 1 year` |
| `3Y` | `Trailing 3 years. More data, so steadier factor loadings` |
| `5Y` | `Trailing 5 years` |
| loadings heading | copy AttributionSection's heading tooltip verbatim |

## Acceptance criteria

`BLOCKED` is the right answer to a criterion that cannot be satisfied as written.

`tickerProfile.test.ts`:

1. `profileWindowStart(3, '2026-10-26', '2010-01-04')` → `{ start: '2023-10-26', clamped: false }`.
2. `profileWindowStart(5, '2026-10-26', '2024-03-01')` → `{ start: '2024-03-01', clamped: true }`.
3. `profileWindowStart(1, '2028-02-29', null)` → `{ start: '2027-02-28', clamped: false }`.
4. `profileRequest('MS', '2023-10-26')` deep-equals `{ tickers: ['MS'], weights: [1], cash: 0, start: '2023-10-26', end: null, market_ticker: 'SPY' }`.
5. `rollingVol` of a 6-point path whose values are `100` multiplied in turn by `1.01, 0.99, 1.01, 0.99, 1.01`, with window `4`:
   - returns 2 points, dated the 5th and 6th path dates;
   - each value is `toBeCloseTo(0.01 * Math.sqrt(4 / 3) * Math.sqrt(252), 6)`.
6. `rollingVol` of a path whose value grows by exactly 1% a day gives values `toBeCloseTo(0, 10)`.
7. `rollingVol` with `path.length === window` returns `[]`.

Shared libs:

8. `attributionSummary(R, 'MS')` starts with `MS returned`. `attributionSummary(R)` is unchanged, so the existing test still passes.
9. The Beta row tooltip from `performanceRows(RESPONSE, 'MS')` contains `How much MS moved`. Existing tests pass unchanged.

Global:

10. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
11. `cd frontend && npm run test` passes, with **403 + the tests you added** in **29** files. Report both numbers.
12. `cd frontend && npm run build` exits 0.
13. `cd frontend && npm run lint` shows the same 2 known warnings and nothing new.
14. `grep -n ' title=' frontend/src/pages/ticker/RiskProfileSection.tsx | grep -v SeriesChart` prints nothing.
15. `git diff frontend/src/pages/TickerPage.tsx` shows only the import and the one `<RiskProfileSection …/>` element, plus the `firstBarDate` expression if you hoisted it.
16. `git diff frontend/src/lib/attribution.ts frontend/src/lib/performance.ts` shows only the added parameter and the two substituted strings.
17. Format, then check for collapse. Run `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write` on each **created** file. Then `awk 'length > 300 {print FILENAME": "FNR}'` over them must print nothing. If `/tmp/prettier3` is missing, report it; do not hand-reformat.
18. List every created and modified file in the report. Created files are untracked; check them with `git status --short`, not `git diff`.

**Planner-run** (coders skip these, and write "browser checks left for the Planner" under Not done):

19. Against a stub API: the section renders the table, the chart, the loadings and the summary with no `EXCEPTION:`.
    - Switching to 1Y re-requests with a later `start`.
    - A stubbed 422 on attribution shows its message without hiding the table.

## Human verification — does Gunnar need to run anything?

Yes. Frontend only, so restart nothing. Open a few tickers in both themes:
- **MS:** the numbers should be close to what you'd expect for a large bank. Beta should be above 1.
- **SPY:** beta should be exactly 1.00, and every Diff should be 0.
- **A young listing, or a bond or gold fund:** check that the "stored prices only from" note appears or not as you'd expect, and that the loadings read sensibly.

Is 3Y the right default?

## Open questions — do not resolve yourself

- None known. If `/portfolio/attribution` or `/portfolio/performance` rejects a one-ticker request, stop and report `BLOCKED` with the response.
