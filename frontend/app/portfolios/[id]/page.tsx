"use client";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  addPosition,
  fetchPortfolioAnalytics,
  fetchPortfolioDetail,
  fetchTickerTechnicals,
  optimizePortfolio,
  removePosition,
  updatePosition,
} from "@/lib/api";
import { fmtNum, fmtPct, colorForValue, downsample } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import InfoTooltip from "@/components/InfoTooltip";
import { PortfolioAnalytics, PortfolioOptimizeResult, Position } from "@/types/sprint3";
import { SignalResult } from "@/types/sprint2";
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

type Tab = "holdings" | "analytics" | "optimize";

// ── Quick Technicals accordion per holding row ────────────────────────────────

function QuickTechnicals({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["quick-technicals", ticker],
    queryFn: () => fetchTickerTechnicals(ticker, undefined, undefined, true),
    staleTime: 60_000,
  });
  if (isLoading) return <p className="text-xs text-[var(--color-muted)] py-1">Loading signals…</p>;
  if (!data?.signals?.length) return <p className="text-xs text-[var(--color-muted)] py-1">No signals available.</p>;
  return (
    <div className="flex flex-wrap gap-2 py-1">
      {data.signals.map((s: SignalResult) => (
        <SignalBadge key={s.signal} state={s.state} lastDate={s.last_trigger_date} />
      ))}
      {data.atr14 != null && (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          ATR14: {fmtNum(data.atr14, 2)}
        </span>
      )}
      <span className="text-xs text-[var(--color-muted)] self-center">as of {data.as_of_date}</span>
    </div>
  );
}

// ── Holdings tab ─────────────────────────────────────────────────────────────

function HoldingsTab({
  portfolioId,
  positions,
  onRefetch,
}: {
  portfolioId: string;
  positions: Position[];
  onRefetch: () => void;
}) {
  const [newTicker, setNewTicker] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [editingTicker, setEditingTicker] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState("");
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const addMut = useMutation({
    mutationFn: () =>
      addPosition(
        portfolioId,
        newTicker.trim().toUpperCase(),
        newWeight ? parseFloat(newWeight) : null,
      ),
    onSuccess: () => {
      setNewTicker("");
      setNewWeight("");
      setAddError(null);
      onRefetch();
    },
    onError: (e: Error) => setAddError(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ ticker, weight }: { ticker: string; weight: number | null }) =>
      updatePosition(portfolioId, ticker, weight),
    onSuccess: () => {
      setEditingTicker(null);
      onRefetch();
    },
  });

  const removeMut = useMutation({
    mutationFn: (ticker: string) => removePosition(portfolioId, ticker),
    onSuccess: () => onRefetch(),
  });

  const totalWeight = positions.reduce((s, p) => s + (p.weight ?? 1), 0) || 1;

  return (
    <div className="space-y-4">
      {/* Add position form */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          Add Holding
          <InfoTooltip text="Tickers must be in the active Universe. Weight is relative (e.g. 1, 2, 3…) and normalised to 100%." />
        </h3>
        <div className="flex flex-wrap gap-3">
          <input
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
            placeholder="Ticker (e.g. AAPL)"
            className="w-28 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <input
            value={newWeight}
            onChange={(e) => setNewWeight(e.target.value)}
            placeholder="Weight (optional)"
            type="number"
            min={0}
            step={0.01}
            className="w-36 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <button
            onClick={() => addMut.mutate()}
            disabled={!newTicker.trim() || addMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {addMut.isPending ? "Adding…" : "Add"}
          </button>
        </div>
        {addError && <p className="mt-2 text-xs text-[var(--color-negative)]">{addError}</p>}
      </div>

      {/* Positions table */}
      {positions.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          No holdings yet. Add tickers from the Universe above.
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)]">Ticker</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">Weight</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">Alloc %</th>
                <th className="px-4 py-3 text-xs font-semibold text-[var(--color-muted)]">Signals</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {positions.map((pos) => {
                const pct = ((pos.weight ?? 1) / totalWeight) * 100;
                const isExpanded = expandedTicker === pos.ticker;
                return (
                  <>
                    <tr key={pos.ticker} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-medium">
                        <Link href={`/ticker/${pos.ticker}`} className="text-[var(--color-primary)] hover:underline">
                          {pos.ticker}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editingTicker === pos.ticker ? (
                          <input
                            autoFocus
                            type="number"
                            value={editWeight}
                            onChange={(e) => setEditWeight(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                updateMut.mutate({ ticker: pos.ticker, weight: editWeight ? parseFloat(editWeight) : null });
                              if (e.key === "Escape") setEditingTicker(null);
                            }}
                            onBlur={() =>
                              updateMut.mutate({ ticker: pos.ticker, weight: editWeight ? parseFloat(editWeight) : null })
                            }
                            className="w-20 rounded border border-[var(--color-border)] px-2 py-0.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                          />
                        ) : (
                          <button
                            onClick={() => { setEditingTicker(pos.ticker); setEditWeight(String(pos.weight ?? "")); }}
                            className="text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
                          >
                            {pos.weight ?? "—"}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--color-muted)]">{pct.toFixed(1)}%</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setExpandedTicker(isExpanded ? null : pos.ticker)}
                          className="flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-primary)] transition-colors"
                        >
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {isExpanded ? "Hide" : "Signals"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => removeMut.mutate(pos.ticker)}
                          disabled={removeMut.isPending}
                          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-negative)] transition-colors"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${pos.ticker}-signals`}>
                        <td colSpan={5} className="bg-gray-50 px-6 py-2">
                          <QuickTechnicals ticker={pos.ticker} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Metrics cards ─────────────────────────────────────────────────────────────

function MetricCards({ metrics }: { metrics: PortfolioAnalytics["metrics"] }) {
  const items = [
    { label: "CAGR", value: fmtPct(metrics.cagr), color: colorForValue(metrics.cagr) },
    { label: "Volatility", value: fmtPct(metrics.vol), color: "" },
    { label: "Sharpe", value: fmtNum(metrics.sharpe), color: colorForValue(metrics.sharpe) },
    { label: "Max Drawdown", value: fmtPct(metrics.max_dd), color: colorForValue(metrics.max_dd) },
    ...(metrics.beta != null ? [{ label: "Beta (vs SPY)", value: fmtNum(metrics.beta), color: "" }] : []),
    ...(metrics.alpha != null ? [{ label: "Alpha", value: fmtPct(metrics.alpha), color: colorForValue(metrics.alpha) }] : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(({ label, value, color }) => (
        <div key={label} className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm text-center">
          <p className="text-xs text-[var(--color-muted)]">{label}</p>
          <p className={`mt-0.5 text-base font-bold ${color || "text-[var(--color-text)]"}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Analytics tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ portfolioId }: { portfolioId: string }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [queryParams, setQueryParams] = useState<{ start?: string; end?: string }>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["portfolio-analytics", portfolioId, queryParams],
    queryFn: () => fetchPortfolioAnalytics(portfolioId, queryParams.start, queryParams.end),
  });

  const analytics = data as PortfolioAnalytics | undefined;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Start (optional)</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">End (optional)</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
        </div>
        <button
          onClick={() => setQueryParams({ start: start || undefined, end: end || undefined })}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Load Analytics
        </button>
      </div>

      {isLoading && <p className="text-sm text-[var(--color-muted)]">Computing analytics…</p>}
      {error && <p className="text-sm text-[var(--color-negative)]">{(error as Error).message}</p>}

      {analytics?.warnings?.length ? (
        <div className="space-y-1">
          {analytics.warnings.map((w, i) => (
            <p key={i} className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-700 border border-amber-200">{w}</p>
          ))}
        </div>
      ) : null}

      {analytics?.metrics && <MetricCards metrics={analytics.metrics} />}

      {analytics?.equity_curves?.length ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
            Equity Curve
            <InfoTooltip text="Simulated: current weights assumed constant over the lookback period. Not actual trade history." />
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={downsample(analytics.equity_curves)} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 7)} tick={{ fontSize: 11 }} minTickGap={60} />
              <YAxis tickFormatter={(v) => `${((v - 1) * 100).toFixed(0)}%`} tick={{ fontSize: 11 }} width={52} />
              <Tooltip formatter={(v: number | undefined) => v != null ? `${((v - 1) * 100).toFixed(2)}%` : "—"} labelFormatter={(l) => `Date: ${l}`} />
              <Legend />
              <Line type="monotone" dataKey="portfolio" stroke="#3b82f6" strokeWidth={2} dot={false} name="Portfolio" />
              <Line type="monotone" dataKey="benchmark" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="5 3" name="SPY" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {analytics?.signals_by_ticker?.length ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
            Exit Signals
            <InfoTooltip text="Signals use no look-ahead: each indicator scans historical data and reports the last trigger event." />
          </h3>
          <div className="space-y-3">
            {analytics.signals_by_ticker.map(({ ticker, signals }) => (
              <div key={ticker} className="flex flex-wrap items-center gap-3">
                <Link href={`/ticker/${ticker}`} className="w-16 font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline">{ticker}</Link>
                {signals.length ? signals.map((s) => <SignalBadge key={s.signal} state={s.state} lastDate={s.last_trigger_date} />) : (
                  <span className="text-xs text-[var(--color-muted)]">—</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Optimize tab ──────────────────────────────────────────────────────────────

function OptimizeTab({ portfolioId }: { portfolioId: string }) {
  const [mode, setMode] = useState<"min_variance" | "max_sharpe">("min_variance");
  const [maxWeight, setMaxWeight] = useState(1.0);
  const [result, setResult] = useState<PortfolioOptimizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const optMut = useMutation({
    mutationFn: () => optimizePortfolio(portfolioId, mode, maxWeight),
    onSuccess: (data) => { setResult(data); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
          Optimization Settings
          <InfoTooltip text="Uses the portfolio's current holdings and weights as the baseline. Optimized weights minimise variance or maximise Sharpe ratio." />
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "min_variance" | "max_sharpe")}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              <option value="min_variance">Min Variance — lowest risk</option>
              <option value="max_sharpe">Max Sharpe — best risk-adjusted return</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              Max weight per asset: {(maxWeight * 100).toFixed(0)}%
            </label>
            <input
              type="range" min={10} max={100} step={5}
              value={maxWeight * 100}
              onChange={(e) => setMaxWeight(+e.target.value / 100)}
              className="w-full accent-[var(--color-primary)]"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => optMut.mutate()}
              disabled={optMut.isPending}
              className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {optMut.isPending ? "Optimizing…" : "Run Optimizer"}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-[var(--color-negative)]">{error}</p>}
      </div>

      {result && (
        <>
          {result.warnings.map((w, i) => (
            <p key={i} className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-700 border border-amber-200">{w}</p>
          ))}
          {!result.feasible && (
            <p className="rounded bg-red-50 px-3 py-1.5 text-xs text-red-700 border border-red-200">
              Optimizer did not converge — showing current weights as fallback.
            </p>
          )}

          {/* Metrics comparison */}
          <div className="grid gap-4 sm:grid-cols-2">
            {(["current", "optimized"] as const).map((key) => {
              const m = result.metrics[key];
              return (
                <div key={key} className={`rounded-[var(--radius-card)] border p-4 shadow-sm ${key === "optimized" ? "border-green-200 bg-green-50" : "border-blue-200 bg-blue-50"}`}>
                  <h4 className={`mb-2 text-sm font-semibold ${key === "optimized" ? "text-green-700" : "text-blue-700"}`}>
                    {key === "optimized" ? `Optimized (${result.mode.replace(/_/g, " ")})` : "Current Weights"}
                  </h4>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    {[["CAGR", fmtPct(m.cagr)], ["Vol", fmtPct(m.vol)], ["Sharpe", fmtNum(m.sharpe)], ["Max DD", fmtPct(m.max_dd)]].map(([l, v]) => (
                      <div key={l}><dt className="text-gray-500">{l}</dt><dd className="font-semibold text-gray-800">{v}</dd></div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>

          {/* Implied trades table */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
              Rebalance Plan
              <InfoTooltip text="Delta = target weight minus current weight. Positive = buy more; negative = trim." />
            </h3>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-[var(--color-border)] bg-gray-50">
                  <tr>
                    {["Ticker", "Current", "Target", "Δ (delta)"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.tickers.map((t) => {
                    const delta = result.implied_trades[t] ?? 0;
                    return (
                      <tr key={t} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium">{t}</td>
                        <td className="px-3 py-2">{fmtPct(result.current_weights[t])}</td>
                        <td className="px-3 py-2">{fmtPct(result.target_weights[t])}</td>
                        <td className={`px-3 py-2 font-semibold ${colorForValue(delta)}`}>
                          {delta >= 0 ? "+" : ""}{fmtPct(delta)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Equity curve comparison */}
          {result.equity_curves.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Equity Curve: Current vs Optimized</h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={downsample(result.equity_curves)} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 7)} tick={{ fontSize: 11 }} minTickGap={60} />
                  <YAxis tickFormatter={(v) => `${((v - 1) * 100).toFixed(0)}%`} tick={{ fontSize: 11 }} width={52} />
                  <Tooltip formatter={(v: number | undefined) => v != null ? `${((v - 1) * 100).toFixed(2)}%` : "—"} labelFormatter={(l) => `Date: ${l}`} />
                  <Legend />
                  <Line type="monotone" dataKey="optimized" stroke="#22c55e" strokeWidth={2} dot={false} name="Optimized" />
                  <Line type="monotone" dataKey="current" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="5 3" name="Current" />
                  <Line type="monotone" dataKey="benchmark" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="3 3" name="SPY" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PortfolioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { checked } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("holdings");

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["portfolio", id],
    queryFn: () => fetchPortfolioDetail(id),
    enabled: checked,
  });

  if (!checked) return null;
  if (isLoading) return <p className="text-sm text-[var(--color-muted)] p-4">Loading…</p>;
  if (!data) return <p className="text-sm text-[var(--color-negative)] p-4">Portfolio not found.</p>;

  const TABS: { key: Tab; label: string }[] = [
    { key: "holdings", label: "Holdings" },
    { key: "analytics", label: "Analytics" },
    { key: "optimize", label: "Optimize" },
  ];

  return (
    <div className="space-y-5">
      {/* Breadcrumb + header */}
      <div>
        <Link href="/portfolios" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-primary)]">
          ← Portfolios
        </Link>
        <h1 className="mt-1 text-xl font-bold text-[var(--color-text)]">{data.name}</h1>
        <p className="text-xs text-[var(--color-muted)]">
          {data.positions.length} holding{data.positions.length !== 1 ? "s" : ""} · Created {new Date(data.created_at).toLocaleDateString()}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === key
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "holdings" && (
        <HoldingsTab
          portfolioId={id}
          positions={data.positions}
          onRefetch={() => { refetch(); qc.invalidateQueries({ queryKey: ["portfolio", id] }); }}
        />
      )}
      {tab === "analytics" && <AnalyticsTab portfolioId={id} />}
      {tab === "optimize" && <OptimizeTab portfolioId={id} />}
    </div>
  );
}
