"""Portfolio price & volatility forecasting: EWMA, ARIMA, Prophet, Ensemble.

All methods accept an equity curve (pd.Series, DatetimeIndex, values >= 1.0)
and return a dict with:
  - price_series: list[ForecastPoint]
  - vol_series:   list[ForecastPoint]
  - calibration:  {rmse, mae, directional_accuracy}
  - model_info:   dict
  - method:       str
"""
from __future__ import annotations

import numpy as np
import pandas as pd

HOLD_OUT = 30  # calibration hold-out window (trading days)


# ── Type alias ────────────────────────────────────────────────────────────────

ForecastPoint = dict  # {date, actual?, p10?, p25?, p50?, p75?, p90?}


# ── Internal helpers ──────────────────────────────────────────────────────────

def _log_returns(equity: pd.Series) -> pd.Series:
    return np.log(equity / equity.shift(1)).dropna()


def _rolling_vol(log_ret: pd.Series, window: int = 21) -> pd.Series:
    return log_ret.rolling(window).std() * np.sqrt(252)


def _percentile_bands(
    paths: np.ndarray,
    base_price: float,
    dates: pd.DatetimeIndex,
) -> list[ForecastPoint]:
    """Convert (n_paths × horizon) cumulative-return matrix to percentile bands."""
    prices = base_price * paths  # shape: (n_paths, horizon)
    pcts = np.percentile(prices, [10, 25, 50, 75, 90], axis=0)
    points = []
    for i, d in enumerate(dates):
        points.append({
            "date": str(d.date()),
            "p10": round(float(pcts[0, i]), 4),
            "p25": round(float(pcts[1, i]), 4),
            "p50": round(float(pcts[2, i]), 4),
            "p75": round(float(pcts[3, i]), 4),
            "p90": round(float(pcts[4, i]), 4),
        })
    return points


def _history_points(equity: pd.Series) -> list[ForecastPoint]:
    """Convert historical equity to ForecastPoints with 'actual' field only."""
    return [{"date": str(d.date()), "actual": round(float(v), 4)} for d, v in equity.items()]


def _vol_history_points(log_ret: pd.Series, window: int = 21) -> list[ForecastPoint]:
    vol = _rolling_vol(log_ret, window).dropna()
    return [{"date": str(d.date()), "actual": round(float(v), 4)} for d, v in vol.items()]


def _calibration(equity: pd.Series, method: str, horizon: int = HOLD_OUT) -> dict:
    """Fit on equity[:-horizon], forecast horizon steps, compare P50 vs actual."""
    if len(equity) <= horizon + 60:
        return {"rmse": None, "mae": None, "directional_accuracy": None}

    train = equity.iloc[:-horizon]
    actual = equity.iloc[-horizon:].values

    try:
        if method == "ewma":
            fc = forecast_ewma(train, horizon, calibrating=True)
        elif method == "arima":
            fc = forecast_arima(train, horizon, calibrating=True)
        elif method == "prophet":
            fc = forecast_prophet(train, horizon, calibrating=True)
        else:
            return {"rmse": None, "mae": None, "directional_accuracy": None}

        predicted = np.array([pt["p50"] for pt in fc["price_series"] if pt.get("p50") is not None])
        n = min(len(predicted), len(actual))
        if n == 0:
            return {"rmse": None, "mae": None, "directional_accuracy": None}
        predicted = predicted[:n]
        actual = actual[:n]

        rmse = float(np.sqrt(np.mean((predicted - actual) ** 2)))
        mae = float(np.mean(np.abs(predicted - actual)))
        dir_acc = float(np.mean(
            np.sign(np.diff(predicted)) == np.sign(np.diff(actual))
        )) if n > 1 else None

        return {
            "rmse": round(rmse, 4),
            "mae": round(mae, 4),
            "directional_accuracy": round(dir_acc, 4) if dir_acc is not None else None,
        }
    except Exception:
        return {"rmse": None, "mae": None, "directional_accuracy": None}


def _future_biz_dates(last_date: pd.Timestamp, horizon: int) -> pd.DatetimeIndex:
    return pd.bdate_range(start=last_date + pd.Timedelta(days=1), periods=horizon)


# ── EWMA forecast ─────────────────────────────────────────────────────────────

def forecast_ewma(
    equity: pd.Series,
    horizon: int,
    n_paths: int = 500,
    seed: int = 42,
    calibrating: bool = False,
) -> dict:
    """GBM simulation with EWMA drift (λ=0.97) and EWMA vol (λ=0.94)."""
    log_ret = _log_returns(equity)
    lam_vol = 0.94
    lam_drift = 0.97

    # EWMA vol
    ewma_var = float(log_ret.var())
    for r in log_ret:
        ewma_var = lam_vol * ewma_var + (1 - lam_vol) * r**2
    sigma_daily = float(np.sqrt(max(ewma_var, 1e-12)))

    # EWMA drift
    ewma_mu = float(log_ret.mean())
    for r in log_ret:
        ewma_mu = lam_drift * ewma_mu + (1 - lam_drift) * r
    mu_daily = ewma_mu

    rng = np.random.default_rng(seed)
    eps = rng.standard_normal((n_paths, horizon))
    # GBM: log price increments
    log_increments = (mu_daily - 0.5 * sigma_daily**2) + sigma_daily * eps
    cum_returns = np.exp(np.cumsum(log_increments, axis=1))  # (n_paths, horizon)

    base_price = float(equity.iloc[-1])
    last_date = equity.index[-1]
    fut_dates = _future_biz_dates(last_date, horizon)
    price_fc = _percentile_bands(cum_returns, base_price, fut_dates)

    # Vol forecast: constant EWMA vol as point estimate (no fan)
    sigma_ann = sigma_daily * np.sqrt(252)
    vol_fc = [{"date": str(d.date()), "p50": round(sigma_ann, 4)} for d in fut_dates]

    result = {
        "price_series": _history_points(equity) + price_fc,
        "vol_series": _vol_history_points(log_ret) + vol_fc,
        "model_info": {
            "lambda_vol": lam_vol,
            "lambda_drift": lam_drift,
            "sigma_daily": round(sigma_daily, 6),
            "mu_daily": round(mu_daily, 6),
            "n_paths": n_paths,
        },
        "method": "ewma",
    }
    if not calibrating:
        result["calibration"] = _calibration(equity, "ewma", horizon)
    return result


# ── ARIMA forecast ────────────────────────────────────────────────────────────

def forecast_arima(
    equity: pd.Series,
    horizon: int,
    calibrating: bool = False,
) -> dict:
    """ARIMA(1,1,0) on log prices; confidence intervals mapped to P10/P90."""
    from statsmodels.tsa.arima.model import ARIMA  # lazy import

    log_eq = np.log(equity.values)
    model = ARIMA(log_eq, order=(1, 1, 0))
    fit = model.fit()
    fc_obj = fit.get_forecast(steps=horizon)
    fc_frame = fc_obj.summary_frame(alpha=0.1)  # 90% CI → P5/P95 approx

    base_price = float(equity.iloc[-1])
    last_date = equity.index[-1]
    fut_dates = _future_biz_dates(last_date, horizon)

    price_fc = []
    for i, d in enumerate(fut_dates):
        p50 = float(np.exp(fc_frame["mean"].iloc[i]))
        p10 = float(np.exp(fc_frame["mean_ci_lower"].iloc[i]))
        p90 = float(np.exp(fc_frame["mean_ci_upper"].iloc[i]))
        p25 = float(np.exp(0.75 * fc_frame["mean"].iloc[i] + 0.25 * fc_frame["mean_ci_lower"].iloc[i]))
        p75 = float(np.exp(0.75 * fc_frame["mean"].iloc[i] + 0.25 * fc_frame["mean_ci_upper"].iloc[i]))
        price_fc.append({
            "date": str(d.date()),
            "p10": round(p10, 4),
            "p25": round(p25, 4),
            "p50": round(p50, 4),
            "p75": round(p75, 4),
            "p90": round(p90, 4),
        })

    log_ret = _log_returns(equity)
    sigma_ann = float(log_ret.std() * np.sqrt(252))
    vol_fc = [{"date": str(d.date()), "p50": round(sigma_ann, 4)} for d in fut_dates]

    result = {
        "price_series": _history_points(equity) + price_fc,
        "vol_series": _vol_history_points(log_ret) + vol_fc,
        "model_info": {"order": "1,1,0", "aic": round(float(fit.aic), 2)},
        "method": "arima",
    }
    if not calibrating:
        result["calibration"] = _calibration(equity, "arima", horizon)
    return result


# ── Prophet forecast ──────────────────────────────────────────────────────────

def forecast_prophet(
    equity: pd.Series,
    horizon: int,
    calibrating: bool = False,
) -> dict:
    """Prophet on log prices. Lazy import to avoid startup overhead."""
    from prophet import Prophet  # noqa: PLC0415

    df = pd.DataFrame({"ds": equity.index, "y": np.log(equity.values)})
    m = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=False,
        daily_seasonality=False,
        interval_width=0.9,
    )
    m.fit(df)
    last_date = equity.index[-1]
    fut_dates = _future_biz_dates(last_date, horizon)
    future_df = pd.DataFrame({"ds": fut_dates})
    forecast = m.predict(future_df)

    price_fc = []
    for _, row in forecast.iterrows():
        p50 = float(np.exp(row["yhat"]))
        p10 = float(np.exp(row["yhat_lower"]))
        p90 = float(np.exp(row["yhat_upper"]))
        p25 = float(np.exp(0.75 * row["yhat"] + 0.25 * row["yhat_lower"]))
        p75 = float(np.exp(0.75 * row["yhat"] + 0.25 * row["yhat_upper"]))
        price_fc.append({
            "date": str(pd.Timestamp(row["ds"]).date()),
            "p10": round(p10, 4),
            "p25": round(p25, 4),
            "p50": round(p50, 4),
            "p75": round(p75, 4),
            "p90": round(p90, 4),
        })

    log_ret = _log_returns(equity)
    sigma_ann = float(log_ret.std() * np.sqrt(252))
    vol_fc = [{"date": str(d.date()), "p50": round(sigma_ann, 4)} for d in fut_dates]

    result = {
        "price_series": _history_points(equity) + price_fc,
        "vol_series": _vol_history_points(log_ret) + vol_fc,
        "model_info": {"yearly_seasonality": True, "interval_width": 0.9},
        "method": "prophet",
    }
    if not calibrating:
        result["calibration"] = _calibration(equity, "prophet", horizon)
    return result


# ── Ensemble forecast ─────────────────────────────────────────────────────────

def forecast_ensemble(
    equity: pd.Series,
    horizon: int,
) -> dict:
    """Average P50 across EWMA + ARIMA + Prophet. Outer bands = widest of all three."""
    results = {}
    errors = []
    for method, fn in [("ewma", forecast_ewma), ("arima", forecast_arima), ("prophet", forecast_prophet)]:
        try:
            results[method] = fn(equity, horizon, calibrating=True)
        except Exception as exc:
            errors.append(f"{method}: {exc}")

    if not results:
        raise RuntimeError(f"All forecast methods failed: {'; '.join(errors)}")

    # Use EWMA dates as reference
    ref_method = list(results.keys())[0]
    ref_fc = results[ref_method]["price_series"]
    n_hist = sum(1 for pt in ref_fc if pt.get("actual") is not None)
    hist_pts = ref_fc[:n_hist]
    fc_pts_by_method = {m: r["price_series"][n_hist:] for m, r in results.items()}
    fut_len = min(len(pts) for pts in fc_pts_by_method.values())

    ensemble_fc = []
    for i in range(fut_len):
        date = list(fc_pts_by_method.values())[0][i]["date"]
        p50s = [fc_pts_by_method[m][i].get("p50") for m in results if fc_pts_by_method[m][i].get("p50") is not None]
        p10s = [fc_pts_by_method[m][i].get("p10") for m in results if fc_pts_by_method[m][i].get("p10") is not None]
        p90s = [fc_pts_by_method[m][i].get("p90") for m in results if fc_pts_by_method[m][i].get("p90") is not None]
        p25s = [fc_pts_by_method[m][i].get("p25") for m in results if fc_pts_by_method[m][i].get("p25") is not None]
        p75s = [fc_pts_by_method[m][i].get("p75") for m in results if fc_pts_by_method[m][i].get("p75") is not None]
        ensemble_fc.append({
            "date": date,
            "p10": round(float(min(p10s)), 4) if p10s else None,
            "p25": round(float(min(p25s)), 4) if p25s else None,
            "p50": round(float(np.mean(p50s)), 4) if p50s else None,
            "p75": round(float(max(p75s)), 4) if p75s else None,
            "p90": round(float(max(p90s)), 4) if p90s else None,
        })

    # Vol: average across available methods
    ref_vol_fc = results[ref_method]["vol_series"]
    n_vol_hist = sum(1 for pt in ref_vol_fc if pt.get("actual") is not None)
    vol_hist = ref_vol_fc[:n_vol_hist]
    vol_fc_pts = [{"date": pt["date"], "p50": pt.get("p50")} for pt in ref_vol_fc[n_vol_hist:]]

    # Compute ensemble calibration as average of sub-model calibrations
    sub_calibrations = [_calibration(equity, m, HOLD_OUT) for m in results]
    rmse_vals = [c["rmse"] for c in sub_calibrations if c.get("rmse") is not None]
    mae_vals = [c["mae"] for c in sub_calibrations if c.get("mae") is not None]
    da_vals = [c["directional_accuracy"] for c in sub_calibrations if c.get("directional_accuracy") is not None]

    calibration = {
        "rmse": round(float(np.mean(rmse_vals)), 4) if rmse_vals else None,
        "mae": round(float(np.mean(mae_vals)), 4) if mae_vals else None,
        "directional_accuracy": round(float(np.mean(da_vals)), 4) if da_vals else None,
        "methods_used": list(results.keys()),
    }

    return {
        "price_series": hist_pts + ensemble_fc,
        "vol_series": vol_hist + vol_fc_pts,
        "model_info": {"methods": list(results.keys()), "errors": errors},
        "method": "ensemble",
        "calibration": calibration,
    }
