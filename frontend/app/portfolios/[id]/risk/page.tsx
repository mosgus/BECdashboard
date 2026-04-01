"use client";
import { use, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchPortfolioAnalytics,
  fetchPortfolioHealth,
  runScenario,
} from "@/lib/api";
import { fmtNum, fmtPct, colorForValue, downsample } from "@/lib/utils";
import InfoTooltip from "@/components/InfoTooltip";
import HelpSidebar from "@/components/HelpSidebar";
import SignalBadge from "@/components/SignalBadge";
import RiskContributionChart from "@/components/RiskContributionChart";
import ScenarioGuide from "@/components/ScenarioGuide";
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

type RiskSection = "performance" | "health" | "scenarios";

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
      {section === "scenarios"   && <ScenariosSection portfolioId={portfolioId} />}
    </div>
  );
}

// ── Performance section ────────────────────────────────────────────────────────

function PerformanceSection({ portfolioId }: { portfolioId: string }) {
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
    { key: "market_shock",     label: "Market Shock" },
    { key: "vol_shock",        label: "Vol Shock" },
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
                { label: "Base Vol",    value: result.base_vol    != null ? fmtPct(result.base_vol)    : "—" },
                { label: "Shocked Vol", value: result.shocked_vol != null ? fmtPct(result.shocked_vol) : "—" },
                { label: "Vol Scale",   value: `${result.vol_scale}×` },
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
                  { label: "Total Return", value: result.total_return != null ? fmtPct(result.total_return) : "—" },
                  { label: "Max Drawdown", value: result.max_dd      != null ? fmtPct(result.max_dd)       : "—" },
                  { label: "Best Day",     value: result.best_day    != null ? fmtPct(result.best_day)     : "—" },
                  { label: "Worst Day",    value: result.worst_day   != null ? fmtPct(result.worst_day)    : "—" },
                ].map((c) => (
                  <div key={c.label} className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                    <p className="text-xs text-[var(--color-muted)]">{c.label}</p>
                    <p className={`text-xl font-bold ${colorForValue(parseFloat(c.value.replace(/[%+]/g, "") || "0"))}`}>{c.value}</p>
                  </div>
                ))}
              </div>

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

          <ScenarioPlaybook result={result} />
        </div>
      )}
    </div>
  );
}
