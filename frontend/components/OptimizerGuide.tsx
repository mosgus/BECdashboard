"use client";
import { X } from "lucide-react";

interface Props {
  onClose: () => void;
}

const MODES = [
  {
    name: "Equal Weight (1/N)",
    tagline: "Simplest baseline — equal allocation across all holdings.",
    whenToUse:
      "Use when you have no conviction on returns or risk estimates and want a transparent, naive starting point. Useful as a benchmark to beat with more sophisticated methods.",
    caveat: "Ignores all return and risk information — will underweight diversifiers and overweight volatile assets equally.",
  },
  {
    name: "Min Variance",
    tagline: "Minimise portfolio volatility — no return assumption required.",
    whenToUse:
      "Best in uncertain or bearish markets where you want to reduce drawdowns. Relies only on the covariance matrix, so it is more robust when expected-return forecasts are unreliable.",
    caveat: "Tends to concentrate in low-volatility assets and may sacrifice significant return potential.",
  },
  {
    name: "Max Sharpe (Historical)",
    tagline: "Best historical risk-adjusted return using past returns as the forecast.",
    whenToUse:
      "Use when you believe historical return patterns will persist. Balances return and risk explicitly, producing the portfolio on the efficient frontier with the highest Sharpe ratio.",
    caveat: "Highly sensitive to mean-return estimates — small changes in recent history can flip weights dramatically.",
  },
  {
    name: "Max Sharpe — CAPM",
    tagline: "Forward-looking expected returns via CAPM betas instead of historical means.",
    whenToUse:
      "Use when you trust systematic risk pricing over raw history. Betas vs SPY are computed from the lookback window and used to derive expected returns (rf + β × MRP), making it less sensitive to short-term noise.",
    caveat: "Depends on CAPM assumptions (linear beta, stable market risk premium). Works best in liquid, large-cap portfolios.",
  },
  {
    name: "Risk Parity",
    tagline: "Equal risk contribution — each asset contributes the same amount of portfolio volatility.",
    whenToUse:
      "Use when you want diversification by risk rather than by dollar. Naturally overweights low-volatility assets. No return forecast needed — a pure risk-based approach.",
    caveat: "Results in significant low-vol tilts and may underperform in trending bull markets; requires w > 0 for all assets.",
  },
  {
    name: "Max Sortino",
    tagline: "Maximise return per unit of downside risk only.",
    whenToUse:
      "Best for portfolios where drawdown protection matters. Unlike Sharpe, Sortino penalises only negative returns, so it tolerates upside volatility while minimising downside vol.",
    caveat: "Requires sufficient negative-return days in the lookback to estimate downside vol reliably; noisy with short histories.",
  },
  {
    name: "Min CVaR (95%)",
    tagline: "Minimise the expected loss in the worst 5% of trading days.",
    whenToUse:
      "Tail-risk focused: directly minimises Expected Shortfall (ES) rather than variance. Preferred by risk managers who care about extreme scenarios, not just average volatility.",
    caveat: "CVaR estimates from short samples are noisy. Requires at least several hundred days of data for meaningful tail estimation.",
  },
  {
    name: "Max Diversification",
    tagline: "Maximise the diversification ratio — weighted-avg vol / portfolio vol.",
    whenToUse:
      "Use when your goal is to extract maximum benefit from low asset correlation. Naturally allocates more to assets that are weakly correlated with the rest of the portfolio.",
    caveat: "Can produce concentrated positions in a single low-correlated asset. Does not account for expected returns.",
  },
  {
    name: "Target Volatility",
    tagline: "Maximise expected return within a hard annual volatility ceiling you set.",
    whenToUse:
      "Use when you have an explicit risk budget (e.g. a 10% vol mandate). Finds the highest-return portfolio that stays at or below your target vol — essentially a constrained Max Return.",
    caveat: "If all portfolios exceed vol_target, the optimizer may not converge. Set vol_target above the minimum-variance portfolio's vol.",
  },
];

export default function OptimizerGuide({ onClose }: Props) {
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
        className="fixed right-0 top-14 bottom-0 z-50 flex w-[420px] max-w-[95vw] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        role="dialog"
        aria-label="Optimizer Guide"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Optimizer Guide
          </h2>
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
          {MODES.map((m) => (
            <div
              key={m.name}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-sm"
            >
              <p className="mb-1 text-sm font-bold text-[var(--color-primary)]">
                {m.name}
              </p>
              <p className="mb-2 text-xs font-medium text-[var(--color-text)]">
                {m.tagline}
              </p>
              <p className="mb-2 text-xs text-[var(--color-muted)] leading-relaxed">
                {m.whenToUse}
              </p>
              <p className="text-xs italic text-[var(--color-muted)]">
                ⚠ {m.caveat}
              </p>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
