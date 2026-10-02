# Contract 0151 — Prophet as an opt-in, untested Forecast model

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Add `prophet` as a fifth model on `POST /portfolio/forecast` and in the Forecast tab's model
select. It is labelled **unstable and untested** everywhere it appears. It is **not** an Ensemble
member, and it is not part of the planned calibration.

## Why

Gunnar, 2026-10-01: "lets include Prophet anyway and just label it as unstable/untested". See
`REBUILD.md` → Outlook → "Forecast: five methods, fixed rather than ported".

### What the planner measured

Measured on 2026-10-02 in a scratch venv at `/tmp/prophetvenv`, outside the project:

| Check | Result |
|---|---|
| Install | `prophet==1.4.0` (latest) installs and runs alongside the pinned `pandas==3.0.5`, `numpy==2.5.3` and `scipy==1.18.1` on Python 3.13. It pulls in `cmdstanpy` 1.3.0, `holidays`, `matplotlib` and `tqdm`. |
| Linux wheel | PyPI has a `manylinux_2_27_x86_64` wheel, so Render can install it without compiling. |
| Speed | Fit plus 252-day sampling takes 0.5–0.8 s on 1,254 days. |
| Memory | Peak RSS is **413 MB at 10,000 samples × 756 days**, against **170 MB at 2,000**. Render's free tier has 512 MB, so this contract caps Prophet at 2,000 samples. |
| Determinism | With `np.random.seed(42)` before sampling, two runs are identical. |
| Real data | On 5 years of equal-weight XLK/MS/GLD/SPY with V0 = 10,000, the median moves to 10,090 on day 1 (the fitted trend ends about 1% above the last close). At 1 year the band is P5 6,566 – P95 24,953, against about 9,070 – 15,700 for the volatility models. |

**Why the bands look like that:** Prophet's bands come from extrapolating the trend, plus
independent noise on each day. They don't come from volatility. That is what "unstable" means
here, and the guide says so.

## Files

Modify:
- `backend/requirements.txt`: add `prophet==1.4.0`. **This is the only dependency change.** Don't
  touch `requirements-dev.txt`.
- `backend/app/forecast_run.py`
- `backend/app/schemas.py`: `current_vol` becomes `float | None`.
- `backend/tests/test_forecast_run.py` and `backend/tests/test_api_forecast.py`
- `frontend/src/api/client.ts`: `current_vol: number | null`.
- `frontend/src/lib/forecast.ts` and `frontend/src/lib/forecast.test.ts`
- `frontend/src/lib/forecastGuide.ts` and `frontend/src/lib/forecastGuide.test.ts`
- `frontend/src/pages/analysis/outlook/ForecastSection.tsx`: only the volatility caption (see
  Frontend). Gunnar has hand-tweaked this file. Don't reformat it, and don't change anything else
  in it.

**Prophet is pre-installed by Gunnar. Do not run `pip install`; your sandbox has no network.**
First run `(cd backend && .venv/bin/python -m pip list | grep -iE "^(pandas|numpy|scipy|prophet) ")`.
It must show `numpy 2.5.3`, `pandas 3.0.5`, `scipy 1.18.1` and `prophet 1.4.0`. If prophet is
missing or any version differs, stop and report `BLOCKED` with the output.

**Touch nothing else.** In particular, leave the Ensemble's members, Monte Carlo, `.env*` and
`reference files/` alone.

## Backend — `forecast_run.py`

```python
MODELS = ("ewma", "garch", "arima", "ensemble", "prophet")
MIN_RETURNS = {..., "prophet": 250}
MODEL_LABELS = {..., "prophet": "Prophet"}
PROPHET_MAX_SAMPLES = 2000
PROPHET_WARNING = (
    "Prophet is unstable and untested here. Its bands come from extrapolating the trend of the "
    "portfolio's value, not from its volatility, and have not been checked against what happened."
)
```

**Validation message:** it becomes
`'model must be one of "ewma", "garch", "arima", "ensemble" or "prophet"'`. Update the two
existing tests that assert the old text. Those are the only edits allowed to existing assertions.

**`_load_prophet()`:** a module-level function that imports Prophet and returns the `Prophet`
class.
- **Import lazily, inside the function.** Never import Prophet at module top level. The app and
  the other models must still work if Prophet isn't installed.
- On `ImportError`, raise `ForecastInputError("Prophet is not installed on this server.")`.
- Before returning, quiet the noise. Set `logging.getLogger("cmdstanpy")` to `WARNING`, and
  disable `logging.getLogger("prophet.plot")`, which logs "Importing plotly failed".

**`run_forecast` with `model="prophet"`.** The validation order and the shared outputs
(`vol_history`, `history`, the `lookback_vol` path, and so on) are unchanged. Then:
1. **Sample count.** `samples = min(num_simulations, PROPHET_MAX_SAMPLES)`. If it was capped,
   append the warning
   `f"Prophet draws at most {PROPHET_MAX_SAMPLES:,} samples, so this forecast uses {PROPHET_MAX_SAMPLES:,}."`.
   The result's `num_simulations` is `samples`, the number actually used.
2. **Degenerate series** (`x.var(ddof=1) < 1e-18`): use the existing deterministic rule, exactly
   as the other models do. `current_vol` is 0, `vol_forecast` is zeros, and Prophet isn't
   imported. Still append `PROPHET_WARNING`.
3. **Otherwise:**
   - Set `y = np.cumsum(x)` (log value relative to the first return date) and
     `ds = pd.to_datetime(series.returns.index)`.
   - Fit `Prophet(growth="linear", yearly_seasonality="auto", weekly_seasonality=False, daily_seasonality=False, uncertainty_samples=samples)`
     on `pd.DataFrame({"ds": ds, "y": y})`.
   - Set `future = pd.DataFrame({"ds": pd.bdate_range(ds[-1] + pd.offsets.BDay(1), periods=horizon_days)})`.
   - Call `np.random.seed(seed)` immediately before `m.predictive_samples(future)["yhat"]`, which
     has shape `(horizon_days, samples)`.
   - The value array is `initial_value · exp(yhat.T − y[-1])`, with an `initial_value` column
     prepended. It is anchored to the **last actual close**, so the day-1 jump shows. Pass it to
     `summarize_paths`.
   - The docstring must say that each day's samples are independent draws, not coherent paths.
4. **Outputs:**
   - `current_vol = None` and `vol_forecast = []`. Prophet doesn't forecast volatility.
   - `params = {"end_gap": float(exp(m.predict(pd.DataFrame({"ds": ds[-1:]}))["yhat"].iloc[0] − y[-1]) − 1)}`.
     This is the fitted trend's gap to the last close.
   - `members = ["prophet"]` and `member_medians = {}`.
   - Append `PROPHET_WARNING` to `warnings`, after any shared-window or cap warning.
5. **A fit exception** (any `Exception` from `fit` or `predictive_samples`) becomes
   `ForecastInputError("Prophet could not be fitted to this lookback. Try a longer lookback or the EWMA model.")`.

**Types:** `ForecastResult.current_vol` becomes `float | None`, and so does
`ForecastResponse.current_vol` in `schemas.py`. The ensemble is unchanged and never includes
Prophet.

## Backend tests

These go in `test_forecast_run.py` unless noted. Prophet is installed in the dev venv, so **no
`importorskip`**. The tests must actually run.

1. **Constant growth:** add `"prophet"` to the existing `test_constant_growth` parametrize. The
   same assertions must pass (median ≈ 1064.99331, `current_vol == 0`), through the degenerate
   rule.
2. **`test_prophet_on_regime`:** `REGIME`, `model="prophet"`, `lookback_days=800`,
   `horizon_days=63` and `num_simulations=500`. Assert:
   - `current_vol is None`, `vol_forecast == []` and `members == ["prophet"]`;
   - `paths[0]` has every band equal to 1000;
   - every point satisfies `p5 <= p25 <= p50 <= p75 <= p95`;
   - `paths[-1].day == 63`;
   - `"end_gap" in params`;
   - `PROPHET_WARNING in warnings`;
   - `num_simulations == 500`.
3. **`test_prophet_caps_samples`:** the same inputs with `num_simulations=5000`.
   - `num_simulations == 2000`.
   - `"Prophet draws at most 2,000 samples, so this forecast uses 2,000."` is in `warnings`.
4. **`test_prophet_is_deterministic`:** two identical runs on `REGIME` give equal `terminal`.
5. **`test_prophet_not_installed`:** monkeypatch `app.forecast_run._load_prophet` to raise
   `ForecastInputError("Prophet is not installed on this server.")`. `model="prophet"` on `REGIME`
   raises it, and `model="ewma"` still works.
6. **`test_prophet_minimum_returns`:** the 100-return series from the existing minimum test raises
   `"Prophet needs at least 250 daily returns, but the holdings share only 100. Choose a longer lookback."`.
7. **Ensemble excludes Prophet:** in the existing `test_regime_and_ensemble`, the
   `members == ["ewma", "garch", "arima"]` assertion already covers this. Leave it as it is.
8. **API (`test_api_forecast.py`):** add a `C`-based prophet request with `"lookback_days": 730` (C has 260 returns; Prophet needs 250), which is degenerate and
   fast. It returns 200, `current_vol == 0`, and `"Prophet is unstable and untested here."` is the
   start of one warning. Then update the existing 422 message assertion.

## Frontend

**`client.ts`:** `current_vol: number | null`.

**`lib/forecast.ts`:**
- `ForecastModel` adds `'prophet'`. Append this entry to `FORECAST_MODELS`:
  ```ts
  { value: 'prophet', label: 'Prophet (untested)', tooltip: 'Unstable and untested. Extrapolates the trend and yearly pattern of the portfolio’s value. Its bands are not based on volatility.' }
  ```
- **`volatilitySummary`:** if `current_vol === null`, return
  `"Prophet does not forecast volatility. Its bands come from how uncertain the trend is, so they widen with the horizon."`.
- **`paramRows`:** `end_gap` gets the label `"Fitted trend vs last close"`. Its value is
  `${(v * 100).toFixed(2)}%`, with a leading `+` when `v > 0`.
- **`forecastCsv`:** when no `vol_forecast` point exists for a day, the `vol` field is **empty**,
  not `0`, so the row ends in `,`. The current `?? 0` is wrong for Prophet.

**`ForecastSection.tsx`:** the volatility chart caption.
- When `response.vol_forecast.length === 0`, show `"Grey is the realised volatility over each past 21 trading days. Prophet does not forecast volatility, so there is no forecast line."`.
- Otherwise keep the existing caption.

That is the only change to this file. The select already renders from `FORECAST_MODELS`.

**`lib/forecastGuide.ts`:** the copy below goes in **verbatim**.
- **"The models":** add a fifth entry after Ensemble.
  - Its term must equal the label, because the existing guide test compares the terms with
    `FORECAST_MODELS` labels.
  - Term: `Prophet (untested)`.
  - Text: "Unstable and untested. Prophet, a forecasting library from Meta, fits a trend with occasional bends, plus a yearly pattern, to the portfolio’s value and extends them forward. Its bands come from how much the trend might bend and from day-to-day noise, not from the portfolio’s volatility, so they are often much wider than the other models’ at long horizons, and the first day can jump if the fitted trend ends away from the last close. It is not part of the Ensemble and has not been checked against what happened. It draws at most 2,000 samples and needs at least 250 shared daily returns."
- **"Settings" → "Model":** "EWMA, GARCH, ARIMA, Ensemble or Prophet (untested). See The models."
- **"Short history":** change the last sentence to "EWMA and ARIMA need at least 60 shared daily
  returns; GARCH, Ensemble and Prophet need 250."
- **"Reading the results" → "Fitted parameters":** append the sentence: " For Prophet, the gap
  between the fitted trend and the last close shows how far the first forecast day may jump."

**Tests (`forecast.test.ts`)**, all in addition to the existing ones:
- `volatilitySummary({ ...RESPONSE, current_vol: null })` returns the Prophet sentence.
- `paramRows({ ...RESPONSE, params: { end_gap: 0.0096 } })` is `[{ label: 'Fitted trend vs last close', value: '+0.96%' }]`.
- `forecastCsv({ ...RESPONSE, vol_forecast: [] })`: every data row ends in `,`.
- `FORECAST_MODELS.map(m => m.value)` is `['ewma','garch','arima','ensemble','prophet']`.

## Out of scope

- Adding Prophet to the Ensemble.
- Calibration.
- Plotly.
- Prophet holidays or regressors.
- Any change to the other four models.
- Formatting or restyling `ForecastSection`.

## Acceptance criteria

Run them in bash from the repo root.

1. **Install:** paste the `pip list` output showing the four versions above.
2. **Backend tests:** `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)` passes.
   - Before: 727.
   - After: 727 plus the number of cases you added. State it. The parametrize addition counts as
     1.
   - `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_forecast_run.py -rs)`
     shows **no skips**.
3. **Frontend tests:** `(cd frontend && npx vitest run)` passes. Paste before and after; after =
   before + the number added.
4. **Frontend checks:**
   - `(cd frontend && npx tsc -p tsconfig.app.json --noEmit)` is clean.
   - `npm run lint` shows only the two known warnings.
   - `npm run build` succeeds, and `grep -l ResponsiveContainer frontend/dist/assets/index-*.js`
     prints nothing.
5. **Prophet loads lazily:**
   `grep -n "^from prophet\|^import prophet" backend/app/forecast_run.py` prints nothing, and
   `grep -c "from prophet import Prophet" backend/app/forecast_run.py` prints `1`.
6. `grep -n "prophet" backend/requirements.txt` prints exactly `prophet==1.4.0`, and
   `grep -c "prophet" backend/requirements-dev.txt` prints `0`.
7. **Timing:** reuse 0149's throwaway setup (30 holdings, 1300 business days, seed 0) with
   `model="prophet"`, `horizon_days=504` and `num_simulations=10000`. Time `run_forecast` twice;
   the first call includes the import. Paste both times. **The limit:** ≤ 5.0 s each.
8. **`awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/forecast.ts frontend/src/lib/forecastGuide.ts frontend/src/lib/forecast.test.ts frontend/src/lib/forecastGuide.test.ts`**
   prints nothing. Long string literals may be split with `+`, as in 0150 Rework 2. Format only the four `lib/` files with `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write <files>`. **Never run Prettier on `ForecastSection.tsx`**, which holds Gunnar's tweaks.
9. **Real data:** if the backend on `localhost:8000` is running and has reloaded with Prophet
   installed, run 0149's curl with `"model":"prophet"`. Paste `current_vol`, `terminal`, `params`,
   `warnings` and `num_simulations`. If it isn't running, say so.

`BLOCKED` is the right answer to a criterion that cannot be satisfied. Report every deviation,
even one you think is harmless.

## Human verification — Gunnar

1. **Restart the backend** after the install. The running server won't see the new package until
   it restarts.
2. **Run Forecast → Prophet (untested), 1 Yr.** You should see:
   - the untested warning in the summary card;
   - the Prophet vol sentence;
   - a volatility chart with only the realised line;
   - a fan much wider than GARCH's.
3. **Before deploying to Render:** the next deploy installs Prophet (about 80 MB more). Watch the
   first build. If Render runs out of memory or build time, tell the planner. The app still works
   without Prophet; only that model returns "Prophet is not installed on this server."

## Open questions

None.
