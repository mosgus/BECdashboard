"use client";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  computeTilt,
  fetchPortfolioDetail,
  optimizePortfolio,
  patchPortfolioTargets,
  updatePosition,
} from "@/lib/api";
import { fmtNum, fmtPct, colorForValue, downsample } from "@/lib/utils";
import InfoTooltip from "@/components/InfoTooltip";
import OptimizerGuide from "@/components/OptimizerGuide";
import { ForwardLookingMetrics, PortfolioAnalytics, PortfolioOptimizeResult, Position, TiltResult } from "@/types/sprint3";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ── Metric Cards (used by analytics and targets) ───────────────────────────────

function MetricCards({ metrics }: { metrics: PortfolioAnalytics["metrics"] }) {
  const items = [
    {
      label: "CAGR",
      value: fmtPct(metrics.cagr),
      color: colorForValue(metrics.cagr),
      tooltip:
        "Compound Annual Growth Rate — annualised total return. The constant rate at which $1 invested would have grown to the ending value over the period.",
    },
    {
      label: "Volatility",
      value: fmtPct(metrics.vol),
      color: "",
      tooltip:
        "Annualised portfolio volatility: daily standard deviation of returns × √252.",
    },
    {
      label: "Sharpe",
      value: fmtNum(metrics.sharpe),
      color: colorForValue(metrics.sharpe),
      tooltip:
        "Risk-adjusted return: CAGR ÷ Volatility (Rf = 0). Sharpe > 1.0 is broadly acceptable; > 2.0 is excellent.",
    },
    {
      label: "Max Drawdown",
      value: fmtPct(metrics.max_dd),
      color: colorForValue(metrics.max_dd),
      tooltip:
        "Largest peak-to-trough decline in the simulated equity curve.",
    },
    ...(metrics.beta != null
      ? [
          {
            label: "Beta (vs SPY)",
            value: fmtNum(metrics.beta!),
            color: "",
            tooltip:
              "OLS market beta vs SPY. β = 1 moves in lockstep; β > 1 amplifies; β < 1 dampens.",
          },
        ]
      : []),
    ...(metrics.alpha != null
      ? [
          {
            label: "Alpha",
            value: fmtPct(metrics.alpha!),
            color: colorForValue(metrics.alpha!),
            tooltip:
              "Jensen's Alpha: annualised excess return above CAPM prediction.",
          },
        ]
      : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(({ label, value, color, tooltip }) => (
        <div
          key={label}
          className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm text-center"
        >
          <p className="flex items-center justify-center gap-0.5 text-xs text-[var(--color-muted)]">
            {label}
            <InfoTooltip text={tooltip} />
          </p>
          <p
            className={`mt-0.5 text-base font-bold ${color || "text-[var(--color-text)]"}`}
          >
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── CAPM Forward-Looking Panel ─────────────────────────────────────────────────

function ForwardLookingPanel({
  metrics,
  capmReturns,
}: {
  metrics: ForwardLookingMetrics;
  capmReturns: Record<string, number> | null | undefined;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border-2 border-indigo-200 bg-indigo-50 p-5 shadow-sm space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Forward-Looking · CAPM
          </span>
        </div>
        <h3 className="text-sm font-semibold text-indigo-900">
          Model-Implied Portfolio Projections
        </h3>
        <p className="mt-1 text-xs text-indigo-700 leading-relaxed">
          These figures are derived from the <strong>CAPM expected return model</strong> (E[R<sub>i</sub>]&nbsp;=&nbsp;r<sub>f</sub>&nbsp;+&nbsp;β<sub>i</sub>&nbsp;×&nbsp;MRP),
          not from backtesting historical prices. They represent what the model{" "}
          <em>expects going forward</em> given current betas, the live 10Y Treasury rate, and a 5% market risk premium.
          The in-sample backtest below is shown separately for comparison only — it reflects past realised returns,
          which were inflated by the 2023–2025 bull market and should not be used as a return forecast.
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Expected Return",
            value: fmtPct(metrics.expected_return),
            color: colorForValue(metrics.expected_return),
            tooltip: "Σ wᵢ × E[Rᵢ] — weighted sum of CAPM expected annual returns. This is the forward-looking portfolio return the model targets.",
          },
          {
            label: "Expected Vol",
            value: fmtPct(metrics.vol),
            color: "",
            tooltip: "√(wᵀ Σ w) using the historical covariance matrix as a forward-looking vol estimate (annualised).",
          },
          {
            label: "Forward Sharpe",
            value: fmtNum(metrics.sharpe),
            color: colorForValue(metrics.sharpe),
            tooltip: "(Expected Return − Rf) ÷ Expected Vol. This is the Sharpe ratio the optimizer actually maximised — it uses model returns, not historical actuals.",
          },
        ].map(({ label, value, color, tooltip }) => (
          <div
            key={label}
            className="rounded-[var(--radius-card)] border border-indigo-200 bg-white p-3 text-center shadow-sm"
          >
            <p className="flex items-center justify-center gap-0.5 text-xs text-indigo-600">
              {label}
              <InfoTooltip text={tooltip} />
            </p>
            <p className={`mt-0.5 text-base font-bold ${color || "text-indigo-900"}`}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Per-ticker CAPM expected returns */}
      {capmReturns && Object.keys(capmReturns).length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-indigo-800">
            Per-Ticker CAPM Expected Returns
            <InfoTooltip text="E[Rᵢ] = rf + βᵢ × MRP for each holding. Beta is estimated via OLS regression against SPY over the lookback window." />
          </p>
          <div className="overflow-auto rounded border border-indigo-200 bg-white">
            <table className="w-full text-xs">
              <thead className="border-b border-indigo-100 bg-indigo-50">
                <tr>
                  {["Ticker", "β (vs SPY)", "E[R] CAPM (annual)"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-indigo-700">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-50">
                {Object.entries(capmReturns)
                  .sort(([, a], [, b]) => b - a)
                  .map(([ticker, er]) => {
                    // Back-compute beta: E[R] = rf + β × MRP  →  β = (E[R] - rf) / MRP
                    const beta = (er - 0.0364) / 0.05;
                    return (
                      <tr key={ticker} className="hover:bg-indigo-50">
                        <td className="px-3 py-1.5 font-mono font-semibold">{ticker}</td>
                        <td className="px-3 py-1.5 text-indigo-800">{beta.toFixed(2)}</td>
                        <td className={`px-3 py-1.5 font-semibold ${colorForValue(er)}`}>
                          {fmtPct(er)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Targets Page ───────────────────────────────────────────────────────────────

export default function TargetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: portfolioId } = use(params);
  const { checked } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();

  const { data } = useQuery({
    queryKey: ["portfolio", portfolioId],
    queryFn: () => fetchPortfolioDetail(portfolioId),
    enabled: checked,
  });
  const positions: Position[] = data?.positions ?? [];

  const [mode, setMode] = useState("min_variance");
  const [lookbackDays, setLookbackDays] = useState(1825);
  const [maxWeight, setMaxWeight] = useState(1.0);
  const [minWeight, setMinWeight] = useState(0.0);
  const [volTarget, setVolTarget] = useState(0.1);
  const [allowShort, setAllowShort] = useState(false);
  const [kappa, setKappa] = useState(0.05);
  const [guideOpen, setGuideOpen] = useState(false);
  const [result, setResult] = useState<PortfolioOptimizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);

  // Conviction / tilt state
  const [convictionOpen, setConvictionOpen] = useState(false);
  const [convictionViews, setConvictionViews] = useState<
    Record<string, number>
  >({});
  const [tiltBaseline, setTiltBaseline] = useState<
    "equal" | "current" | "optimizer"
  >("equal");
  const [tiltLam, setTiltLam] = useState(1.0);
  const [tiltResult, setTiltResult] = useState<TiltResult | null>(null);
  const [tiltError, setTiltError] = useState<string | null>(null);

  const LONG_ONLY_MODES = ["equal_weight", "risk_parity", "max_diversification"];
  const VIEWS_MODES = ["max_sharpe", "max_sharpe_capm", "max_sortino"];
  const nonZeroViews = Object.fromEntries(
    Object.entries(convictionViews).filter(([, v]) => v !== 0),
  );
  const hasViews = Object.keys(nonZeroViews).length > 0;

  // Helper: persist target set to DB
  async function saveTargetSet(
    weights: Record<string, number>,
    source: "optimizer" | "tilt",
    optResult?: PortfolioOptimizeResult | null,
  ) {
    await patchPortfolioTargets(portfolioId, {
      source,
      weights,
      mode: source === "optimizer" ? (optResult?.mode ?? mode) : null,
      views_applied:
        source === "optimizer" ? (optResult?.views_applied ?? false) : false,
      delta_mu: source === "optimizer" ? (optResult?.delta_mu ?? null) : null,
    });
    qc.invalidateQueries({ queryKey: ["portfolio", portfolioId] });
  }

  // Helper: apply weights to DB positions (fractions → percentages)
  async function applyWeightsToPositions(weights: Record<string, number>) {
    for (const [ticker, w] of Object.entries(weights)) {
      await updatePosition(
        portfolioId,
        ticker,
        parseFloat((w * 100).toFixed(4)),
      );
    }
    qc.invalidateQueries({ queryKey: ["portfolio", portfolioId] });
  }

  const optMut = useMutation({
    mutationFn: () =>
      optimizePortfolio(
        portfolioId,
        mode,
        maxWeight,
        new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        undefined,
        mode === "target_volatility" ? volTarget : undefined,
        allowShort,
        minWeight,
        hasViews && VIEWS_MODES.includes(mode) ? nonZeroViews : undefined,
        hasViews && VIEWS_MODES.includes(mode) ? kappa : undefined,
      ),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      setApplySuccess(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const tiltMut = useMutation({
    mutationFn: () =>
      computeTilt(portfolioId, {
        baseline: tiltBaseline,
        optimizer_mode: tiltBaseline === "optimizer" ? mode : null,
        conviction: nonZeroViews,
        lam: tiltLam,
        u0: 20.0,
      }),
    onSuccess: (data) => {
      setTiltResult(data);
      setTiltError(null);
    },
    onError: (e: Error) => setTiltError(e.message),
  });

  // Apply optimizer result as targets: positions + persist to DB
  const applyOptMut = useMutation({
    mutationFn: async (weights: Record<string, number>) => {
      await applyWeightsToPositions(weights);
      await saveTargetSet(weights, "optimizer", result);
    },
    onSuccess: () => setApplySuccess(true),
  });

  // Apply tilt result as targets: positions + persist to DB
  const applyTiltMut = useMutation({
    mutationFn: async (weights: Record<string, number>) => {
      await applyWeightsToPositions(weights);
      await saveTargetSet(weights, "tilt");
    },
    onSuccess: () => setApplySuccess(true),
  });

  if (!checked) return null;

  return (
    <div className="space-y-5">
      {/* Optimization Settings */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
          Optimization Settings
          <InfoTooltip text="Uses the portfolio's current holdings and weights as the baseline. Select a mode and run to see target weights." />
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-[var(--color-muted)]">
              Mode
              <InfoTooltip text="Choose an optimization objective. Click 'Optimizer Guide' below for a full description of each mode." />
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              <option value="equal_weight">Equal Weight (1/N)</option>
              <option value="min_variance">Min Variance</option>
              <option value="max_sharpe">Max Sharpe (Historical)</option>
              <option value="risk_parity">Risk Parity</option>
              <option value="max_sortino">Max Sortino</option>
              <option value="min_cvar">Min CVaR (95%)</option>
              <option value="max_diversification">Max Diversification</option>
              <option value="target_volatility">Target Volatility</option>
            </select>
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-[var(--color-muted)]">
              Lookback
              <InfoTooltip text="Historical data window used for return estimation, covariance, and beta computation." />
            </label>
            <div className="flex gap-1">
              {[
                { label: "1Y", days: 365 },
                { label: "2Y", days: 730 },
                { label: "3Y", days: 1095 },
                { label: "5Y", days: 1825 },
              ].map(({ label, days }) => (
                <button
                  key={days}
                  onClick={() => setLookbackDays(days)}
                  className={`flex-1 rounded-[var(--radius-btn)] px-2 py-2 text-xs font-medium transition-colors ${
                    lookbackDays === days
                      ? "bg-[var(--color-primary)] text-white"
                      : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-border)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              {allowShort ? "Max abs. weight" : "Max weight"}:{" "}
              {(maxWeight * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={maxWeight * 100}
              onChange={(e) => setMaxWeight(+e.target.value / 100)}
              className="w-full accent-[var(--color-primary)]"
            />
            <label className="mt-2 block text-xs font-medium text-[var(--color-muted)]">
              Min weight: {(minWeight * 100).toFixed(0)}%
              <InfoTooltip text="Minimum allocation per asset. Must satisfy: min_weight × N ≤ 100%." />
            </label>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={minWeight * 100}
              onChange={(e) => setMinWeight(+e.target.value / 100)}
              className="w-full accent-[var(--color-primary)]"
            />
            {mode === "target_volatility" && (
              <div className="mt-2">
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                  Vol target: {(volTarget * 100).toFixed(0)}% / yr
                </label>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={1}
                  value={volTarget * 100}
                  onChange={(e) => setVolTarget(+e.target.value / 100)}
                  className="w-full accent-[var(--color-primary)]"
                />
              </div>
            )}
            <label className="mt-2 flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <input
                type="checkbox"
                checked={allowShort}
                onChange={(e) => setAllowShort(e.target.checked)}
                className="accent-[var(--color-primary)]"
              />
              Allow short positions
              <InfoTooltip
                text={`Negative weights (short selling). ${LONG_ONLY_MODES.map((m) => m.replace(/_/g, " ")).join(", ")} remain long-only regardless.`}
              />
            </label>
          </div>
          <div className="flex flex-col gap-2">
            {VIEWS_MODES.includes(mode) && hasViews && (
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                  Return bump κ: {(kappa * 100).toFixed(0)}% / 1% view
                  <InfoTooltip text="Annual return added per 1% undervaluation conviction. Only applies to Max Sharpe / Sortino modes." />
                </label>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={kappa * 100}
                  onChange={(e) => setKappa(+e.target.value / 100)}
                  className="w-full accent-[var(--color-primary)]"
                />
              </div>
            )}
            <button
              onClick={() => optMut.mutate()}
              disabled={optMut.isPending}
              className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {optMut.isPending ? "Optimizing…" : "Generate Targets"}
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-3 text-xs text-[var(--color-negative)]">{error}</p>
        )}
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => setGuideOpen(true)}
            className="flex items-center gap-1.5 text-xs text-[var(--color-primary)] hover:underline"
          >
            <BookOpen size={13} />
            Optimizer Guide →
          </button>
        </div>
      </div>
      {guideOpen && <OptimizerGuide onClose={() => setGuideOpen(false)} />}

      {/* Optimizer results */}
      {result && (
        <>
          {result.as_of_date && (
            <p className="text-xs text-[var(--color-muted)]">
              Data as of {result.as_of_date}
              {result.views_applied && (
                <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                  Views applied
                </span>
              )}
            </p>
          )}
          {result.warnings.map((w, i) => (
            <p
              key={i}
              className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-700 border border-amber-200"
            >
              {w}
            </p>
          ))}
          {!result.feasible && (
            <p className="rounded bg-red-50 px-3 py-1.5 text-xs text-red-700 border border-red-200">
              Optimizer did not converge — showing current weights as fallback.
            </p>
          )}

          {/* Apply buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => applyOptMut.mutate(result.target_weights)}
              disabled={applyOptMut.isPending}
              className="rounded-[var(--radius-btn)] bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {applyOptMut.isPending ? "Applying…" : "Apply to Portfolio"}
            </button>
            {applySuccess && (
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                Weights saved and applied.
              </span>
            )}
          </div>

          {/* Forward-looking panel — CAPM mode only */}
          {result.metrics.forward_looking && (
            <ForwardLookingPanel
              metrics={result.metrics.forward_looking}
              capmReturns={result.capm_expected_returns}
            />
          )}

          {/* Historical backtest comparison */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-xs font-semibold text-[var(--color-muted)]">
                In-Sample Backtest (historical prices over lookback window)
              </p>
              <InfoTooltip text="These metrics are computed by applying the weights to historical price data — they are NOT forecasts. For CAPM mode, use the Forward-Looking Projections above as the authoritative return estimate." />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(["current", "optimized"] as const).map((key) => {
                const m = result.metrics[key];
                return (
                  <div
                    key={key}
                    className={`rounded-[var(--radius-card)] border p-4 shadow-sm ${key === "optimized" ? "border-green-200 bg-green-50" : "border-blue-200 bg-blue-50"}`}
                  >
                    <h4
                      className={`mb-2 text-sm font-semibold ${key === "optimized" ? "text-green-700" : "text-blue-700"}`}
                    >
                      {key === "optimized"
                        ? `Optimized (${result.mode.replace(/_/g, " ")})`
                        : "Current Weights"}
                    </h4>
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        ["CAGR", fmtPct(m.cagr)],
                        ["Vol", fmtPct(m.vol)],
                        ["Sharpe", fmtNum(m.sharpe)],
                        ["Max DD", fmtPct(m.max_dd)],
                      ].map(([l, v]) => (
                        <div key={l}>
                          <dt className="text-gray-500">{l}</dt>
                          <dd className="font-semibold text-gray-800">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Table (shares, $, %) */}
          {(() => {
            const totalValue = (data?.notional_value ?? positions.reduce((s, p) => s + (p.market_value ?? 0), 0)) || 1;
            const posMap = Object.fromEntries(positions.map((p) => [p.ticker, p]));
            const actionRows = result.tickers.map((t) => {
              const pos = posMap[t];
              const price = pos?.price ?? 0;
              const curShares = pos?.shares ?? 0;
              const curVal = curShares * price;
              const curPct = result.current_weights[t] ?? 0;
              const tgtPct = result.target_weights[t] ?? 0;
              const tgtVal = tgtPct * totalValue;
              const tgtShares = price > 0 ? Math.floor(tgtVal / price) : 0;
              const actShares = tgtShares - curShares;
              const actDollars = actShares * price;
              const actPct = tgtPct - curPct;
              return { ticker: t, price, curShares, curVal, curPct, tgtShares, tgtVal: tgtShares * price, tgtPct, actShares, actDollars, actPct };
            }).sort((a, b) => b.tgtPct - a.tgtPct);

            return (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">
                    Action Table
                    <InfoTooltip text="Shows recommended trades to move from current holdings to the optimized portfolio. Shares are floored to whole numbers." />
                  </h3>
                  <button
                    className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-bg)] transition-colors"
                    onClick={() => {
                      const header = "Ticker,Price,Cur Shares,Cur Value,Cur %,Tgt Shares,Tgt Value,Tgt %,Action Shares,Action $,Action %";
                      const rows = actionRows.map((r) =>
                        [r.ticker, r.price.toFixed(2), r.curShares, r.curVal.toFixed(2), (r.curPct * 100).toFixed(2), r.tgtShares, r.tgtVal.toFixed(2), (r.tgtPct * 100).toFixed(2), r.actShares, r.actDollars.toFixed(2), (r.actPct * 100).toFixed(2)].join(",")
                      );
                      const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "action_table.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Export CSV
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
                        <th className="py-2 text-left font-medium">Ticker</th>
                        <th className="py-2 text-right font-medium">Price</th>
                        <th className="py-2 text-right font-medium">Cur Shares</th>
                        <th className="py-2 text-right font-medium">Cur Value</th>
                        <th className="py-2 text-right font-medium">Cur %</th>
                        <th className="py-2 text-right font-medium">Tgt Shares</th>
                        <th className="py-2 text-right font-medium">Tgt Value</th>
                        <th className="py-2 text-right font-medium">Tgt %</th>
                        <th className="py-2 text-right font-medium">Action Shs</th>
                        <th className="py-2 text-right font-medium">Action $</th>
                        <th className="py-2 text-right font-medium">Action %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actionRows.map((r) => {
                        const color = r.actShares > 0 ? "text-[var(--color-positive)]" : r.actShares < 0 ? "text-[var(--color-negative)]" : "text-[var(--color-muted)]";
                        return (
                          <tr key={r.ticker} className="border-b border-[var(--color-border)]">
                            <td className="py-2 font-medium text-[var(--color-text)]">{r.ticker}</td>
                            <td className="py-2 text-right">${r.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                            <td className="py-2 text-right">{r.curShares.toLocaleString()}</td>
                            <td className="py-2 text-right">${r.curVal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                            <td className="py-2 text-right">{(r.curPct * 100).toFixed(2)}%</td>
                            <td className="py-2 text-right">{r.tgtShares.toLocaleString()}</td>
                            <td className="py-2 text-right">${r.tgtVal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                            <td className="py-2 text-right font-semibold">{(r.tgtPct * 100).toFixed(2)}%</td>
                            <td className={`py-2 text-right font-bold ${color}`}>{r.actShares > 0 ? "+" : ""}{r.actShares.toLocaleString()}</td>
                            <td className={`py-2 text-right font-bold ${color}`}>{r.actDollars > 0 ? "+$" : r.actDollars < 0 ? "-$" : "$"}{Math.abs(r.actDollars).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                            <td className={`py-2 text-right font-bold ${color}`}>{r.actPct > 0 ? "+" : ""}{(r.actPct * 100).toFixed(2)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* Equity curve comparison */}
          {result.equity_curves.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-baseline gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  Equity Curve: Current vs Optimized
                </h3>
                <span className="text-xs text-[var(--color-muted)]">(in-sample backtest — not a forecast)</span>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={downsample(result.equity_curves)}
                  margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => d.slice(0, 7)}
                    tick={{ fontSize: 11 }}
                    minTickGap={60}
                  />
                  <YAxis
                    tickFormatter={(v) =>
                      `${((v - 1) * 100).toFixed(0)}%`
                    }
                    tick={{ fontSize: 11 }}
                    width={52}
                  />
                  <Tooltip
                    formatter={(v: unknown) =>
                      v != null
                        ? `${((Number(v) - 1) * 100).toFixed(2)}%`
                        : "—"
                    }
                    labelFormatter={(l) => `Date: ${l}`}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="optimized"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                    name="Optimized"
                  />
                  <Line
                    type="monotone"
                    dataKey="current"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="5 3"
                    name="Current"
                  />
                  <Line
                    type="monotone"
                    dataKey="benchmark"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="3 3"
                    name="SPY"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
