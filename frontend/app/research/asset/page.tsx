"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useResearch } from "@/components/research/ResearchContext";
import { fetchAssetResearch, fetchUniverse } from "@/lib/api";
import { fmtPct, fmtNum } from "@/lib/utils";
import type { AssetResearchResult } from "@/types/research";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";

// ── Stat card ───────────────────────────────────────────────────────────────

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <p className="text-[10px] font-medium text-[var(--color-muted)]">{label}</p>
      <p className="mt-0.5 text-base font-bold text-[var(--color-text)]">{value}</p>
      {detail && <p className="text-[10px] text-[var(--color-muted)]">{detail}</p>}
    </div>
  );
}

// ── Factor Exposure Table ───────────────────────────────────────────────────

function FactorExposureSection({ data }: { data: AssetResearchResult }) {
  const ff = data.factor_exposure;
  if (ff.error) {
    return (
      <div className="rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700">
        Factor exposure unavailable: {ff.error}
      </div>
    );
  }

  const factors = [
    { name: "Market (Mkt-RF)", loading: ff.beta_mkt, t: ff.t_stats?.mkt },
    { name: "Size (SMB)", loading: ff.beta_smb, t: ff.t_stats?.smb },
    { name: "Value (HML)", loading: ff.beta_hml, t: ff.t_stats?.hml },
  ];

  // Interpretation
  const interp: string[] = [];
  if (ff.beta_mkt !== undefined) {
    if (ff.beta_mkt > 1.1) interp.push("High market exposure (aggressive)");
    else if (ff.beta_mkt < 0.8) interp.push("Low market exposure (defensive)");
    else interp.push("Market-like exposure");
  }
  if (ff.beta_smb !== undefined) {
    if (ff.beta_smb > 0.2) interp.push("small-cap tilt");
    else if (ff.beta_smb < -0.2) interp.push("large-cap tilt");
  }
  if (ff.beta_hml !== undefined) {
    if (ff.beta_hml > 0.2) interp.push("value tilt");
    else if (ff.beta_hml < -0.2) interp.push("growth tilt");
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <h3 className="mb-1 text-sm font-semibold text-[var(--color-text)]">
        Fama-French 3-Factor Exposure
      </h3>
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        OLS regression: R<sub>i</sub> - R<sub>f</sub> = alpha + beta<sub>mkt</sub>(R<sub>m</sub>-R<sub>f</sub>) + beta<sub>smb</sub>SMB + beta<sub>hml</sub>HML
      </p>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Factor</th>
            <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Loading</th>
            <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">t-stat</th>
            <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">Significance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[var(--color-border)]">
            <td className="px-3 py-2 font-medium">Alpha (annualised)</td>
            <td className="px-3 py-2 font-mono">{fmtPct(ff.alpha_annual)}</td>
            <td className="px-3 py-2 font-mono">{fmtNum(ff.t_stats?.alpha)}</td>
            <td className="px-3 py-2">
              {ff.t_stats?.alpha !== undefined && (
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  Math.abs(ff.t_stats.alpha) > 1.96
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-600"
                }`}>
                  {Math.abs(ff.t_stats.alpha) > 1.96 ? "SIG" : "NS"}
                </span>
              )}
            </td>
          </tr>
          {factors.map((f) => (
            <tr key={f.name} className="border-b border-[var(--color-border)]">
              <td className="px-3 py-2 font-medium">{f.name}</td>
              <td className="px-3 py-2 font-mono">{fmtNum(f.loading, 3)}</td>
              <td className="px-3 py-2 font-mono">{fmtNum(f.t, 2)}</td>
              <td className="px-3 py-2">
                {f.t !== undefined && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    Math.abs(f.t) > 1.96
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-600"
                  }`}>
                    {Math.abs(f.t) > 1.96 ? "SIG" : "NS"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex items-center gap-4 text-xs">
        <span className="text-[var(--color-muted)]">
          R<sup>2</sup> = <strong>{fmtNum(ff.r_squared, 3)}</strong>
        </span>
        <span className="text-[var(--color-muted)]">
          Residual vol = <strong>{fmtPct(ff.residual_vol)}</strong>
        </span>
        <span className="text-[var(--color-muted)]">
          {ff.n_obs} observations
        </span>
      </div>

      {interp.length > 0 && (
        <p className="mt-2 rounded bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)]">
          <strong>Interpretation:</strong> {interp.join(", ")}.
        </p>
      )}
    </div>
  );
}

// ── Portfolio Role Badge ────────────────────────────────────────────────────

function PortfolioRoleSection({ data }: { data: AssetResearchResult }) {
  const role = data.role;

  const roleColors: Record<string, string> = {
    "Return Engine": "bg-blue-100 text-blue-800 border-blue-300",
    "Diversifier": "bg-purple-100 text-purple-800 border-purple-300",
    "Defensive Ballast": "bg-green-100 text-green-800 border-green-300",
    "Income Generator": "bg-amber-100 text-amber-800 border-amber-300",
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Portfolio Role</h3>
      <div className="flex items-center gap-3">
        <span className={`rounded-lg border px-4 py-2 text-sm font-bold ${roleColors[role.primary_role] ?? "bg-gray-100 text-gray-800 border-gray-300"}`}>
          {role.primary_role}
        </span>
        {role.secondary_role && (
          <span className={`rounded border px-3 py-1.5 text-xs font-medium ${roleColors[role.secondary_role] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
            {role.secondary_role}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--color-muted)]">{role.rationale}</p>

      {/* Score bars */}
      <div className="mt-3 space-y-1.5">
        {Object.entries(role.scores).map(([name, score]) => (
          <div key={name} className="flex items-center gap-2 text-xs">
            <div className="w-32 text-[var(--color-muted)]">{name}</div>
            <div className="flex-1 h-2 rounded-full bg-[var(--color-border)]">
              <div
                className="h-2 rounded-full bg-[var(--color-primary)]"
                style={{ width: `${score * 100}%` }}
              />
            </div>
            <div className="w-8 text-right font-mono text-[var(--color-muted)]">
              {(score * 100).toFixed(0)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Correlation Chart ───────────────────────────────────────────────────────

function CorrelationSection({ data }: { data: AssetResearchResult }) {
  const corr = data.correlations;
  const chartData = corr.per_holding
    .filter((h) => h.correlation != null)
    .map((h) => ({ ticker: h.ticker, correlation: h.correlation! }));

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <h3 className="mb-1 text-sm font-semibold text-[var(--color-text)]">
        Correlation vs Portfolio Holdings
      </h3>
      <div className="mb-3 flex gap-4 text-xs text-[var(--color-muted)]">
        <span>Avg: <strong>{fmtNum(corr.avg_correlation, 3)}</strong></span>
        <span>Max: <strong>{fmtNum(corr.max_correlation, 3)}</strong> ({corr.max_corr_ticker})</span>
      </div>

      {corr.crowding_warning && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Crowding risk: correlation &gt; 0.8 with {corr.max_corr_ticker}. This asset may not add meaningful diversification.
        </div>
      )}

      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={Math.max(150, chartData.length * 28)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis type="number" domain={[-1, 1]} tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="ticker" tick={{ fontSize: 10 }} width={50} />
            <Tooltip formatter={(v: unknown) => fmtNum(v as number, 3)} />
            <Bar dataKey="correlation" name="Correlation">
              {chartData.map((d, i) => (
                <Cell
                  key={i}
                  fill={
                    d.correlation > 0.8
                      ? "#ef4444"
                      : d.correlation > 0.5
                        ? "#f59e0b"
                        : d.correlation > 0
                          ? "#3b82f6"
                          : "#8b5cf6"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function AssetResearchPage() {
  const { portfolioId } = useResearch();
  const [ticker, setTicker] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Universe tickers for autocomplete
  const { data: universeData } = useQuery({
    queryKey: ["universe-list"],
    queryFn: () => fetchUniverse(),
    staleTime: 60_000,
  });

  const universeTickers = universeData?.tickers ?? [];
  const filtered = searchQuery.length > 0
    ? universeTickers.filter(
        (t) =>
          t.ticker.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (t.name ?? "").toLowerCase().includes(searchQuery.toLowerCase()),
      ).slice(0, 10)
    : [];

  // Asset research mutation
  const researchMut = useMutation({
    mutationFn: () => fetchAssetResearch(portfolioId!, ticker),
  });

  const data = researchMut.data;

  if (!portfolioId) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
        Select a portfolio above to begin asset research.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Ticker selector */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          Select a Security to Analyze
        </h3>
        <div className="flex items-end gap-3">
          <div className="relative flex-1 max-w-xs">
            <input
              type="text"
              value={searchQuery || ticker}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setTicker(e.target.value.toUpperCase());
              }}
              placeholder="Search ticker or name..."
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-primary)] focus:outline-none"
            />
            {filtered.length > 0 && searchQuery.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg max-h-48 overflow-auto">
                {filtered.map((t) => (
                  <button
                    key={t.ticker}
                    onClick={() => {
                      setTicker(t.ticker);
                      setSearchQuery("");
                    }}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-[var(--color-border)]/30"
                  >
                    <span className="font-medium text-[var(--color-text)]">{t.ticker}</span>
                    {t.name && (
                      <span className="ml-2 text-[var(--color-muted)]">{t.name}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setSearchQuery("");
              researchMut.mutate();
            }}
            disabled={!ticker || researchMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-6 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {researchMut.isPending ? "Analyzing..." : "Analyze"}
          </button>
        </div>
      </div>

      {researchMut.isError && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {(researchMut.error as Error).message}
        </div>
      )}

      {data && (
        <>
          {/* Return Profile */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
              Return & Risk Profile — {data.ticker}
            </h3>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="CAGR" value={fmtPct(data.profile.cagr)} />
              <Stat label="Volatility" value={fmtPct(data.profile.vol)} detail="Annualised" />
              <Stat label="Sharpe" value={fmtNum(data.profile.sharpe)} />
              <Stat label="Sortino" value={fmtNum(data.profile.sortino)} />
              <Stat label="Calmar" value={fmtNum(data.profile.calmar)} />
              <Stat label="Max Drawdown" value={fmtPct(data.profile.max_dd)} />
              <Stat label="Beta" value={fmtNum(data.profile.beta)} detail="vs SPY" />
              <Stat label="Alpha" value={fmtPct(data.profile.alpha)} detail="vs SPY" />
              <Stat label="Upside Capture" value={fmtNum(data.profile.upside_capture, 2)} />
              <Stat label="Downside Capture" value={fmtNum(data.profile.downside_capture, 2)} />
            </div>
          </div>

          {/* Rolling Vol Chart */}
          {data.profile.rolling_vol.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Rolling Volatility (63-day)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.profile.rolling_vol}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtPct(v)} />
                  <Tooltip formatter={(v: unknown) => fmtPct(v as number)} />
                  <Line dataKey="value" stroke="var(--color-primary)" dot={false} strokeWidth={1.5} name="Vol" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Factor Exposure */}
          <FactorExposureSection data={data} />

          {/* Portfolio Role */}
          <PortfolioRoleSection data={data} />

          {/* Correlation */}
          <CorrelationSection data={data} />
        </>
      )}
    </div>
  );
}
