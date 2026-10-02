# Contract 0146 — Monte Carlo section on the Outlook tab (UI), with a per-analysis lookback floor

**Status:** accepted (browser render not yet seen; see Acceptance)
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Outlook → **Monte Carlo** stops being a placeholder. It becomes a working section on the backend
from contract 0144 (`POST /portfolio/montecarlo`).

**Settings card:**
- **Lookback:** the shared `LookbackPicker` (`Custom 1Y 3Y 5Y`), defaulting to 5Y. The custom
  dialog has a **3-month floor** for this analysis.
- **Model:** Bootstrap or Normal.
- **Horizon:** 3 Mo, 6 Mo, 1 Yr or 2 Yr.
- **Simulations:** a number, 1000 by default.
- **Starting value:** dollars.
- **Run** button.

**Results:**
- a summary line, the settings-changed note, and any warnings;
- a **fan chart** of the percentile paths;
- a terminal-value table, the chance of a loss, and a CSV export.

**Shared change:** the lookback floor becomes a parameter. Optimize and CAPM keep today's
28-day / "4 weeks" floor, unchanged. Monte Carlo passes 89 days / "3 months".

**Not in this contract:** the Help button and guide come in 0147, written from the finished
feature. Calibration and the efficient frontier are later contracts, recorded in `REBUILD.md`.

## Why

- Decided 2026-10-01: Gunnar wants the custom-date lookback on every analysis that has the
  `Custom 1Y 3Y 5Y` row, so Monte Carlo gets the same component, not a copy.
- **Why a floor of 89 days:**
  - The backend refuses fewer than 60 daily returns (`MIN_RETURNS = 60`, contract 0144). With the
    28-day floor, the dialog would offer **1 Mo**, which always fails.
  - 89 is the shortest "3 calendar months ago" span (15 Feb → 15 May in a non-leap year), so the
    **3 Mo** preset is valid on every date.
  - That's about 61 trading days. A window with two market holidays can still come up one short;
    the backend's 422 message then says exactly that. Accepted. Don't raise the floor, and don't
    touch `MIN_RETURNS`.
- **Fixing a 0145 gap:** `LookbackDialog`'s preset buttons have no `Tooltip`, though 0145 specified
  tooltip text for them. This contract touches that file, so it adds them.
- **Starting value:**
  - **Dollar basis** (shares and prices for every holding): the holdings at last close plus cash.
  - **Weights-only portfolios** have no dollar value, so the default is a hypothetical
    **10000.00**, and a note says so.
  - The request sends dollars on a dollar basis and weights otherwise. The backend only needs
    weights and cash in the same units (0144).

## Files

Create:
- `frontend/src/lib/monteCarlo.ts`: settings, validation, request builder, run comparison,
  summary, table rows, chart data, CSV.
- `frontend/src/lib/monteCarlo.test.ts`
- `frontend/src/pages/analysis/outlook/MonteCarloSection.tsx`
- `frontend/src/components/MonteCarloChart.tsx`: a lazy-loaded default export. It sits next to
  `CapmChart.tsx`, matching that convention.

Modify:
- `frontend/src/lib/optimize.ts`: the floor parameter, see Interface.
- `frontend/src/lib/optimize.test.ts`: floor tests.
- `frontend/src/components/LookbackDialog.tsx`: the `floor` prop and preset tooltips.
- `frontend/src/components/LookbackPicker.tsx`: pass `floor` through.
- `frontend/src/api/client.ts`: Monte Carlo types and `monteCarloPortfolio`.
- `frontend/src/pages/analysis/OutlookPage.tsx`: render `MonteCarloSection`, and drop
  "(not built yet)" from the Monte Carlo tab's tooltip. Forecast stays a placeholder.

Don't touch: anything under `backend/`, `OptimizePage.tsx`, `CapmSection.tsx`.

## Interface

### `lib/optimize.ts`

```ts
export interface LookbackFloor { days: number; label: string }
export const DEFAULT_LOOKBACK_FLOOR: LookbackFloor = { days: MIN_LOOKBACK_DAYS, label: '4 weeks' }
export function customLookbackError(date: string, today: Date, floor: LookbackFloor = DEFAULT_LOOKBACK_FLOOR): string | null
```

- Below the floor, the message is `` `Choose a date at least ${floor.label} ago.` ``. With the
  default floor, that's today's exact text, so existing tests must pass **unchanged**.
- The other two messages are unchanged.
- Don't change `MIN_LOOKBACK_DAYS`, `MAX_LOOKBACK_DAYS` or `presetLookbackDate`.

### `LookbackDialog` and `LookbackPicker`

Both get an optional `floor?: LookbackFloor` prop, defaulting to `DEFAULT_LOOKBACK_FLOOR`.
`LookbackPicker` passes it to `LookbackDialog`. In the dialog:

- `error` uses `customLookbackError(value, today, floor)`.
- The date input's `max` is today minus `floor.days`, not `MIN_LOOKBACK_DAYS`.
- **Any** preset whose date errors under the floor is disabled, not just YTD. Under the default
  floor that's only early-January YTD, as today. Under the Monte Carlo floor, 1 Mo is always
  disabled.
- **Initial value:** if `initialDate` is null and the 6 Mo preset errors under the floor, start
  from the 3 Mo preset. That can't happen with today's two floors; it's a guard.
- Each preset button is wrapped in `Tooltip` (see Tooltips).

### `api/client.ts`

Types mirror `backend/app/schemas.py` `MonteCarloRequest`/`MonteCarloResponse` exactly:
`MonteCarloRequest`, `MonteCarloPathPoint`, `MonteCarloTerminal`, `MonteCarloResponse`.
`fit_start`/`fit_end` are `string`.

```ts
export async function monteCarloPortfolio(body: MonteCarloRequest): Promise<MonteCarloResponse>
```

It posts to `/portfolio/montecarlo` through `request`, like `capmPortfolio`.

### `lib/monteCarlo.ts`

```ts
export type MonteCarloModel = 'bootstrap' | 'normal'
export interface MonteCarloSettings {
  lookbackDays: number      // default 1825
  model: MonteCarloModel    // default 'bootstrap'
  horizonDays: number       // default 252
  simulationsText: string   // default '1000'
}
export const DEFAULT_MONTE_CARLO_SETTINGS: MonteCarloSettings
export const MONTE_CARLO_LOOKBACK_FLOOR: LookbackFloor = { days: 89, label: '3 months' }
export const HORIZON_OPTIONS: ReadonlyArray<{ label: string; days: number }> =
  [{ label: '3 Mo', days: 63 }, { label: '6 Mo', days: 126 }, { label: '1 Yr', days: 252 }, { label: '2 Yr', days: 504 }]
export const HYPOTHETICAL_START = 10000

export function cashDollars(portfolio: Portfolio, basis: Extract<TradeBasis, { kind: 'dollar' }>): number
export function defaultStartingValue(portfolio: Portfolio, basis: TradeBasis): string
export function buildMonteCarloRequest(
  portfolio: Portfolio, settings: MonteCarloSettings, startingText: string, basis: TradeBasis,
): { ok: true; request: MonteCarloRequest } | { ok: false; message: string }
export function sameMonteCarloRequest(a: MonteCarloRequest, b: MonteCarloRequest): boolean
export function monteCarloSummary(response: MonteCarloResponse): string
export interface TerminalRow { label: string; value: number; change: number }
export function terminalRows(response: MonteCarloResponse): TerminalRow[]
export interface FanPoint { day: number; outer: [number, number]; inner: [number, number]; median: number }
export function fanChartData(response: MonteCarloResponse): FanPoint[]
export function monteCarloCsv(response: MonteCarloResponse): string
export function monteCarloCsvFilename(portfolioName: string, now: Date): string
```

**Rules:**

- **`cashDollars`:** `portfolio.cashDollars` if defined. Otherwise
  `basis.investedValue * cashWeight / (100 - cashWeight)`. `tradeBasis` already guarantees
  `cashWeight < 100` on a dollar basis.
- **`defaultStartingValue`:**
  - dollar basis: `(investedValue + cashDollars).toFixed(2)`;
  - weights basis: `HYPOTHETICAL_START.toFixed(2)`, which is `'10000.00'`.
- **`buildMonteCarloRequest`** checks in this order, returning the first failure:
  1. No positions: `'Add at least one holding to simulate.'`
  2. Simulations: the text, trimmed, must be a whole number from 100 to 10000. Otherwise:
     `'Simulations must be a whole number from 100 to 10,000.'`
  3. Starting value: remove `$`, `,` and whitespace, then `Number(...)`. Empty, not finite, or
     `<= 0` gives `'Starting value must be a number above $0.'`
  4. On success, the request is:
     - `tickers`: the positions' tickers in order;
     - `weights`: `shares × price` per position on a dollar basis, else `position.weight`;
     - `cash`: `cashDollars(...)` on a dollar basis, else `portfolio.cashWeight`;
     - `initial_value`, `horizon_days`, `num_simulations`, `lookback_days`, `model` from the inputs.
- **`sameMonteCarloRequest`:** every scalar field is equal, and `tickers`/`weights` are equal
  element by element.
- **`monteCarloSummary`** returns exactly this template:
  `` `${n} ${model === 'bootstrap' ? 'bootstrapped' : 'normal-model'} paths over ${horizon_days} trading days from ${formatMoney(initial_value)}. Fitted ${fit_start} to ${fit_end} (${n_returns} daily returns, ${lookbackLabel(lookback_days)} lookback). Seed ${seed}, so the same settings give the same result.` ``
  Here `n` is `num_simulations.toLocaleString('en-US')`.
- **`terminalRows`:** six rows in this order: `5th percentile` (p5), `25th percentile` (p25),
  `Median` (median), `75th percentile` (p75), `95th percentile` (p95), `Mean` (mean).
  `change = value / initial_value - 1`.
- **`fanChartData`:** for each path point,
  `{ day, outer: [p5, p95], inner: [p25, p75], median: p50 }`.
- **`monteCarloCsv`:**
  - the header `day,p5,p25,p50,p75,p95`, then one row per path point;
  - values through `csvNumber(value, 2)` from `lib/optimize`;
  - rows joined with `\n`, with no trailing newline. Match `capmCsv`'s line ending if it differs,
    and say so.
- **`monteCarloCsvFilename`:** `${filenameSafeName(name.trim()) || 'portfolio'}-montecarlo-${datePart(now)}.csv`,
  the same pattern as `capmCsvFilename`.

### `MonteCarloSection.tsx`

Follow `CapmSection.tsx` for the plumbing:
- portfolio lookup and the legacy check;
- `getUniverse`, giving a `lastClose` map and the live `tradeBasis`;
- `mountedRef`;
- a `RunState` of `idle | running | error | ready`. `ready` holds `response` and the `request`
  that produced it.
- the card and label styling, and a local `Field` helper.

**Settings card**, in a responsive grid like CAPM's:
1. `<LookbackPicker floor={MONTE_CARLO_LOOKBACK_FLOOR} …>`.
2. **Model:** two toggle buttons, Bootstrap and Normal, styled like the lookback buttons.
3. **Horizon:** four toggle buttons from `HORIZON_OPTIONS`.
4. **Simulations:** a text input with `inputMode="numeric"`.
5. **Starting value:** a text input. While the user hasn't edited it, it shows
   `defaultStartingValue(portfolio, liveBasis)`. Use the same `string | null` override pattern
   as CAPM's `targetText`.
   - On a weights basis, a muted note under it reads: **"These holdings have no share counts or
     prices, so this is a hypothetical starting value."**
6. **Run** button:
   - disabled while running, while the universe is loading, or with no positions;
   - label `Run simulation`, or `Simulating…` while running;
   - on click, build the request. On failure, show `error`. On success, call
     `monteCarloPortfolio`. A thrown error shows `error.message`, or
     `'The Monte Carlo request failed.'`

**Results** (only when `ready`), top to bottom:
1. `monteCarloSummary(response)`, muted.
2. If the currently built request is not ok, or not `sameMonteCarloRequest` as the saved one,
   show the existing note **"Settings have changed since this run. Run it again to update the
   results."**, styled like CAPM's.
3. `response.warnings`, styled like CAPM's warnings list.
4. A line: **"Chance of ending below the starting value: X%"**, with `X = (prob_loss * 100).toFixed(1)`.
5. The **fan chart**, inside `Suspense` + `ExpandableChart` with title `"Simulated portfolio value"`
   and the same fallback as CAPM.
   - Caption, muted: **"The dark band holds the middle half of the simulated paths, the light band
     90% of them, and the line is the median. The dashed line is the starting value. Simulations
     of past behavior, not a forecast."**
6. The **terminal table:** columns `Outcome`, `Ending value` (`formatMoney`), and
   `Change` (`formatReturn` from `lib/capm`), rows from `terminalRows`.
7. The **Export CSV** button, styled like CAPM's, with `DownloadIcon`.

### `MonteCarloChart.tsx`

```ts
export default function MonteCarloChart({ data, initialValue, size = 'inline' }:
  { data: FanPoint[]; initialValue: number; size?: 'inline' | 'expanded' }): JSX.Element
```

- The wrapper div is `h-[22rem]` inline and `h-[70vh]` expanded, as in `CapmChart`.
- `ResponsiveContainer` > `ComposedChart`:
  - `CartesianGrid` like CapmChart's;
  - `XAxis dataKey="day"` labelled "Trading days ahead";
  - a `YAxis` whose ticks are compact dollars (e.g. `$12k`), with domain `['auto', 'auto']`;
  - `Area dataKey="outer"` with low opacity, and `Area dataKey="inner"` with higher opacity, both
    `var(--color-primary)` and no stroke;
  - `Line dataKey="median"` with no dots;
  - `ReferenceLine y={initialValue}`, dashed, `var(--color-muted)`;
  - `Legend` and `ChartTooltip`. The tooltip formatter formats a number with `formatMoney`, and a
    `[low, high]` array as `` `${formatMoney(low)} – ${formatMoney(high)}` ``.
  - Series names: `5th–95th percentile`, `25th–75th percentile`, `Median`.
  - `isAnimationActive={false}` on every series.
- It's imported only via `lazy(() => import('../../../components/MonteCarloChart'))`.

## Tests

### `lib/optimize.test.ts`, added. Existing tests are unchanged.

`today = new Date(2026, 9, 1)` (1 Oct 2026). `MC = { days: 89, label: '3 months' }`.

1. `customLookbackError('2026-07-05', today, MC)` returns `'Choose a date at least 3 months ago.'`
   (88 days).
2. `customLookbackError('2026-07-04', today, MC)` returns `null` (89 days).
3. `customLookbackError('2026-09-04', today)` returns `'Choose a date at least 4 weeks ago.'` (the
   default floor is unchanged).
4. For every day of 2027 and of 2028:
   - `customLookbackDays(presetLookbackDate('3M', d), d) >= 89`;
   - `customLookbackDays(presetLookbackDate('1M', d), d) < 89`.

   Build `d` with `new Date(year, 0, 1 + i)`. This proves the floor allows 3 Mo and always
   blocks 1 Mo.

### `lib/monteCarlo.test.ts`

Fixtures. Inline them in the test file; they're literal.

```ts
const dollarPortfolio: Portfolio = {
  id: 'p', name: 'My: Fund', cashWeight: 20, updatedAt: '2026-09-01T00:00:00.000Z',
  positions: [{ ticker: 'AAA', weight: 40, shares: 10 }, { ticker: 'BBB', weight: 40, shares: 20 }],
}
const closes = new Map([['AAA', 100], ['BBB', 50]])   // invested 2000, total 2500
const weightsPortfolio: Portfolio = { ...dollarPortfolio, positions: [{ ticker: 'AAA', weight: 40 }, { ticker: 'BBB', weight: 40 }] }
```

Build bases with the real `tradeBasis(portfolio, closes)`, and assert `basis.kind` first.
Adjust a `Position` field name only if the real type differs; say so in the report.

1. `defaultStartingValue(dollarPortfolio, dollarBasis)` is `'2500.00'`.
2. With `{ ...dollarPortfolio, cashDollars: 300 }` it's `'2300.00'`. The rebuilt basis must still
   be dollar.
3. `defaultStartingValue(weightsPortfolio, weightsBasis)` is `'10000.00'`.
4. `buildMonteCarloRequest(dollarPortfolio, DEFAULT_MONTE_CARLO_SETTINGS, '$2,500', dollarBasis)`
   is ok, with:
   - `tickers ['AAA','BBB']`, `weights [1000, 1000]`, `cash` about 500 (`toBeCloseTo`);
   - `initial_value 2500`, `horizon_days 252`, `num_simulations 1000`, `lookback_days 1825`,
     `model 'bootstrap'`.
5. The weights basis gives `weights [40, 40]`, `cash 20` and `initial_value 10000`.
6. Each of these returns its exact message:
   - simulations `'50'`, `'10001'`, `'1000.5'`, `''`;
   - starting value `'0'`, `'-5'`, `'abc'`, `''`;
   - a portfolio with `positions: []`.
7. `sameMonteCarloRequest`: true for two builds from the same inputs. False when only
   `horizon_days` differs. False when only `weights[1]` differs.
8. `RESPONSE` fixture, literal:
   - `tickers ['AAA','BBB']`, `weights {AAA: 0.4, BBB: 0.4}`, `cash_weight 0.2`;
   - `model 'bootstrap'`, `seed 42`, `horizon_days 252`, `num_simulations 1000`,
     `initial_value 2500`, `lookback_days 1825`;
   - `fit_start '2021-10-01'`, `fit_end '2026-09-30'`, `n_returns 1256`, `daily_mean 0.0004`,
     `daily_vol 0.01`;
   - `paths`: `[{day:0,p5:2500,p25:2500,p50:2500,p75:2500,p95:2500}, {day:252,p5:2000,p25:2400,p50:2700,p75:3000,p95:3500}]`;
   - `terminal {mean:2750, median:2700, p5:2000, p25:2400, p75:3000, p95:3500, prob_loss:0.234, mean_return:0.1, median_return:0.08}`;
   - `warnings []`.

   Then:
   - `monteCarloSummary(RESPONSE)` equals
     `'1,000 bootstrapped paths over 252 trading days from $2,500.00. Fitted 2021-10-01 to 2026-09-30 (1256 daily returns, 5Y lookback). Seed 42, so the same settings give the same result.'`
   - `terminalRows`: the labels are in the listed order. The `5th percentile` value is `2000`,
     with change `toBeCloseTo(-0.2)`. The `Mean` change is `toBeCloseTo(0.1)`.
   - `fanChartData(RESPONSE)[1]` equals
     `{ day: 252, outer: [2000, 3500], inner: [2400, 3000], median: 2700 }`.
   - `monteCarloCsv(RESPONSE)` starts with `'day,p5,p25,p50,p75,p95\n0,2500,2500,2500,2500,2500'`.
   - `monteCarloCsvFilename('My: Fund', new Date(2026, 8, 26))` is
     `'My Fund-montecarlo-2026-09-26.csv'`.

## Out of scope

- The Help button and guide (0147), calibration, and the efficient frontier.
- Saving Monte Carlo settings across reloads.
- Any backend change. If the backend can't do something, report `BLOCKED`.
- Applying anything to the portfolio. Monte Carlo is read-only.

## Acceptance criteria

Run from the repo root, **in bash**.

1. `awk 'length > 300 {print FILENAME": "FNR": "length}'` over every created or touched frontend
   file prints no new lines. Run it **before and after**, and paste both.
   - New TSX files only: if a line is over 300 characters, run
     `npx --yes prettier@3 --print-width 120 --single-quote --no-semi --write <file>` on that
     **new** file. Don't run it on existing files.
2. `grep -c "<LookbackPicker" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx` prints
   `1`, and `grep -n "MONTE_CARLO_LOOKBACK_FLOOR" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx`
   prints a line.
3. `grep -n "MIN_LOOKBACK_DAYS" frontend/src/components/LookbackDialog.tsx` prints nothing (the
   floor comes from the prop).
4. `grep -c "<Tooltip" frontend/src/components/LookbackDialog.tsx` prints at least `4`.
5. `grep -n "title=" frontend/src/components/LookbackDialog.tsx frontend/src/components/LookbackPicker.tsx frontend/src/pages/analysis/outlook/MonteCarloSection.tsx frontend/src/components/MonteCarloChart.tsx`
   prints nothing. (`ExpandableChart`'s `title` prop is allowed. If it matches, paste it and
   explain.)
6. `grep -n "not built yet" frontend/src/pages/analysis/OutlookPage.tsx` prints only the
   Forecast line(s).
7. `grep -n "from 'recharts'" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx` prints
   nothing, and `grep -n "lazy(" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx` prints
   a line.
8. The backend is untouched. Run `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)`
   **before you start and again at the end**, and paste both summary lines. It passes both times with
   the **same count** (705 when this was written; another session may add tests, so the "before" run
   is the baseline). List every changed file in the report; none may be under `backend/`.
9. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. Plain `--noEmit` is vacuous here;
   never use it.
10. `cd frontend && npm run lint` exits 0, with no new warnings beyond the existing
    `HelpSidebar.tsx`/`UniversePage.tsx` ones.
11. `cd frontend && npm test` passes in full. Run it before you start too. Report both totals; the
    "after" total is the "before" total plus your new tests.
12. `cd frontend && npm run build` succeeds. After it,
    `grep -l "ResponsiveContainer" dist/assets/index-*.js` prints nothing.
13. **Smoke render** (needs `npm run dev` on :5173 and Chrome):
    `node contracts/tools/smoke-render.mjs outlook "Monte Carlo"` prints `SUB-TAB CLICKED: true`,
    no `EXCEPTION:` lines, and a `ROOT TEXT` containing `Run simulation`. The backend need not be
    running. If Chrome or the dev server is unavailable, say so. Don't skip it silently.

`BLOCKED` is the right answer to a criterion that cannot be satisfied, and to an undecided design
question. Don't find a clever way to pass a criterion. A clever pass is worse than a stop.

## Verification to run and paste

Paste the **complete, verbatim** output of every command, including failures. A summary doesn't
count as output.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
bash <<'EOF'
FE="frontend/src/lib/optimize.ts frontend/src/lib/monteCarlo.ts frontend/src/components/LookbackDialog.tsx frontend/src/components/LookbackPicker.tsx frontend/src/components/MonteCarloChart.tsx frontend/src/api/client.ts frontend/src/pages/analysis/OutlookPage.tsx frontend/src/pages/analysis/outlook/MonteCarloSection.tsx"
MC=frontend/src/pages/analysis/outlook/MonteCarloSection.tsx
awk 'length > 300 {print FILENAME": "FNR": "length}' $FE 2>/dev/null   # before AND after
grep -c "<LookbackPicker" $MC
grep -n "MONTE_CARLO_LOOKBACK_FLOOR" $MC
grep -n "MIN_LOOKBACK_DAYS" frontend/src/components/LookbackDialog.tsx
grep -c "<Tooltip" frontend/src/components/LookbackDialog.tsx
grep -n "title=" frontend/src/components/LookbackDialog.tsx frontend/src/components/LookbackPicker.tsx $MC frontend/src/components/MonteCarloChart.tsx
grep -n "not built yet" frontend/src/pages/analysis/OutlookPage.tsx
grep -n "from 'recharts'" $MC
grep -n "lazy(" $MC
EOF
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
npm run build
grep -l "ResponsiveContainer" dist/assets/index-*.js
cd ..
node contracts/tools/smoke-render.mjs outlook "Monte Carlo"
```

## Tooltips

Every control uses the `Tooltip` component, never `title`.

**LookbackDialog presets** (the texts from 0145):
- 1 Mo: **"Set the start date to 1 month ago"**
- 3 Mo: **"Set the start date to 3 months ago"**
- 6 Mo: **"Set the start date to 6 months ago"**
- YTD: **"Set the start date to January 1 of this year"**
- Any **disabled** preset: **`This analysis needs at least ${floor.label} of prices.`**, for
  example "…at least 3 months of prices." on Monte Carlo's 1 Mo button.

**Monte Carlo section:**
- **Custom:** **"Simulate from daily returns since a start date you choose, at least 3 months ago"**
- **1Y/3Y/5Y:** `` `Draw simulated days from the last ${years} ${years === 1 ? 'year' : 'years'} of daily returns` ``
- **Bootstrap:** **"Replay randomly chosen real days from the lookback. Keeps fat tails and big moves."**
- **Normal:** **"Draw daily returns from a bell curve with the lookback's mean and volatility. Thinner tails."**
- **Horizon buttons:** `` `Simulate ${label} ahead (${days} trading days)` ``
- **Simulations:** **"How many paths to simulate, from 100 to 10,000. More paths give smoother percentiles."**
- **Starting value:** **"Portfolio value on day 0. Defaults to the holdings at their last close plus cash."**
- **Run button:**
  - enabled: **"Simulate this portfolio with these settings"**;
  - no positions: **"Add a holding to this portfolio to simulate it"**;
  - loading: **"Loading prices…"**;
  - running: **"Simulating…"**.
- **Export CSV:** **"Download the percentile paths as a CSV"**
- **Expand:** `ExpandableChart`'s own tooltip.

## Human verification — does Gunnar need to run anything?

**Yes.** Run the backend and frontend, and check at ~1440px and ~390px.

1. **Outlook → Monte Carlo** on a shares-based portfolio:
   - The tab tooltip no longer says "not built yet".
   - The starting value equals the Holdings tab's total.
   - Run with the defaults. The summary, fan chart, table and chance of loss appear.
   - Expand the chart.
   - Export the CSV.
2. **Stale note:** change Horizon to 3 Mo. The "Settings have changed" note appears. Run again,
   and the note clears; the chart ends at day 63.
3. **Lookback floor:**
   - Click Custom. 1 Mo is greyed out, and its tooltip says 3 months.
   - 3 Mo works; Confirm and run.
   - Typing a date 2 months ago shows "Choose a date at least 3 months ago." and disables Confirm.
4. **Optimize and CAPM are unchanged:** their Custom dialogs still allow 1 Mo and show the
   4-weeks message.
5. **Weights-only portfolio:** the starting value is 10,000.00, with the hypothetical note.
6. **Validation:** Simulations `50` shows the 100–10,000 message, and no request is sent.

## Open questions

None. If recharts 3 doesn't render a ranged `Area` from a `[low, high]` dataKey, report it with
what you saw. Don't substitute stacked areas silently.

## Audit (planner, 2026-10-01): PARTIAL, one small rework

Re-run by the planner:
- **Backend:** 705 passed, before and after.
- **Frontend tests:** 286 passed (281 + 5 new `it` blocks covering every listed assertion).
- **Type check, lint, build:** `tsc -p tsconfig.app.json` exits 0. Lint shows only the two known
  warnings. The build succeeds, and `ResponsiveContainer` isn't in `index-*.js`.
- **Long lines:** none over 300 characters.
- **Smoke render:** not run. Chrome isn't installed on this machine, so this isn't the coder's
  fault; it's carried to human verification.

The code matches the Interface. I checked:
- floor plumbing, preset tooltips and the guarded initial value;
- request units for both bases;
- the stale-note comparison, and note and warning styling identical to CAPM's;
- the lazy chart, and the CSV and filename.

**Defect: nested tooltips on Model and Horizon.**
- `MonteCarloSection` wraps the Model and Horizon button groups in `Field`, which puts a
  `Tooltip` around the whole group. Each button also has its own `Tooltip`.
- `Tooltip` shows on `mouseenter` and doesn't stop propagation. So hovering a button shows **two
  tooltips at once**: the group's ("Choose how each simulated day is drawn.") and the button's.
- CAPM only uses `Field` around a single input or select. That's the convention here.

## Rework 1

Edit only `frontend/src/pages/analysis/outlook/MonteCarloSection.tsx`.

1. **Model and Horizon:** render a plain label instead of `Field`. Use the same
   `<label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">` that `Field`
   uses, followed by the button grid. There should be no group-level `Tooltip`; the per-button
   tooltips stay as they are.
2. **Simulations and Starting value** keep `Field`, because each wraps exactly one input.

**Acceptance:**
- `grep -n 'Field label="Model"\|Field label="Horizon"' frontend/src/pages/analysis/outlook/MonteCarloSection.tsx`
  prints nothing.
- `grep -c "<Field" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx` prints `2`.
- `grep -n "Choose how each simulated day\|How far ahead the simulated paths run" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx`
  prints nothing.
- `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`, `npm test` (286) and `npm run build`
  all pass, as before. Paste the output verbatim.
- If Chrome is installed by then, run `node contracts/tools/smoke-render.mjs outlook "Monte Carlo"`.
  Otherwise say it was unavailable.

## Acceptance (planner, 2026-10-01): ACCEPTED

Rework 1 re-run by the planner:
- The Model and Horizon rows use plain `<label>`s, and `<Field` appears twice.
- The group tooltip strings are gone.
- `tsc` exits 0, and 286 tests pass. Lint shows only the 2 known warnings, and the build succeeds.
- No lines are over 300 characters.

**Outstanding:** the page has never been rendered in a browser, because Chrome isn't installed.
Gunnar's Human verification steps 1–6 are the render check. Look closely at the fan chart's
ranged bands (recharts `Area` with a `[low, high]` key) and the Custom button's date label inside
the narrow Lookback column at ~1440px.
