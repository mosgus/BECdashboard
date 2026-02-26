"use client";
import { X } from "lucide-react";

interface Props {
  onClose: () => void;
}

const METHODS = [
  {
    name: "EWMA + GBM (ewma)",
    tagline: "500 simulated paths with EWMA drift (λ=0.97) and EWMA vol (λ=0.94).",
    whenToUse:
      "Best all-purpose baseline. Applies exponential weighting to drift and volatility estimates so recent returns matter more than distant history. 500 independent GBM paths are simulated and collapsed to percentile bands — uncertainty widens realistically as horizon grows.",
    caveat:
      "Assumes log-normal returns (no jumps, no fat tails, no mean reversion). The fan widens linearly with the square root of time — may overstate long-horizon uncertainty for range-bound strategies.",
  },
  {
    name: "ARIMA(1,1,0) (arima)",
    tagline: "Autoregressive model on log prices — captures short-term momentum in the trend.",
    whenToUse:
      "Useful when recent trend is strong and expected to persist. Fits a first-order autoregressive model on differenced log prices. Confidence intervals come directly from the model's standard errors, mapped to P10/P90 bands via 90% alpha.",
    caveat:
      "Overconfident in flat or mean-reverting markets. Over long horizons the forecast degenerates toward a linear extrapolation. Bands can appear artificially narrow compared to Monte Carlo methods.",
  },
  {
    name: "Prophet (prophet)",
    tagline: "Trend + yearly seasonality decomposition — more robust to structural breaks.",
    whenToUse:
      "Ideal when the equity curve shows repeating annual patterns (e.g. seasonal factor tilt). Prophet fits a piecewise linear trend with automatic changepoint detection, making it more resilient to one-off structural breaks than pure AR models.",
    caveat:
      "Adds 30–60 s compute time. Requires at least 1–2 years of data for meaningful yearly seasonality. For monotonic equity curves without seasonality, Prophet may over-fit trend changepoints and produce surprising results.",
  },
  {
    name: "Ensemble (ensemble)",
    tagline: "Average P50 across all three methods; outer bands are the widest of all three.",
    whenToUse:
      "The recommended default. Blends EWMA, ARIMA, and Prophet to reduce model-specific bias. The median line (P50) is the simple mean of all three models' P50s at each horizon step. P10/P90 outer bands use the minimum/maximum across models for conservative uncertainty quantification.",
    caveat:
      "Slowest option — includes Prophet's 30–60 s overhead. If one sub-model fails silently it is dropped; the ensemble continues with the remaining two. Calibration metrics are averaged across whichever sub-models succeed.",
  },
];

const INTERPRETATION = [
  {
    label: "Fan chart bands",
    text: "P10 / P90 = outer shaded region (10th–90th percentile of simulated outcomes). P25 / P75 = inner shaded region (25th–75th percentile). P50 = dashed median forecast line. Historical actual = solid line. The vertical dashed reference line marks the forecast start date.",
  },
  {
    label: "Calibration panel",
    text: "The model is re-fitted on all data except the last 30 trading days (hold-out). The median forecast is then compared to the actual equity values in that window. RMSE and MAE are in equity-curve units (the series is normalised to start at 1.0). Directional accuracy is the fraction of hold-out days where the sign of the forecast change matched the actual change.",
  },
  {
    label: "Vol forecast (bottom chart)",
    text: "Historical volatility is a 21-day rolling annualised standard deviation of log returns. The forecast is a flat projection of the current EWMA volatility estimate — it does not widen with horizon. For ARIMA and Prophet, the same EWMA point-estimate is used as a constant volatility forecast.",
  },
  {
    label: "Horizon selector",
    text: "30 d / 60 d / 90 d sets the number of business days forward. Longer horizons produce wider fan bands — uncertainty compounds with time. ARIMA and EWMA are fast (<1 s); Prophet adds ~30–60 s. Ensemble always runs all three.",
  },
];

export default function ForecastGuide({ onClose }: Props) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className="fixed right-0 top-14 bottom-0 z-50 flex w-[440px] max-w-[95vw] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        role="dialog"
        aria-label="Forecast Guide"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Forecast Methods Guide</h2>
            <p className="text-xs text-[var(--color-muted)]">Fan chart shows P10 / P25 / P50 / P75 / P90</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Close guide"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Method cards */}
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Methods</p>
          {METHODS.map((m) => (
            <div
              key={m.name}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-sm"
            >
              <p className="mb-1 text-sm font-bold text-[var(--color-primary)]">{m.name}</p>
              <p className="mb-2 text-xs font-medium text-[var(--color-text)]">{m.tagline}</p>
              <p className="mb-2 text-xs text-[var(--color-muted)] leading-relaxed">{m.whenToUse}</p>
              <p className="text-xs italic text-[var(--color-muted)]">⚠ {m.caveat}</p>
            </div>
          ))}

          {/* Interpretation section */}
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            How to interpret results
          </p>
          {INTERPRETATION.map((item) => (
            <div
              key={item.label}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-sm"
            >
              <p className="mb-1 text-xs font-semibold text-[var(--color-text)]">{item.label}</p>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed">{item.text}</p>
            </div>
          ))}

          {/* Footer disclaimer */}
          <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-muted)] leading-relaxed">
            <strong className="text-[var(--color-text)]">Disclaimer:</strong> All forecasts are
            statistical models, not investment advice. Past performance does not guarantee future
            results. Calibration metrics reflect in-sample hold-out performance only.
          </div>
        </div>
      </aside>
    </>
  );
}
