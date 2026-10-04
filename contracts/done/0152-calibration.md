# Contract 0152 — Calibration check for Monte Carlo and Forecast

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Add a **Check calibration** button under the Monte Carlo and Forecast results. Clicking it does
three things:
1. It reruns the selected method at many past start dates, each time using **only the data before
   that date**.
2. It counts how often the real outcome landed inside the method's p5–p95 and p25–p75 bands.
3. It shows whether those hit rates fit a well-calibrated model, given how many outcomes there were.

The check covers Monte Carlo (Bootstrap, Normal) and Forecast (EWMA, GARCH, ARIMA, Ensemble).
**Prophet is excluded.**

The contract also fixes a small bug: the volatility chart's legend shows "Forecast" when there is
no forecast line (Prophet).

## Why

REBUILD.md → Outlook: "Calibration comes later, as its own contract … It must be a real check, not
`main`'s formula." `main` scored one autocorrelated hold-out path.

### Decisions (planner, 2026-10-03; Gunnar may override)

- **Only 21- and 63-day horizons are checked, whatever horizon is selected.** Windows at one horizon
  **do not overlap**: start dates are `h` trading days apart, so each outcome is independent of the
  others. At 1 year, 5 years of data gives about 4 independent outcomes, too few to mean anything.
  The panel says longer horizons are not checked.
- **Expected ranges are binomial.** With `n` outcomes and target coverage `p`, the range is
  `[binom.ppf(0.025, n, p) / n, binom.ppf(0.975, n, p) / n]`. A hit rate outside that range is a
  real miss, not noise. With 60 outcomes the 90% band's range is 82%–97%, so the check is coarse.
  The panel shows the range so nobody over-reads it.
- **It runs on a button**, not automatically. It is cheap: the planner's prototype on 30 holdings
  and 1,300 days took ≤ 0.62 s for any method. A button keeps it out of the way, and it only runs
  when someone asks.

### What the planner measured (`/tmp/pf/calib_cov.py`, prototype of the exact algorithm below)

| Data | Method | 21-day outcomes | Inside 90% | Expected | Below / above | Verdict |
|---|---|---|---|---|---|---|
| IID returns, constant vol | normal | 60 | 83.3% | 81.7–96.7% | 5 / 5 | consistent |
| Calm 1,500 days, then 4× vol for 500 | normal | 60 | 75.0% | 81.7–96.7% | 8 / 7 | too narrow |
| Same regime data | ewma | 60 | 83.3% | 81.7–96.7% | 7 / 3 | consistent |

The test fixtures below reproduce these numbers.

## Files

Create:
- `backend/app/calibration_run.py`
- `backend/tests/test_calibration_run.py`
- `backend/tests/test_api_calibration.py`
- `frontend/src/lib/calibration.ts`
- `frontend/src/lib/calibration.test.ts`
- `frontend/src/pages/analysis/outlook/CalibrationPanel.tsx`

Modify:
- `backend/app/schemas.py` (new request and response models only)
- `backend/app/routers/portfolio.py` (one new endpoint)
- `frontend/src/api/client.ts` (new types and `calibratePortfolio`)
- `frontend/src/lib/monteCarloGuide.ts` and `frontend/src/lib/forecastGuide.ts` (one entry each)
- `frontend/src/components/VolatilityChart.tsx` (the legend fix)
- `frontend/src/pages/analysis/outlook/MonteCarloSection.tsx` and `ForecastSection.tsx`: **only**
  the insertion shown below. Gunnar has hand-tweaked both files. Do not reformat them, do not run
  Prettier on them, and change nothing else.

**Touch nothing else.** In particular:
- Leave `montecarlo_run.py`, `forecast_run.py` and the existing endpoints alone. Calibration calls
  `run_monte_carlo` and `run_forecast` as they are, so it tests the exact code users run.
- Make no dependency changes.

## Backend — `calibration_run.py`

```python
CALIBRATION_MODELS = ("bootstrap", "normal", "ewma", "garch", "arima", "ensemble")
HORIZONS = (21, 63)
MAX_WINDOWS = 60
MIN_WINDOWS_FOR_VERDICT = 10
NUM_SIMULATIONS = 1000
SEED = 42

class CalibrationInputError(ValueError): ...

@dataclass
class CalibrationHorizon:
    horizon_days: int
    windows: int
    first_origin: date | None   # earliest start date used
    last_origin: date | None    # latest start date used
    inside_90: float | None     # share with p5 <= outcome <= p95; None when windows == 0
    inside_50: float | None     # share with p25 <= outcome <= p75
    below_90: int               # outcome < p5
    above_90: int               # outcome > p95
    range_90: tuple[float, float] | None
    range_50: tuple[float, float] | None
    verdict_90: str             # "consistent" | "too_narrow" | "too_wide" | "too_few"
    verdict_50: str

@dataclass
class CalibrationResult:
    tickers: list[str]
    model: str
    lookback_days: int
    num_simulations: int
    horizons: list[CalibrationHorizon]
    warnings: list[str]
```

`run_calibration(weights, cash, closes, *, lookback_days, model) -> CalibrationResult`. Implement
it **exactly** as follows.

1. **Validate the model.**
   - `model == "prophet"` raises `CalibrationInputError("Calibration does not cover Prophet, which is untested by design.")`.
   - Any other model not in `CALIBRATION_MODELS` raises
     `CalibrationInputError('model must be one of "bootstrap", "normal", "ewma", "garch", "arima" or "ensemble"')`.
2. **Build the realised series.**
   `full = portfolio_series(weights, cash, closes, lookback_days=MAX_LOOKBACK_DAYS).returns`, using
   `MAX_LOOKBACK_DAYS` from `optimize_run`. Re-raise a `MonteCarloInputError` as
   `CalibrationInputError(str(exc))`. Set `warnings = []`; the per-run warnings are not copied.
3. **For each `h` in `HORIZONS`:**
   - Start with `i = len(full) - 1 - h`. The first origin is the latest date whose `h`-day outcome
     is fully known.
   - While `i >= 0` and fewer than `MAX_WINDOWS` windows have been collected:
     1. `origin = full.index[i]`.
     2. Truncate every ticker's closes to `index <= origin`:
        `{t: s[s.index <= origin] for t, s in closes.items()}`.
     3. Call `run_monte_carlo` for bootstrap or normal, or `run_forecast` otherwise. Pass the
        truncated closes, the same `weights`, `cash`, `lookback_days` and `model`, plus
        `initial_value=1.0`, `horizon_days=h`, `num_simulations=NUM_SIMULATIONS` and `seed=SEED`.
     4. **Not enough history.** If it raises `MonteCarloInputError` or `ForecastInputError` and the
        message contains `"at least"` (the minimum-returns error), **stop this horizon** (`break`).
        Earlier origins have even less history. **Re-raise any other error** as
        `CalibrationInputError(str(exc))`.
     5. Compute the outcome `g = prod(1 + full.values[i+1 : i+1+h])` and the band
        `b = result.paths[-1]`. Assert `b.day == h`.
     6. Record `g < b.p5`, `g > b.p95` and `b.p25 <= g <= b.p75`.
     7. Set `i -= h`. **The windows must not overlap.**
4. **Fill in each horizon.** Let `n` be the number of windows.
   - `inside_90 = (n - below - above) / n` and `inside_50 = hits_50 / n`.
   - `first_origin` and `last_origin` are the earliest and latest origins used.
   - `range_90` uses `p = 0.9` and `range_50` uses `p = 0.5`, with the binomial formula above and
     `scipy.stats.binom`.
   - Each verdict: `"too_few"` if `n < MIN_WINDOWS_FOR_VERDICT`, `"too_narrow"` if the share is
     below the range's low end, `"too_wide"` if it is above the high end, and `"consistent"`
     otherwise. When `n == 0`, the shares and ranges are `None` and the origins are `None`.
5. **Return** the result. `tickers` comes from `portfolio_series`.

The module docstring must say three things:
- each fit uses only data up to its origin;
- the windows don't overlap;
- the expected ranges are 95% binomial intervals.

## Backend — API

`schemas.py`:
- `CalibrationRequest`: `tickers: list[str]`, `weights: list[float]`, `cash: float = 0.0`,
  `lookback_days: int = 1825` and `model: str`.
- `CalibrationHorizonOut` mirrors the dataclass. Tuples become `list[float] | None`.
- `CalibrationResponse` mirrors `CalibrationResult`.

`routers/portfolio.py`: add `@router.post("/calibration", response_model=CalibrationResponse)`.
- It follows `forecast_portfolio` line for line: `_require_database`, `_normalise_request` and
  `_load_stored_closes`.
- `CalibrationInputError` becomes a 422 with `str(exc)` as the detail.

## Backend tests

### `test_calibration_run.py`

These module-level literal fixtures must be built **in this order**, from one generator:

```python
rng = np.random.default_rng(7)
IID = 0.0003 + 0.01 * rng.standard_normal(2000)
SWITCH = np.concatenate([0.005 * rng.standard_normal(1500), 0.02 * rng.standard_normal(500)])

def closes_from(returns):
    dates = pd.bdate_range("2016-01-04", periods=len(returns) + 1).date
    return {"A": pd.Series(100 * np.concatenate([[1], np.cumprod(1 + returns)]), index=dates)}
```

Every call uses `weights={"A": 1.0}`, `cash=0` and `lookback_days=730`, unless stated otherwise.

1. **`test_iid_normal_is_consistent`:** `closes_from(IID)` with `model="normal"`.
   - The 21-day horizon has 60 windows, `below_90 == 5`, `above_90 == 5`,
     `inside_90 == pytest.approx(50/60)`, `range_90 == pytest.approx((49/60, 58/60))`,
     `verdict_90 == "consistent"` and `verdict_50 == "consistent"`.
   - `[h.horizon_days for h in result.horizons] == [21, 63]`.
2. **`test_regime_flags_normal_too_narrow`:** `closes_from(SWITCH)` with `model="normal"`. The
   21-day horizon has 60 windows, `below_90 == 8`, `above_90 == 7` and `verdict_90 == "too_narrow"`.
3. **`test_regime_ewma_adapts`:** the same data with `model="ewma"`. The 21-day horizon has
   `below_90 == 7`, `above_90 == 3` and `verdict_90 == "consistent"`.
4. **`test_too_few_windows`:** `closes_from(IID[:400])` with `lookback_days=365` and
   `model="normal"`.
   - The 63-day horizon has 5 windows and `verdict_90 == "too_few"`.
   - The 21-day horizon has 16 windows and its verdict is not `"too_few"`.
5. **`test_no_lookahead`:** monkeypatch `app.calibration_run.run_monte_carlo` with a wrapper that
   records `max(s.index[-1] for s in closes.values())` and then calls the real function. Use
   `closes_from(IID)` with `model="normal"`. For the 21-day horizon, the recorded dates are, in
   order, `full.index[len(full)-1-21]`, `full.index[len(full)-1-42]`, and so on, 60 of them. No
   recorded date is later than `full.index[-22]`. Build `full` in the test with `portfolio_series`.
6. **`test_rejects_prophet_and_unknown`:** both messages, exactly.
7. **`test_every_model_runs`:** parametrize over `CALIBRATION_MODELS` on `closes_from(IID)`. Both
   horizons have `windows > 0`, and every non-`None` share lies in [0, 1].

**If tests 1–4 give different counts:** don't change the fixtures or the expected numbers. Report
`BLOCKED` with your counts, because a difference means the algorithm deviates from the one
specified.

### `test_api_calibration.py`

Copy the `db_mode`, `client` and `_insert` pattern from `test_api_forecast.py`. Insert ticker `A`
from `closes_from(IID[:400])` (same fixture code, built locally).
- `{"tickers": ["A"], "weights": [1], "lookback_days": 365, "model": "normal"}` returns 200 with
  two horizons.
- `"model": "prophet"` returns 422 with the Prophet message.

## Frontend

### `client.ts`

Add `CalibrationRequest`, `CalibrationHorizon` and `CalibrationResponse`. They mirror the schema
and use `string | null` for dates.

Add `calibratePortfolio(body)`, which POSTs to `/portfolio/calibration`. Copy the pattern of
`forecastPortfolio`.

### `lib/calibration.ts`

- `calibrationRequest(request: MonteCarloRequest): CalibrationRequest` picks `tickers`, `weights`,
  `cash`, `lookback_days` and `model`.
- `calibrationRows(response)` returns `Array<{ horizon: string; windows: string; inside90: string; inside50: string; misses: string; reading: string; flagged: boolean }>`:
  - `horizon`: `'1 month (21 trading days)'` for 21 and `'3 months (63 trading days)'` for 63.
    Otherwise use `` `${n} trading days` ``.
  - `windows`: `` `${windows} (${first_origin} to ${last_origin})` ``, or `'0'` when there are no
    windows.
  - `inside90` and `inside50`: `` `${Math.round(share*100)}% (expected ${Math.round(lo*100)}–${Math.round(hi*100)}%)` ``,
    or `'—'` when the share is null.
  - `misses`: `` `${below_90} below, ${above_90} above` ``.
  - `reading`: the first rule that matches.
    1. Either verdict is `too_few`: `'Too few windows to judge.'`
    2. `verdict_90 === 'too_narrow'`: `'Too narrow: outcomes fell outside the 90% band more often than a calibrated model allows.'`
    3. `verdict_90 === 'too_wide'`: `'Too wide: outcomes stayed inside the 90% band more often than a calibrated model would.'`
    4. `verdict_50 === 'too_narrow'`: `'The 90% band holds up, but the middle band is too narrow.'`
    5. `verdict_50 === 'too_wide'`: `'The 90% band holds up, but the middle band is too wide.'`
    6. Otherwise: `'Consistent with calibrated bands.'`
  - `flagged`: true when either verdict is `too_narrow` or `too_wide`.
- `CALIBRATION_NOTE` must be exactly:
  `'Refits this method at up to 60 past start dates per horizon, using only the prices before each one, and counts how often the real outcome landed inside the bands. The windows do not overlap. Only 1- and 3-month bands are checked: longer horizons have too few independent outcomes to test. The expected range is where a calibrated model lands 95% of the time with that many outcomes.'`

### `lib/calibration.test.ts`

Use a literal `CalibrationResponse` fixture with two horizons:
- 21 days: 60 windows, `2021-03-01` to `2026-08-31`, `inside_90` 0.75, `inside_50` 0.4333,
  `below_90` 8, `above_90` 7, `range_90` `[0.8167, 0.9667]`, `range_50` `[0.3667, 0.6333]`,
  `verdict_90` `too_narrow` and `verdict_50` `consistent`.
- 63 days: 5 windows, verdicts `too_few`.

Assert:
- the full first row: `inside90` is `'75% (expected 82–97%)'`, `inside50` is
  `'43% (expected 37–63%)'`, `misses` is `'8 below, 7 above'`, `flagged` is true, and `reading` is
  the too-narrow sentence;
- the second row's reading is `'Too few windows to judge.'`;
- one case for each remaining reading rule (3–6), built with spread overrides;
- a zero-window horizon gives `windows` `'0'` and `'—'` shares;
- `calibrationRequest` drops `horizon_days`, `num_simulations` and `initial_value`.

### `CalibrationPanel.tsx` (default export, lazy-loaded is **not** needed)

Props: `{ request: MonteCarloRequest }`.

**State:** `idle`, `running`, `ready` (holding the response) or `error` (holding the message). Use
a `mountedRef` guard, as the sections do.

**Prophet:** if `request.model === 'prophet'`, render only a Card-styled box with
`'Calibration does not cover Prophet, which is untested by design.'`. Show no button.

**Otherwise** render a box styled like the sections' result cards
(`bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4`), containing:
- the heading `Calibration` (`text-sm font-semibold`);
- `CALIBRATION_NOTE` in `text-xs text-[var(--color-muted)]`;
- a button labelled `Check calibration`, or `Checking…` while it runs, disabled while running. Use
  the "Export CSV" button styling from `MonteCarloSection`.
- the error, if there is one, in `text-brand-negative`;
- when ready, a table using the same `TH`/`TD`/`NUMERIC` class strings as the sections (copy the
  constants). Its columns are Horizon, Windows, Inside 90% band, Inside 50% band, Misses (90%) and
  Reading. A flagged row's Reading cell adds `text-brand-negative`.

### Insertion in both sections

The only edit in each file is to wrap the existing `<Results … />` in a fragment and add the panel
after it:
```tsx
{run.status === 'ready' && (
  <>
    <Results … unchanged … />
    <CalibrationPanel key={JSON.stringify(run.request)} request={run.request} />
  </>
)}
```
Also add the import. The `key` resets the panel on every new run.

### `VolatilityChart.tsx`

Render the `Forecast` `<Line>` only when
`data.some((point) => point.forecast !== null && point.forecast !== undefined)`. Recharts then
leaves it out of the legend. Change nothing else.

### Guides

Add this entry to "Reading the results" in **both** `monteCarloGuide.ts` and `forecastGuide.ts`,
after `Export CSV`:

```ts
{
  term: 'Check calibration',
  text:
    'Reruns the method at past start dates, each using only the prices before it, and counts how often the real 1- and 3-month outcome landed inside the bands. ' +
    'A calibrated method lands inside the 90% band about 90% of the time and inside the middle band about half the time. ' +
    'The expected range allows for luck; a result outside it means the bands are too narrow or too wide for this portfolio. With few windows the check is coarse.',
},
```

The existing guide tests must still pass. If a test pins the entry list of "Reading the results",
update that test's expected list to include the new term, and report it.

## Out of scope

- Prophet calibration.
- Horizons other than 21 and 63 days.
- Caching.
- Running calibration automatically.
- Changing any model.
- Restyling either section.

## Acceptance criteria

Run them in bash from the repo root.

1. **Backend:** `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)` passes.
   - Before: 733.
   - After: 733 plus the number you added. State it; the parametrized test counts as 6.
2. **Calibration tests:**
   `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_calibration_run.py tests/test_api_calibration.py -v)`
   passes. Paste the output.
3. **Frontend tests:** `(cd frontend && npx vitest run)` passes. Before: 308. After: 308 plus the
   number you added.
4. **Frontend checks:**
   - `(cd frontend && npx tsc -p tsconfig.app.json --noEmit)` is clean.
   - `npm run lint` shows only the two known warnings (HelpSidebar, UniversePage).
   - `npm run build` succeeds, and `grep -l ResponsiveContainer frontend/dist/assets/index-*.js`
     prints nothing.
5. **Timing:** reuse 0149's throwaway setup (30 holdings, 1300 business days, seed 0). Time
   `run_calibration` with `lookback_days=1825` for `model="ensemble"` and `model="bootstrap"`.
   Paste both times. Each must be ≤ 5.0 s; the planner measured about 0.6 s.
6. **Line length:** `awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/calibration.ts frontend/src/lib/calibration.test.ts frontend/src/pages/analysis/outlook/CalibrationPanel.tsx`
   prints nothing.
7. **Prettier on new files only:**
   `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write frontend/src/lib/calibration.ts frontend/src/lib/calibration.test.ts frontend/src/pages/analysis/outlook/CalibrationPanel.tsx`.
   If `/tmp/prettier3` is missing, report it; don't substitute `npx`.
8. **Section edits are minimal:** `git diff --stat` is not a valid check here, because Gunnar has
   uncommitted edits. Instead, paste
   `grep -n "CalibrationPanel" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx frontend/src/pages/analysis/outlook/ForecastSection.tsx`.
   It should show exactly 2 lines per file (the import and the element).
9. **Real data:** if the backend on `localhost:8000` is running, POST `/portfolio/calibration` for
   a real portfolio with `"model":"garch"`. Paste the response's `horizons`. If it isn't running,
   say so.

`BLOCKED` is the right answer to a criterion that cannot be satisfied. Report every deviation,
even one you think is harmless.

## Human verification — Gunnar

1. **Restart the backend.** Run Monte Carlo (Bootstrap, 5Y), then **Check calibration**. You should
   see a table with two rows and expected ranges, returned within a few seconds.
2. **Forecast:** do the same with GARCH, then with Normal Monte Carlo. Compare the readings.
3. **Forecast → Prophet:** the panel shows the "does not cover Prophet" line and no button.
4. **Forecast → Prophet, volatility chart:** the legend no longer shows "Forecast".

## Open questions

None.
