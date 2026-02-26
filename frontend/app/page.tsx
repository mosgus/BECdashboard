"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { fetchPortfolioMetrics } from "@/lib/api";
import { PortfolioResponse } from "@/types/portfolio";
import { useAuth } from "@/hooks/useAuth";
import MetricsBar from "@/components/MetricsBar";
import EquityCurve from "@/components/EquityCurve";
import DrawdownChart from "@/components/DrawdownChart";
import CorrelationHeatmap from "@/components/CorrelationHeatmap";
import PerformanceTable from "@/components/PerformanceTable";

const DEFAULT_TICKERS = "AAPL, MSFT, GOOGL, AMZN, NVDA";
const TODAY = new Date().toISOString().slice(0, 10);

const WORKFLOW_STEPS = [
  {
    num: 1,
    tab: "Holdings",
    emoji: "📋",
    headline: "Build your portfolio",
    description:
      "Add positions with tickers and target weights. Set a notional dollar value so every downstream calculation is grounded in real share math. Import existing holdings from a CSV.",
    tip: "Start here — every other tab depends on having positions.",
  },
  {
    num: 2,
    tab: "Targets",
    emoji: "🎯",
    headline: "Set target weights",
    description:
      "Run the optimizer across 9 modes (Max Sharpe, Min Variance, Risk Parity, L/S, and more) or apply per-ticker conviction tilts with a tanh overlay. Target weights are saved to the database so they survive a page refresh.",
    tip: "Views + κ inject your alpha directly into the optimizer's expected-return vector.",
  },
  {
    num: 3,
    tab: "Rebalance",
    emoji: "⚖️",
    headline: "Generate trade orders",
    description:
      "Translate target weights into whole-share quantities using live prices and your notional value. Floor-and-greedily-allocate residual cash. Export a ready-to-execute CSV trade list.",
    tip: "Uses the saved target set from step 2 — no session state required.",
  },
  {
    num: 4,
    tab: "Monitor",
    emoji: "📡",
    headline: "Watch candidates",
    description:
      "Track tickers you're considering with live SMA, RSI, and MACD signal badges. Drill into any ticker's chart with 10 extended indicators (Bollinger, ADX, Donchian, Stochastic, OBV). Configure per-ticker indicator saves.",
    tip: "Add a candidate here, then promote it to Holdings when signals align.",
  },
  {
    num: 5,
    tab: "Risk & Perf",
    emoji: "📊",
    headline: "Understand your risk",
    description:
      "Simulated equity curve vs SPY, exit signals per holding, HHI concentration, beta, vol, and marginal risk contributions. Stress-test with market shocks, volatility scaling, or historical period replays — each with a mitigation playbook.",
    tip: "All analytics assume current weights held constant — no trade history needed.",
  },
  {
    num: 6,
    tab: "Research",
    emoji: "🔬",
    headline: "Validate statistically",
    description:
      "Run 7 statistical tests on the portfolio's simulated daily returns — Sharpe t-test, block permutation, bootstrap CI, ADF stationarity, Ljung-Box autocorrelation, Jarque-Bera normality, and drawdown bootstrap. Get a GO / NO-GO decision. Then forecast the equity curve and rolling vol using EWMA, ARIMA, Prophet, or an ensemble.",
    tip: "Quick mode runs in ~20 s (500 permutations). Full mode is more powerful but slower.",
  },
] as const;

export default function OverviewPage() {
  const { checked } = useAuth();

  const [rawTickers, setRawTickers] = useState(DEFAULT_TICKERS);
  const [weightMode, setWeightMode] = useState<"equal" | "custom">("equal");
  const [customWeights, setCustomWeights] = useState<Record<string, string>>({});
  const [benchmark, setBenchmark] = useState("SPY");
  const [start, setStart] = useState("2020-01-01");
  const [end, setEnd] = useState(TODAY);

  const tickers = rawTickers
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const mutation = useMutation({
    mutationFn: () => {
      let weights: number[] | undefined;
      if (weightMode === "custom") {
        const raw = tickers.map((t) => parseFloat(customWeights[t] ?? "1"));
        const sum = raw.reduce((a, b) => a + b, 0);
        weights = raw.map((w) => w / sum);
      }
      return fetchPortfolioMetrics({ tickers, weights, benchmark, start, end });
    },
  });

  const result: PortfolioResponse | undefined = mutation.data;

  if (!checked) return null;

  return (
    <div className="space-y-10">

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-8 py-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">
              Welcome to Blue Eagle Capital
            </h1>
            <p className="mt-1 max-w-xl text-sm text-[var(--color-muted)]">
              An institutional-grade portfolio management system — from holdings to targets to
              rebalancing, all in one URL-navigable workspace. Each portfolio has six tabs that
              take you from idea to execution.
            </p>
          </div>
          <Link
            href="/portfolios"
            className="shrink-0 rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            Open Portfolios →
          </Link>
        </div>
      </div>

      {/* ── Workflow walkthrough ──────────────────────────────────────────────── */}
      <div>
        <div className="mb-1 flex items-baseline gap-3">
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            The Six-Tab Workflow
          </h2>
          <span className="text-xs text-[var(--color-muted)]">
            Follow steps 1 → 6 in order for your first portfolio.
          </span>
        </div>

        {/* Connector line above the grid — visual breadcrumb */}
        <div className="mb-5 flex items-center gap-2 overflow-x-auto pb-1">
          {WORKFLOW_STEPS.map((s, i) => (
            <div key={s.num} className="flex items-center gap-2 shrink-0">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-[10px] font-bold text-white">
                {s.num}
              </span>
              <span className="text-xs font-medium text-[var(--color-text)]">{s.tab}</span>
              {i < WORKFLOW_STEPS.length - 1 && (
                <span className="text-[var(--color-muted)]">→</span>
              )}
            </div>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WORKFLOW_STEPS.map((step) => (
            <div
              key={step.num}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm flex flex-col"
            >
              {/* Step header */}
              <div className="mb-3 flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-sm font-bold text-white">
                  {step.num}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
                    {step.emoji} {step.tab}
                  </p>
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    {step.headline}
                  </p>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs leading-relaxed text-[var(--color-muted)] flex-1">
                {step.description}
              </p>

              {/* Pro tip */}
              <div className="mt-3 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
                <p className="text-[10px] leading-relaxed text-[var(--color-muted)]">
                  <span className="font-semibold text-[var(--color-accent)]">Tip: </span>
                  {step.tip}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Supporting pages note */}
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-[var(--color-text)] mb-2">Also available</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--color-muted)]">
            <span>
              <Link href="/universe" className="font-medium text-[var(--color-primary)] hover:underline">Universe</Link>
              {" "}— browse and filter the investable ticker universe that powers the UniverseTickerPicker
            </span>
            <span>
              <Link href="/technicals" className="font-medium text-[var(--color-primary)] hover:underline">Technicals</Link>
              {" "}— standalone chart tool: any ticker, any date range, any indicator overlay
            </span>
            <span>
              <Link href="/alerts" className="font-medium text-[var(--color-primary)] hover:underline">Alerts</Link>
              {" "}— configure signal-triggered alert rules (SMA cross, RSI threshold, MACD cross)
            </span>
            <span>
              <Link href="/optimize" className="font-medium text-[var(--color-primary)] hover:underline">Quick Optimize</Link>
              {" "}— ad-hoc portfolio optimization without saving to a portfolio
            </span>
            <span>
              <Link href="/ops" className="font-medium text-[var(--color-primary)] hover:underline">Ops</Link>
              {" "}— system health, data freshness, and backend diagnostics
            </span>
          </div>
        </div>
      </div>

      {/* ── Divider ───────────────────────────────────────────────────────────── */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--color-border)]" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[var(--color-bg)] px-4 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
            Quick Analysis
          </span>
        </div>
      </div>
      <p className="text-xs text-[var(--color-muted)] -mt-6">
        Ad-hoc analysis for any set of tickers — no portfolio needed. Results are not saved.
      </p>

      {/* ── Existing analyzer ────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-[var(--color-text)]">Portfolio Configuration</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Tickers (comma-separated)</label>
              <input
                value={rawTickers}
                onChange={(e) => setRawTickers(e.target.value)}
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                placeholder="AAPL, MSFT, GOOGL"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Benchmark</label>
              <input
                value={benchmark}
                onChange={(e) => setBenchmark(e.target.value.toUpperCase())}
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Weight Mode</label>
              <select
                value={weightMode}
                onChange={(e) => setWeightMode(e.target.value as "equal" | "custom")}
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                <option value="equal">Equal Weight</option>
                <option value="custom">Custom Weights</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Start Date</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">End Date</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
            </div>
          </div>

          {weightMode === "custom" && tickers.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {tickers.map((t) => (
                <label key={t} className="block">
                  <span className="text-xs font-medium text-[var(--color-muted)]">{t} weight</span>
                  <input
                    type="number"
                    value={customWeights[t] ?? "1"}
                    onChange={(e) => setCustomWeights((prev) => ({ ...prev, [t]: e.target.value }))}
                    className="mt-1 w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-sm"
                    min={0}
                    step={0.01}
                  />
                </label>
              ))}
            </div>
          )}

          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="mt-4 rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {mutation.isPending ? "Fetching…" : "Run Analysis"}
          </button>

          {mutation.error && (
            <p className="mt-2 text-sm text-[var(--color-negative)]">
              {(mutation.error as Error).message}
            </p>
          )}
          {(result?.missing?.length ?? 0) > 0 && (
            <p className="mt-2 text-xs text-[var(--color-accent)]">
              No data for: {result!.missing.join(", ")}
            </p>
          )}
        </div>

        {result && (
          <>
            <MetricsBar metrics={result.metrics} benchMetrics={result.bench_metrics} />
            <EquityCurve
              data={result.equity_curve}
              lines={[
                { key: "portfolio", color: "#3b82f6" },
                { key: "benchmark", color: "#f59e0b", dashed: true },
              ]}
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <DrawdownChart data={result.drawdown} dataKey="dd" title="Portfolio Drawdown" color="#ef4444" label="Drawdown" />
              <DrawdownChart data={result.rolling_vol} dataKey="vol" title="Rolling 21-Day Volatility" color="#8b5cf6" label="Ann. Vol" />
            </div>
            <CorrelationHeatmap data={result.correlation} />
            <PerformanceTable
              assets={result.assets}
              portfolioMetrics={result.metrics}
              benchMetrics={result.bench_metrics}
              benchmark={result.benchmark}
            />
          </>
        )}

        {!result && !mutation.isPending && (
          <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-12 text-center text-[var(--color-muted)]">
            <p className="mb-2 text-4xl">🦅</p>
            <p className="text-sm">
              Enter tickers above and click <strong>Run Analysis</strong> to load your portfolio.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
