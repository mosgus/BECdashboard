"use client";
import { use, useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchPortfolioAnalytics,
  fetchPortfolioAttribution,
  fetchPortfolioHealth,
  runScenario,
} from "@/lib/api";
import { fmtNum, fmtPct, colorForValue, downsample } from "@/lib/utils";
import { SCENARIO_PRESETS, TAG_STYLES, type ScenarioTag } from "@/lib/scenarios";
import InfoTooltip from "@/components/InfoTooltip";
import HelpSidebar from "@/components/HelpSidebar";
import SignalBadge from "@/components/SignalBadge";
import ChartExportButtons from "@/components/ChartExportButtons";
import RiskContributionChart from "@/components/RiskContributionChart";
import ScenarioGuide from "@/components/ScenarioGuide";
import ScenarioComparisonBar from "@/components/research/ScenarioComparisonBar";
import ScenarioResultCard from "@/components/research/ScenarioResultCard";
import type { PortfolioAnalytics } from "@/types/sprint3";
import type { PortfolioHealthResult, ScenarioResult, ScenarioType, ScenarioRequest } from "@/types/sprint7";
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

type RiskSection = "performance" | "health" | "attribution" | "scenarios";

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

export default function RiskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: portfolioId } = use(params);
  const { checked } = useAuth();
  const [section, setSection] = useState<RiskSection>("performance");

  if (!checked) return null;

  return (
    <div className="space-y-4">
      {/* Section switcher */}
      <div className="flex gap-2">
        {([
          { key: "performance", label: "Performance" },
          { key: "health",      label: "Health" },
          { key: "attribution", label: "Attribution" },
          { key: "scenarios",   label: "Scenarios" },
        ] as { key: RiskSection; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`rounded-[var(--radius-btn)] px-4 py-2 text-sm font-medium transition-colors ${
              section === key
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "performance" && <PerformanceSection portfolioId={portfolioId} />}
      {section === "health"      && <HealthSection portfolioId={portfolioId} />}
      {section === "attribution" && <AttributionSection portfolioId={portfolioId} />}
      {section === "scenarios"   && <ScenariosSection portfolioId={portfolioId} />}
    </div>
  );
}

// ── Performance section ────────────────────────────────────────────────────────

function PerformanceSection({ portfolioId }: { portfolioId: string }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [queryParams, setQueryParams] = useState<{ start?: string; end?: string }>({});
  const equityChartRef = useRef<HTMLDivElement>(null);

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

      {/* Comparative metrics: Portfolio vs Benchmark side-by-side */}
      {analytics?.metrics && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
            Portfolio vs Benchmark (SPY)
            <InfoTooltip text="Side-by-side comparison of key metrics. Portfolio metrics are simulated: current weights held constant over the lookback period." />
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
                  <th className="py-2 text-left font-medium">Metric</th>
                  <th className="py-2 text-right font-medium">Portfolio</th>
                  <th className="py-2 text-right font-medium">SPY</th>
                  <th className="py-2 text-right font-medium">Diff</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "CAGR", port: analytics.metrics.cagr, bench: analytics.bench_metrics?.cagr },
                  { label: "Volatility", port: analytics.metrics.vol, bench: analytics.bench_metrics?.vol },
                  { label: "Sharpe", port: analytics.metrics.sharpe, bench: analytics.bench_metrics?.sharpe, isFmt: true },
                  { label: "Max Drawdown", port: analytics.metrics.max_dd, bench: analytics.bench_metrics?.max_dd },
                ].map(({ label, port, bench, isFmt }) => {
                  const diff = bench != null ? port - bench : null;
                  const fmt = isFmt ? fmtNum : fmtPct;
                  return (
                    <tr key={label} className="border-b border-[var(--color-border)]">
                      <td className="py-2 font-medium text-[var(--color-text)]">{label}</td>
                      <td className="py-2 text-right font-semibold">{fmt(port)}</td>
                      <td className="py-2 text-right text-[var(--color-muted)]">{bench != null ? fmt(bench) : "-"}</td>
                      <td className={`py-2 text-right font-bold ${diff != null && diff > 0 ? "text-[var(--color-positive)]" : diff != null && diff < 0 ? "text-[var(--color-negative)]" : "text-[var(--color-muted)]"}`}>
                        {diff != null ? (isFmt ? (diff > 0 ? "+" : "") + fmtNum(diff) : fmtPct(diff)) : "-"}
                      </td>
                    </tr>
                  );
                })}
                {analytics.metrics.beta != null && (
                  <tr className="border-b border-[var(--color-border)]">
                    <td className="py-2 font-medium text-[var(--color-text)]">Beta</td>
                    <td className="py-2 text-right font-semibold">{fmtNum(analytics.metrics.beta)}</td>
                    <td className="py-2 text-right text-[var(--color-muted)]">1.00</td>
                    <td className="py-2 text-right text-[var(--color-muted)]">{fmtNum(analytics.metrics.beta - 1)}</td>
                  </tr>
                )}
                {analytics.metrics.alpha != null && (
                  <tr className="border-b border-[var(--color-border)]">
                    <td className="py-2 font-medium text-[var(--color-text)]">Alpha</td>
                    <td className={`py-2 text-right font-bold ${analytics.metrics.alpha > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>{fmtPct(analytics.metrics.alpha)}</td>
                    <td className="py-2 text-right text-[var(--color-muted)]">0.00%</td>
                    <td className="py-2 text-right text-[var(--color-muted)]">-</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {analytics?.equity_curves?.length ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Equity Curve
              <InfoTooltip text="Simulated: current weights assumed constant over the lookback period. Not actual trade history." />
            </h3>
            <ChartExportButtons
              chartRef={equityChartRef}
              csvData={analytics.equity_curves as unknown as Record<string, unknown>[]}
              filename="equity_curve"
            />
          </div>
          <div ref={equityChartRef}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={downsample(analytics.equity_curves)} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 7)} tick={{ fontSize: 11 }} minTickGap={60} />
              <YAxis tickFormatter={(v) => `${((v - 1) * 100).toFixed(0)}%`} tick={{ fontSize: 11 }} width={52} />
              <Tooltip formatter={(v: unknown) => v != null ? `${((Number(v) - 1) * 100).toFixed(2)}%` : "—"} labelFormatter={(l) => `Date: ${l}`} />
              <Legend />
              <Line type="monotone" dataKey="portfolio" stroke="#3b82f6" strokeWidth={2} dot={false} name="Portfolio" />
              <Line type="monotone" dataKey="benchmark" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="5 3" name="SPY" />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {analytics?.signals_by_ticker?.length ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
            Exit Signals
            <InfoTooltip text="Signals use no look-ahead: each indicator scans historical data and reports the last trigger event." />
          </h3>
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
    </div>
  );
}

// ── Health section ─────────────────────────────────────────────────────────────

function HealthSection({ portfolioId }: { portfolioId: string }) {
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

      {/* ── Mitigation Recommendations ──────────────────────────────────── */}
      <MitigationPanel
        hhi={data.concentration.hhi}
        top5={data.concentration.top5}
        beta={data.beta}
        vol={data.vol}
        portfolioId={portfolioId}
      />

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


// ── Attribution section (FF3 performance decomposition) ─────────────────────

function AttributionSection({ portfolioId }: { portfolioId: string }) {
  const [lookbackDays, setLookbackDays] = useState(252);
  const { data, isLoading, error } = useQuery({
    queryKey: ["portfolio-attribution", portfolioId, lookbackDays],
    queryFn: () => fetchPortfolioAttribution(portfolioId, lookbackDays),
  });

  if (isLoading) {
    return <p className="text-sm text-[var(--color-muted)]">Running Fama-French regression…</p>;
  }
  if (error) {
    return <p className="text-sm text-[var(--color-negative)]">{(error as Error).message}</p>;
  }
  if (!data || data.error) {
    return (
      <div className="space-y-3">
        <LookbackPicker value={lookbackDays} onChange={setLookbackDays} />
        <p className="text-sm text-[var(--color-negative)]">{data?.error ?? "No attribution data available."}</p>
      </div>
    );
  }

  const contribs = data.factor_contributions!;
  const totalRet = data.period_return_pct ?? 0;
  const segments = [
    { key: "alpha",    label: "Alpha",    value: contribs.alpha_pct,    fill: "#8b5cf6" },
    { key: "market",   label: "Market",   value: contribs.market_pct,   fill: "#3b82f6" },
    { key: "smb",      label: "Size (SMB)", value: contribs.smb_pct,    fill: "#10b981" },
    { key: "hml",      label: "Value (HML)", value: contribs.hml_pct,   fill: "#f59e0b" },
    { key: "rf",       label: "Risk-free",  value: contribs.rf_pct,    fill: "#6b7280" },
    { key: "residual", label: "Residual",   value: contribs.residual_pct, fill: "#d1d5db" },
  ];

  const betas = [
    { name: "β (Market)",     value: data.beta_mkt ?? 0, t: data.t_stats?.mkt ?? 0 },
    { name: "β (Size, SMB)",  value: data.beta_smb ?? 0, t: data.t_stats?.smb ?? 0 },
    { name: "β (Value, HML)", value: data.beta_hml ?? 0, t: data.t_stats?.hml ?? 0 },
  ];

  const sig = (t: number) => Math.abs(t) > 1.96;

  // Build interpretation text
  const parts: string[] = [];
  parts.push(`Portfolio returned ${fmtPct(totalRet)} over the last ${data.n_obs ?? "?"} trading days.`);
  if (Math.abs(data.beta_mkt ?? 0) > 0.1) {
    parts.push(`Market beta ${(data.beta_mkt ?? 0).toFixed(2)} contributed ${fmtPct(contribs.market_pct)}.`);
  }
  if (Math.abs(data.beta_smb ?? 0) > 0.15) {
    parts.push(`${(data.beta_smb ?? 0) > 0 ? "Small-cap tilt" : "Large-cap tilt"} contributed ${fmtPct(contribs.smb_pct)}.`);
  }
  if (Math.abs(data.beta_hml ?? 0) > 0.15) {
    parts.push(`${(data.beta_hml ?? 0) > 0 ? "Value tilt" : "Growth tilt"} contributed ${fmtPct(contribs.hml_pct)}.`);
  }
  parts.push(`Alpha: ${fmtPct(contribs.alpha_pct)} (annualised ${fmtPct(data.alpha_annual ?? 0)}).`);

  return (
    <div className="space-y-5">
      <LookbackPicker value={lookbackDays} onChange={setLookbackDays} />

      {/* Summary banner */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <p className="text-xs font-semibold text-[var(--color-muted)] mb-1">Attribution Summary</p>
        <p className="text-sm text-[var(--color-text)] leading-6">{parts.join(" ")}</p>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          R² = {fmtNum(data.r_squared)} · {data.n_obs} observations
        </p>
      </div>

      {/* Factor loadings */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          Factor Loadings (Fama-French 3)
          <InfoTooltip text="OLS coefficients from regressing portfolio excess returns on Mkt-RF, SMB, and HML. Stars indicate statistical significance (|t| > 1.96)." />
        </h3>
        <div className="space-y-2">
          {betas.map((b) => (
            <div key={b.name} className="flex items-center gap-3 text-xs">
              <div className="w-32 text-[var(--color-muted)]">{b.name}</div>
              <div className="flex-1 relative h-5 bg-[var(--color-bg)] rounded overflow-hidden">
                <div
                  className={`absolute top-0 h-full ${b.value >= 0 ? "bg-blue-500" : "bg-red-500"}`}
                  style={{
                    left: b.value >= 0 ? "50%" : `${50 + b.value * 40}%`,
                    width: `${Math.min(40, Math.abs(b.value * 40))}%`,
                  }}
                />
                <div className="absolute top-0 left-1/2 h-full w-[1px] bg-[var(--color-border)]" />
              </div>
              <div className="w-16 text-right font-mono">{fmtNum(b.value)}</div>
              <div className="w-20 text-right text-[var(--color-muted)]">t = {fmtNum(b.t, 2)} {sig(b.t) ? "★" : ""}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Contribution stacked bar */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          Return Contribution Breakdown
          <InfoTooltip text="Period return decomposed into alpha + market + SMB + HML + risk-free + residual. Segments sum to total period return." />
        </h3>
        <div className="mb-3 text-xs text-[var(--color-muted)]">
          Total period return: <strong className="text-[var(--color-text)]">{fmtPct(totalRet)}</strong>
        </div>

        {/* Horizontal stacked bar */}
        <div className="relative h-8 w-full rounded overflow-hidden border border-[var(--color-border)]">
          {(() => {
            const totalAbs = segments.reduce((s, seg) => s + Math.abs(seg.value), 0) || 1;
            let offset = 0;
            return segments.map((seg) => {
              const width = (Math.abs(seg.value) / totalAbs) * 100;
              const style = { left: `${offset}%`, width: `${width}%`, backgroundColor: seg.fill };
              offset += width;
              return (
                <div
                  key={seg.key}
                  className="absolute top-0 h-full opacity-90 flex items-center justify-center"
                  style={style}
                  title={`${seg.label}: ${fmtPct(seg.value)}`}
                >
                  {width > 5 && (
                    <span className="text-[10px] font-semibold text-white drop-shadow">
                      {(seg.value * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            });
          })()}
        </div>

        {/* Legend */}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {segments.map((seg) => (
            <div key={seg.key} className="flex items-center gap-2 text-xs">
              <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: seg.fill }} />
              <span className="text-[var(--color-muted)]">{seg.label}:</span>
              <span className="font-mono text-[var(--color-text)]">{fmtPct(seg.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LookbackPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs font-medium text-[var(--color-muted)]">Lookback:</label>
      <div className="flex gap-1">
        {[
          { label: "6mo", days: 126 },
          { label: "1Y", days: 252 },
          { label: "2Y", days: 504 },
          { label: "3Y", days: 756 },
          { label: "5Y", days: 1260 },
        ].map(({ label, days }) => (
          <button
            key={days}
            onClick={() => onChange(days)}
            className={`rounded-[var(--radius-btn)] px-3 py-1.5 text-xs font-medium transition-colors ${
              value === days
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-border)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}


// ── Mitigation Recommendations Panel ─────────────────────────────────────────

function MitigationPanel({
  hhi, top5, beta, vol, portfolioId,
}: {
  hhi: number; top5: number; beta: number | null; vol: number | null; portfolioId: string;
}) {
  const recs: { severity: "high" | "medium" | "low"; title: string; body: string; action?: string; link?: string }[] = [];

  if (hhi > 0.15) {
    recs.push({
      severity: "high",
      title: "High concentration risk",
      body: `HHI of ${hhi.toFixed(3)} indicates a concentrated portfolio. Top 5 holdings account for ${(top5 * 100).toFixed(1)}% of the portfolio.`,
      action: "Consider using Risk Parity or Max Diversification optimization.",
      link: `/portfolios/${portfolioId}/targets`,
    });
  } else if (hhi > 0.08) {
    recs.push({
      severity: "medium",
      title: "Moderate concentration",
      body: `HHI of ${hhi.toFixed(3)} — portfolio is moderately concentrated. Consider adding positions to improve diversification.`,
    });
  }

  if (beta != null && beta > 1.3) {
    recs.push({
      severity: "high",
      title: "High market sensitivity",
      body: `Portfolio beta of ${beta.toFixed(2)} amplifies market swings by ${((beta - 1) * 100).toFixed(0)}%.`,
      action: "Consider adding defensive sectors (XLP, XLV, utilities) or non-correlated assets (GLD, bonds).",
      link: `/portfolios/${portfolioId}/outlook`,
    });
  } else if (beta != null && beta > 1.1) {
    recs.push({
      severity: "medium",
      title: "Above-market sensitivity",
      body: `Beta of ${beta.toFixed(2)} — portfolio moves more than the market. Run CAPM optimization in the Outlook tab to explore alternatives.`,
      link: `/portfolios/${portfolioId}/outlook`,
    });
  }

  if (vol != null && vol > 0.25) {
    recs.push({
      severity: "high",
      title: "Elevated volatility",
      body: `Annualised vol of ${(vol * 100).toFixed(1)}% is significantly above typical balanced portfolios (12-18%).`,
      action: "Consider the Target Volatility optimization mode to scale down to a comfortable vol level.",
      link: `/portfolios/${portfolioId}/targets`,
    });
  } else if (vol != null && vol > 0.20) {
    recs.push({
      severity: "medium",
      title: "Above-average volatility",
      body: `Annualised vol of ${(vol * 100).toFixed(1)}%. Min Variance optimization can reduce this while staying fully invested.`,
      link: `/portfolios/${portfolioId}/targets`,
    });
  }

  if (recs.length === 0) {
    recs.push({
      severity: "low",
      title: "Portfolio health looks good",
      body: "No major concentration, beta, or volatility concerns detected. Continue monitoring periodically.",
    });
  }

  const severityColors = {
    high: "border-red-300 bg-red-50 text-red-800",
    medium: "border-amber-300 bg-amber-50 text-amber-800",
    low: "border-green-300 bg-green-50 text-green-800",
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm space-y-3">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        Risk Mitigation Recommendations
        <InfoTooltip text="Actionable suggestions based on current portfolio health metrics. Click links to navigate to relevant tools." />
      </h3>
      {recs.map((r, i) => (
        <div key={i} className={`rounded-[var(--radius-btn)] border px-4 py-3 text-xs ${severityColors[r.severity]}`}>
          <p className="font-semibold">{r.title}</p>
          <p className="mt-1">{r.body}</p>
          {r.action && <p className="mt-1 font-medium">{r.action}</p>}
          {r.link && (
            <Link href={r.link} className="mt-1 inline-block font-semibold underline hover:opacity-80">
              Go to tool →
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}


// ── Scenario Playbook helper ───────────────────────────────────────────────────

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

// ── Scenarios section ──────────────────────────────────────────────────────────

function ScenariosSection({ portfolioId }: { portfolioId: string }) {
  const [scenarioType, setScenarioType] = useState<ScenarioType>("market_shock");
  const [shockPct, setShockPct] = useState("-20");
  const [volScale, setVolScale] = useState("2");
  const [replayStart, setReplayStart] = useState("2022-01-01");
  const [replayEnd, setReplayEnd] = useState("2022-12-31");
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [showGuide, setShowGuide] = useState(false);

  const mutation = useMutation<ScenarioResult, Error, ScenarioRequest>({
    mutationFn: (body) => runScenario(portfolioId, body),
    onSuccess: (data) => setResults((prev) => [...prev, data]),
  });

  function handleRun() {
    const body: ScenarioRequest = { scenario_type: scenarioType };
    if (scenarioType === "market_shock") body.shock_pct = parseFloat(shockPct) / 100;
    if (scenarioType === "vol_shock") body.vol_scale = parseFloat(volScale);
    if (scenarioType === "historical_replay") { body.start_date = replayStart; body.end_date = replayEnd; }
    if (scenarioType === "factor_replay") { body.start_date = replayStart; body.end_date = replayEnd; }
    mutation.mutate(body);
  }

  function runPreset(p: any) {
    setScenarioType("factor_replay" as ScenarioType);
    setReplayStart(p.start);
    setReplayEnd(p.end);
    const body: ScenarioRequest = { scenario_type: "factor_replay", start_date: p.start, end_date: p.end };
    mutation.mutate(body);
  }

  const TYPES: { key: ScenarioType; label: string }[] = [
    { key: "market_shock",      label: "Market Shock" },
    { key: "vol_shock",         label: "Vol Shock" },
    { key: "historical_replay", label: "Historical Replay" },
    { key: "factor_replay",     label: "Factor Replay (Historical + Modeled)" },
  ];

  return (
    <div className="space-y-5">
      {showGuide && <ScenarioGuide onClose={() => setShowGuide(false)} />}

      {/* Preset scenarios gallery */}
      <div>
        <p className="mb-2 text-xs font-semibold text-[var(--color-muted)]">
          Preset Scenarios — click to run factor replay with one of these crisis windows
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIO_PRESETS.map((p: any) => (
            <button
              key={p.id}
              onClick={() => runPreset(p)}
              disabled={mutation.isPending}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:border-[var(--color-primary)] hover:shadow-sm transition-all disabled:opacity-50"
            >
              <p className="text-xs font-semibold text-[var(--color-text)]">{p.name}</p>
              <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{p.description}</p>
              <p className="mt-1 text-[10px] font-mono text-[var(--color-muted)]">
                {p.start} → {p.end}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {p.tags.map((t: ScenarioTag) => (
                  <span key={t} className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${TAG_STYLES[t]}`}>
                    {t}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-[var(--color-border)]">
        <p className="mb-3 text-xs font-semibold text-[var(--color-muted)]">Or run a custom scenario:</p>
      </div>

      {/* Type selector and controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">
            Scenario Type
          </label>
          <select
            value={scenarioType}
            onChange={(e) => setScenarioType(e.target.value as ScenarioType)}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          >
            {TYPES.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowGuide(true)}
          className="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
        >
          <BookOpen size={13} /> Scenario Guide
        </button>
      </div>

      {/* Input controls */}
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
        {(scenarioType === "historical_replay" || scenarioType === "factor_replay") && (
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
        {results.length > 0 && (
          <button
            onClick={() => setResults([])}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)]"
          >
            Clear
          </button>
        )}
      </div>

      {mutation.error && (
        <p className="text-sm text-[var(--color-negative)]">{mutation.error.message}</p>
      )}

      {/* Results with comparison */}
      {results.length > 0 && (
        <div className="space-y-4">
          <ScenarioComparisonBar results={results} />
          <div className="space-y-4">
            {results.map((result, i) => (
              <ScenarioResultCard
                key={i}
                result={result}
                notionalValue={null}
                index={i}
                onRemove={() => setResults((prev) => prev.filter((_, idx) => idx !== i))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
