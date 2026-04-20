"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchUniverseStats,
  runUniverseAudit,
  runUniverseScreen,
} from "@/lib/api";
import { fmtPct, fmtNum } from "@/lib/utils";
import type {
  UniverseAuditResponse,
  UniverseScreenResponse,
} from "@/types/research";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#a855f7",
];

const GRADE_COLORS: Record<string, string> = {
  A: "bg-green-100 text-green-800",
  B: "bg-blue-100 text-blue-800",
  C: "bg-amber-100 text-amber-800",
  F: "bg-red-100 text-red-800",
};

// ── Universe Summary ────────────────────────────────────────────────────────

function UniverseSummary() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["universe-stats"],
    queryFn: fetchUniverseStats,
    staleTime: 60_000,
  });

  if (isLoading)
    return <p className="text-xs text-[var(--color-muted)]">Loading universe stats...</p>;
  if (!stats) return null;

  const sectorData = Object.entries(stats.sector_distribution).map(([name, value]) => ({
    name,
    value,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Quick stats */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <p className="text-xs font-semibold text-[var(--color-muted)]">Universe Overview</p>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--color-muted)]">Total tickers</span>
            <span className="font-bold text-[var(--color-text)]">{stats.total}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-muted)]">Active</span>
            <span className="font-bold text-[var(--color-text)]">{stats.active}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-muted)]">Sector coverage</span>
            <span className="font-mono text-[var(--color-text)]">{stats.coverage.sector}/{stats.total}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-muted)]">Market cap coverage</span>
            <span className="font-mono text-[var(--color-text)]">{stats.coverage.market_cap}/{stats.total}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-muted)]">P/E coverage</span>
            <span className="font-mono text-[var(--color-text)]">{stats.coverage.pe_ratio}/{stats.total}</span>
          </div>
        </div>
      </div>

      {/* Sector pie */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <p className="mb-2 text-xs font-semibold text-[var(--color-muted)]">Sector Distribution</p>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={sectorData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={75}
              label
              labelLine={false}
              fontSize={9}
            >
              {sectorData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Market cap percentiles */}
      {stats.market_cap_percentiles && Object.keys(stats.market_cap_percentiles).length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold text-[var(--color-muted)]">Market Cap Distribution</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={Object.entries(stats.market_cap_percentiles).map(([k, v]) => ({
                name: k.toUpperCase(),
                value: v / 1e9,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} label={{ value: "$B", position: "insideLeft", fontSize: 10 }} />
              <Tooltip formatter={(v: unknown) => `$${(v as number).toFixed(1)}B`} />
              <Bar dataKey="value" fill="var(--color-primary)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Data Quality Audit ──────────────────────────────────────────────────────

function DataQualityAudit() {
  const auditMut = useMutation({
    mutationFn: () => runUniverseAudit({ min_history_days: 504 }),
  });

  const data = auditMut.data;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Data Quality Audit</h3>
          <p className="text-xs text-[var(--color-muted)]">
            Check history length, data gaps, and liquidity for all active universe tickers.
          </p>
        </div>
        <button
          onClick={() => auditMut.mutate()}
          disabled={auditMut.isPending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {auditMut.isPending ? "Auditing..." : "Run Audit"}
        </button>
      </div>

      {auditMut.isError && (
        <p className="text-xs text-[var(--color-negative)]">{(auditMut.error as Error).message}</p>
      )}

      {data && (
        <>
          {/* Summary badges */}
          <div className="mb-3 flex gap-3">
            {(["A", "B", "C", "F"] as const).map((g) => (
              <span key={g} className={`rounded px-2 py-1 text-xs font-bold ${GRADE_COLORS[g]}`}>
                {g}: {data.summary[`grade_${g}` as keyof typeof data.summary]}
              </span>
            ))}
            <span className="text-xs text-[var(--color-muted)] self-center">
              of {data.summary.total} tickers
            </span>
          </div>

          {/* Audit table */}
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-surface)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Ticker</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Grade</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">History</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Gaps</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Avg Vol</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Range</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Issues</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.ticker} className="border-b border-[var(--color-border)] hover:bg-[var(--color-border)]/20">
                    <td className="px-3 py-2 font-medium text-[var(--color-text)]">{r.ticker}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${GRADE_COLORS[r.grade]}`}>
                        {r.grade}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">{r.history_days} days</td>
                    <td className="px-3 py-2 font-mono">{fmtPct(r.pct_gaps)}</td>
                    <td className="px-3 py-2 font-mono">
                      {r.avg_daily_volume != null
                        ? r.avg_daily_volume >= 1e6
                          ? `${(r.avg_daily_volume / 1e6).toFixed(1)}M`
                          : `${(r.avg_daily_volume / 1e3).toFixed(0)}K`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">
                      {r.first_date} to {r.last_date}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">
                      {r.issues.length > 0 ? r.issues.join("; ") : "None"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Screening Panel ─────────────────────────────────────────────────────────

function ScreeningPanel() {
  const [minCap, setMinCap] = useState<string>("");
  const [maxPe, setMaxPe] = useState<string>("");
  const [minDiv, setMinDiv] = useState<string>("");
  const [excludeSectors, setExcludeSectors] = useState<string>("");
  const [minHistory, setMinHistory] = useState<string>("252");

  const screenMut = useMutation({
    mutationFn: () =>
      runUniverseScreen({
        min_market_cap: minCap ? parseFloat(minCap) * 1e9 : undefined,
        max_pe: maxPe ? parseFloat(maxPe) : undefined,
        min_div_yield: minDiv ? parseFloat(minDiv) / 100 : undefined,
        sectors_exclude: excludeSectors
          ? excludeSectors.split(",").map((s) => s.trim())
          : undefined,
        min_history_days: minHistory ? parseInt(minHistory) : undefined,
      }),
  });

  const data = screenMut.data;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Eligibility Screening</h3>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)]">Min Market Cap ($B)</label>
          <input
            type="number"
            value={minCap}
            onChange={(e) => setMinCap(e.target.value)}
            placeholder="e.g. 10"
            className="mt-1 w-28 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)]">Max P/E</label>
          <input
            type="number"
            value={maxPe}
            onChange={(e) => setMaxPe(e.target.value)}
            placeholder="e.g. 40"
            className="mt-1 w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)]">Min Div Yield (%)</label>
          <input
            type="number"
            step={0.1}
            value={minDiv}
            onChange={(e) => setMinDiv(e.target.value)}
            placeholder="e.g. 1.5"
            className="mt-1 w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)]">Exclude Sectors</label>
          <input
            type="text"
            value={excludeSectors}
            onChange={(e) => setExcludeSectors(e.target.value)}
            placeholder="e.g. Utilities, Energy"
            className="mt-1 w-48 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)]">Min History (days)</label>
          <input
            type="number"
            value={minHistory}
            onChange={(e) => setMinHistory(e.target.value)}
            className="mt-1 w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          />
        </div>
        <button
          onClick={() => screenMut.mutate()}
          disabled={screenMut.isPending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {screenMut.isPending ? "Screening..." : "Apply Filters"}
        </button>
      </div>

      {screenMut.isError && (
        <p className="text-xs text-[var(--color-negative)]">{(screenMut.error as Error).message}</p>
      )}

      {data && (
        <>
          {/* Summary */}
          <div className="mb-3 flex items-center gap-4">
            <span className="rounded bg-green-100 px-2 py-1 text-xs font-bold text-green-800">
              {data.summary.eligible} eligible
            </span>
            <span className="rounded bg-red-100 px-2 py-1 text-xs font-bold text-red-800">
              {data.summary.dropped} dropped
            </span>
            <span className="text-xs text-[var(--color-muted)]">of {data.summary.total} total</span>
          </div>

          {/* Results table */}
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-surface)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Ticker</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Sector</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Mkt Cap</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">P/E</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Eligible</th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Filters</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr
                    key={r.ticker}
                    className={`border-b border-[var(--color-border)] ${
                      r.eligible ? "" : "opacity-50"
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-[var(--color-text)]">{r.ticker}</td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">{r.name ?? "—"}</td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">{r.sector ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">
                      {r.market_cap ? `$${(r.market_cap / 1e9).toFixed(1)}B` : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.pe_ratio ? fmtNum(r.pe_ratio, 1) : "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          r.eligible ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                        }`}
                      >
                        {r.eligible ? "PASS" : "FAIL"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {Object.entries(r.filters).map(([k, v]) => (
                          <span
                            key={k}
                            className={`rounded px-1 py-0.5 text-[9px] ${
                              v ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                            }`}
                            title={k}
                          >
                            {k.replace("min_", "").replace("max_", "").replace("_", " ")}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function UniverseResearchPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
        Securities Research defines your tracked consideration set. Screen by fundamentals,
        check data quality, and determine which tickers are eligible for portfolio construction.
      </div>

      <UniverseSummary />
      <DataQualityAudit />
      <ScreeningPanel />
    </div>
  );
}
