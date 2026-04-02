"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useResearch } from "@/components/research/ResearchContext";
import OptimizerComparisonTable from "@/components/research/OptimizerComparisonTable";
import {
  fetchCorrelation,
  fetchEfficientFrontier,
  fetchOptimizerComparison,
  fetchPortfolioHealth,
} from "@/lib/api";
import { fmtPct, fmtNum } from "@/lib/utils";
import type { OptimizerComparisonResult } from "@/types/research";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ── Correlation Heatmap (inline) ────────────────────────────────────────────

function CorrelationHeatmap({
  matrix,
  order,
}: {
  matrix: Record<string, Record<string, number>>;
  order: string[];
}) {
  const colorForCorr = (v: number): string => {
    if (v >= 0.8) return "bg-red-500 text-white";
    if (v >= 0.5) return "bg-red-300 text-red-900";
    if (v >= 0.2) return "bg-red-100 text-red-800";
    if (v >= -0.2) return "bg-gray-50 text-gray-600";
    if (v >= -0.5) return "bg-blue-100 text-blue-800";
    if (v >= -0.8) return "bg-blue-300 text-blue-900";
    return "bg-blue-500 text-white";
  };

  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1" />
            {order.map((t) => (
              <th
                key={t}
                className="px-2 py-1 text-center font-medium text-[var(--color-muted)]"
                style={{ writingMode: "vertical-lr", transform: "rotate(180deg)" }}
              >
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((row) => (
            <tr key={row}>
              <td className="px-2 py-1 font-medium text-[var(--color-text)]">
                {row}
              </td>
              {order.map((col) => {
                const v = matrix[row]?.[col] ?? 0;
                return (
                  <td
                    key={col}
                    className={`px-2 py-1 text-center font-mono ${colorForCorr(v)}`}
                    title={`${row} / ${col}: ${v.toFixed(3)}`}
                  >
                    {row === col ? "" : v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Turnover Cost Sensitivity ───────────────────────────────────────────────

function CostSensitivity({
  results,
}: {
  results: OptimizerComparisonResult;
}) {
  const [costBps, setCostBps] = useState(10);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-[var(--color-muted)]">
          Transaction cost (bps):
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={costBps}
          onChange={(e) => setCostBps(Number(e.target.value))}
          className="w-40"
        />
        <span className="text-xs font-mono text-[var(--color-text)]">
          {costBps} bps
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                Mode
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                Gross Sharpe
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                Turnover
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                Cost Drag
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                Net Sharpe
              </th>
            </tr>
          </thead>
          <tbody>
            {results.results
              .filter((r) => !r.error && r.mode !== "current")
              .map((r) => {
                const turnover = r.turnover ?? 0;
                const costDrag = turnover * (costBps / 10000);
                const grossSharpe = r.metrics?.sharpe ?? 0;
                const vol = r.metrics?.vol ?? 1;
                const netSharpe =
                  vol > 0 ? grossSharpe - costDrag / vol : grossSharpe;
                return (
                  <tr
                    key={r.mode}
                    className="border-b border-[var(--color-border)]"
                  >
                    <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                      {r.label}
                    </td>
                    <td className="px-3 py-2 font-mono">{fmtNum(grossSharpe)}</td>
                    <td className="px-3 py-2 font-mono">{fmtPct(turnover)}</td>
                    <td className="px-3 py-2 font-mono text-red-500">
                      -{fmtPct(costDrag)}
                    </td>
                    <td
                      className={`px-3 py-2 font-mono font-semibold ${
                        netSharpe > 0
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      {fmtNum(netSharpe)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function PortfolioResearchPage() {
  const { portfolioId } = useResearch();

  // Optimizer comparison
  const compMut = useMutation({
    mutationFn: () => fetchOptimizerComparison(portfolioId!, {}),
  });

  // Correlation
  const { data: corrData } = useQuery({
    queryKey: ["research-corr", portfolioId],
    queryFn: () => fetchCorrelation(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 120_000,
  });

  // Efficient frontier
  const { data: frontierData } = useQuery({
    queryKey: ["research-frontier", portfolioId],
    queryFn: () => fetchEfficientFrontier(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 120_000,
  });

  // Health (risk contributions)
  const { data: healthData } = useQuery({
    queryKey: ["research-health", portfolioId],
    queryFn: () => fetchPortfolioHealth(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 60_000,
  });

  if (!portfolioId) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
        Select a portfolio above to begin research.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Optimizer Comparison */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Optimizer Comparison
            </h3>
            <p className="text-xs text-[var(--color-muted)]">
              Run all 8 optimization modes and compare side-by-side against your
              current portfolio.
            </p>
          </div>
          <button
            onClick={() => compMut.mutate()}
            disabled={compMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {compMut.isPending ? "Running 8 modes..." : "Run Comparison"}
          </button>
        </div>

        {compMut.isError && (
          <p className="text-xs text-[var(--color-negative)]">
            {(compMut.error as Error).message}
          </p>
        )}

        {compMut.data && (
          <OptimizerComparisonTable results={compMut.data.results} />
        )}
      </div>

      {/* Efficient Frontier */}
      {frontierData && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
            Efficient Frontier
          </h3>
          <ResponsiveContainer width="100%" height={350}>
            <ScatterChart margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="vol"
                name="Vol"
                type="number"
                tickFormatter={(v: number) => fmtPct(v)}
                label={{ value: "Volatility", position: "bottom", offset: 0, fontSize: 11 }}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                dataKey="ret"
                name="Return"
                type="number"
                tickFormatter={(v: number) => fmtPct(v)}
                label={{ value: "Return", angle: -90, position: "insideLeft", fontSize: 11 }}
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                formatter={(v: unknown) => fmtPct(v as number)}
                labelFormatter={() => ""}
              />
              <Legend verticalAlign="top" height={28} />

              {/* Random cloud */}
              {frontierData.random_portfolios && (
                <Scatter
                  name="Random Portfolios"
                  data={frontierData.random_portfolios}
                  fill="var(--color-border)"
                  opacity={0.25}
                  shape="circle"
                  legendType="circle"
                />
              )}

              {/* Frontier curve */}
              {frontierData.frontier && (
                <Scatter
                  name="Efficient Frontier"
                  data={frontierData.frontier}
                  fill="var(--color-primary)"
                  shape="circle"
                  legendType="line"
                  line={{ stroke: "var(--color-primary)", strokeWidth: 2 }}
                />
              )}

              {/* Key portfolios */}
              {frontierData.current_portfolio && (
                <Scatter
                  name="Current"
                  data={[frontierData.current_portfolio]}
                  fill="#f59e0b"
                  shape="diamond"
                  legendType="diamond"
                />
              )}
              {frontierData.max_sharpe && (
                <Scatter
                  name="Max Sharpe"
                  data={[frontierData.max_sharpe]}
                  fill="#10b981"
                  shape="star"
                  legendType="star"
                />
              )}
              {frontierData.min_variance && (
                <Scatter
                  name="Min Variance"
                  data={[frontierData.min_variance]}
                  fill="#3b82f6"
                  shape="triangle"
                  legendType="triangle"
                />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Risk Contributions */}
      {healthData?.risk_contributions && healthData.risk_contributions.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
            Risk Contribution Breakdown
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    Ticker
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    Weight
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    Risk Contribution
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    MCTR
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    RC Bar
                  </th>
                </tr>
              </thead>
              <tbody>
                {healthData.risk_contributions.map(
                  (r: { ticker: string; weight: number; rc: number | null; mctr: number | null }) => (
                    <tr
                      key={r.ticker}
                      className="border-b border-[var(--color-border)]"
                    >
                      <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                        {r.ticker}
                      </td>
                      <td className="px-3 py-2 font-mono">{fmtPct(r.weight)}</td>
                      <td className="px-3 py-2 font-mono">
                        {r.rc != null ? fmtPct(r.rc) : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {r.mctr != null ? fmtNum(r.mctr, 4) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.rc != null && (
                          <div className="h-2.5 w-full rounded-full bg-[var(--color-border)]">
                            <div
                              className="h-2.5 rounded-full bg-[var(--color-primary)]"
                              style={{
                                width: `${Math.min(100, Math.abs(r.rc) * 100)}%`,
                              }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Correlation Matrix */}
      {corrData && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
            Correlation Matrix
          </h3>
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            Ordered by hierarchical clustering (Ward linkage). Red = positive
            correlation, blue = negative.
          </p>
          <CorrelationHeatmap
            matrix={corrData.matrix}
            order={corrData.cluster_order}
          />
        </div>
      )}

      {/* Cost Sensitivity */}
      {compMut.data && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
            Turnover & Cost Sensitivity
          </h3>
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            Adjust transaction cost assumptions to see net-of-cost Sharpe
            impact for each optimizer mode.
          </p>
          <CostSensitivity results={compMut.data} />
        </div>
      )}
    </div>
  );
}
