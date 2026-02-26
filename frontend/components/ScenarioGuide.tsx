"use client";
import { X } from "lucide-react";

interface Props {
  onClose: () => void;
}

const SCENARIOS = [
  {
    name: "Market Shock",
    tagline: "Apply a uniform instant shock to every position simultaneously.",
    whenToUse:
      "Use to stress-test a single macro event: a flash crash, a rate surprise, or a sector meltdown. Enter a negative percentage (e.g. −20%) to see the portfolio drawdown. A positive shock models a rally.",
    caveat:
      "Assumes perfect correlation — every asset moves by exactly the same percentage at the same time. Real crashes feature differentiated reactions across sectors, so this is an upper-bound worst-case.",
  },
  {
    name: "Vol Shock",
    tagline: "Scale market volatility by a multiplier and see the new portfolio risk level.",
    whenToUse:
      "Use to model a VIX spike or a regime change from low-vol to high-vol. A 2× vol shock doubles the standard deviation of every asset — the resulting portfolio vol scales proportionally via the covariance matrix.",
    caveat:
      "Assumes correlations are stable under stress. In real crises correlations tend to rise (diversification breaks down), so the true shocked vol may be higher than estimated.",
  },
  {
    name: "Historical Replay",
    tagline: "Apply today's weights to a specific historical period and see how they would have performed.",
    whenToUse:
      "Use to answer 'how would my current portfolio have done during 2008, 2020 COVID, or 2022 rate hikes?' Returns, drawdowns, best/worst days, and per-asset contribution are all computed on real price data.",
    caveat:
      "Historical replay is not a backtest — weights are held fixed for the entire window with no rebalancing, transaction costs, or slippage. Results are illustrative, not predictive.",
  },
];

const INTERPRETATION = [
  {
    label: "Portfolio Impact",
    text: "Market shock only. The total dollar-weighted P&L as a fraction of portfolio value (e.g. −0.18 = −18%).",
  },
  {
    label: "Contribution Table",
    text: "Per-asset breakdown. Contribution = weight × shock_pct. Sorted worst-to-best. The largest contributors to losses are shown first.",
  },
  {
    label: "Base vs Shocked Vol",
    text: "Vol shock only. Base vol is the current annualised portfolio volatility. Shocked vol is the result after scaling the covariance matrix by vol_scale².",
  },
  {
    label: "Equity Curve",
    text: "Historical replay only. Shows $1 growing through the selected window. The curve reveals entry/exit timing and drawdown severity in context.",
  },
  {
    label: "Total Return / Max DD",
    text: "Historical replay only. Total return is the buy-and-hold gain over the window. Max drawdown is the peak-to-trough drop in the equity curve.",
  },
];

export default function ScenarioGuide({ onClose }: Props) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <aside className="fixed right-0 top-14 bottom-0 z-50 flex w-[440px] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Scenario Guide
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Scenario cards */}
          {SCENARIOS.map((s, i) => (
            <div
              key={s.name}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">{s.name}</p>
                  <p className="mt-0.5 text-xs italic text-[var(--color-muted)]">{s.tagline}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2 pl-9">
                <div>
                  <p className="text-xs font-medium text-[var(--color-text)]">When to use</p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">{s.whenToUse}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[var(--color-negative)]">Caveat</p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">{s.caveat}</p>
                </div>
              </div>
            </div>
          ))}

          {/* Interpretation section */}
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
            <p className="text-xs font-semibold text-[var(--color-text)] mb-3">
              How to read the results
            </p>
            <div className="space-y-3">
              {INTERPRETATION.map((item) => (
                <div key={item.label}>
                  <p className="text-xs font-medium text-[var(--color-text)]">{item.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-[10px] text-[var(--color-muted)] pb-4">
            All scenarios use historical price data and simplified assumptions. Results are
            illustrative only and do not constitute investment advice.
          </p>
        </div>
      </aside>
    </>
  );
}
