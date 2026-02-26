"use client";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronDown, ChevronRight, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  addCandidate,
  addPosition,
  deleteIndicatorConfig,
  fetchCandidates,
  fetchIndicatorConfigs,
  fetchPortfolioAnalytics,
  fetchPortfolioDetail,
  fetchPortfolioHealth,
  fetchTickerTechnicals,
  forecastPortfolio,
  importPortfolioCSV,
  optimizePortfolio,
  refreshCandidates,
  removeCandidate,
  removePosition,
  runScenario,
  updatePosition,
  upsertIndicatorConfig,
  validatePortfolio,
} from "@/lib/api";
import { fmtNum, fmtPct, colorForValue, downsample } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import InfoTooltip from "@/components/InfoTooltip";
import HelpSidebar from "@/components/HelpSidebar";
import UniverseTickerPicker from "@/components/UniverseTickerPicker";
import TechnicalsChart from "@/components/TechnicalsChart";
import OptimizerGuide from "@/components/OptimizerGuide";
import ValidationGuide from "@/components/ValidationGuide";
import ForecastGuide from "@/components/ForecastGuide";
import FanChart from "@/components/FanChart";
import RiskContributionChart from "@/components/RiskContributionChart";
import ScenarioGuide from "@/components/ScenarioGuide";
import TechnicalsGuide from "@/components/TechnicalsGuide";
import { PortfolioAnalytics, PortfolioOptimizeResult, Position } from "@/types/sprint3";
import { SignalResult } from "@/types/sprint2";
import type { CandidateRefreshResponse, IndicatorType, PortfolioIndicatorConfig } from "@/types/sprint4";
import type { PortfolioValidationResult, PortfolioForecastResult } from "@/types/sprint6";
import type { PortfolioHealthResult, ScenarioResult, ScenarioType, ScenarioRequest, ExtendedTechnicalsResponse } from "@/types/sprint7";
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

type Tab = "holdings" | "watchlist" | "technicals" | "analytics" | "optimize" | "validation" | "forecast" | "scenarios";

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
  const [editError, setEditError] = useState<string | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [csvResult, setCsvResult] = useState<{
    positions_added: number;
    positions_updated: number;
    universe_added: string[];
    warnings: string[];
  } | null>(null);

  const csvMut = useMutation({
    mutationFn: (file: File) => importPortfolioCSV(portfolioId, file),
    onSuccess: (result) => {
      setCsvResult(result);
      onRefetch();
    },
  });

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
      setEditError(null);
      onRefetch();
    },
  });

  function saveWeight(ticker: string) {
    const val = parseFloat(editWeight) || 0;
    const otherSum = positions
      .filter((p) => p.ticker !== ticker)
      .reduce((s, p) => s + (p.weight ?? 0), 0);
    if (val < 0) { setEditError("Must be ≥ 0%"); return; }
    if (otherSum + val > 100 + 0.001) {
      setEditError(`Total would be ${(otherSum + val).toFixed(1)}% — exceeds 100%`);
      return;
    }
    setEditError(null);
    updateMut.mutate({ ticker, weight: val || null });
  }

  const removeMut = useMutation({
    mutationFn: (ticker: string) => removePosition(portfolioId, ticker),
    onSuccess: () => onRefetch(),
  });

  const totalWeight = positions.reduce((s, p) => s + (p.weight ?? 1), 0) || 1;
  const currentTotal = positions.reduce((s, p) => s + (p.weight ?? 0), 0);
  const editingCurrentWeight = editingTicker
    ? (positions.find((p) => p.ticker === editingTicker)?.weight ?? 0)
    : 0;
  const displayTotal = editingTicker
    ? currentTotal - editingCurrentWeight + (parseFloat(editWeight) || 0)
    : currentTotal;

  return (
    <div className="space-y-4">
      {/* Add position form */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Add Holding
            <InfoTooltip text="Tickers must be in the active Universe. Enter weight as a percentage (e.g. 25 = 25%). All weights must sum to exactly 100%." />
          </h3>
          <label className={`flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-gray-50 transition-colors ${csvMut.isPending ? "opacity-50 pointer-events-none" : ""}`}>
            <Upload className="h-3.5 w-3.5" />
            {csvMut.isPending ? "Importing…" : "Import CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setCsvResult(null); csvMut.mutate(f); }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {csvMut.isError && (
          <p className="mb-2 text-xs text-[var(--color-negative)]">
            Import failed: {(csvMut.error as Error).message}
          </p>
        )}
        {csvResult && (
          <div className="mb-3 rounded-[var(--radius-btn)] border border-green-200 bg-green-50 p-3 text-xs text-green-800 space-y-1">
            <p className="font-semibold">
              Import complete — {csvResult.positions_added} added, {csvResult.positions_updated} updated
            </p>
            {csvResult.universe_added.length > 0 && (
              <p>Auto-added to universe: <span className="font-mono">{csvResult.universe_added.join(", ")}</span></p>
            )}
            {csvResult.warnings.map((w, i) => (
              <p key={i} className="text-amber-700">{w}</p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <UniverseTickerPicker
            value={newTicker}
            onChange={setNewTicker}
            placeholder="Ticker (e.g. AAPL)"
            className="w-44"
          />
          <input
            value={newWeight}
            onChange={(e) => { setNewWeight(e.target.value); setAddError(null); }}
            placeholder="Weight % (e.g. 25)"
            type="number"
            min={0}
            max={100}
            step={0.1}
            className="w-36 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <button
            onClick={() => {
              const newW = newWeight ? parseFloat(newWeight) : 0;
              if (newW < 0) { setAddError("Weight cannot be negative."); return; }
              if (newW > 0 && currentTotal + newW > 100 + 0.001) {
                setAddError(`Adding ${newW}% would exceed 100% (current: ${currentTotal.toFixed(1)}%).`);
                return;
              }
              addMut.mutate();
            }}
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
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">Weight %</th>
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
                        <Link href={`/ticker/${pos.ticker}?from=/portfolios/${portfolioId}`} className="text-[var(--color-primary)] hover:underline">
                          {pos.ticker}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editingTicker === pos.ticker ? (
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                value={editWeight}
                                onChange={(e) => { setEditWeight(e.target.value); setEditError(null); }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveWeight(pos.ticker);
                                  if (e.key === "Escape") { setEditingTicker(null); setEditError(null); }
                                }}
                                onBlur={() => saveWeight(pos.ticker)}
                                className="w-20 rounded border border-[var(--color-border)] px-2 py-0.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                              />
                              <span className="text-xs text-[var(--color-muted)]">%</span>
                            </div>
                            {editError && (
                              <p className="text-xs text-[var(--color-negative)] max-w-[140px] text-right">{editError}</p>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingTicker(pos.ticker); setEditWeight(String(pos.weight ?? "")); setEditError(null); }}
                            className="text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
                          >
                            {pos.weight != null ? `${pos.weight}%` : "—"}
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
            <tfoot className="border-t-2 border-[var(--color-border)] bg-gray-50">
              <tr>
                <td colSpan={2} className="px-4 py-2 text-right text-xs font-semibold text-[var(--color-muted)]">
                  Total
                </td>
                <td className={`px-4 py-2 text-right text-sm font-bold ${
                  displayTotal > 100 + 0.001
                    ? "text-[var(--color-negative)]"
                    : Math.abs(displayTotal - 100) <= 0.1
                    ? "text-green-600"
                    : "text-amber-500"
                }`}>
                  {displayTotal.toFixed(1)}%
                </td>
                <td colSpan={2} className="px-4 py-2 text-xs text-[var(--color-muted)]">
                  {displayTotal > 100 + 0.001
                    ? "Over-allocated — reduce a weight"
                    : Math.abs(displayTotal - 100) <= 0.1
                    ? "Fully allocated"
                    : `${(100 - displayTotal).toFixed(1)}% remaining`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Metrics cards ─────────────────────────────────────────────────────────────

function MetricCards({ metrics }: { metrics: PortfolioAnalytics["metrics"] }) {
  const items = [
    {
      label: "CAGR",
      value: fmtPct(metrics.cagr),
      color: colorForValue(metrics.cagr),
      tooltip: "Compound Annual Growth Rate — annualised total return. The constant rate at which $1 invested would have grown to the ending value over the period.",
    },
    {
      label: "Volatility",
      value: fmtPct(metrics.vol),
      color: "",
      tooltip: "Annualised portfolio volatility: daily standard deviation of returns × √252. Measures the magnitude of return swings — higher vol means wider outcome ranges and greater drawdown risk.",
    },
    {
      label: "Sharpe",
      value: fmtNum(metrics.sharpe),
      color: colorForValue(metrics.sharpe),
      tooltip: "Risk-adjusted return: CAGR ÷ Volatility (Rf = 0). Sharpe > 1.0 is broadly acceptable; > 2.0 is excellent. Negative Sharpe means the strategy lost money on a risk-adjusted basis.",
    },
    {
      label: "Max Drawdown",
      value: fmtPct(metrics.max_dd),
      color: colorForValue(metrics.max_dd),
      tooltip: "Largest peak-to-trough decline in the simulated equity curve. The primary measure of downside risk — how much capital was lost from a high-water mark before recovery began.",
    },
    ...(metrics.beta != null
      ? [{
          label: "Beta (vs SPY)",
          value: fmtNum(metrics.beta),
          color: "",
          tooltip: "OLS market beta vs SPY over the lookback period. β = 1 moves in lockstep with the market; β > 1 amplifies market swings; β < 1 dampens them. Negative β implies counter-cyclical exposure.",
        }]
      : []),
    ...(metrics.alpha != null
      ? [{
          label: "Alpha",
          value: fmtPct(metrics.alpha),
          color: colorForValue(metrics.alpha),
          tooltip: "Jensen's Alpha: annualised excess return above what the CAPM model predicts given this portfolio's beta. Positive alpha suggests return sources beyond plain market exposure.",
        }]
      : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(({ label, value, color, tooltip }) => (
        <div key={label} className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm text-center">
          <p className="flex items-center justify-center gap-0.5 text-xs text-[var(--color-muted)]">
            {label}
            <InfoTooltip text={tooltip} />
          </p>
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
        <span className="flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-700">
          Simulated
          <InfoTooltip text="Analytics assume current weights held constant over the lookback period. No trade history is required." />
        </span>
        <HelpSidebar />
      </div>
      {analytics?.as_of_date && (
        <p className="text-xs text-[var(--color-muted)]">
          Data as of {analytics.as_of_date}{analytics.data_source ? ` · ${analytics.data_source}` : ""}
        </p>
      )}

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
          {/* Header row */}
          <div className="mb-1 grid grid-cols-[5rem_1fr_1fr_1fr] gap-2 border-b border-[var(--color-border)] pb-1">
            <span />
            {[
              { key: "sma_cross",     label: "SMA 20/50" },
              { key: "rsi_threshold", label: "RSI 14" },
              { key: "macd_cross",    label: "MACD (12,26,9)" },
            ].map((c) => (
              <span key={c.key} className="text-xs font-semibold text-[var(--color-muted)]">{c.label}</span>
            ))}
          </div>
          {/* One row per ticker */}
          {analytics.signals_by_ticker.map(({ ticker, signals }) => {
            const byKey = Object.fromEntries(signals.map((s) => [s.signal, s]));
            return (
              <div key={ticker} className="grid grid-cols-[5rem_1fr_1fr_1fr] gap-2 items-center py-1">
                <Link href={`/ticker/${ticker}?from=/portfolios/${portfolioId}`} className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline truncate">{ticker}</Link>
                {["sma_cross", "rsi_threshold", "macd_cross"].map((k) => {
                  const s = byKey[k];
                  return s
                    ? <SignalBadge key={k} state={s.state} lastDate={s.last_trigger_date} />
                    : <span key={k} className="text-xs text-[var(--color-muted)]">—</span>;
                })}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── Portfolio Health (inline at bottom of Analytics) ─────────────────── */}
      <div className="border-t border-[var(--color-border)] pt-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
          Portfolio Health
          <InfoTooltip text="Concentration, beta, volatility, and per-asset risk contributions computed from current holdings and weights." />
        </h2>
        <HealthTab portfolioId={portfolioId} />
      </div>
    </div>
  );
}

// ── Optimize tab ──────────────────────────────────────────────────────────────

function OptimizeTab({ portfolioId }: { portfolioId: string }) {
  const [mode, setMode] = useState("min_variance");
  const [maxWeight, setMaxWeight] = useState(1.0);
  const [volTarget, setVolTarget] = useState(0.10);
  const [allowShort, setAllowShort] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [result, setResult] = useState<PortfolioOptimizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const LONG_ONLY_MODES = ["equal_weight", "risk_parity", "max_diversification"];

  const optMut = useMutation({
    mutationFn: () =>
      optimizePortfolio(
        portfolioId,
        mode,
        maxWeight,
        undefined,
        undefined,
        mode === "target_volatility" ? volTarget : undefined,
        allowShort,
      ),
    onSuccess: (data) => { setResult(data); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
          Optimization Settings
          <InfoTooltip text="Uses the portfolio's current holdings and weights as the baseline. Select a mode and run the optimizer to see rebalancing targets." />
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
              <option value="max_sharpe_capm">Max Sharpe — CAPM</option>
              <option value="risk_parity">Risk Parity</option>
              <option value="max_sortino">Max Sortino</option>
              <option value="min_cvar">Min CVaR (95%)</option>
              <option value="max_diversification">Max Diversification</option>
              <option value="target_volatility">Target Volatility</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              {allowShort ? "Max abs. weight per asset" : "Max weight per asset"}: {(maxWeight * 100).toFixed(0)}%
            </label>
            <input
              type="range" min={10} max={100} step={5}
              value={maxWeight * 100}
              onChange={(e) => setMaxWeight(+e.target.value / 100)}
              className="w-full accent-[var(--color-primary)]"
            />
            {mode === "target_volatility" && (
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                  Vol target: {(volTarget * 100).toFixed(0)}% / yr
                </label>
                <input
                  type="range" min={5} max={50} step={1}
                  value={volTarget * 100}
                  onChange={(e) => setVolTarget(+e.target.value / 100)}
                  className="w-full accent-[var(--color-primary)]"
                />
              </div>
            )}
            <label className="mt-3 flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <input
                type="checkbox"
                checked={allowShort}
                onChange={(e) => setAllowShort(e.target.checked)}
                className="accent-[var(--color-primary)]"
              />
              Allow short positions
              <InfoTooltip text={`Negative weights (short selling). ${LONG_ONLY_MODES.map((m) => m.replace(/_/g, " ")).join(", ")} remain long-only regardless.`} />
            </label>
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

      {result && (
        <>
          {result.as_of_date && (
            <p className="text-xs text-[var(--color-muted)]">
              Data as of {result.as_of_date}
            </p>
          )}
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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                Rebalance Plan
                <InfoTooltip text="Delta = target weight minus current weight. Positive = buy more; negative = trim." />
              </h3>
              <div className="flex items-center gap-3">
                {/* Turnover chip */}
                {(() => {
                  const to = 0.5 * Object.values(result.implied_trades).reduce((s, v) => s + Math.abs(v as number), 0);
                  return (
                    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1 text-xs font-semibold text-[var(--color-muted)]">
                      TO: {(to * 100).toFixed(1)}%
                    </span>
                  );
                })()}
                {/* Export CSV */}
                <button
                  className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-bg)] transition-colors"
                  onClick={() => {
                    const rows = result.tickers.map((t) => {
                      const delta = result.implied_trades[t] ?? 0;
                      return [t, result.current_weights[t], result.target_weights[t], delta].join(",");
                    });
                    const csv = ["ticker,current_weight,target_weight,delta", ...rows].join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "rebalance_trades.csv";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export CSV
                </button>
              </div>
            </div>
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

// ── Watchlist tab ─────────────────────────────────────────────────────────────

const SIGNAL_KEYS = ["sma_cross", "rsi_threshold", "macd_cross"] as const;
const SIGNAL_LABELS = ["SMA 20/50", "RSI 14", "MACD"];

function WatchlistTab({
  portfolioId,
  holdingTickers,
  onAddToHoldings,
}: {
  portfolioId: string;
  holdingTickers: string[];
  onAddToHoldings: () => void;
}) {
  const qc = useQueryClient();
  const [newTicker, setNewTicker] = useState("");
  const [refreshData, setRefreshData] = useState<CandidateRefreshResponse | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["candidates", portfolioId],
    queryFn: () => fetchCandidates(portfolioId),
  });

  const displayData = refreshData ?? data;

  const addMut = useMutation({
    mutationFn: () => addCandidate(portfolioId, newTicker.trim().toUpperCase()),
    onSuccess: () => {
      setNewTicker("");
      qc.invalidateQueries({ queryKey: ["candidates", portfolioId] });
    },
  });

  const removeMut = useMutation({
    mutationFn: (ticker: string) => removeCandidate(portfolioId, ticker),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["candidates", portfolioId] }),
  });

  const refreshMut = useMutation({
    mutationFn: () => refreshCandidates(portfolioId),
    onSuccess: (result) => setRefreshData(result),
  });

  const addToHoldingsMut = useMutation({
    mutationFn: (ticker: string) => addPosition(portfolioId, ticker, 0),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio", portfolioId] });
      onAddToHoldings();
    },
  });

  const rows = displayData?.rows ?? [];

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          Add Candidate
          <InfoTooltip text="Add tickers from the Universe that you are considering for this portfolio. Refresh signals to see the latest SMA, RSI, and MACD state." />
        </h3>
        <div className="flex flex-wrap gap-3">
          <UniverseTickerPicker
            value={newTicker}
            onChange={setNewTicker}
            placeholder="Ticker (e.g. AAPL)"
            className="w-44"
          />
          <button
            onClick={() => addMut.mutate()}
            disabled={!newTicker.trim() || addMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {addMut.isPending ? "Adding…" : "Add"}
          </button>
          <button
            onClick={() => refreshMut.mutate()}
            disabled={refreshMut.isPending || rows.length === 0}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-muted)] hover:bg-[var(--color-border)] disabled:opacity-40 transition-colors"
          >
            {refreshMut.isPending ? "Refreshing…" : "Refresh Signals"}
          </button>
        </div>
        {addMut.error && (
          <p className="mt-2 text-xs text-[var(--color-negative)]">{(addMut.error as Error).message}</p>
        )}
      </div>

      {/* Candidates table */}
      {isLoading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          No candidates yet. Add tickers from the Universe to build your watchlist.
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-x-auto">
          {displayData?.as_of_date && (
            <p className="px-4 py-2 text-xs text-[var(--color-muted)] border-b border-[var(--color-border)]">
              Signals as of {displayData.as_of_date} · {displayData.data_source}
            </p>
          )}
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted)]">Ticker</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted)]">Last Close</th>
                {SIGNAL_LABELS.map((l) => (
                  <th key={l} className="px-4 py-3 text-center text-xs font-medium text-[var(--color-muted)]">{l}</th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-medium text-[var(--color-muted)]">→ Holdings</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((row) => {
                const sigMap = Object.fromEntries(row.signals.map((s) => [s.signal, s]));
                const alreadyHeld = holdingTickers.includes(row.ticker);
                return (
                  <tr key={row.ticker} className="hover:bg-[var(--color-bg)] transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-[var(--color-primary)]">
                      <Link href={`/ticker/${row.ticker}?from=/portfolios/${portfolioId}`} className="hover:underline">{row.ticker}</Link>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-muted)]">
                      {row.last_close != null ? `$${fmtNum(row.last_close, 2)}` : "—"}
                    </td>
                    {SIGNAL_KEYS.map((key) => (
                      <td key={key} className="px-4 py-3 text-center">
                        {sigMap[key] ? (
                          <SignalBadge state={sigMap[key].state} lastDate={sigMap[key].last_trigger_date} small />
                        ) : (
                          <span className="text-xs text-[var(--color-muted)]">—</span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center">
                      {alreadyHeld ? (
                        <span className="text-xs text-green-600 font-medium">In portfolio</span>
                      ) : (
                        <button
                          onClick={() => addToHoldingsMut.mutate(row.ticker)}
                          disabled={addToHoldingsMut.isPending}
                          className="rounded-[var(--radius-btn)] bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          + Add
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => removeMut.mutate(row.ticker)}
                        disabled={removeMut.isPending}
                        className="text-[var(--color-muted)] hover:text-[var(--color-negative)] transition-colors"
                        title="Remove candidate"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Technicals tab ─────────────────────────────────────────────────────────────

const INDICATOR_DEFS: { type: IndicatorType; label: string; defaultParams: Record<string, number> }[] = [
  { type: "sma",        label: "SMA 20/50",          defaultParams: { fast: 20, slow: 50 } },
  { type: "rsi",        label: "RSI 14",             defaultParams: { window: 14, oversold: 30, overbought: 70 } },
  { type: "macd",       label: "MACD 12/26/9",       defaultParams: { fast: 12, slow: 26, signal_period: 9 } },
  { type: "atr",        label: "ATR 14",             defaultParams: { window: 14 } },
  { type: "ema",        label: "EMA 20/50",          defaultParams: { fast: 20, slow: 50 } },
  { type: "bollinger",  label: "Bollinger (20, 2σ)", defaultParams: { window: 20, num_std: 2 } },
  { type: "adx",        label: "ADX 14",             defaultParams: { window: 14 } },
  { type: "donchian",   label: "Donchian (20)",      defaultParams: { window: 20 } },
  { type: "stochastic", label: "Stochastic (14,3)",  defaultParams: { k: 14, d: 3, smooth_k: 3 } },
  { type: "obv",        label: "OBV",                defaultParams: {} },
];

function TechnicalsTab({
  portfolioId,
  holdingTickers,
  candidateTickers,
}: {
  portfolioId: string;
  holdingTickers: string[];
  candidateTickers: string[];
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const allTickers = Array.from(new Set([...holdingTickers, ...candidateTickers])).sort();

  const today = new Date().toISOString().slice(0, 10);
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86400_000).toISOString().slice(0, 10);

  const [chartTicker, setChartTicker] = useState(allTickers[0] ?? "");
  const [start, setStart] = useState(twoYearsAgo);
  const [end, setEnd] = useState(today);
  const [chartParams, setChartParams] = useState<{ ticker: string; start: string; end: string } | null>(null);
  const [visibleIndicators, setVisibleIndicators] = useState<Set<string>>(new Set());
  const [showGuide, setShowGuide] = useState(false);
  const includeParam = Array.from(visibleIndicators).join(",");

  function toggleIndicator(key: string) {
    setVisibleIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const { data: chartData, isLoading: chartLoading } = useQuery<ExtendedTechnicalsResponse>({
    queryKey: ["ticker-technicals-tab", chartParams, includeParam],
    queryFn: () => fetchTickerTechnicals(chartParams!.ticker, chartParams!.start, chartParams!.end, true, includeParam || undefined),
    enabled: !!chartParams,
  });

  const { data: configData } = useQuery({
    queryKey: ["indicator_configs", portfolioId],
    queryFn: () => fetchIndicatorConfigs(portfolioId),
  });

  const upsertMut = useMutation({
    mutationFn: (body: { ticker: string; indicator_type: string; params_json: Record<string, unknown> | null; enabled: boolean }) =>
      upsertIndicatorConfig(portfolioId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicator_configs", portfolioId] }),
  });

  const deleteMut = useMutation({
    mutationFn: ({ ticker, indicator }: { ticker: string; indicator: string }) =>
      deleteIndicatorConfig(portfolioId, ticker, indicator),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicator_configs", portfolioId] }),
  });

  const configs: PortfolioIndicatorConfig[] = configData?.configs ?? [];
  const configMap = Object.fromEntries(
    configs.filter((c) => c.ticker === chartTicker).map((c) => [c.indicator_type, c])
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left — chart */}
        <div className="flex-[3] min-w-0 space-y-4">
          {/* Controls */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Ticker</label>
                <select
                  value={chartTicker}
                  onChange={(e) => setChartTicker(e.target.value)}
                  className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  {allTickers.length === 0 && <option value="">—</option>}
                  {allTickers.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Start</label>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                  className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">End</label>
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                  className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
              <button
                onClick={() => setChartParams({ ticker: chartTicker, start, end })}
                disabled={!chartTicker || chartLoading}
                className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {chartLoading ? "Loading…" : "Load Chart"}
              </button>
            </div>
          </div>

          {/* Indicator toggles */}
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-sm">
            <span className="text-xs font-semibold text-[var(--color-muted)]">Indicators:</span>
            {[
              { key: "ema",        label: "EMA 20/50" },
              { key: "bollinger",  label: "Bollinger (20, 2σ)" },
              { key: "donchian",   label: "Donchian (20)" },
              { key: "adx",        label: "ADX 14" },
              { key: "stochastic", label: "Stochastic (14,3)" },
              { key: "obv",        label: "OBV" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={visibleIndicators.has(key)}
                  onChange={() => toggleIndicator(key)}
                  className="accent-[var(--color-primary)]"
                />
                {label}
              </label>
            ))}
            <button
              onClick={() => setShowGuide(true)}
              className="ml-auto flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
            >
              <BookOpen size={13} />
              Technicals Guide
            </button>
          </div>
          {showGuide && <TechnicalsGuide onClose={() => setShowGuide(false)} />}

          {/* Chart */}
          {chartData && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
              <TechnicalsChart data={chartData} visibleIndicators={visibleIndicators} />
            </div>
          )}
          {!chartData && !chartLoading && (
            <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center text-sm text-[var(--color-muted)]">
              Select a ticker and click Load Chart.
            </div>
          )}
        </div>

        {/* Right — indicator config */}
        <div className="flex-[2] min-w-0">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Indicator Config
              {chartTicker && <span className="ml-1 font-mono text-[var(--color-primary)]">— {chartTicker}</span>}
            </h3>

            {!chartTicker ? (
              <p className="text-xs text-[var(--color-muted)]">Select a ticker above to configure indicators.</p>
            ) : (
              INDICATOR_DEFS.map(({ type, label, defaultParams }) => {
                const existing = configMap[type];
                const isEnabled = existing?.enabled ?? false;
                return (
                  <div key={type} className="rounded-[var(--radius-btn)] border border-[var(--color-border)] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--color-text)]">{label}</span>
                      <div className="flex items-center gap-2">
                        {existing && (
                          <button
                            onClick={() => deleteMut.mutate({ ticker: chartTicker, indicator: type })}
                            disabled={deleteMut.isPending}
                            className="text-[var(--color-muted)] hover:text-[var(--color-negative)] transition-colors"
                            title="Remove config"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                        <button
                          onClick={() =>
                            upsertMut.mutate({
                              ticker: chartTicker,
                              indicator_type: type,
                              params_json: existing?.params_json ?? defaultParams,
                              enabled: !isEnabled,
                            })
                          }
                          disabled={upsertMut.isPending}
                          className={`rounded-full px-3 py-0.5 text-xs font-semibold transition-colors ${
                            isEnabled
                              ? "bg-green-100 text-green-700 hover:bg-green-200"
                              : "bg-[var(--color-border)] text-[var(--color-muted)] hover:bg-gray-300"
                          }`}
                        >
                          {isEnabled ? "Enabled" : "Disabled"}
                        </button>
                      </div>
                    </div>
                    {existing && (
                      <p className="mt-1 text-xs text-[var(--color-muted)]">
                        Params: {JSON.stringify(existing.params_json ?? defaultParams)}
                      </p>
                    )}
                  </div>
                );
              })
            )}

            {chartTicker && (
              <button
                onClick={() => router.push(`/alerts?ticker=${chartTicker}`)}
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-primary)] px-3 py-2 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white transition-colors"
              >
                Create Alert Rule →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Validation tab ────────────────────────────────────────────────────────────

const TEST_INTERPRETATIONS: Record<string, string> = {
  sharpe_ttest:      "Is the Sharpe ratio statistically different from zero? (Lo 2002 autocorrelation correction)",
  block_permutation: "Does return timing add value vs shuffled 4-week blocks?",
  block_bootstrap_ci:"Bootstrap 95% CI for annualised Sharpe — does it exclude zero?",
  stationarity_adf:  "Are returns stationary? (Augmented Dickey-Fuller — rejection = stationary)",
  autocorrelation_lb:"Are returns serially independent? (Ljung-Box lag 10 — fail = autocorrelation present)",
  normality_jb:      "Do returns have fat tails? (Jarque-Bera — rejection is expected for real returns)",
  drawdown_bootstrap:"Is max drawdown consistent with random timing? (block-bootstrap null)",
};

function ValidationTab({ portfolioId }: { portfolioId: string }) {
  const [result, setResult] = useState<PortfolioValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const valMut = useMutation({
    mutationFn: () => validatePortfolio(portfolioId, true),
    onSuccess: (data) => { setResult(data); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-5">
      {showGuide && <ValidationGuide onClose={() => setShowGuide(false)} />}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Statistical Validation Suite</h3>
          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
          >
            <BookOpen size={13} />
            Validation Guide →
          </button>
        </div>
        <p className="mb-4 text-xs text-[var(--color-muted)]">
          Runs 7 statistical tests on the portfolio's simulated daily returns. Quick mode: 500 permutations / 1,000 bootstrap samples (~20–30 s).
        </p>
        <button
          onClick={() => valMut.mutate()}
          disabled={valMut.isPending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {valMut.isPending ? "Running 7 tests…" : "Run Validation"}
        </button>
        {error && <p className="mt-3 text-xs text-[var(--color-negative)]">{error}</p>}
      </div>

      {result && (
        <>
          {result.warnings?.length > 0 && (
            <div className="space-y-1">
              {result.warnings.map((w, i) => (
                <p key={i} className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-700 border border-amber-200">{w}</p>
              ))}
            </div>
          )}

          {/* GO / NO-GO badge */}
          <div className={`flex items-center gap-4 rounded-[var(--radius-card)] border p-5 shadow-sm ${result.go_decision ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <span className={`text-3xl font-black ${result.go_decision ? "text-green-600" : "text-red-600"}`}>
              {result.go_decision ? "GO" : "NO-GO"}
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {result.n_passing}/{result.n_total} tests passed
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                {result.returns_used} trading days · {result.quick_mode ? "Quick mode" : "Full mode"}
              </p>
            </div>
          </div>

          {/* 7 test cards */}
          <div className="grid gap-3 sm:grid-cols-2">
            {result.tests.map((t) => (
              <div
                key={t.test}
                className={`rounded-[var(--radius-card)] border p-4 shadow-sm ${t.passed ? "border-green-100 bg-green-50" : "border-red-100 bg-red-50"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-xs font-semibold ${t.passed ? "text-green-700" : "text-red-700"}`}>{t.label}</p>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${t.passed ? "bg-green-200 text-green-800" : "bg-red-200 text-red-800"}`}>
                    {t.passed ? "PASS" : "FAIL"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted)]">{TEST_INTERPRETATIONS[t.test] ?? ""}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--color-text)]">
                  {t.statistic != null && <span>stat: <strong>{t.statistic.toFixed(3)}</strong></span>}
                  {t.p_value != null && <span>p: <strong>{t.p_value.toFixed(3)}</strong></span>}
                  {t.details?.ci_lower != null && (
                    <span>95% CI: [<strong>{String(t.details.ci_lower)}</strong>, <strong>{String(t.details.ci_upper)}</strong>]</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Forecast tab ───────────────────────────────────────────────────────────────

function ForecastTab({ portfolioId }: { portfolioId: string }) {
  const [method, setMethod] = useState("ensemble");
  const [horizon, setHorizon] = useState(30);
  const [result, setResult] = useState<PortfolioForecastResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const fcMut = useMutation({
    mutationFn: () => forecastPortfolio(portfolioId, method, horizon),
    onSuccess: (data) => { setResult(data); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-5">
      {showGuide && <ForecastGuide onClose={() => setShowGuide(false)} />}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Forecast Settings
            <InfoTooltip text="Forecasts the simulated portfolio equity curve and rolling volatility using the selected method. Prophet may take 30–60 s." />
          </h3>
          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
          >
            <BookOpen size={13} />
            Forecast Guide →
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              <option value="ewma">EWMA + Random Walk</option>
              <option value="arima">ARIMA (1,1,0)</option>
              <option value="prophet">Prophet</option>
              <option value="ensemble">Ensemble (Average)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Horizon</label>
            <div className="flex gap-1">
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setHorizon(d)}
                  className={`rounded-[var(--radius-btn)] px-3 py-2 text-sm font-medium transition-colors ${horizon === d ? "bg-[var(--color-primary)] text-white" : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-border)]"}`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => fcMut.mutate()}
            disabled={fcMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {fcMut.isPending ? "Forecasting…" : "Run Forecast"}
          </button>
        </div>
        {error && <p className="mt-3 text-xs text-[var(--color-negative)]">{error}</p>}
      </div>

      {result && (
        <>
          {result.warnings?.length > 0 && (
            <div className="space-y-1">
              {result.warnings.map((w, i) => (
                <p key={i} className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-700 border border-amber-200">{w}</p>
              ))}
            </div>
          )}

          {/* Fan charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <FanChart
              data={result.price_series}
              title={`Price Forecast — ${result.method} (${result.horizon_days}d)`}
              yLabel="Portfolio equity (start = 1.0)"
            />
            <FanChart
              data={result.vol_series}
              title="Volatility Forecast (annualised)"
              yLabel="Annualised vol"
            />
          </div>

          {/* Calibration + model info */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Calibration panel */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
                Calibration (last 30-day hold-out)
                <InfoTooltip text="Model was fit on data up to 30 days ago, then forecast forward. Metrics compare P50 vs actual." />
              </h3>
              <dl className="grid grid-cols-3 gap-3 text-xs">
                {[
                  ["RMSE", result.calibration.rmse != null ? result.calibration.rmse.toFixed(4) : "—"],
                  ["MAE", result.calibration.mae != null ? result.calibration.mae.toFixed(4) : "—"],
                  ["Dir. Acc.", result.calibration.directional_accuracy != null ? `${(result.calibration.directional_accuracy * 100).toFixed(1)}%` : "—"],
                ].map(([l, v]) => (
                  <div key={l}>
                    <dt className="text-[var(--color-muted)]">{l}</dt>
                    <dd className="font-semibold text-[var(--color-text)]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Model info */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Model Info</h3>
              <dl className="space-y-1 text-xs">
                <div>
                  <dt className="text-[var(--color-muted)]">Method</dt>
                  <dd className="font-medium text-[var(--color-text)]">{result.method}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-muted)]">Horizon</dt>
                  <dd className="font-medium text-[var(--color-text)]">{result.horizon_days} trading days</dd>
                </div>
                {Object.entries(result.model_info).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[var(--color-muted)]">{k.replace(/_/g, " ")}</dt>
                    <dd className="font-medium text-[var(--color-text)]">
                      {Array.isArray(v) ? v.join(", ") : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
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

  const { data: candidatesData } = useQuery({
    queryKey: ["candidates", id],
    queryFn: () => fetchCandidates(id),
    enabled: checked,
  });

  if (!checked) return null;
  if (isLoading) return <p className="text-sm text-[var(--color-muted)] p-4">Loading…</p>;
  if (!data) return <p className="text-sm text-[var(--color-negative)] p-4">Portfolio not found.</p>;

  const holdingTickers = data.positions.map((p: Position) => p.ticker);
  const candidateTickers = (candidatesData?.rows ?? []).map((r) => r.ticker);

  const TABS: { key: Tab; label: string }[] = [
    { key: "holdings",   label: "Holdings"   },
    { key: "watchlist",  label: "Watchlist"  },
    { key: "technicals", label: "Technicals" },
    { key: "analytics",  label: "Analytics"  },
    { key: "optimize",   label: "Optimize"   },
    { key: "validation", label: "Validation" },
    { key: "forecast",   label: "Forecast"   },
    { key: "scenarios",  label: "Scenarios"  },
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
      {tab === "watchlist" && (
        <WatchlistTab
          portfolioId={id}
          holdingTickers={holdingTickers}
          onAddToHoldings={() => setTab("holdings")}
        />
      )}
      {tab === "technicals" && (
        <TechnicalsTab
          portfolioId={id}
          holdingTickers={holdingTickers}
          candidateTickers={candidateTickers}
        />
      )}
      {tab === "analytics" && <AnalyticsTab portfolioId={id} />}
      {tab === "optimize" && <OptimizeTab portfolioId={id} />}
      {tab === "validation" && <ValidationTab portfolioId={id} />}
      {tab === "forecast" && <ForecastTab portfolioId={id} />}
      {tab === "scenarios" && <ScenariosTab portfolioId={id} />}
    </div>
  );
}


// ── HealthTab ──────────────────────────────────────────────────────────────────

function HealthTab({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading, error } = useQuery<PortfolioHealthResult>({
    queryKey: ["portfolio-health", portfolioId],
    queryFn: () => fetchPortfolioHealth(portfolioId),
  });

  if (isLoading) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-12 text-center text-sm text-[var(--color-muted)]">
        Computing health metrics…
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-[var(--color-negative)]">
        {(error as Error)?.message ?? "Failed to load health data."}
      </p>
    );
  }

  const cards = [
    {
      label: "HHI",
      value: data.concentration.hhi.toFixed(4),
      tooltip: "Herfindahl-Hirschman Index: Σw². Ranges 1/N (perfectly diversified) to 1.0 (single position). Higher = more concentrated.",
    },
    {
      label: "N_eff",
      value: data.concentration.n_eff.toFixed(2),
      tooltip: "Effective N: 1/HHI. The equivalent number of equally-weighted positions that would produce the same concentration.",
    },
    {
      label: "Top 5",
      value: fmtPct(data.concentration.top5),
      tooltip: "Sum of the 5 largest position weights. A proxy for how top-heavy the portfolio is.",
    },
    {
      label: "Beta",
      value: data.beta != null ? data.beta.toFixed(3) : "—",
      tooltip: "OLS beta vs SPY over the lookback window. Beta > 1 = amplifies market moves; < 1 = dampens.",
    },
    {
      label: "Ann. Vol",
      value: data.vol != null ? fmtPct(data.vol) : "—",
      tooltip: "Annualised portfolio volatility (daily std × √252) computed over the lookback window.",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <p className="text-xs text-[var(--color-muted)]">
              {c.label}
              <InfoTooltip text={c.tooltip} />
            </p>
            <p className="mt-1 text-xl font-bold text-[var(--color-text)]">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Risk contribution chart */}
      {data.risk_contributions.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
            Risk Contributions
            <InfoTooltip text="RC_i = w_i × (Σw)_i / (w′Σw). Σ RC_i = 1. Shows which positions drive portfolio variance most." />
          </h3>
          <RiskContributionChart contributions={data.risk_contributions} />
        </div>
      )}

      {/* RC table */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Risk Contribution Detail</h3>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-[var(--color-border)] bg-gray-50">
              <tr>
                {["Ticker", "Weight", "RC", "MCTR"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.risk_contributions.map((r) => (
                <tr key={r.ticker} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono font-medium">{r.ticker}</td>
                  <td className="px-3 py-2">{fmtPct(r.weight)}</td>
                  <td className="px-3 py-2">{r.rc != null ? fmtPct(r.rc) : "—"}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{r.mctr != null ? r.mctr.toFixed(4) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-[var(--color-muted)]">As of {data.as_of_date} · {data.data_source}</p>

      {data.warnings?.length > 0 && (
        <div className="space-y-1">
          {data.warnings.map((w, i) => (
            <p key={i} className="text-xs text-[var(--color-negative)]">{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Scenario Playbook ──────────────────────────────────────────────────────────

function ScenarioPlaybook({ result }: { result: ScenarioResult }) {
  const items: { icon: string; title: string; body: string }[] = [];

  if (result.scenario_type === "market_shock" && result.portfolio_impact != null) {
    const impact = result.portfolio_impact;
    const worstContributor = result.contributions
      ?.slice().sort((a, b) => a.impact - b.impact)[0];

    if (impact <= -0.15) {
      items.push({
        icon: "🛡️",
        title: "Protective puts / collar strategy",
        body: "A shock of this magnitude warrants downside protection. Consider buying 3–6 month put options (5–10% OTM) on your top holdings or a broad index ETF. A collar (buy put, sell call) can cap premium cost.",
      });
    }
    if (impact <= -0.10) {
      items.push({
        icon: "💵",
        title: "Raise cash buffer",
        body: "Trim 5–15% of equity exposure into cash or short-duration T-bills. This provides dry powder to re-enter at lower levels and reduces drawdown depth in a sustained sell-off.",
      });
    }
    if (impact <= -0.08) {
      items.push({
        icon: "🔄",
        title: "Rotate toward defensive sectors",
        body: "Utilities, consumer staples, healthcare, and dividend-payers tend to outperform in sharp drawdowns. Reducing high-beta growth exposure and adding low-beta names dampens the impact of a market shock.",
      });
    }
    if (worstContributor && worstContributor.impact < -0.03) {
      items.push({
        icon: "✂️",
        title: `Trim concentrated risk in ${worstContributor.ticker}`,
        body: `${worstContributor.ticker} is your single largest drag in this scenario (${fmtPct(worstContributor.impact)} impact). Consider reducing to a weight where a repeat of this shock leaves the position loss within acceptable per-name limits.`,
      });
    }
    if (impact > 0) {
      items.push({
        icon: "📈",
        title: "Portfolio benefits from this shock",
        body: "Positive impact in a market downturn suggests meaningful short exposure, inverse ETFs, or defensive positioning. Verify this is intentional and consider whether the hedge should be scaled back in a recovery.",
      });
    }
    items.push({
      icon: "📊",
      title: "Stress-test correlation assumptions",
      body: "In sharp drawdowns, cross-asset correlations spike toward 1. Re-run this scenario with a larger shock (−30%, −40%) to see if any assumed diversification benefits hold under extreme conditions.",
    });
  }

  if (result.scenario_type === "vol_shock" && result.shocked_vol != null) {
    const shockedVol = result.shocked_vol;
    const scale = result.vol_scale ?? 2;

    items.push({
      icon: "📐",
      title: "Rescale position sizes",
      body: `At ${fmtPct(shockedVol)} annualised vol (${scale}× baseline), standard risk-budgeting would cut position sizes by ~${Math.round((1 - 1 / scale) * 100)}% to keep dollar-vol-per-position constant. Review your largest holdings first.`,
    });
    items.push({
      icon: "🛑",
      title: "Widen stop-losses proportionally",
      body: "ATR-based stops set at baseline volatility will trigger prematurely in a high-vol regime. Multiply your current stop distances by the vol scale factor (or use a trailing stop set to 2–3× the shocked ATR).",
    });
    if (shockedVol > 0.30) {
      items.push({
        icon: "📉",
        title: "Check margin and leverage headroom",
        body: "High realised vol often triggers broker margin calls. Ensure leverage is well below maximum thresholds and model your maintenance margin at this vol level to avoid forced liquidation at the worst moment.",
      });
    }
    items.push({
      icon: "🔀",
      title: "Consider VIX-linked hedges",
      body: "If the vol shock is systemic, VIX call spreads or long VIX ETPs (UVIX, VIXY) provide convex upside during volatility spikes. Size small — these decay rapidly in calm markets.",
    });
    items.push({
      icon: "🗓️",
      title: "Shorten holding periods",
      body: "High vol environments compress information ratios. Shorter holding periods (days vs weeks) and faster signal turnover can reduce exposure to sustained adverse moves.",
    });
  }

  if (result.scenario_type === "historical_replay") {
    const totalReturn = result.total_return ?? 0;
    const maxDd = result.max_dd ?? 0;
    const worstContributor = result.contributors
      ?.slice().sort((a, b) => a.weighted_contribution - b.weighted_contribution)[0];
    const bestContributor = result.contributors
      ?.slice().sort((a, b) => b.weighted_contribution - a.weighted_contribution)[0];

    if (totalReturn < -0.10) {
      items.push({
        icon: "🔎",
        title: "Diagnose the macro regime",
        body: "This period likely featured a specific regime (rate hike cycle, recession, liquidity crisis). Identify the primary driver and determine whether your current macro environment resembles it — if so, the same repositioning applies now.",
      });
    }
    if (maxDd < -0.20) {
      items.push({
        icon: "📏",
        title: "Implement a drawdown circuit-breaker",
        body: `A −${Math.abs(Math.round(maxDd * 100))}% drawdown is substantial. Define a portfolio-level stop: if drawdown exceeds −15%, reduce risk by 50%; if it exceeds −25%, move to cash. Systematic rules prevent emotional decision-making in live drawdowns.`,
      });
    }
    if (worstContributor && worstContributor.weighted_contribution < -0.05) {
      items.push({
        icon: "⚖️",
        title: `Reconsider weighting in ${worstContributor.ticker}`,
        body: `${worstContributor.ticker} was the top drag (${fmtPct(worstContributor.weighted_contribution)} portfolio contribution). If the macro regime that hurt it is plausible again, consider a tighter weight cap or sector hedge.`,
      });
    }
    if (bestContributor && bestContributor.weighted_contribution > 0.03) {
      items.push({
        icon: "⭐",
        title: `${bestContributor.ticker} was your best hedge`,
        body: `${bestContributor.ticker} added ${fmtPct(bestContributor.weighted_contribution)} in this period. Consider whether increasing its weight (or adding similar uncorrelated names) would provide meaningful protection in a repeat scenario.`,
      });
    }
    items.push({
      icon: "🌐",
      title: "Add uncorrelated diversifiers",
      body: "Historical replays that produce large losses often reflect a single factor dominating the portfolio. Gold, Treasuries, trend-following CTAs, or merger-arb strategies can dampen drawdown without significantly reducing expected return.",
    });
    if (result.n_days && result.n_days > 180) {
      items.push({
        icon: "🔄",
        title: "Review rebalancing frequency",
        body: "In prolonged adverse periods, systematic rebalancing (monthly or quarterly) can reduce drawdown by trimming overexposed winners and averaging into underperformers. Consider whether your current rebalancing cadence held up well in this replay.",
      });
    }
  }

  if (!items.length) return null;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
        Mitigation Playbook
        <InfoTooltip text="Suggested preparation and risk-management actions based on this scenario's results. Not investment advice — validate all actions against your investment policy statement." />
      </h3>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="flex gap-3 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
            <span className="text-base leading-none mt-0.5 shrink-0">{item.icon}</span>
            <div>
              <p className="text-xs font-semibold text-[var(--color-text)] mb-0.5">{item.title}</p>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed">{item.body}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] italic text-[var(--color-muted)]">
        ⚠ These are general frameworks, not personalised investment advice. All scenario outputs are model-based estimates.
      </p>
    </div>
  );
}

// ── ScenariosTab ───────────────────────────────────────────────────────────────

function ScenariosTab({ portfolioId }: { portfolioId: string }) {
  const [scenarioType, setScenarioType] = useState<ScenarioType>("market_shock");
  const [shockPct, setShockPct] = useState("-20");
  const [volScale, setVolScale] = useState("2");
  const [replayStart, setReplayStart] = useState("2022-01-01");
  const [replayEnd, setReplayEnd] = useState("2022-12-31");
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const mutation = useMutation<ScenarioResult, Error, ScenarioRequest>({
    mutationFn: (body) => runScenario(portfolioId, body),
    onSuccess: (data) => setResult(data),
  });

  function handleRun() {
    const body: ScenarioRequest = { scenario_type: scenarioType };
    if (scenarioType === "market_shock") body.shock_pct = parseFloat(shockPct) / 100;
    if (scenarioType === "vol_shock") body.vol_scale = parseFloat(volScale);
    if (scenarioType === "historical_replay") { body.start_date = replayStart; body.end_date = replayEnd; }
    mutation.mutate(body);
  }

  const TYPES: { key: ScenarioType; label: string }[] = [
    { key: "market_shock", label: "Market Shock" },
    { key: "vol_shock", label: "Vol Shock" },
    { key: "historical_replay", label: "Historical Replay" },
  ];

  return (
    <div className="space-y-5">
      {showGuide && <ScenarioGuide onClose={() => setShowGuide(false)} />}

      {/* Type selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-[var(--radius-btn)] border border-[var(--color-border)] overflow-hidden">
          {TYPES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setScenarioType(key); setResult(null); }}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                scenarioType === key
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowGuide(true)}
          className="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
        >
          <BookOpen size={13} /> Scenario Guide
        </button>
      </div>

      {/* Inputs */}
      <div className="flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        {scenarioType === "market_shock" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Shock % (e.g. −20)</label>
            <input
              type="number"
              value={shockPct}
              onChange={(e) => setShockPct(e.target.value)}
              className="w-32 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm"
            />
          </div>
        )}
        {scenarioType === "vol_shock" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Vol Scale (e.g. 2 = 2×)</label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={volScale}
              onChange={(e) => setVolScale(e.target.value)}
              className="w-32 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm"
            />
          </div>
        )}
        {scenarioType === "historical_replay" && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Start</label>
              <input type="date" value={replayStart} onChange={(e) => setReplayStart(e.target.value)}
                className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">End</label>
              <input type="date" value={replayEnd} onChange={(e) => setReplayEnd(e.target.value)}
                className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
            </div>
          </>
        )}
        <button
          onClick={handleRun}
          disabled={mutation.isPending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {mutation.isPending ? "Running…" : "Run Scenario"}
        </button>
      </div>

      {mutation.error && (
        <p className="text-sm text-[var(--color-negative)]">{mutation.error.message}</p>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Market shock result */}
          {result.scenario_type === "market_shock" && result.portfolio_impact != null && (
            <>
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                <p className="text-xs text-[var(--color-muted)]">Portfolio Impact</p>
                <p className={`text-3xl font-bold ${colorForValue(result.portfolio_impact)}`}>
                  {fmtPct(result.portfolio_impact)}
                </p>
              </div>
              {result.contributions && (
                <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm overflow-auto">
                  <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Per-Asset Impact</h3>
                  <table className="w-full text-xs">
                    <thead className="border-b border-[var(--color-border)] bg-gray-50">
                      <tr>
                        {["Ticker", "Weight", "Impact"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {result.contributions.map((c) => (
                        <tr key={c.ticker} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono font-medium">{c.ticker}</td>
                          <td className="px-3 py-2">{fmtPct(c.weight)}</td>
                          <td className={`px-3 py-2 font-semibold ${colorForValue(c.impact)}`}>{fmtPct(c.impact)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Vol shock result */}
          {result.scenario_type === "vol_shock" && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Base Vol", value: result.base_vol != null ? fmtPct(result.base_vol) : "—" },
                { label: "Shocked Vol", value: result.shocked_vol != null ? fmtPct(result.shocked_vol) : "—" },
                { label: "Vol Scale", value: `${result.vol_scale}×` },
              ].map((c) => (
                <div key={c.label} className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                  <p className="text-xs text-[var(--color-muted)]">{c.label}</p>
                  <p className="text-2xl font-bold text-[var(--color-text)]">{c.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Historical replay result */}
          {result.scenario_type === "historical_replay" && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Total Return", value: result.total_return != null ? fmtPct(result.total_return) : "—", colored: true },
                  { label: "Max Drawdown", value: result.max_dd != null ? fmtPct(result.max_dd) : "—", colored: true },
                  { label: "Best Day", value: result.best_day != null ? fmtPct(result.best_day) : "—", colored: true },
                  { label: "Worst Day", value: result.worst_day != null ? fmtPct(result.worst_day) : "—", colored: true },
                ].map((c) => (
                  <div key={c.label} className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                    <p className="text-xs text-[var(--color-muted)]">{c.label}</p>
                    <p className={`text-xl font-bold ${colorForValue(parseFloat(c.value.replace(/[%+]/g, "") || "0"))}`}>{c.value}</p>
                  </div>
                ))}
              </div>

              {/* Equity curve */}
              {result.equity_curve && result.equity_curve.length > 1 && (
                <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                  <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Equity Curve</h3>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={downsample(result.equity_curve, 300)} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={60} tickFormatter={(d: string) => d.slice(0, 7)} />
                      <YAxis tick={{ fontSize: 10 }} width={48} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(2)} />
                      <Tooltip labelFormatter={(l) => `Date: ${l}`} formatter={(v: number | undefined) => [(v ?? 0).toFixed(4), "Portfolio"]} />
                      <Line type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={1.5} dot={false} name="Portfolio" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Contributors */}
              {result.contributors && (
                <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm overflow-auto">
                  <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Asset Contributions</h3>
                  <table className="w-full text-xs">
                    <thead className="border-b border-[var(--color-border)] bg-gray-50">
                      <tr>
                        {["Ticker", "Asset Return", "Weight", "Contribution"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[...result.contributors].sort((a, b) => b.weighted_contribution - a.weighted_contribution).map((c) => (
                        <tr key={c.ticker} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono font-medium">{c.ticker}</td>
                          <td className={`px-3 py-2 ${colorForValue(c.asset_return)}`}>{fmtPct(c.asset_return)}</td>
                          <td className="px-3 py-2">{fmtPct(c.weight)}</td>
                          <td className={`px-3 py-2 font-semibold ${colorForValue(c.weighted_contribution)}`}>{fmtPct(c.weighted_contribution)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Mitigation Playbook — always rendered after any result */}
          <ScenarioPlaybook result={result} />
        </div>
      )}
    </div>
  );
}
