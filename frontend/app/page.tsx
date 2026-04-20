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
    emoji: "🗂️",
    headline: "Build or import your portfolio",
    description:
      "Add positions manually, pull tickers from the Securities universe, or upload a Bloomberg/brokerage CSV. Each position stores shares, cost basis, and current market value.",
    tip: "Start here — every other tab depends on having positions. CSV import supports Bloomberg holdings export format.",
  },
  {
    num: 2,
    tab: "Backtest",
    emoji: "📊",
    headline: "Optimize for historical performance",
    description:
      "Run backtested portfolio optimization across 9 modes — Max Sharpe, Min Variance, Risk Parity, Long/Short, and more. Inject conviction tilts via Black-Litterman views + κ overlay. Save target weights to the portfolio.",
    tip: "Use this to understand how different weightings would have performed historically. Views + κ inject your alpha directly into the optimizer's expected-return vector.",
  },
  {
    num: 3,
    tab: "Outlook",
    emoji: "🔭",
    headline: "Project forward: CAPM, Monte Carlo & Forecast",
    description:
      "CAPM-based optimization with per-ticker min/max/freeze constraints. Monte Carlo simulation across thousands of paths. Fan-chart price forecasting with EWMA, ARIMA, Prophet, or ensemble models. Refine allocation before committing.",
    tip: "Where Backtest looks backward, Outlook looks forward. Run Monte Carlo to see the distribution of outcomes before finalizing weights.",
  },
  {
    num: 4,
    tab: "Monitor",
    emoji: "📡",
    headline: "Watch candidates & live signals",
    description:
      "Live SMA, RSI, and MACD signal badges for every candidate. Configure custom indicator thresholds and alert rules. Drill into full charts with 10 extended indicators (Bollinger, ADX, Donchian, Stochastic, OBV).",
    tip: "Add a candidate here, then promote it to Holdings when signals align — Monitor is for watching, Holdings is for committing.",
  },
  {
    num: 5,
    tab: "Risk & Perf",
    emoji: "⚖️",
    headline: "Measure and stress-test your risk",
    description:
      "Equity curve vs SPY, factor attribution, HHI concentration, beta, vol, and marginal risk contributions. Preset stress scenarios (GFC, COVID crash, rate shock) plus custom market and vol shocks. Re-run after applying optimization to see how your risk profile shifts.",
    tip: "All analytics reflect current saved weights. Apply optimization in Backtest or Outlook first, then return here to measure the change.",
  },
] as const;

const RESEARCH_TOOLS = [
  {
    title: "Portfolio Health",
    href: "/research/overview",
    emoji: "🏥",
    description: "Composite score gauge (0–100), decision memos, and one-click PDF tearsheet export.",
  },
  {
    title: "Asset Research",
    href: "/research/asset",
    emoji: "🔍",
    description: "Deep-dive on any ticker: factor exposure (Fama-French), price/return charts, and peer comparison.",
  },
  {
    title: "Decision Memo",
    href: "/research/decision",
    emoji: "📋",
    description: "Auto-generated red-flag scorecard (concentration, poor Sharpe, excessive drawdown) + written decision log.",
  },
  {
    title: "Portfolio Analytics",
    href: "/research/portfolio",
    emoji: "📈",
    description: "Correlation heatmap, efficient frontier, and side-by-side optimizer comparison table.",
  },
  {
    title: "Stress & Validation",
    href: "/research/stress",
    emoji: "⚡",
    description: "Scenario stress tests (COVID, GFC, taper tantrum) + walk-forward statistical validation (Sharpe t-test, bootstrap, ADF, Ljung-Box, Jarque-Bera).",
  },
  {
    title: "Universe Screener",
    href: "/research/universe",
    emoji: "🌍",
    description: "Sector/asset breakdown, data-quality audit with letter grades, and custom filter screens for the investable universe.",
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
              An institutional-grade portfolio management system. Import or build a portfolio, backtest
              and project your weights, monitor live signals, and stress-test your risk — all in one
              URL-navigable workspace.
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
            The Five-Tab Portfolio Workflow
          </h2>
          <span className="text-xs text-[var(--color-muted)]">
            Follow steps 1 → 5 in order for your first portfolio.
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

      </div>

      {/* ── Research & Validation section ───────────────────────────────────── */}
      <div>
        <div className="mb-1 flex items-baseline gap-3">
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            Research & Validation
          </h2>
          <span className="text-xs text-[var(--color-muted)]">
            A parallel toolkit for validating strategy, auditing data quality, and stress-testing ideas — independent of any portfolio workflow.
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RESEARCH_TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm hover:shadow-md hover:border-[var(--color-primary)] transition-all flex flex-col"
            >
              {/* Tool header */}
              <div className="mb-3">
                <p className="text-2xl mb-1">{tool.emoji}</p>
                <p className="text-sm font-semibold text-[var(--color-text)]">
                  {tool.title}
                </p>
              </div>

              {/* Description */}
              <p className="text-xs leading-relaxed text-[var(--color-muted)] flex-1">
                {tool.description}
              </p>
            </Link>
          ))}
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
