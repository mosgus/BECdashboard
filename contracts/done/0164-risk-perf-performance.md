# Contract 0164 — Risk & Perf: main's pill switcher and the Performance sub-tab

**Status:** done
**Assigned to:** sonnet
**Author:** planner (opus)

## Resume — read this first (planner audit of attempt 1, 2026-10-04)

Attempt 1 stopped part-way and reported PARTIAL. Its files are still in the working tree. **Finish the
contract from where it stopped. Don't start over, and don't revert the parts listed as kept.**

**Kept as they are.** These match the spec:
- the `RiskPage.tsx` pill switcher;
- the `AnalysisLayout.tsx` label;
- the `client.ts` types and `performancePortfolio`;
- the `schemas.py` models;
- the logic of `performance_run.py` and of the `/portfolio/performance` route;
- `performanceSummary`, `performanceChartData` and `performanceCsv` in `lib/performance.ts`.

**Reformat, without changing behaviour.**
- `backend/app/performance_run.py`, the new route in `routers/portfolio.py`, and the three new schema
  classes are crammed onto single lines with `;`, `try: … except: …` one-liners and one-line class
  bodies.
- Rewrite them in the style of `stress_run.py`, `stress_portfolio` and `StressResponse`:
  - one statement per line;
  - one field per line;
  - type hints on `run_performance`'s parameters, as in the Interface section;
  - double-quoted strings, as in the rest of the router.
- Check with `grep -n ";" app/performance_run.py`. It must print nothing.

**Replace entirely: `PerformanceSection.tsx`.** The current file is a placeholder, and it has two bugs:
1. **Infinite request loop.** `useEffect(…, [portfolio])` depends on an object rebuilt on every
   render. `listPortfolios()` runs `JSON.parse` each time. So every `setResult` re-renders, which
   re-fires `/universe` and `/portfolio/performance` forever. Follow section 8: copy `RiskSection`'s
   universe effect, which has `[]` deps, and use a ref-guarded auto-run.
2. **Cash dropped for dollar portfolios.** It sends `cash: 0` when `basis.kind === 'dollar'`. Use
   `buildPerformanceRequest`, which goes through `portfolioAmounts` → `cashDollars`. Don't build the
   request inline.

It also has a `useState<any>`, a **Load Analytics** button with no `onClick`, a `JSON.stringify`
dump in place of the table, and an empty Exit Signals card. Build all of section 8.

**Still to write:**
- `lib/performance.ts`: `parseOptionalWindow`, `buildPerformanceRequest`, `samePerformanceRequest`,
  `PerformanceRow`/`performanceRows`, `SIGNAL_COLUMNS` and `signalGrid`.
- `lib/performance.test.ts` (+8).
- `tests/test_performance_run.py` (+8) and `tests/test_api_performance.py` (+4).
- Every acceptance criterion: run it and paste the output.

The contract is long, so work in this order and keep going until every step is done:
1. backend reformat;
2. backend tests, then acceptance criteria 1–3;
3. `performance.ts` and its tests;
4. `PerformanceSection.tsx`;
5. Prettier;
6. criteria 4–7.

If you run out of room part-way, report PARTIAL with the exact step you reached.

## Goal

The portfolio tab is called **Risk & Perf** again. It uses `main`'s pill switcher with
**Performance | Health | Scenarios** pills, and Performance is selected first. Performance is a port of
`main`'s Performance section with corrected math:
- a Portfolio vs SPY table;
- an equity curve;
- an Exit Signals grid.

## Why

Gunnar prefers `main`'s Risk & Perf UI/UX to what 0162–0163 built, and asked for a full port of its
sub-tabs "just with correct math". He accepts some duplication with Historical Optimize. This is
contract 1 of 4:
- 0164: Performance and the switcher;
- 0165: Health, which replaces Breakdown;
- 0166: Scenarios, which replaces Stress test;
- 0167: Attribution.

Until 0165 and 0166 land, the **Health** pill renders today's `RiskSection` and the **Scenarios** pill
renders today's `StressSection`, unchanged. There is no Attribution pill yet.

Read `main`'s version before starting:
`git show 'main:frontend/app/portfolios/[id]/risk/page.tsx' | sed -n 96,321p`, and
`git show main:backend/routers/portfolios_analytics.py`.

**What changes from `main`, and why:**

| `main` | Here |
|---|---|
| Cash ignored; weights renormalised to 100% | Cash counted, as in every rebuild tab |
| Daily-rebalanced to constant weights | Buy-and-hold from the window start, the same path as Stress test (`run_stress`) |
| Missing tickers dropped and the rest renormalised | 0163's coverage rule: missing holdings count as flat, and the run is refused below 80% coverage |
| Sharpe = CAGR ÷ vol (risk-free rate 0) | Sharpe = (CAGR − rf) ÷ vol, with alpha relative to rf too. This is `compute_metrics(..., rf=rf)`, the same as Historical Optimize |
| Volatility diff coloured green when the portfolio is *more* volatile | Volatility diff tone inverted: higher volatility than SPY is red |
| "Weights held constant" copy | "Bought and held" copy, which matches the math |

## Files

Create:
- `backend/app/performance_run.py` — wraps `run_stress` and adds metrics.
- `backend/tests/test_performance_run.py`
- `backend/tests/test_api_performance.py`
- `frontend/src/lib/performance.ts`
- `frontend/src/lib/performance.test.ts`
- `frontend/src/pages/analysis/risk/PerformanceSection.tsx`

Modify:
- `backend/app/schemas.py` — performance request and response models.
- `backend/app/routers/portfolio.py` — `POST /portfolio/performance`.
- `frontend/src/api/client.ts` — types and `performancePortfolio`.
- `frontend/src/pages/analysis/RiskPage.tsx` — pill switcher.
- `frontend/src/pages/analysis/AnalysisLayout.tsx` — label `'Risk'` becomes `'Risk & Perf'`.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. In particular, do not edit `StressChart.tsx`, `SignalBadge.tsx`,
`RiskSection.tsx`, `StressSection.tsx`, `stress_run.py` or `optimizer.py`. This contract reuses them as
they are.

**`reference files/` and the `main` branch are read-only.**

## Backend

### 1. New `backend/app/performance_run.py`

```python
class PerformanceInputError(ValueError): ...

MIN_DAYS = 20            # fewer trading days than this: refuse
SHORT_WINDOW_DAYS = 126  # fewer than this: warn that annualised numbers are noisy
DEFAULT_WINDOW_DAYS = 365

@dataclass(frozen=True)
class PerformanceResult:
    market_ticker: str
    start: date
    end: date
    n_days: int
    cash_weight: float
    coverage: float
    rf: float
    metrics: dict            # compute_metrics output for the portfolio
    bench_metrics: dict | None
    path: list[StressPoint]  # reused from stress_run
    warnings: list[str]

def run_performance(
    weights: dict[str, float], cash: float, closes: dict[str, pd.Series], market: pd.Series,
    *, market_ticker: str, start: date | None, end: date | None, today: date, rf: float,
) -> PerformanceResult: ...
```

**Steps, in order**

1. **Resolve the window.**
   - `end_resolved = end or today`
   - `start_resolved = start or end_resolved - timedelta(days=DEFAULT_WINDOW_DAYS)`
2. **Build the path.** Call
   `run_stress(weights, cash, closes, market, market_ticker=market_ticker, start=start_resolved, end=end_resolved)`.
   Catch `StressInputError` and re-raise it as `PerformanceInputError(str(exc))` with `from exc`.
   The stress result supplies these fields:
   - `start`, `end`, `n_days`, `cash_weight`, `coverage`;
   - `path`;
   - `warnings`, which are kept in order and come first.
3. **Refuse short windows.** If `n_days < MIN_DAYS`, raise `PerformanceInputError` with:
   `f"Only {n_days} trading days in this window. Pick a window of at least {MIN_DAYS} trading days."`
4. **Compute returns.**
   - Portfolio returns: `pd.Series([p.value for p in path]).pct_change().dropna()`.
   - If every `p.market` is not None, market returns are the same calculation on `p.market`.
     Otherwise there are no market returns.
5. **Compute metrics.**
   - With market returns:
     - `metrics = compute_metrics(port_returns, market_returns, rf=rf)`
     - `bench_metrics = compute_metrics(market_returns, None, rf=rf)`
   - Without them:
     - `metrics = compute_metrics(port_returns, None, rf=rf)`, so there is no beta or alpha key;
     - `bench_metrics = None`.
6. **Warn on short windows.** If `n_days < SHORT_WINDOW_DAYS`, append:
   `f"Only {n_days} trading days in this window. CAGR, Sharpe and alpha are annualised from a short period and can look extreme."`

Do not reimplement the value path or the metrics. The point is that Performance, Stress test and
Historical Optimize share the same buy-and-hold path and the same `compute_metrics`.

### 2. `backend/app/schemas.py`

```python
class PerformanceRequest(BaseModel):
    tickers: list[str]
    weights: list[float]
    cash: float = 0.0
    start: date | None = None
    end: date | None = None
    market_ticker: str = "SPY"

class PerformanceMetricsOut(BaseModel):
    cagr: float | None = None
    vol: float | None = None
    sharpe: float | None = None
    max_dd: float | None = None
    beta: float | None = None
    alpha: float | None = None

class PerformanceResponse(BaseModel):
    market_ticker: str
    start: date
    end: date
    n_days: int
    cash_weight: float
    coverage: float
    rf: float
    rf_source: str
    metrics: PerformanceMetricsOut
    bench_metrics: PerformanceMetricsOut | None
    path: list[StressPointOut]   # reuse the existing stress point model
    warnings: list[str]
```

If the existing stress point model has a different name, reuse it under that name. Don't duplicate it.

### 3. `backend/app/routers/portfolio.py`

Add `POST /portfolio/performance` with `response_model=PerformanceResponse`. Mirror `stress_portfolio`
line for line:
- `_require_database`, `_normalise_request` and `_load_stored_closes`;
- the same market lookup and the same 422 message for an unknown market ticker.

Then:
- `rf, rf_source = fetch_risk_free_rate_with_source()`.
- Call `run_performance(..., today=date.today(), rf=rf)`.
- Map `PerformanceInputError` to 422 with `detail=str(exc)`.
- Pass `metrics` and `bench_metrics` through the existing `_safe_metrics` idea, so that NaN or Infinity
  becomes null. `_safe_metrics` takes a dict of groups, so call it as
  `_safe_metrics({"metrics": result.metrics, "bench_metrics": result.bench_metrics})` and unpack the result.

### 4. Backend tests (+12)

**New `backend/tests/test_performance_run.py` (+8).** Use one module-level fixture built from literal
formulas:

```python
DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=140)]
A = pd.Series([100 * 1.001 ** k for k in range(140)], index=DATES)
B = pd.Series([50 + (k % 2) for k in range(140)], index=DATES)      # ends at 51 (k=139 is odd)
M = pd.Series([200 + k for k in range(140)], index=DATES)
```

Unless a test says otherwise, call:
`run_performance({"A": 1, "B": 1}, 2, {"A": A, "B": B}, M, market_ticker="M", start=DATES[0], end=DATES[-1], today=DATES[-1], rf=0.04)`.

1. **Cash counted, buy-and-hold.** The last `path` value is `pytest.approx(0.5 + 0.25 * 1.001 ** 139 + 0.25 * 51 / 50, rel=1e-9)`.
   `cash_weight == pytest.approx(0.5)` and `n_days == 139`.
2. **Shared metrics.**
   - Rebuild the portfolio and market returns from `result.path`.
   - Every key of `result.metrics` matches `compute_metrics(port, market, rf=0.04)`, using `pytest.approx`. Treat a None value as needing None on both sides.
   - `result.bench_metrics` matches `compute_metrics(market, None, rf=0.04)` and has no `"beta"` key.
3. **Sharpe uses rf.** Run twice, with `rf=0.04` and `rf=0.0`. The difference in Sharpe is
   `pytest.approx(0.04 / result.metrics["vol"])`.
4. **Market not covered.** Use `M.iloc[5:]` as the market. Then:
   - `bench_metrics is None`;
   - `"beta" not in metrics` and `"alpha" not in metrics`;
   - a warning contains `"no market comparison"`.
5. **Too short.** `end=DATES[10]` raises `PerformanceInputError`, and the message contains `"at least 20 trading days"`.
6. **Short-window warning.**
   - `end=DATES[29]` gives a warning containing `"annualised from a short period"`.
   - The full window gives no such warning.
7. **Default window.** `start=None, end=None, today=DATES[-1]` gives `result.start == DATES[0]`. The 365-day
   default reaches back before the data, and `run_stress` snaps to the first stored date.
   `result.end == DATES[-1]`.
8. **Coverage carried through.**
   - Add `C = pd.Series([10.0] * 40, index=DATES[100:])` with weights `{"A": 4, "B": 4, "C": 1}`.
   - The run succeeds: invested coverage is 8/9.
   - A warning contains `"counted as flat"`.

**New `backend/tests/test_api_performance.py` (+4).**
- Copy the DB fixtures and `seed` style from `tests/test_api_stress.py`.
- Seed A, B and M with the 140-row formulas above.
- Monkeypatch `app.routers.portfolio.fetch_risk_free_rate_with_source` to `lambda: (0.04, "live")`.

The tests:
1. Success with explicit `start` and `end`:
   - status 200;
   - `rf == 0.04` and `rf_source == "live"`;
   - `bench_metrics` is not None;
   - `len(path) == n_days + 1`.
2. Body with `start` and no `end`: status 200 and `n_days == 139`. The end defaults to today, which is after the data.
3. `end` = DATES[10]: status 422, and the detail contains `"at least 20 trading days"`.
4. Unknown market `"VT"`: status 422, with the same message as the stress route.

## Frontend

### 5. `frontend/src/api/client.ts`

- Add the `PerformanceRequest` interface. `start` and `end` are `string | null`.
- Add `PerformanceMetrics`, with every field `number | null` and `beta`/`alpha` optional.
- Add `PerformanceResponse`. Reuse `StressPointOut` for `path`.
- Add `performancePortfolio(body)`, mirroring `stressPortfolio`.

### 6. New `frontend/src/lib/performance.ts`

**`parseOptionalWindow(startText, endText)`**
- Returns `{ ok: true; start: string | null; end: string | null } | { ok: false; message: string }`.
- Values are trimmed; an empty value becomes `null`.
- A non-empty value must be a real `YYYY-MM-DD` date (reuse the same check as `parseWindow` in
  `stress.ts`). Otherwise return `'Dates must be YYYY-MM-DD, or left empty.'`
- If both are given and `start >= end`, return `'Start date must be before end date.'`

**`buildPerformanceRequest(portfolio, window: { start: string; end: string }, basis)`**
- Returns `{ ok: true; request } | { ok: false; message }`.
- Without positions, return `'Add at least one holding to see performance.'`
- A window parse error is returned as is.
- Otherwise return `{ ...portfolioAmounts(portfolio, basis), start, end, market_ticker: 'SPY' }`.

**`samePerformanceRequest(a, b)`**
- Compares every field, the way `sameStressRequest` does.

**`performanceRows(r): PerformanceRow[]`**

```ts
export interface PerformanceRow {
  label: string; tooltip: string
  portfolio: string; benchmark: string; diff: string
  portfolioTone: 'positive' | 'negative' | 'default'
  diffTone: 'positive' | 'negative' | 'muted'
}
```

Formatting:
- `pct(v) = (v * 100).toFixed(2) + '%'`.
- A signed percentage adds `'+'` when the value is above 0.
- Sharpe and beta use `toFixed(2)`, signed the same way for diffs.
- A null or undefined value shows `'—'`.

Rows, in this order. Labels and tooltips are verbatim.

| label | portfolio | benchmark | diff | diff tone |
|---|---|---|---|---|
| `CAGR` | pct | pct | signed pct of port − bench | > 0 positive, < 0 negative |
| `Volatility` | pct | pct | signed pct | **> 0 negative, < 0 positive** |
| `Sharpe` | 2 dp | 2 dp | signed 2 dp | > 0 positive, < 0 negative |
| `Max Drawdown` | pct | pct | signed pct | > 0 positive, < 0 negative |
| `Beta` (only if `bench_metrics` and `metrics.beta` are non-null) | 2 dp | `'1.00'` | signed 2 dp of β − 1 | muted |
| `Alpha` (only if `bench_metrics` and `metrics.alpha` are non-null) | pct, with portfolioTone by sign | `'0.00%'` | `'—'` | muted |

Other rules:
- A diff of exactly 0, or any null side, gives a muted diff tone.
- Every row except Alpha has `portfolioTone 'default'`.
- When `bench_metrics` is null, the four base rows show `'—'` for the benchmark and the diff.

Tooltips:
- CAGR: `'Compound annual growth rate over the window.'`
- Volatility: `'Annualised standard deviation of daily returns. Higher than SPY shows red.'`
- Sharpe: `'Return above the risk-free rate per unit of volatility: (CAGR − risk-free) ÷ volatility.'`
- Max Drawdown: `'Largest fall from a high point during the window.'`
- Beta: `'How much the portfolio moved per 1% move in SPY, from daily returns over the window. SPY is 1.00 by definition.'`
- Alpha: `'Annual return beyond what beta to SPY explains: CAGR − rf − β × (SPY CAGR − rf). SPY is 0 by definition.'`

In the strings, replace `SPY` with `r.market_ticker`.

**`performanceSummary(r)`**

Returns:
`` `${r.start} → ${r.end} (${r.n_days} trading days) · risk-free ${(r.rf * 100).toFixed(2)}%${r.rf_source === 'live' ? '' : ' (fallback)'}${r.cash_weight > 0 ? ` · ${(r.cash_weight * 100).toFixed(1)}% cash` : ''}` ``

**`performanceChartData(r)`**
- Same mapping as `stressChartData`: `(value − 1) × 100`, with null market kept.
- Reuse `StressChart` for display: its props already match.

**`performanceCsv(r): string`**
- Header: `date,portfolio,${r.market_ticker}`.
- Then one line per path point: `${date},${value},${market ?? ''}`, joined with `'\n'`.

**Signal columns and `signalGrid`**

```ts
export const SIGNAL_COLUMNS = [['sma_cross', 'SMA 20/50'], ['rsi_threshold', 'RSI 14'], ['macd_cross', 'MACD (12,26,9)']] as const
export function signalGrid(tickers: string[], signals: TickerSignals[]):
  { ticker: string; cells: { state: string | null; lastTrigger: string | null }[] }[]
```

- Rows follow the portfolio's ticker order.
- Cells are looked up by the `signal` key, in `SIGNAL_COLUMNS` order.
- A ticker or signal missing from the response gives `{ state: null, lastTrigger: null }`.

### 7. New `frontend/src/lib/performance.test.ts` (+8)

Use this literal response fixture (Gunnar's own numbers from `main`):
- `metrics = { cagr: 0.3339, vol: 0.3419, sharpe: 0.98, max_dd: -0.3942, beta: 1.25, alpha: 0.087 }`
- `bench_metrics = { cagr: 0.1978, vol: 0.1486, sharpe: 1.33, max_dd: -0.1876 }`
- `market_ticker 'SPY'`, `rf 0.04`, `rf_source 'live'`, `cash_weight 0`
- a 2-point path:
  - `{date:'2024-01-02', value:1, market:1}`
  - `{date:'2024-01-03', value:1.1, market:null}`

Tests:

1. `parseOptionalWindow`:
   - `('', '')` → ok with both null;
   - `(' 2024-01-02 ', '')` → ok with start `'2024-01-02'`;
   - `('2024-13-01', '')` → the format error;
   - `('2024-02-01', '2024-01-01')` → the order error.
2. `buildPerformanceRequest`:
   - an empty portfolio gives the holdings message;
   - a weights-basis portfolio with `cashWeight` 0.2 and an empty window gives `start: null`, `end: null`, `market_ticker: 'SPY'` and `cash: 0.2`.
3. `performanceRows` with the fixture gives exactly 6 rows. The `[label, portfolio, benchmark, diff, diffTone]` values are:
   - `['CAGR','33.39%','19.78%','+13.61%','positive']`
   - `['Volatility','34.19%','14.86%','+19.33%','negative']`
   - `['Sharpe','0.98','1.33','-0.35','negative']`
   - `['Max Drawdown','-39.42%','-18.76%','-20.66%','negative']`
   - `['Beta','1.25','1.00','+0.25','muted']`
   - `['Alpha','8.70%','0.00%','—','muted']`, with Alpha's `portfolioTone` `'positive'`.
4. With `bench_metrics: null`, `performanceRows` gives 4 rows, each with benchmark `'—'` and diff `'—'`.
5. With `sharpe: null`, the Sharpe row's portfolio is `'—'` and its diff is `'—'`.
6. `performanceChartData`:
   - `[{date:'2024-01-02', portfolio:0, market:0}, {date:'2024-01-03', portfolio: ≈10, market:null}]`;
   - use `toBeCloseTo` for 10.
7. `performanceCsv` returns `'date,portfolio,SPY\n2024-01-02,1,1\n2024-01-03,1.1,'`.
8. `signalGrid(['B','A'], …)`:
   - A has the signals in `macd, sma, rsi` order;
   - B is absent;
   - so rows are `B` then `A`;
   - B's cells are all null;
   - A's cells are in `sma, rsi, macd` order.

### 8. New `frontend/src/pages/analysis/risk/PerformanceSection.tsx`

**Data loading**
- Load the portfolio, universe and trade basis exactly as `RiskSection` does: `useParams`,
  `listPortfolios`, `isLegacyPortfolio`, `getUniverse`, `tradeBasis` and `mountedRef`.
- Use a `RunState` union like the other sections.

**Auto-run**
- Like `main`, run once automatically when the universe becomes ready, with an empty window.
- **Load Analytics** re-runs with the date inputs.
- Guard the auto-run with a ref so it fires once.

**Signals**
- Call `getSignals(tickers)` once on mount.
- Keep its state separately: `loading`, `ready` or `error`.
- A failure hides the grid and shows the muted line `Signals unavailable.`

**Layout**

Follow `main`'s order. Every card is `bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4`.

1. **Controls row**, `flex flex-wrap items-end gap-3`:
   - `Start (optional)` and `End (optional)` date inputs. Copy the input classes from `PortfolioCharts.tsx:86`.
   - A **Load Analytics** primary button.
   - A `Buy & hold` pill: `rounded-full border border-brand-border px-2 py-1 text-xs text-[var(--color-muted)]`. This replaces `main`'s amber "Simulated" pill.
2. **Status lines**:
   - the `performanceSummary` line, muted `text-xs`;
   - `Computing analytics…` while running;
   - the error in `text-brand-negative`;
   - each warning as a muted `text-xs` line;
   - the "changed since this run" line when the built request isn't `samePerformanceRequest` to the last run's:
     `Dates or holdings have changed since this run. Click Load Analytics to update.`
3. **Table card** titled `Portfolio vs Benchmark (${market_ticker})`:
   - A `text-xs` table with columns `Metric | Portfolio | ${market_ticker} | Diff`.
   - Numbers are right-aligned and `tabular-nums`.
   - Each Metric label is wrapped in `Tooltip` with the row tooltip.
   - Tones:
     - `positive` → `text-brand-positive`
     - `negative` → `text-brand-negative`
     - `muted` → `text-[var(--color-muted)]`
     - Portfolio cells are `font-semibold`; Diff cells are `font-bold` unless muted.
   - Footnote, muted `text-xs`:
     `Today's holdings bought at the start of the window and left to drift; cash stays flat. Sharpe and alpha subtract the risk-free rate shown above.`
4. **Equity curve card**:
   - Title `Equity Curve`, with a `Download CSV` button on the right. The button calls
     `downloadTextFile('equity_curve.csv', performanceCsv(r), 'text/csv')`.
   - Below, show `StressChart`, lazy-loaded the way `StressSection` does, with `performanceChartData(r)` and `r.market_ticker`.
5. **Exit Signals card**:
   - Header row `grid grid-cols-[5rem_1fr_1fr_1fr] gap-2`, with the three `SIGNAL_COLUMNS` labels muted.
   - One row per `signalGrid` entry:
     - The ticker is a react-router `Link` to `/ticker/${ticker}`: `font-mono text-xs font-semibold text-brand-primary hover:underline`.
     - Each cell is `<SignalBadge state={cell.state} />`. If `lastTrigger` is set, follow it with
       `<span className="ml-1.5 text-[11px] text-[var(--color-muted)]">{lastTrigger}</span>`.
   - Show the card even before the performance run finishes. Signals are independent of it.

### 9. `frontend/src/pages/analysis/RiskPage.tsx`

Replace the underline tabs with `main`'s pill switcher. Keep `role="tablist"`, `role="tab"` and
`aria-selected`, because the smoke tool clicks `[role="tab"]`. Keep the `Tooltip` wrappers.

```ts
const TABS = [
  ['performance', 'Performance', 'Return, volatility, drawdown and alpha against SPY, plus exit signals'],
  ['health', 'Health', 'Volatility, beta and where the risk in this portfolio comes from'],
  ['scenarios', 'Scenarios', "Replay a past market sell-off on today's holdings"],
] as const
```

- Default `'performance'`.
- Render:
  - performance → `<PerformanceSection />`
  - health → `<RiskSection />`
  - scenarios → `<StressSection />`
- Wrapper: `flex gap-2 mb-5`.
- Every pill: `rounded-[var(--radius-btn)] px-4 py-2 text-sm font-medium transition-colors`.
  - Active: `bg-brand-primary text-white`.
  - Inactive: `border border-brand-border text-[var(--color-muted)] hover:text-foreground`.

### 10. `AnalysisLayout.tsx`

Change `{ path: 'risk', label: 'Risk' }` to `label: 'Risk & Perf'`.

### 11. Formatting

Run Prettier on the **new** frontend files only: `performance.ts`, `performance.test.ts` and `PerformanceSection.tsx`:
`node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write <files>`.

If `/tmp/prettier3` is missing, report it and skip this step.

Do not run Prettier on `RiskPage.tsx`, `AnalysisLayout.tsx` or `client.ts`. Keep each of their lines
under 300 characters by hand.

## Tooltips

| Element | Copy |
|---|---|
| Start date input | `First day of the window. Leave empty for one year before the end date.` |
| End date input | `Last day of the window. Leave empty for the latest stored prices.` |
| Load Analytics | `Recompute performance for these dates with the current holdings` |
| Buy & hold pill | `Today's holdings bought at the start of the window and held, not your actual trade history.` |
| Download CSV | `Download the portfolio and SPY curves as a CSV file` (with `SPY` replaced by the market ticker) |
| Ticker link | `Open ${ticker}'s chart and indicators` |
| Pills | The third column of `TABS` |

## Out of scope

- Health, Scenarios and Attribution content (0165–0167). Don't touch `RiskSection` or `StressSection`.
- A benchmark picker. The market ticker is fixed to SPY, as in `main`.
- PNG chart export, `HelpSidebar`, and `main`'s unused `MetricCards`.
- Changing `StressChart`'s colours, or `SignalBadge`'s props.
- Any change to Historical Optimize, CAPM, Monte Carlo or Holdings.

## Acceptance criteria

Run these from `backend/`:

1. `DATABASE_URL="" PYTHONPATH=. .venv/bin/pytest -q` passes. The baseline is 798; afterwards there are **810**. Paste the totals.
2. `DATABASE_URL="" PYTHONPATH=. .venv/bin/pytest -q tests/test_performance_run.py tests/test_api_performance.py`
   passes, with 12 tests.
3. `grep -n "pct_change\|cumprod\|\.std(" app/performance_run.py` prints at most two `pct_change` lines and
   no `cumprod` or `.std(`. The path and metrics are reused, not reimplemented.

Run these from `frontend/`:

4. `npx vitest run` passes. The baseline is 340 tests in 21 files; afterwards there are **348 in 22 files**. Paste the totals.
5. `npx tsc -p tsconfig.app.json --noEmit` is clean, `npm run lint` shows only the 2 known warnings,
   and `npm run build` succeeds.
6. `awk 'length > 300' src/lib/performance.ts src/pages/analysis/risk/PerformanceSection.tsx src/pages/analysis/RiskPage.tsx src/api/client.ts`
   prints nothing.
7. `grep -n "'Risk & Perf'" src/pages/analysis/AnalysisLayout.tsx` prints one line.

**Planner-run** (coders skip these: write "browser checks left for the Planner" under Not done):

8. `node contracts/tools/smoke-render.mjs risk` reports no `EXCEPTION:` line. Its PAGE TEXT contains
   `Performance`, `Health`, `Scenarios`, `Load Analytics` and `Exit Signals`.
9. `node contracts/tools/smoke-render.mjs risk "Health"` shows `Risk settings`.
   `node contracts/tools/smoke-render.mjs risk "Scenarios"` shows `COVID crash`.

`BLOCKED` is a valid outcome. Report any deviation.

## Human verification — Gunnar

Restart the backend first. Then:

1. The tab reads **Risk & Perf**, and it opens on the **Performance** pill. **Health** and **Scenarios**
   show the old Breakdown and Stress test content for now.
2. The table loads by itself and looks like `main`'s. On a portfolio with cash:
   - CAGR and volatility are lower than `main` showed for the same holdings, because cash now counts;
   - Sharpe is lower too, because the risk-free rate is subtracted.
3. A portfolio more volatile than SPY shows a **red** Volatility diff.
4. Set Start to `2022-01-03` and End to `2022-10-12`, then click **Load Analytics**. The table, curve
   and summary update. **Download CSV** saves `equity_curve.csv`.
5. The Exit Signals grid lists each holding. Clicking a ticker opens its page.

## Open questions

None.
