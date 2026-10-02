# Contract 0150 — Forecast tab: settings, charts, results and guide

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Replace the "Forecast — not built yet" placeholder in Forward Models with a working tab. It calls
`POST /portfolio/forecast` (built in 0149) and shows:
- a value chart: recent history, then the forecast fan;
- a volatility chart: realised volatility, then the forecast volatility;
- the terminal values, the ensemble member medians and the fitted parameters;
- a help guide.

It also includes two small backend items, task 0: four assertions 0149 dropped, and a `day`
offset on the history points so the charts can share one x-axis.

Prophet is not part of this contract (0151).

## Why

`REBUILD.md` → Outlook → "Forecast: five methods, fixed rather than ported". The backend is
accepted (see `contracts/done/0149-forecast-backend.md`, including the audit).

The tab is only worth having if the reader can see what Monte Carlo can't show: the forecast
volatility **now** compared with the lookback average, and how fast it reverts. That's why the
volatility chart and the summary line come first, not as extras.

## Read first

- `frontend/src/pages/analysis/outlook/MonteCarloSection.tsx`: the tab to model this one on, for
  layout, state, the run button, the "settings changed" note and the error display.
- `frontend/src/lib/monteCarlo.ts` and `monteCarlo.test.ts`
- `frontend/src/components/MonteCarloChart.tsx`
- `frontend/src/lib/monteCarloGuide.ts`, `monteCarloGuide.test.ts` and
  `pages/analysis/outlook/MonteCarloGuide.tsx`
- `frontend/src/pages/analysis/OutlookPage.tsx`
- `backend/app/forecast_run.py` and `backend/tests/test_forecast_run.py`

## Files

Create:
- `frontend/src/lib/forecast.ts` and `frontend/src/lib/forecast.test.ts`
- `frontend/src/lib/forecastGuide.ts` and `frontend/src/lib/forecastGuide.test.ts`
- `frontend/src/components/ForecastChart.tsx` (value) and
  `frontend/src/components/VolatilityChart.tsx`
- `frontend/src/pages/analysis/outlook/ForecastSection.tsx`
- `frontend/src/pages/analysis/outlook/ForecastGuide.tsx`

Modify:
- `frontend/src/api/client.ts`: the forecast types and `forecastPortfolio()`.
- `frontend/src/lib/monteCarlo.ts`: widen three parameter types only (see Reuse).
- `frontend/src/pages/analysis/OutlookPage.tsx`
- `backend/app/forecast_run.py`, `backend/app/schemas.py` and
  `backend/tests/test_forecast_run.py`: task 0 only.

**Touch nothing else.** In particular, don't edit `MonteCarloSection.tsx`, `MonteCarloChart.tsx`
or any Monte Carlo test. `README.md` and `REBUILD.md` belong to the planner. The working tree
already contains Gunnar's uncommitted tab renames ("Historical Optimize", "Forward Models") in
`README.md`, `AnalysisLayout.tsx`, `HoldingsPage.tsx` and `OutlookPage.tsx`. Keep them; don't
revert them.

## Task 0 — backend

1. **`day` offsets.** Add `day: int` to `HistoryPoint` and `VolPoint` in `forecast_run.py`, and to
   `ForecastHistoryPointOut` and `ForecastVolPointOut` in `schemas.py`.
   - `day` is the return's position relative to the last return: `index − (n_returns − 1)`. The
     last return is day `0` and the first is `−(n_returns − 1)`.
   - For `vol_history`, use the position of the rolling window's **end** in `x`.
2. **Restore 0149's dropped assertions** in `test_forecast_run.py`. Add them to the existing test
   functions; don't add new functions:
   - in `test_regime_and_ensemble`:
     - replace the chained comparison with two separate assertions: `garch.vol_forecast[-1].vol < garch.current_vol` and `garch.vol_forecast[-1].vol > garch.lookback_vol`;
     - add `assert abs(arima.lookback_vol - 0.144) < 0.005`;
     - add `assert min(ensemble.member_medians.values()) - 5 <= ensemble.terminal.median <= max(ensemble.member_medians.values()) + 5`;
   - in `test_minimum_determinism_warning_validation_and_history`:
     - `assert all(a.date < b.date for a, b in zip(result.history, result.history[1:]))`
     - `assert result.history[-1].day == 0` and `result.history[0].day == -259`, because `C` has
       260 returns and the first one is always kept;
     - `assert result.vol_history[-1].day == 0` and `result.vol_history[0].day == -239`, because
       the 21-day window first ends at index 20 of 260.

## Reuse in `lib/monteCarlo.ts`

Widen these types only. No behaviour change, and every existing Monte Carlo test must pass
unchanged:
- **`buildMonteCarloRequest`:** its `settings` parameter becomes
  `Omit<MonteCarloSettings, 'model'> & { model: string }`.
- **`terminalRows`:** its parameter becomes `Pick<MonteCarloResponse, 'terminal' | 'initial_value'>`.
- **`fanChartData`:** its parameter becomes `Pick<MonteCarloResponse, 'paths'>`.

Forecast then reuses `buildMonteCarloRequest`, `sameMonteCarloRequest`, `terminalRows`,
`fanChartData`, `defaultStartingValue`, `HORIZON_OPTIONS` and `MONTE_CARLO_LOOKBACK_FLOOR` rather
than copying them.

## `api/client.ts`

```ts
export type ForecastRequest = MonteCarloRequest
export interface ForecastVolPoint { date: string; day: number; vol: number }
export interface ForecastVolForecastPoint { day: number; vol: number }
export interface ForecastHistoryPoint { date: string; day: number; value: number }
export interface ForecastResponse {
  tickers: string[]; weights: Record<string, number>; cash_weight: number; model: string; seed: number
  horizon_days: number; num_simulations: number; initial_value: number; lookback_days: number
  fit_start: string; fit_end: string; n_returns: number; daily_drift: number
  current_vol: number; lookback_vol: number; params: Record<string, number>
  members: string[]; member_medians: Record<string, number>
  paths: MonteCarloPathPoint[]; terminal: MonteCarloTerminal
  vol_forecast: ForecastVolForecastPoint[]; vol_history: ForecastVolPoint[]; history: ForecastHistoryPoint[]
  warnings: string[]
}
export async function forecastPortfolio(body: ForecastRequest): Promise<ForecastResponse>   // POST /portfolio/forecast
```

## `lib/forecast.ts`

```ts
export type ForecastModel = 'ewma' | 'garch' | 'arima' | 'ensemble'
export const FORECAST_MODELS: ReadonlyArray<{ value: ForecastModel; label: string; tooltip: string }> = [
  { value: 'ewma', label: 'EWMA', tooltip: 'Volatility from recent days, weighted toward the latest. Stays at today’s level for the whole horizon.' },
  { value: 'garch', label: 'GARCH', tooltip: 'Volatility starts at today’s level and drifts back toward the lookback average.' },
  { value: 'arima', label: 'ARIMA', tooltip: 'Constant volatility at the lookback average. The baseline that ignores current conditions.' },
  { value: 'ensemble', label: 'Ensemble', tooltip: 'Pools paths from EWMA, GARCH and ARIMA in equal shares.' },
]
export interface ForecastSettings { lookbackDays: number; model: ForecastModel; horizonDays: number; simulationsText: string }
export const DEFAULT_FORECAST_SETTINGS: ForecastSettings = { lookbackDays: 1825, model: 'garch', horizonDays: 252, simulationsText: '1000' }

export function formatVol(vol: number): string                 // 0.16118 → "16.1%"
export function forecastSummary(response: ForecastResponse): string
export function volatilitySummary(response: ForecastResponse): string
export interface ValuePoint { day: number; history?: number; outer?: [number, number]; inner?: [number, number]; median?: number }
export function valueChartData(response: ForecastResponse): ValuePoint[]
export interface VolChartPoint { day: number; realised?: number; forecast?: number }
export function volChartData(response: ForecastResponse): VolChartPoint[]
export function memberMedianRows(response: ForecastResponse): Array<{ label: string; value: number; change: number }>
export function paramRows(response: ForecastResponse): Array<{ label: string; value: string }>
export function forecastCsv(response: ForecastResponse): string
export function forecastCsvFilename(portfolioName: string, now: Date): string
```

Rules:

- **`forecastSummary`:** `"{N} {Label} paths over {h} trading days from {money}. Fitted {fit_start} to {fit_end} ({n} daily returns, {lookbackLabel} lookback). Seed {seed}, so the same settings give the same result."`
  - Label is the `FORECAST_MODELS` label, and `N` uses `toLocaleString('en-US')`.
  - It's the same shape as `monteCarloSummary`.
- **`volatilitySummary`:** `"Forecast volatility today: {formatVol(current_vol)} a year, against {formatVol(lookback_vol)} over the lookback."`
  - If `params['half_life_days']` exists (GARCH) or `params['garch.half_life_days']` exists
    (Ensemble), append `" GARCH expects volatility to close half the gap in about {round} trading days."`.
  - If `current_vol === 0`, use only `"These returns have no variation, so every path is the same."`.
- **History window:** both charts show history only for `day >= -horizon_days`. The past is shown
  over the same length as the future.
- **`valueChartData`:**
  - history points with `day < 0` in that window give `{ day, history: value }`;
  - every fan point gives `{ day, outer, inner, median }`, mapped like `fanChartData`;
  - day `0` also gets `history: initial_value`, so the two parts join;
  - sort ascending by `day`.
- **`volChartData`:**
  - `vol_history` points in the window give `{ day, realised }`;
  - every `vol_forecast` point gives `{ day, forecast }`;
  - if both exist on the same day, merge them into one object (day 0);
  - sort ascending.
- **`memberMedianRows`:**
  - in `members` order, `{ label: FORECAST_MODELS label, value: member_medians[m], change: value / initial_value − 1 }`;
  - return `[]` unless `members.length > 1`.
- **`paramRows`:** map keys to labels, in the order the backend sends them. Format numbers with
  `toPrecision(4)`, except `lambda` and `persistence`, which use `toFixed(2)`, and
  `half_life_days`, which uses `toFixed(1)` + `" days"`. The labels are:

  | Key | Label |
  |---|---|
  | `lambda` | Decay (λ) |
  | `omega` | ω |
  | `alpha` | α (reaction) |
  | `beta` | β (persistence of variance) |
  | `persistence` | α + β |
  | `half_life_days` | Half-life |
  | `c` | Constant (c) |
  | `phi` | φ (autocorrelation) |
  | `sigma` | σ (daily) |

  - An ensemble key `garch.alpha` becomes `"GARCH α (reaction)"`, i.e. the member label, a space,
    then the base label.
  - An unknown key shows the key itself.
- **`forecastCsv`:** header `day,p5,p25,p50,p75,p95,vol`. One row per `paths` point, with `vol`
  from the `vol_forecast` point on the same day. Use `csvNumber(value, 2)` for money and
  `csvNumber(vol, 6)` for vol.
- **`forecastCsvFilename`:** `{safe name}-forecast-{YYYY-MM-DD}.csv`. Use the same helpers as
  `monteCarloCsvFilename`.

## Charts

**`ForecastChart.tsx`** is the default export. Its props are `{ data: ValuePoint[]; initialValue; size }`.
Copy `MonteCarloChart`'s structure and styles:
- `XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']}`, with the label
  `"Trading days from the last close"`;
- the same two `Area` bands, the median `Line` and the dashed starting-value `ReferenceLine`;
- a `ReferenceLine x={0}`;
- a `Line dataKey="history" name="History"` in `var(--color-muted)`, solid, with `connectNulls`.

**`VolatilityChart.tsx`** is the default export. Its props are `{ data: VolChartPoint[]; lookbackVol: number; size }`:
- the same X axis;
- a Y axis with `tickFormatter={formatVol}`;
- `Line realised`, named `"Realised (21-day)"`, in `var(--color-muted)`;
- `Line forecast`, named `"Forecast"`, in `var(--color-primary)`;
- both lines with `connectNulls` and `dot={false}`;
- a dashed `ReferenceLine y={lookbackVol}` labelled `"Lookback average"`;
- `ReferenceLine x={0}`;
- a legend and a tooltip using `formatVol`.

Both charts are `lazy()`-loaded in `ForecastSection`, as `MonteCarloChart` is, and wrapped in
`ExpandableChart`.

## `ForecastSection.tsx`

Copy `MonteCarloSection`'s structure: the universe load, the trade basis, the starting value, the
run state, the "settings changed" note, the errors and the guide button.

**Differences:**
- **Header:** "Forecast settings". The help tooltip is "What the forecast models do and how each
  setting works".
- **Model picker:** four buttons from `FORECAST_MODELS`, in a `grid-cols-4`, each with its
  tooltip.
- **Lookback option tooltip:** "Fit the model to the last N years of daily returns".
- **Run button:** "Run forecast"; while running, "Forecasting…". The fallback error message is
  "The forecast request failed.".
- **Results, in this order:**
  1. **The summary card:**
     - `forecastSummary`, the changed note and the warnings, as in Monte Carlo;
     - then `volatilitySummary`;
     - then "Chance of ending below the starting value: X%".
  2. **The value chart card.** Caption: "Grey is the portfolio’s value over the same length of
     past, scaled to end at the starting value. The dark band holds the middle half of the paths,
     the light band 90%, and the line is the median. A model forecast, not a prediction."
  3. **The volatility chart card.** Caption: "Grey is the realised volatility over each past 21
     trading days. The line after day 0 is the model’s forecast, annualized. The dashed line is
     the lookback average."
  4. **Terminal values:** the same table as Monte Carlo, with Export CSV using `forecastCsv`.
  5. **Ensemble members:** only when `memberMedianRows` is non-empty. It's a table with Member,
     Median ending value and Change, and the caption "Each member’s own median. The ensemble’s
     bands pool all members’ paths."
  6. **Fitted parameters:** a two-column table from `paramRows`, shown only when it's non-empty.

## `OutlookPage.tsx`

- Render `<ForecastSection />` for the forecast tab.
- Delete the placeholder branch and the `placeholder` variable.
- Change the forecast tab's tooltip to "Project this portfolio with volatility forecasting models".
- Keep everything else, including Gunnar's renames.

## Guide — `lib/forecastGuide.ts`

`FORECAST_SETTING_TERMS = ['Lookback', 'Model', 'Horizon', 'Simulations', 'Starting value'] as const`.

`FORECAST_GUIDE: GuideSection[]` uses this copy **verbatim**: headings, order, terms and text.
`ForecastGuide.tsx` is `MonteCarloGuide.tsx` with its title, data and name changed. It must
contain the literal `title="Forecast guide"`.

**What this does**
- P: "The forecast simulates many possible paths for this portfolio’s value, like Monte Carlo, but
  lets volatility depend on how markets have behaved recently. After a calm stretch the bands are
  narrow; after a turbulent one they widen straight away."
- P: "Every model uses the same expected daily return: the average daily return over the lookback.
  The models differ only in how they forecast volatility. Nothing is applied to the portfolio."

**The models**
- P: "The holdings’ daily returns over the lookback are combined into one series for the portfolio
  at its current weights, as in Monte Carlo. Each model is fitted to that series, then simulates
  paths from a fixed seed (42), so the same settings always give the same result."
- E "EWMA": "Exponentially weighted volatility. Each past day counts 6% less than the next one, so
  the last few weeks dominate. The forecast volatility stays at today’s level for the whole
  horizon, so after a turbulent month EWMA gives the widest bands."
- E "GARCH": "GARCH(1,1). Volatility starts at today’s level and drifts back toward the lookback
  average at a speed fitted to this portfolio’s history; the half-life in Fitted parameters says
  how fast. This is the standard model for volatility that clusters. It needs at least 250 shared
  daily returns."
- E "ARIMA": "A constant-volatility baseline. It allows for a small day-to-day carry-over in
  returns, but its volatility is the lookback average throughout, whatever the market is doing
  now. When ARIMA’s bands are much narrower than GARCH’s or EWMA’s, current conditions are
  rougher than average, not calmer."
- E "Ensemble": "Pools paths from EWMA, GARCH and ARIMA in equal shares, so its bands sit between
  theirs. If a member can’t be fitted, the ensemble uses the others and a note says so. It needs
  at least 250 shared daily returns."

**Settings**
- E "Lookback": "The window of daily returns the model is fitted to: 1, 3 or 5 years, or a custom
  start date at least 3 months ago. It sets the expected return and, for GARCH and ARIMA, the
  average volatility the forecast settles at. GARCH and Ensemble need about a year."
- E "Model": "EWMA, GARCH, ARIMA or Ensemble. See The models."
- E "Horizon": "How far ahead each path runs: 3 months (63 trading days), 6 months (126), 1 year
  (252) or 2 years (504)."
- E "Simulations": "How many paths to simulate, from 100 to 10,000. More paths give smoother
  percentiles. They don’t make the model more accurate."
- E "Starting value": "The portfolio value on day 0. It defaults to the holdings at their last
  close plus cash, or a hypothetical $10,000 if the holdings have no share counts or prices.
  Changing it scales every result in proportion."

**Short history**
- P: "Every holding needs a price on every day the model uses. If a holding’s prices start more
  than a week after the lookback start, the model uses only the days from that holding’s first
  price onward, and a note under the results says so. EWMA and ARIMA need at least 60 shared daily
  returns; GARCH and Ensemble need 250."

**Reading the results**
- E "Volatility today": "The model’s annualized volatility for the next trading day, against the
  lookback average. A large gap means recent markets have been unusually calm or unusually rough."
- E "Value chart": "Grey is the past, scaled so it ends at the starting value. After day 0, the
  dark band holds the middle half of the paths and the light band 90% of them; the line is the
  median."
- E "Volatility chart": "Grey is the realised volatility over each past 21 trading days. After
  day 0 the line is the model’s forecast. EWMA and ARIMA forecast a flat line; GARCH curves back
  toward the dashed lookback average."
- E "Terminal values": "Where the paths end at the horizon: the 5th, 25th, 75th and 95th
  percentiles, the median and the mean, each with its change from the starting value."
- E "Ensemble members": "Each member’s own median ending value. A wide spread between them means
  the choice of model matters for this portfolio."
- E "Fitted parameters": "The numbers each model was fitted with. For GARCH, α is how strongly
  one day’s move raises the next day’s volatility, α + β is how long that lasts, and the
  half-life is the number of trading days for half of today’s gap to the average to close."
- E "Export CSV": "Downloads the percentile paths and the forecast volatility for each day shown."

**Limits of the models**
- P: "The expected return is the lookback’s average. After a strong five years every model
  projects strong growth; the models forecast volatility, not returns."
- P: "Daily returns are drawn from a bell curve, so extreme days are rarer than in real markets.
  The weights are held fixed, and taxes, fees, trading costs, deposits and withdrawals are not
  included."
- P: "These models have not yet been checked against what actually happened. A calibration test
  is planned."

Mirror `monteCarloGuide.test.ts` in `forecastGuide.test.ts`: four tests (settings order, complete
copy, horizon days, section order). The section order is `['What this does', 'The models',
'Settings', 'Short history', 'Reading the results', 'Limits of the models']`. Add a fifth test:
the "The models" entry terms equal `FORECAST_MODELS.map(m => m.label)`.

## Tests — `lib/forecast.test.ts`

Use one literal `RESPONSE: ForecastResponse` fixture with:
- `model: 'ensemble'`, `initial_value: 1000`, `horizon_days: 2`, `n_returns: 300`;
- `current_vol: 0.25`, `lookback_vol: 0.16118`;
- `paths` at days 0, 1 and 2;
- `vol_forecast` at days 0, 1 and 2: 0.25, 0.25 and 0.24;
- `vol_history` at days −3, −2, −1 and 0: 0.2, 0.21, 0.22 and 0.23;
- `history` at days −4, −2 and 0: 900, 950 and 1000;
- `members ['ewma','garch','arima']` with medians 1010, 1000 and 1005;
- `params { 'ewma.lambda': 0.94, 'garch.alpha': 0.0919491, 'garch.half_life_days': 24.372, 'arima.phi': 0.0036814 }`.

Test:
1. **`formatVol(0.16118)`** is `"16.1%"`.
2. **`volatilitySummary(RESPONSE)`** is exactly `"Forecast volatility today: 25.0% a year, against 16.1% over the lookback. GARCH expects volatility to close half the gap in about 24 trading days."`.
   - With `params: {}` it ends after "lookback.".
   - With `current_vol: 0` it is the no-variation sentence.
3. **`valueChartData`:**
   - it drops day −4, because it's outside `-horizon_days`;
   - day −2 has only `history: 950`;
   - day 0 has both `history: 1000` and the fan fields;
   - the days are `[-2, 0, 1, 2]`.
4. **`volChartData`:**
   - days are `[-2, -1, 0, 1, 2]`;
   - day 0 is `{ day: 0, realised: 0.23, forecast: 0.25 }`;
   - day −2 has no `forecast` key.
5. **`memberMedianRows`:** labels `['EWMA','GARCH','ARIMA']` and the first change ≈ 0.01. With
   `members: ['garch']` it's `[]`.
6. **`paramRows`** gives exactly:
   - `[{label:'EWMA Decay (λ)',value:'0.94'}`
   - `{label:'GARCH α (reaction)',value:'0.09195'}`
   - `{label:'GARCH Half-life',value:'24.4 days'}`
   - `{label:'ARIMA φ (autocorrelation)',value:'0.003681'}]`
7. **`forecastCsv`:** the header plus 3 rows, and the day-2 row ends in `,0.240000`.
8. **`forecastCsvFilename('My: Fund', new Date(2026, 9, 2))`** is `'My Fund-forecast-2026-10-02.csv'`.
   This is the same safe-name form as `monteCarloCsvFilename`.
9. **`forecastSummary(RESPONSE)`** starts with `"1,000 Ensemble paths over 2 trading days from "`
   (or whatever `num_simulations` the fixture uses) and contains `"Seed 42"`.

## Out of scope

- Prophet.
- Calibration.
- Any change to Monte Carlo's UI or behaviour.
- The Monte Carlo X-axis tick crowding.
- A shared settings component between the two tabs. The duplication is accepted for now.

## Acceptance criteria

Run them in bash from the repo root.

1. **Backend tests:** `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)` passes.
   - Before: 727.
   - After: the same count, because task 0 adds assertions, not test cases.
   - Paste both lines.
2. **Frontend tests:** `(cd frontend && npx vitest run)` passes. Paste the before and after
   summaries. After = before + the number of tests you added; state that number. The baseline is
   about 292, but run it yourself.
3. `(cd frontend && npx tsc -p tsconfig.app.json --noEmit)` prints nothing.
4. `(cd frontend && npm run lint)` shows no new problems. The two known warnings are in
   HelpSidebar and UniversePage.
5. `(cd frontend && npm run build)` succeeds, and
   `grep -l ResponsiveContainer frontend/dist/assets/index-*.js` prints nothing: the charts stay
   lazy.
6. **No collapsed TSX:**
   `awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/analysis/outlook/ForecastSection.tsx frontend/src/components/ForecastChart.tsx frontend/src/components/VolatilityChart.tsx`
   prints nothing.
7. `grep -c 'title="Forecast guide"' frontend/src/pages/analysis/outlook/ForecastGuide.tsx` prints
   `1`.
8. `grep -n "not built yet" frontend/src/pages/analysis/OutlookPage.tsx` prints nothing, and
   `grep -n "Forward Models" frontend/src/pages/analysis/OutlookPage.tsx` still prints a line.
9. `git diff --stat -- frontend/src/pages/analysis/outlook/MonteCarloSection.tsx frontend/src/components/MonteCarloChart.tsx frontend/src/lib/monteCarlo.test.ts`
   prints nothing.

`BLOCKED` is the right answer to a criterion that cannot be satisfied. If a literal expected value
in the tests doesn't reproduce from the stated rules, report your value and stop. **Don't bend the
rule to hit the number.** Report any deviation from this contract under Deviations, even one you
think is harmless.

## Verification to run and paste

Paste the complete, verbatim output.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)                       # before AND after
(cd frontend && npx vitest run 2>&1 | tail -5)                                      # before AND after
(cd frontend && npx tsc -p tsconfig.app.json --noEmit)
(cd frontend && npm run lint 2>&1 | tail -8)
(cd frontend && npm run build 2>&1 | tail -5)
grep -l ResponsiveContainer frontend/dist/assets/index-*.js
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/analysis/outlook/ForecastSection.tsx frontend/src/components/ForecastChart.tsx frontend/src/components/VolatilityChart.tsx
grep -c 'title="Forecast guide"' frontend/src/pages/analysis/outlook/ForecastGuide.tsx
grep -n "not built yet" frontend/src/pages/analysis/OutlookPage.tsx
grep -n "Forward Models" frontend/src/pages/analysis/OutlookPage.tsx
git diff --stat -- frontend/src/pages/analysis/outlook/MonteCarloSection.tsx frontend/src/components/MonteCarloChart.tsx frontend/src/lib/monteCarlo.test.ts
```

## Human verification — Gunnar, in the browser

Chrome isn't installed for agents, so this part is yours. Open a portfolio → Forward Models →
Forecast, then:
1. Run GARCH, 1 Yr. Check:
   - the summary shows a vol line;
   - the value chart has a grey past line joining the fan at day 0;
   - the volatility chart has a grey realised line, then a forecast line curving toward the dashed
     average.
2. Switch to EWMA and run it. The forecast vol line should be flat.
3. Run Ensemble. The members table and the prefixed parameters should appear.
4. Choose a custom lookback of about 4 months and run GARCH. A readable error should appear
   ("GARCH needs at least 250 daily returns…").
5. Open the guide.

## Open questions

None.

## Planner audit (2026-10-02) — REWORK 1

The report said PARTIAL. The planner checked:
- **Correct:**
  - the backend `day` offsets;
  - the four restored assertions;
  - `lib/forecast.ts`;
  - the guide copy, all 23 paragraphs and entries verbatim;
  - `OutlookPage`.
- **Below the contract:**
  - `ForecastSection` and the two charts;
  - the test coverage, with 5 of the 14 tests;
  - the formatting.

Prettier didn't hang because of the environment: plain `npx` tries the network. **With `--offline` it
runs in under 1 s.** The planner ran it on scratch copies in `/tmp`.

### Bugs and gaps to fix

1. **`getUniverse()` runs during render.** `if (prices === null) void getUniverse()` sits in the
   component body, so every render before the response arrives fires another request. Nothing
   guards against setting state after unmount, and `submit` uses the render-time `basis` instead
   of recomputing it.
2. **The results don't follow the contract or Monte Carlo's styling:**
   - both chart captions are missing;
   - `ExpandableChart` always renders `size="inline"`, so the expanded view is the small chart;
   - Terminal values are `<p>` lines, not Monte Carlo's table;
   - the Export CSV button is unstyled, with no icon and no tooltip;
   - Ensemble members and Fitted parameters are `<p>` lines joined with " · ", not tables, under
     unstyled `<h2>`s;
   - the Ensemble members caption is missing;
   - the Run button has no tooltip;
   - the Suspense fallback is unstyled.
3. **`ForecastChart`:**
   - the Y axis has no `domain={['auto', 'auto']}`, so recharts starts it at 0 and squashes the
     fan;
   - the tick formatter is full `formatMoney`, not Monte Carlo's compact dollars;
   - the tooltip has no formatter, so the band arrays print raw;
   - animation is left on.
4. **`VolatilityChart`:** animation is on, and the lookback `ReferenceLine` has no stroke colour.
5. **Tests:**
   - `forecast.test.ts` uses a partial fixture cast through `as unknown as` instead of the literal
     fixture the contract specifies.
   - Tests 3, 4, 5, 7 and 9 are missing, as are the empty-params and zero-vol cases of test 2.
   - `forecastGuide.test.ts` is missing "has complete explanatory copy" and the horizon-days test.

### What to do

1. **Rebuild `ForecastSection.tsx` from Monte Carlo.**
   - Run `cp frontend/src/pages/analysis/outlook/MonteCarloSection.tsx frontend/src/pages/analysis/outlook/ForecastSection.tsx`,
     then edit the copy. Keep its `useEffect` universe load, `mountedRef`, `RunState` union,
     `submit` (which recomputes `tradeBasis`), `runTooltip`, `Field`, the `TH`/`TD`/`NUMERIC`
     classes and the `Results` card styling.
   - Change only what "## `ForecastSection.tsx`" lists, plus these:
     - Replace the model picker with the four `FORECAST_MODELS` buttons, in `grid-cols-4`.
     - Change the run tooltips to "Forecasting…", "Loading prices…", "Add a holding to this
       portfolio to forecast it" and "Forecast this portfolio with these settings".
     - Keep the custom-lookback tooltip as "Fit the model to daily returns since a start date you
       choose, at least 3 months ago".
     - Give the Export CSV tooltip "Download the percentile paths and forecast volatility as a
       CSV", with `DownloadIcon`, exactly as Monte Carlo does.
     - Each chart card has its caption `<p className="text-xs text-[var(--color-muted)] mb-3">`,
       then `Suspense` with Monte Carlo's fallback, then
       `ExpandableChart title=… {(expanded) => <Chart … size={expanded ? 'expanded' : 'inline'} />}`.
       - Value chart title: "Forecast portfolio value".
       - Volatility chart title: "Forecast volatility".
     - Ensemble members and Fitted parameters are cards built like Terminal values:
       - an `h2 className="text-sm font-semibold"` heading;
       - for members only, the caption from the contract;
       - a `<table className="w-full text-sm">` with `TH` headers.
       - The members columns are Member, Median ending value and Change.
       - The parameters columns are Parameter and Value; both value columns use `NUMERIC`.
2. **`ForecastChart.tsx`:** copy `compactDollars` and the tooltip formatter from
   `MonteCarloChart.tsx`. Use `YAxis tickFormatter={compactDollars} domain={['auto', 'auto']}`, and
   put `isAnimationActive={false}` on every `Area` and `Line`.
3. **`VolatilityChart.tsx`:**
   - `isAnimationActive={false}` on both lines;
   - `stroke="var(--color-muted)"` on the lookback `ReferenceLine`;
   - `YAxis domain={[0, 'auto']}` (volatility does start at 0).
4. **Tests:**
   - Replace the `forecast.test.ts` fixture with the literal `RESPONSE: ForecastResponse` from
     "## Tests — `lib/forecast.test.ts`". Every field must be present, with no cast.
   - Implement tests 1–9 as specified. Then add the two missing guide tests, mirroring
     `monteCarloGuide.test.ts`.
   - Tests can be separate `it` blocks or not, but **every listed assertion must be there.**
5. **Formatting, last:** run this from `frontend/`:
   ```bash
   npx --offline --yes prettier@3 --print-width 120 --single-quote --no-semi --write \
     src/pages/analysis/outlook/ForecastSection.tsx src/pages/analysis/outlook/ForecastGuide.tsx \
     src/components/ForecastChart.tsx src/components/VolatilityChart.tsx \
     src/lib/forecast.ts src/lib/forecast.test.ts src/lib/forecastGuide.ts src/lib/forecastGuide.test.ts
   ```
   - Run it on **these eight files only.** Don't run it on any existing file.
   - If it fails, paste the error and report `BLOCKED`. Don't hand-format.

### Rework 1 acceptance

Run every check from the original Acceptance and Verification sections again, with these
changes:
- **Criterion 2:** "before" is 297, today's count. After = 297 + the number of tests added in this
  rework; state that number.
- **Criterion 6 now covers all eight new files:**
  `awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/analysis/outlook/Forecast*.tsx frontend/src/components/ForecastChart.tsx frontend/src/components/VolatilityChart.tsx frontend/src/lib/forecast*.ts`
  prints nothing.
- **Extra checks:**
  - `grep -c "getUniverse()" frontend/src/pages/analysis/outlook/ForecastSection.tsx` prints `1`,
    and `grep -n "useEffect" frontend/src/pages/analysis/outlook/ForecastSection.tsx` prints at
    least one line.
  - `grep -c "isAnimationActive={false}" frontend/src/components/ForecastChart.tsx` prints `4`.
  - `grep -c "domain={\['auto', 'auto'\]}" frontend/src/components/ForecastChart.tsx` prints `1`.
  - `grep -c "as unknown as" frontend/src/lib/forecast.test.ts` prints `0`.
  - `grep -c "<table" frontend/src/pages/analysis/outlook/ForecastSection.tsx` prints `3`.

List every deviation, even one you think is harmless.

## Planner audit (2026-10-02) — REWORK 2

**Why Rework 1 was blocked:** in the coder's sandbox, npx can't see the npm cache under `~/.npm`
(that's also why it couldn't write its log). This is not a code problem. The planner copied the
cached Prettier 3.9.9 to `/tmp/prettier3`, and checked that `node /tmp/prettier3/bin/prettier.cjs --version`
prints `3.9.9`.

The planner ran the checks the coder skipped, read-only:
- **Structure:** the Rework 1 grep checks pass (`getUniverse()` 1, `isAnimationActive` 4, the
  auto domain 1, no cast, 3 tables, `mountedRef` and expanded sizing present).
- **Tests:** 304 passed and **2 failed**, out of 306.
- **`tsc`:** 1 error.
- **Lint:** only the two known warnings.

**Fix these two things:**
1. **The CSV test** expects `/,0.240000$/`. That literal is the planner's mistake: `csvNumber`
   is `String(Number(value.toFixed(d)))`, which drops trailing zeros, so the row really ends in
   `,0.24`. Change the assertion to `expect(rows[3].endsWith(',0.24')).toBe(true)`. Don't change
   `forecastCsv`.
2. **`toStartWith`** isn't a vitest matcher. That causes the second test failure and the `tsc`
   error. Use `expect(forecastSummary(RESPONSE).startsWith('1,000 Ensemble paths over 2 trading days from ')).toBe(true)`.

**Then format:** run this from `frontend/`, on the same eight files only:
```bash
node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write \
  src/pages/analysis/outlook/ForecastSection.tsx src/pages/analysis/outlook/ForecastGuide.tsx \
  src/components/ForecastChart.tsx src/components/VolatilityChart.tsx \
  src/lib/forecast.ts src/lib/forecast.test.ts src/lib/forecastGuide.ts src/lib/forecastGuide.test.ts
```
- If `/tmp/prettier3` is missing or unreadable, report `BLOCKED` and paste the error. **Then still
  run and paste every other check**, so the planner can see the rest of the state.

**Acceptance:** everything in "Rework 1 acceptance". Vitest "before" is 304 passing with 2
failing. After should be 306 passing and 0 failing, with no tests added.

## Planner audit (2026-10-02) — ACCEPTED (Rework 2)

The planner re-ran these:
- **Frontend tests:** 306 passed.
- **Types and build:** `tsc` is clean. The build succeeds, and `index-*.js` has no
  `ResponsiveContainer`.
- **Line length:** no line in the eight new files is over 300 characters, and `ForecastSection`
  is 410 lines.
- **Results:** 3 tables.
- **Monte Carlo files:** untouched.

The guide strings are now split with `+`, so the planner bundled `forecastGuide.ts` with esbuild
and compared the **runtime** strings. All 23 match the contract verbatim. The state logic matches
`MonteCarloSection`: the effect-based universe load, `mountedRef`, and `submit` recomputing the
basis. All three captions are present.

Gunnar's browser check (the five steps under Human verification) is still outstanding.
