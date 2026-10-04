# Contract 0163 — Risk tab: Stress test sub-tab, rename, and two 0162 fixes

**Status:** done
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

This contract covers four changes. Gunnar approved them on 2026-10-04.

1. **Fix "Risk ÷ weight"** (an 0162 spec bug).
   - Share of risk adds up to 100% of the *invested* money's risk, but the Weight column is measured
     against the total *including cash*.
   - So when a portfolio holds cash, every ratio is too high by 1 ÷ (1 − cash). With 40% cash, an
     average holding shows 1.67× instead of 1.0×.
   - Fix: the Weight column and the ratio both use the invested weight.
2. **Fix the shock column header.** It repeats whatever the user typed, so typing `-20%` shows
   "moves -20%%" and typing `abc` shows "moves abc%".
3. **Rename and add sub-tabs.**
   - The portfolio tab "Risk & Perf" becomes **"Risk"**. It has no performance content.
   - It gets two sub-tabs: **Breakdown** (the 0162 section) and **Stress test** (new).
4. **Stress test.** Replay a past market window on today's holdings. It shows:
   - portfolio return, max drawdown and worst day;
   - each holding's contribution;
   - the market's return over the same window;
   - a chart of the path.

**Data limit:** stored prices start on `HISTORY_START = 2020-01-01` (`backend/app/universe.py`), so the
presets cover crashes from 2020 onward only. `main`'s 2008, dot-com, 2011 and 2018 presets can't be
replayed. If a window starts before 2020, the error message says why.

## Math (backend)

Inputs:
- `weights` and `cash`, in the same units and validated exactly like `run_risk`;
- `closes` per ticker and `market` closes;
- `start` and `end` dates.

1. Validation, raising `StressInputError(ValueError)`. Check in this order:
   - `weights must be finite and greater than zero`
   - `cash must be finite and zero or more`
   - `missing closes for weighted ticker {ticker!r}`
   - `start must be before end`, when `start >= end`
2. Weights:
   - `total = Σweights + cash`, `w_i = weight_i / total`, and `cash_weight = cash / total`.
3. Window dates:
   - `dates` = the sorted union of every bar date in `[start, end]`, across all holdings and the market.
   - If there are fewer than 2 dates, raise
     `Fewer than 2 trading days of prices between {start} and {end}.`
   - When `start < HISTORY_START` (import it from `app.universe`), append
     ` Stored prices start at {HISTORY_START}, so earlier periods can't be replayed.`
   - `d0 = dates[0]` and `d_end = dates[-1]`.
4. Coverage:
   - A ticker is **covered** when its first bar is on or before `d0` and its last bar is on or after
     `d_end − PIN_GRACE_DAYS` (7 days; import it from `app.optimize_run`).
   - `coverage = Σ covered weight_i / Σ weight_i`.
   - If `coverage < MIN_COVERAGE = 0.8`, raise
     `Only {coverage*100:.1f}% of the invested money has prices for this window (missing: {T1}, {T2}). At least 80% is needed.`
     List the missing tickers in request order.
   - If `0.8 ≤ coverage < 1`, warn:
     `{T1}, {T2} ({100*(1-coverage):.1f}% of the invested money) have no prices for the whole window and are counted as flat (0%). The real result could differ.`
5. Path, buy-and-hold from `d0`:
   - For each covered ticker, `p = series.sort_index().reindex(dates, method="ffill")` and `rel_i = p / p.iloc[0]`.
   - `value_t = cash_weight + Σ_missing w_i + Σ_covered w_i · rel_i,t`, so `value_d0 = 1`.
6. Results:
   - `portfolio_return = value_end − 1`.
   - `max_drawdown = min(value / value.cummax() − 1)`. It is ≤ 0, and 0 when there is no drawdown.
   - `worst_day = min(value.pct_change().dropna())`, with its date as `worst_day_date`.
   - `n_days = len(dates) − 1`.
   - For each holding:
     - covered: `asset_return = rel_end − 1` and `contribution = w_i · asset_return`, so the
       contributions add up to `portfolio_return`;
     - missing: both are `None`.
7. Market:
   - The market counts as covered under the same rule as a holding. If it is, `market_return` is
     computed the same way, and every path point gets a `market` value equal to its `rel`.
   - Otherwise `market_return = None`, every path `market` is `None`, and this warning is added:
     `{M} has no prices for the whole window, so there is no market comparison.`
   - If the market ticker is also a holding, treat it the same way. Nothing special is needed.

## Change

### 1. New `backend/app/stress_run.py`

Module docstring: `"""Pure orchestration for the Risk tab's historical stress test."""`

```python
MIN_COVERAGE = 0.8
class StressInputError(ValueError): ...

@dataclass(frozen=True)
class StressHolding:
    ticker: str
    weight: float                 # of total, including cash
    covered: bool
    asset_return: float | None
    contribution: float | None

@dataclass(frozen=True)
class StressPoint:
    date: date
    value: float                  # 1.0 at the start
    market: float | None

@dataclass(frozen=True)
class StressResult:
    tickers: list[str]
    holdings: list[StressHolding]  # request order
    market_ticker: str
    start: date                    # d0
    end: date                      # d_end
    n_days: int
    cash_weight: float
    coverage: float
    portfolio_return: float
    max_drawdown: float
    worst_day: float
    worst_day_date: date
    market_return: float | None
    path: list[StressPoint]
    warnings: list[str]

def run_stress(weights: dict[str, float], cash: float, closes: dict[str, pd.Series], market: pd.Series,
               *, market_ticker: str, start: date, end: date) -> StressResult
```

### 2. `backend/app/schemas.py`

Add `StressRequest` with these fields:
- `tickers: list[str]`
- `weights: list[float]`
- `cash: float = 0.0`
- `start: date`
- `end: date`
- `market_ticker: str = "SPY"`

Add `StressHoldingOut`, `StressPointOut` and `StressResponse`, mirroring the dataclasses.

### 3. `backend/app/routers/portfolio.py`

Add `POST /portfolio/stress` (`response_model=StressResponse`). Copy the shape of the `/portfolio/risk`
route exactly:
- `_require_database()`;
- `_normalise_request`;
- holdings and market close loading, with the same 422 when the market ticker has no stored prices;
- map `StressInputError` to 422.

### 4. Backend tests (+14)

**New `backend/tests/test_stress_run.py`.** Use these literal fixtures:

```python
DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=5)]   # Jan 2,3,4,5,8
A = pd.Series([100, 90, 80, 85, 88], index=DATES, dtype=float)
B = pd.Series([50, 50, 55, 55, 60], index=DATES, dtype=float)
M = pd.Series([200, 180, 170, 175, 180], index=DATES, dtype=float)
Y = pd.Series([10, 11, 12], index=DATES[2:], dtype=float)             # starts late
START, END = date(2024, 1, 2), date(2024, 1, 8)
```

Unless a test says otherwise, call
`run_stress({"A": 1, "B": 1}, 2, {"A": A, "B": B}, M, market_ticker="M", start=START, end=END)`.
Use `pytest.approx(…, abs=1e-9)` for every float.

1. **Base case.**
   - `cash_weight` is `0.5`.
   - `portfolio_return` is `0.02`.
   - `max_drawdown` is `-0.025`.
   - `worst_day` is `-0.025`, with `worst_day_date == DATES[1]`.
   - `market_return` is `-0.1`.
   - `coverage` is `1.0`, `n_days == 4`, `start == DATES[0]`, `end == DATES[-1]`, and `warnings == []`.
2. **Contributions.**
   - A has `asset_return -0.12` and `contribution -0.03`.
   - B has `asset_return 0.2` and `contribution 0.05`.
   - The contributions add up to `portfolio_return`, and `weight` is `0.25` each.
3. **Path.**
   - The values are `[1.0, 0.975, 0.975, 0.9875, 1.02]`.
   - The market values are `[1.0, 0.9, 0.85, 0.875, 0.9]`.
   - The dates equal `DATES`.
4. **Missing holding inside the coverage limit.**
   - Weights `{A: 3, B: 3, Y: 1}`, cash `0`, closes including Y.
   - `coverage` is `6/7` and `portfolio_return` is `(3/7) * 0.08`.
   - Y is `covered False`, with `asset_return None` and `contribution None`.
   - There is exactly one warning. It contains `"Y ("` and `"counted as flat"`.
5. **Coverage too low.**
   - Weights `{A: 1, B: 1, Y: 1}`, cash `0`.
   - Raises a match for `Only 66.7% of the invested money has prices for this window (missing: Y)`.
6. **Late market.**
   - Pass `market=Y` with `market_ticker="Y"`.
   - `market_return is None`, and every path `market is None`.
   - The warnings include `Y has no prices for the whole window, so there is no market comparison.`
7. **Window before stored history.**
   - `start=date(2019, 1, 2)` and `end=date(2019, 3, 1)`.
   - Raises a match for `Stored prices start at 2020-01-01`.
8. **Validation**, parametrized with 4 cases, each matching its message:
   - weight `0`;
   - cash `-1`;
   - `start=END, end=START`, which gives `start must be before end`;
   - a weighted ticker missing from `closes`.

**New `backend/tests/test_api_stress.py`.** Copy the DB fixtures and `_insert` from
`tests/test_api_risk.py`, then seed A, B and M with the series above.

1. **Success.**
   - POST `{"tickers": ["a", "b"], "weights": [1, 1], "cash": 2, "start": "2024-01-02", "end": "2024-01-08", "market_ticker": "m"}`.
   - Expect 200.
   - `portfolio_return` is about `0.02`, and `market_ticker == "M"`.
   - The response has 5 path points.
2. **Unknown market ticker.** Returns 422, and the detail contains `No stored price history for market ticker`.
3. **`start` after `end`.** Returns 422, and the detail is `start must be before end`.

Together: 7 tests + 4 parametrized cases = 11, plus 3 API tests = **+14**.

Use `pytest.raises(StressInputError, match=re.escape(...))` for every message match, because the messages contain `(`, `.` and `%`.

### 5. Fix 1 — Risk ÷ weight (`frontend/src/lib/risk.ts`, `RiskSection.tsx`, `risk.test.ts`)

**`riskRows`**
- `weight` becomes `holding.invested_weight`.
- `ratio = riskShare / invested_weight`, under the same `null` rules.
- Rename nothing else.

**`RiskSection.tsx`**
- The table's Weight column now shows the invested weight. Its header stays `Weight`.
- Replace the footnote with:
  `Weight is each holding's share of the invested money (cash excluded). Share of risk is its contribution to the portfolio's volatility; the shares add up to 100%. Risk ÷ weight above 1 means the holding adds more risk than its size suggests.`
- The shock column still uses `shockImpact` (total weights). That is correct, because the column
  adds up to the portfolio move including cash.

**`risk.test.ts`**
- In the `riskRows` test, change the expected `ratio` for A from `1.55` to `1.24` (0.62 ÷ 0.5).
- Also assert A's `weight` is `0.5`.

### 6. Fix 2 — shock header (`risk.ts`, `RiskSection.tsx`, `risk.test.ts`)

Add `shockLabel(marketTicker: string, shock: ReturnType<typeof parseShock>): string`:
- valid → `` `If ${marketTicker} moves ${formatSigned(shock.value)}` ``
- invalid → `` `If ${marketTicker} moves …` ``

Use it for the table's last column header.

**New test (+1):**
- `shockLabel('SPY', parseShock('-20%'))` is `'If SPY moves -20.0%'`.
- `shockLabel('SPY', parseShock('abc'))` is `'If SPY moves …'`.

### 7. Shared amounts helper (`risk.ts`)

Move the tickers, weights and cash logic out of `buildRiskRequest` into an exported helper:

```ts
export function portfolioAmounts(portfolio: Portfolio, basis: TradeBasis): { tickers: string[]; weights: number[]; cash: number }
```

`buildRiskRequest` then uses it. Its behaviour, and its existing tests, stay the same.

### 8. Rename and sub-tabs

**`frontend/src/pages/analysis/AnalysisLayout.tsx`**
- Change `'Risk & Perf'` to `'Risk'`. The path stays `risk`.

**`frontend/src/pages/analysis/RiskPage.tsx`**
- Copy the `OutlookPage.tsx` sub-tab pattern exactly (`role="tablist"`, Tooltip on each tab).
- Use `aria-label="Risk sections"` and these tabs:
  - `['breakdown', 'Breakdown', 'Volatility, beta and where the risk in this portfolio comes from']`
  - `['stress', 'Stress test', "Replay a past market sell-off on today's holdings"]`
- Default to `breakdown`. Render `<RiskSection />` or `<StressSection />`.

### 9. New `frontend/src/lib/stress.ts`

```ts
export interface StressPreset { id: string; name: string; description: string; start: string; end: string }
export const STRESS_PRESETS: StressPreset[]
```

Use these 5 presets, in this order:

| id | name | start | end | description |
|---|---|---|---|---|
| `covid-crash` | `COVID crash` | `2020-02-19` | `2020-03-23` | `February 2020 high to the March low.` |
| `covid-rebound` | `COVID rebound` | `2020-03-23` | `2020-08-18` | `March 2020 low back to the February high.` |
| `rate-shock-2022` | `2022 rate shock` | `2022-01-03` | `2022-10-12` | `Fed tightening: stocks and bonds fell together.` |
| `carry-unwind-2024` | `Aug 2024 carry unwind` | `2024-07-16` | `2024-08-05` | `Yen carry-trade unwind and a sharp volatility spike.` |
| `tariffs-2025` | `2025 tariff sell-off` | `2025-02-19` | `2025-04-08` | `February 2025 high to the April tariff low.` |

**`parseWindow(startText, endText)`**
- Returns `{ ok: true; start: string; end: string } | { ok: false; message: string }`.
- Both values are trimmed.
- Each must match `/^\d{4}-\d{2}-\d{2}$/` and be a real date. Otherwise return `'Enter a start and end date (YYYY-MM-DD).'`
- `start >= end` returns `'Start date must be before end date.'`

**`buildStressRequest(portfolio, window: { start: string; end: string }, marketTicker: string, basis)`**
- Returns `{ ok: true; request } | { ok: false; message }`.
- Uses the same two errors as `buildRiskRequest`, with the wording `measure risk` changed to
  `run a stress test`.
- Otherwise returns `{ ...portfolioAmounts(portfolio, basis), start, end, market_ticker: trimmed }`.

**`sameStressRequest(a, b)`**
- Compares every field, the way `sameRiskRequest` does.

**`stressTiles(response): MetricItem[]`**

| Label | Value | Tooltip |
|---|---|---|
| `'Portfolio return'` | `formatSigned(portfolio_return*100)` | `'Return of today\'s holdings, bought at the start of the window and held to the end. Cash stays flat.'` |
| `'Max drawdown'` | `formatSigned(max_drawdown*100)` | `'Largest fall from a high point during the window.'` |
| `'Worst day'` | `formatSigned(worst_day*100)` | `` `Worst single-day move, on ${worst_day_date}.` `` |
| `` `${market_ticker} over the window` `` | `market_return === null ? '—' : formatSigned(market_return*100)` | `` `What ${market_ticker} returned over the same window, for comparison.` `` |

**`stressRows(response)`**
- Returns `{ ticker, weight, covered, assetReturn, contribution }[]`.
- Sort by `contribution` ascending (worst first), with `null`s last.

**`stressSummary(response)`**
- `` `${start} → ${end} (${n_days} trading days) · ${(coverage*100).toFixed(1)}% of invested money has prices` ``
- Append `` ` · ${(cash_weight*100).toFixed(1)}% cash` `` when `cash_weight > 0`.

**`stressChartData(response)`**
- Returns `{ date: string; portfolio: number; market: number | null }[]`.
- `portfolio = (value − 1) * 100`.
- `market = (market − 1) * 100`, or `null`.

### 10. New `frontend/src/lib/stress.test.ts` (+8)

Use a literal `StressResponse` fixture `S`:
- `tickers ['A','B','C']`, market `'SPY'`;
- `start '2025-02-19'`, `end '2025-04-08'`, `n_days 33`;
- `cash_weight 0.2`, `coverage 0.875`;
- `portfolio_return -0.123`, `max_drawdown -0.15`;
- `worst_day -0.045`, `worst_day_date '2025-04-04'`;
- `market_return -0.188`, `warnings []`.

Holdings:

| Ticker | `weight` | `covered` | `asset_return` | `contribution` |
|---|---|---|---|---|
| A | .5 | true | -.2 | -.1 |
| B | .2 | true | -.115 | -.023 |
| C | .1 | false | null | null |

Path:
- `[{ date: '2025-02-19', value: 1, market: 1 }, { date: '2025-04-08', value: 0.877, market: 0.812 }]`

The tests:
1. **Presets.**
   - There are 5 presets.
   - Every `parseWindow(p.start, p.end).ok` is true.
   - Every `p.start >= '2020-01-01'`.
   - The ids are unique.
2. **`parseWindow` accepts.** `(' 2025-02-19 ', '2025-04-08')` returns those trimmed dates.
3. **`parseWindow` rejects.**
   - `('2025-04-08', '2025-02-19')` and `('2025-02-19', '2025-02-19')` give `'Start date must be before end date.'`
   - `('', '2025-04-08')` and `('2025-02-30', '2025-04-08')` give the YYYY-MM-DD message.
4. **`buildStressRequest`.**
   - Weights basis, with `cashWeight 20`: the request has the position weights, `cash 20`, and the
     trimmed market ticker, start and end.
   - Empty positions give `'Add at least one holding to run a stress test.'`
5. **`stressTiles(S)`.**
   - Labels are `['Portfolio return','Max drawdown','Worst day','SPY over the window']`.
   - Values are `['-12.3%','-15.0%','-4.5%','-18.8%']`.
   - With `market_return: null`, the last value is `'—'`.
6. **`stressRows(S)`.**
   - The tickers are ordered `['A','B','C']`.
   - C has `covered` `false` and `contribution` `null`.
7. **`stressSummary(S)`.**
   - It is `'2025-02-19 → 2025-04-08 (33 trading days) · 87.5% of invested money has prices · 20.0% cash'`.
8. **`stressChartData(S)`.**
   - The second point's `portfolio` is close to `-12.3` and its `market` close to `-18.8`.
   - The first point is `0` / `0`.

### 11. `frontend/src/api/client.ts`

Add the `StressRequest`, `StressHoldingOut`, `StressPointOut` and `StressResponse` types (dates as
`string`), plus `stressPortfolio(body)`, which POSTs to `/portfolio/stress`.

### 12. New `frontend/src/components/StressChart.tsx`

Follow `MonteCarloChart.tsx`:
- default export, recharts, `isAnimationActive={false}`, CSS-variable colours, `h-[22rem]`;
- an X axis by `date`;
- a Y axis formatted as `${v.toFixed(0)}%`;
- a `Line` `portfolio`, named `Portfolio`, in `var(--color-primary)`;
- a `Line` `market`, named from a `marketTicker` prop, in `var(--color-muted)` and dashed, rendered
  only when any point has a non-null market;
- a `ReferenceLine` at `y=0`, with a `Legend` and a tooltip that shows values as `%` to one decimal.

`StressSection` lazy-loads it inside `Suspense`, as `MonteCarloSection` does with its chart.

### 13. New `frontend/src/pages/analysis/risk/StressSection.tsx`

Copy `RiskSection.tsx`'s structure for:
- loading the portfolio and the universe;
- the basis;
- the run state, storing `{ response, request, basis }`;
- the error display;
- the stale note, shown when `parseWindow` or `buildStressRequest` fails or the request differs.

Layout:

1. **Card: "Stress test settings".**
   - A row of preset buttons, one per preset. Each shows its `name`, with `description` and the
     dates as its Tooltip.
   - Clicking a preset sets the start and end inputs and the selected preset id. It doesn't run.
     Highlight the selected preset like the active `LookbackPicker` option.
   - Two `<input type="date">` fields, Start and End. They default to the `covid-crash` dates.
     Editing either one clears the selected preset.
   - The Market ticker `<select>`, as in `RiskSection`.
   - A **Run stress test** button.
   - Show the `parseWindow` error inline, under the dates, when it is invalid.
2. **Summary line.**
   - Starts with the preset name and ` · ` when a preset matches the run's dates, then
     `stressSummary(response)`.
   - Each warning follows on its own line, then the stale note.
3. **Card: "Result".**
   - Tiles from `stressTiles`, rendered like `RiskSection`'s `Tiles`. Export `Tiles` from
     `RiskSection.tsx` and import it rather than copying it.
   - When `basis.kind === 'dollar'`, add a line under the tiles:
     `` `On today's ${formatMoney(total)}, that is about ${formatMoney(portfolio_return * total)}.` ``
     Here `total = basis.investedValue + cashDollars(current, basis)`.
4. **Card: "Path".** `StressChart`, with `stressChartData(response)` and `market_ticker`.
5. **Card: "By holding".**
   - A table with columns: Ticker, Weight, Return, Contribution.
   - Weight is `(weight*100).toFixed(1)%`, which is the share of the total, so the contributions add
     up to the portfolio return.
   - Return and Contribution use `formatSigned(x*100)`, or `'No prices'` when the holding isn't covered.
   - Colour a contribution `text-brand-negative` when it is below 0.
   - Footnote:
     `Contribution is weight × return; contributions add up to the portfolio return. Holdings bought and held from the start of the window, not rebalanced. Past windows show how today's holdings behaved then, not how they will behave next time.`

### 14. Formatting

Run Prettier on the **new** frontend files only: `stress.ts`, `stress.test.ts`, `StressChart.tsx` and
`StressSection.tsx`:
`node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write <files>`.
If `/tmp/prettier3` is missing, report it and skip this step.

## Out of scope

- Factor or Fama-French replay.
- Backfilling prices before 2020.
- CSV export and a guide panel.
- Any change to CAPM, Monte Carlo or Optimize.

## Acceptance criteria

Run these from `backend/`:

1. `DATABASE_URL="" PYTHONPATH=. .venv/bin/pytest -q` passes. Baseline 784; afterwards **798**. Paste the totals.
2. `DATABASE_URL="" PYTHONPATH=. .venv/bin/pytest -q tests/test_stress_run.py tests/test_api_stress.py`
   passes, with 14 tests.

Run these from `frontend/`:

3. `npx vitest run` passes. Baseline 331; afterwards **340**. Paste the totals.
4. `npx tsc -p tsconfig.app.json --noEmit` is clean, `npm run lint` shows only the 2 known
   warnings, and `npm run build` succeeds.
5. `awk 'length > 300' src/lib/stress.ts src/pages/analysis/risk/StressSection.tsx src/components/StressChart.tsx src/pages/analysis/risk/RiskSection.tsx`
   prints nothing.
6. `grep -rn "Risk & Perf" src` prints nothing.

Then, from the repo root, with the dev server running:

7. `node contracts/tools/smoke-render.mjs risk` reports no `EXCEPTION:` line. Its PAGE TEXT
   contains `Breakdown`, `Stress test` and `Risk settings`.
8. `node contracts/tools/smoke-render.mjs risk "Stress test"` prints `SUB-TAB CLICKED: true` and no
   `EXCEPTION:` line. Its PAGE TEXT contains `Stress test settings` and `COVID crash`.

If Chrome won't launch in your sandbox, report criteria 7–8 as not run, with the error. Don't retry
with workarounds. The planner will run them.

`BLOCKED` is a valid outcome. Report any deviation.

## Human verification — Gunnar

1. The portfolio tab now reads **Risk**, and it has two sub-tabs: **Breakdown** and **Stress test**.
2. On a portfolio with cash, run **Breakdown**. The Weight column adds up to about 100%, and an
   average holding's Risk ÷ weight is near 1×, not 1.67×. Typing `-20%` in the market move shows
   "If SPY moves -20.0%" in the column header.
3. In **Stress test**, click **2025 tariff sell-off**, then **Run stress test**. Check that:
   - the tiles show the portfolio return next to SPY's;
   - the chart shows both paths;
   - the by-holding contributions add up to the portfolio return.
4. Choose a custom window starting before 2020. The error says stored prices start at 2020-01-01.
5. A holding that IPO'd after a window's start shows **No prices** and a warning. If it is more than
   20% of the invested money, the run is refused with an explanation.

## Open questions

None.
