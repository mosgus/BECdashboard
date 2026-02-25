"use client";
import { useState } from "react";
import { HelpCircle, X } from "lucide-react";

const GLOSSARY = [
  {
    term: "SMA (Simple Moving Average)",
    def: "The average closing price over the last N days. SMA20 reacts faster than SMA50. A bullish crossover occurs when the faster SMA crosses above the slower one.",
  },
  {
    term: "RSI (Relative Strength Index)",
    def: "A momentum oscillator (0–100). Above 70 = overbought (potential pullback). Below 30 = oversold (potential rebound). Neutral between 30–70.",
  },
  {
    term: "MACD (Moving Average Convergence/Divergence)",
    def: "Difference between the 12-day and 26-day EMAs. The signal line (9-day EMA of MACD) is used for crossover signals. Histogram = MACD − Signal.",
  },
  {
    term: "ATR (Average True Range)",
    def: "Measures volatility by averaging the true range (max of: high−low, |high−prev close|, |low−prev close|) over 14 days. Higher ATR = wider daily swings.",
  },
  {
    term: "Bullish / Bearish",
    def: "Bullish = upward momentum signal (fast above slow, MACD > signal). Bearish = downward momentum signal.",
  },
  {
    term: "Last Trigger Date",
    def: "The most recent date on which the signal condition changed state. Hover a badge to see this date.",
  },
  {
    term: "Data caveat",
    def: "All prices are sourced from Yahoo Finance (adjusted close). Data may be delayed by 15–20 minutes during market hours. Signals are computed on historical closes — not real-time.",
  },
  {
    term: "Simulated Analytics",
    def: "Portfolio analytics assume the current weights have been held constant over the entire lookback period. No trade history is required. The result is illustrative — actual returns would differ due to rebalancing, transaction costs, and weight drift.",
  },
  {
    term: "Sharpe Ratio",
    def: "Risk-adjusted return: (CAGR − risk-free rate) ÷ annualised volatility. Higher is better. Above 1.0 is generally considered strong; above 2.0 is exceptional. Assumes a 3.64% risk-free rate.",
  },
  {
    term: "Max Drawdown",
    def: "The largest peak-to-trough percentage decline over the period. Negative by convention (e.g. −0.25 = 25% drop). Smaller magnitude is better.",
  },
  {
    term: "Beta / Alpha",
    def: "Beta measures sensitivity to the benchmark (SPY): 1.0 = moves with the market, >1 = amplified swings. Alpha is the annualised excess return above what beta would predict — positive alpha is favourable.",
  },
  {
    term: "Alert Cooldown",
    def: "The minimum number of days that must pass before the same rule+ticker combination can fire again. Prevents alert storms after a single sharp move.",
  },
  {
    term: "Optimize Modes",
    def: "Min Variance: finds the weight combination with the lowest historical volatility. Max Sharpe: maximises the Sharpe ratio using 2-year historical returns. Implied trades = target weight − current weight.",
  },
];

export default function HelpSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
        title="Indicator glossary"
      >
        <HelpCircle size={14} />
        Help
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setOpen(false)}
          />
          {/* Panel */}
          <aside className="relative z-10 flex h-full w-80 flex-col overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Help &amp; Glossary</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-col gap-4 p-4">
              {GLOSSARY.map(({ term, def }) => (
                <div key={term}>
                  <p className="text-xs font-semibold text-[var(--color-text)]">{term}</p>
                  <p className="mt-1 text-xs text-[var(--color-muted)] leading-relaxed">{def}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
