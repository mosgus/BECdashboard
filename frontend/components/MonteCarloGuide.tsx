"use client";
import { X } from "lucide-react";

interface Props {
  onClose: () => void;
}

const SECTIONS = [
  {
    name: "What is Monte Carlo Simulation?",
    body: "Monte Carlo simulation generates thousands of possible future portfolio paths by randomly sampling daily returns from the historical distribution. Each path represents one plausible outcome — the spread of paths shows the range of uncertainty in your portfolio's future value.",
  },
  {
    name: "How GBM Works",
    body: "Geometric Brownian Motion (GBM) models each day's return as: R = \u03BC + \u03C3\u00B7Z, where \u03BC is the historical mean daily return, \u03C3 is the daily standard deviation, and Z is a random normal draw. This produces log-normally distributed prices — they can't go below zero and have right-skewed upside, which matches real equity behavior reasonably well.",
  },
  {
    name: "Reading the Fan Chart",
    body: "The fan chart shows percentile bands: P5 (worst 5% of outcomes), P25, P50 (median), P75, and P95 (best 5%). Wider bands indicate more uncertainty. The dashed line marks your starting capital — paths below it represent losses. If most of the P50 line stays above the starting capital, the portfolio has positive expected return.",
  },
  {
    name: "Terminal Distribution",
    body: "Terminal stats summarize where your portfolio ends up after the full horizon. Key numbers: Prob. of Loss tells you how likely you are to be underwater; P5 shows your worst-case floor (95% confidence); Mean vs Median divergence reveals skewness — a median below the mean suggests a few lucky paths pulling the average up.",
  },
  {
    name: "Efficient Frontier",
    body: "The efficient frontier shows the best possible risk-return tradeoff for your holdings. Every point on the curve is a portfolio that minimises volatility for a given return level (or maximises return for a given risk). Your current portfolio is plotted as a dot — the closer it is to the frontier, the more efficiently you're using your risk budget. Points below the frontier are suboptimal.",
  },
  {
    name: "Brier Score & Calibration",
    body: "The Brier score measures how well the simulation's probabilistic forecasts match reality, using a hold-out backtest. Coverage 50% checks if ~50% of actual outcomes fell within the P25\u2013P75 band (expected for a well-calibrated model). Coverage 90% checks the P5\u2013P95 band. A well-calibrated model has coverage close to the target percentages. Overconfident = bands too narrow; underconfident = bands too wide.",
    caveat: "Brier scoring uses a single hold-out window (the most recent N days), so it can be noisy for short horizons or during regime changes.",
  },
  {
    name: "Limitations",
    body: "GBM assumes returns are independent and identically distributed (i.i.d.) — it doesn't capture momentum, mean reversion, volatility clustering, or regime changes. Fat tails (extreme events like 2008 or COVID) are underrepresented. The simulation is calibrated to your specific lookback window, so results change with different time periods. Use Monte Carlo as one input among many, not as a precise forecast.",
  },
];

export default function MonteCarloGuide({ onClose }: Props) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-14 bottom-0 z-50 flex w-[420px] max-w-[95vw] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Monte Carlo & Frontier Guide
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {SECTIONS.map((s) => (
            <div
              key={s.name}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4"
            >
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                {s.name}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">
                {s.body}
              </p>
              {"caveat" in s && s.caveat && (
                <p className="mt-2 text-xs italic text-amber-600">
                  {s.caveat}
                </p>
              )}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
