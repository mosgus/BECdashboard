"use client";
import { X } from "lucide-react";

interface Props {
  onClose: () => void;
}

const TESTS = [
  {
    name: "Sharpe t-test (Lo 2002)",
    tagline: "Is the annualised Sharpe ratio statistically different from zero?",
    whenToUse:
      "Assesses whether your portfolio's risk-adjusted return is genuinely above zero vs. random luck. Lo's (2002) autocorrelation correction is applied — without it, serially correlated returns (e.g. momentum strategies) would inflate the t-statistic and produce false positives.",
    caveat:
      "Requires at least ~90 days of returns. A strong recent period can inflate the Sharpe artificially — always view in the context of the full Analytics tab.",
  },
  {
    name: "Block Permutation Null",
    tagline: "Does return timing add alpha over 500 random 20-day block shuffles?",
    whenToUse:
      "Destroys the timing of returns while preserving short-run autocorrelation structure (20-day ≈ 1 trading month). If your observed Sharpe beats ≥ 95% of shuffled versions (p < 0.05), the timing of your returns genuinely adds value beyond what chance would produce.",
    caveat:
      "Sensitive to block size. Very short histories (< 100 days) yield noisy p-values. Running in quick mode uses 500 permutations; full mode uses 2,000 for greater precision.",
  },
  {
    name: "Bootstrap 95% CI (Sharpe)",
    tagline: "Does the 95% confidence interval for the Sharpe ratio exclude zero?",
    whenToUse:
      "More reliable than a normal approximation. Uses circular block bootstrap to estimate uncertainty around the Sharpe ratio. A PASS means both the lower and upper bounds of the 95% CI are positive — your Sharpe is robustly above zero even accounting for sampling variability.",
    caveat:
      "Wide CIs are normal with small samples — even a PASS can shift on fresh data. Use as one signal among many, not in isolation.",
  },
  {
    name: "ADF Stationarity",
    tagline: "Are returns stationary? (Augmented Dickey-Fuller unit root test)",
    whenToUse:
      "A PASS (reject unit root, p < 0.05) confirms the return distribution is stable over time — a prerequisite for Sharpe ratios, volatility estimates, and risk metrics to be meaningful. Non-stationary returns would mean these summary statistics are changing over the lookback period.",
    caveat:
      "A FAIL may reflect a structural shift in portfolio composition (e.g. a major weight change mid-period) rather than a genuine random walk. Check if the lookback window is consistent.",
  },
  {
    name: "Serial Independence (Ljung-Box)",
    tagline: "Are daily returns serially independent? (Ljung-Box test, lag 1–10)",
    whenToUse:
      "A PASS (p > 0.05, no significant autocorrelation) means returns approximate iid noise — consistent with efficient market pricing. A FAIL indicates exploitable autocorrelation or potential look-ahead bias. Interpretation depends on strategy type: momentum portfolios will naturally exhibit short-run autocorrelation.",
    caveat:
      "A FAIL is not inherently bad. For purely passive portfolios, however, strong autocorrelation warrants investigation into data pipeline or rebalancing artefacts.",
  },
  {
    name: "Fat Tails (Jarque-Bera)",
    tagline: "Do returns have fat tails? Note: rejection of normality is expected and healthy.",
    whenToUse:
      "This test is intentionally reversed — a PASS here means Jarque-Bera rejects the null of normality (p < 0.05), which is the expected result for real equity returns with skewness and excess kurtosis. If normality is NOT rejected (test FAILS), it may indicate suspiciously smooth or synthetic returns.",
    caveat:
      "Nearly all real portfolio return series have fat tails. A FAIL (cannot reject normality) should prompt investigation of your return data — not celebration. Check for stale prices or missing data days.",
  },
  {
    name: "Drawdown Bootstrap",
    tagline: "Is the max drawdown consistent with random timing? (not worse than chance)",
    whenToUse:
      "Builds a null distribution of max drawdowns by block-shuffling returns 500 times. A PASS (p > 0.05) means your observed drawdown is NOT significantly worse than what random return timing would produce — the peak-to-trough loss is within what chance alone could explain. A FAIL means your worst loss came at an unusually bad time.",
    caveat:
      "A PASS does not mean the drawdown magnitude is acceptable. A 35% drawdown in line with random timing is still a 35% drawdown. Always check the actual Max Drawdown figure in the Analytics tab.",
  },
];

export default function ValidationGuide({ onClose }: Props) {
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
        aria-label="Validation Guide"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Validation Suite Guide</h2>
            <p className="text-xs text-[var(--color-muted)]">GO decision requires ≥ 4 / 7 tests passing</p>
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
          {TESTS.map((t, idx) => (
            <div
              key={t.name}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-sm"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[10px] font-bold text-white">
                  {idx + 1}
                </span>
                <p className="text-sm font-bold text-[var(--color-primary)]">{t.name}</p>
              </div>
              <p className="mb-2 text-xs font-medium text-[var(--color-text)]">{t.tagline}</p>
              <p className="mb-2 text-xs text-[var(--color-muted)] leading-relaxed">{t.whenToUse}</p>
              <p className="text-xs italic text-[var(--color-muted)]">⚠ {t.caveat}</p>
            </div>
          ))}

          {/* Footer note */}
          <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-muted)] leading-relaxed">
            <strong className="text-[var(--color-text)]">Quick mode</strong> uses 500 permutations and
            1,000 bootstrap samples (~20–30 s). Full mode (via API) uses 2,000 / 5,000 for greater
            statistical precision at the cost of longer runtime.
          </div>
        </div>
      </aside>
    </>
  );
}
