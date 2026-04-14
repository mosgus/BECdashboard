"use client";
import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  LineChart,
  Line,
  Area,
  AreaChart,
  ComposedChart,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { ScenarioResult } from "@/types/sprint7";
import { fmtPct, fmtDollar, fmtNum } from "@/lib/utils";
import { getPresetByDates } from "@/lib/scenarios";
import ChartExportButtons from "@/components/ChartExportButtons";

interface Props {
  result: ScenarioResult;
  notionalValue: number | null;
  index: number;
  onRemove: () => void;
}

export default function ScenarioResultCard({ result, notionalValue, index, onRemove }: Props) {
  if (result.scenario_type === "factor_replay") {
    return <FactorReplayCard result={result} notionalValue={notionalValue} index={index} onRemove={onRemove} />;
  }
  if (result.scenario_type === "historical_replay") {
    return <HistoricalReplayCard result={result} notionalValue={notionalValue} index={index} onRemove={onRemove} />;
  }
  if (result.scenario_type === "market_shock") {
    return <MarketShockCard result={result} notionalValue={notionalValue} index={index} onRemove={onRemove} />;
  }
  if (result.scenario_type === "vol_shock") {
    return <VolShockCard result={result} index={index} onRemove={onRemove} />;
  }
  return null;
}

// ── Shared header ─────────────────────────────────────────────────────────────

function CardHeader({ title, subtitle, tag, onRemove }: { title: string; subtitle?: string; tag: string; onRemove: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] pb-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-primary)]">
            {tag}
          </span>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
        </div>
        {subtitle && <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p>}
      </div>
      <button
        onClick={onRemove}
        className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
        title="Remove this scenario"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function MetricTile({ label, value, dollar, color }: { label: string; value: string; dollar?: string; color?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
      <p className="text-[10px] font-medium uppercase text-[var(--color-muted)]">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${color ?? "text-[var(--color-text)]"}`}>{value}</p>
      {dollar && <p className="text-[10px] text-[var(--color-muted)]">{dollar}</p>}
    </div>
  );
}

// ── Historical Replay Card ────────────────────────────────────────────────────

function HistoricalReplayCard({
  result,
  notionalValue,
  index,
  onRemove,
}: {
  result: ScenarioResult;
  notionalValue: number | null;
  index: number;
  onRemove: () => void;
}) {
  const equityRef = useRef<HTMLDivElement>(null);
  const contribRef = useRef<HTMLDivElement>(null);

  const preset = getPresetByDates(result.start, result.end);
  const title = preset?.name ?? "Historical Replay";
  const subtitle = `${result.start} → ${result.end} · ${result.n_days ?? "?"} trading days`;

  const totalRet = result.total_return ?? 0;
  const isGain = totalRet >= 0;

  // Transform equity curve data: compute daily return + drawdown for the chart
  const curveData = useMemo(() => {
    if (!result.equity_curve?.length) return [];
    let peak = result.equity_curve[0].value;
    return result.equity_curve.map((p) => {
      peak = Math.max(peak, p.value);
      const dd = p.value / peak - 1;
      return {
        date: p.date,
        value: p.value,
        ret_pct: (p.value - 1) * 100,
        drawdown: dd * 100,
      };
    });
  }, [result.equity_curve]);

  // Top contributors (most positive and most negative)
  const contribData = useMemo(() => {
    const c = result.contributors ?? [];
    const sorted = [...c].sort((a, b) => a.weighted_contribution - b.weighted_contribution);
    // Top 6 losers + top 6 winners
    const losers = sorted.slice(0, 6);
    const winners = sorted.slice(-6).reverse();
    const combined = [...losers, ...winners];
    return combined.map((r) => ({
      ticker: r.ticker,
      contribution_pct: r.weighted_contribution * 100,
      asset_return_pct: r.asset_return * 100,
      weight_pct: r.weight * 100,
    }));
  }, [result.contributors]);

  const nPositive = (result.contributors ?? []).filter((c) => c.weighted_contribution > 0).length;
  const nTotal = result.contributors?.length ?? 0;

  const dollar = (pct: number) => (notionalValue != null ? fmtDollar(notionalValue * pct) : undefined);

  const interp = `Over this ${result.n_days ?? "?"}-day window, the portfolio ${isGain ? "gained" : "lost"} ${fmtPct(Math.abs(totalRet))}${notionalValue != null ? ` (${isGain ? "+" : "−"}${fmtDollar(Math.abs(notionalValue * totalRet))} on ${fmtDollar(notionalValue)})` : ""}. Deepest drawdown: ${fmtPct(result.max_dd ?? 0)}. ${nPositive} of ${nTotal} holdings contributed positively.`;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm space-y-4">
      <CardHeader
        tag={`#${index + 1} · Historical`}
        title={title}
        subtitle={subtitle}
        onRemove={onRemove}
      />

      {/* Metric tiles */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-5">
        <MetricTile
          label="Total Return"
          value={fmtPct(totalRet)}
          dollar={dollar(totalRet)}
          color={isGain ? "text-green-600" : "text-red-600"}
        />
        <MetricTile
          label="Max Drawdown"
          value={fmtPct(result.max_dd)}
          dollar={dollar(result.max_dd ?? 0)}
          color="text-red-600"
        />
        <MetricTile
          label="Worst Day"
          value={fmtPct(result.worst_day)}
          dollar={dollar(result.worst_day ?? 0)}
          color="text-red-600"
        />
        <MetricTile
          label="Best Day"
          value={fmtPct(result.best_day)}
          dollar={dollar(result.best_day ?? 0)}
          color="text-green-600"
        />
        <MetricTile label="Trading Days" value={String(result.n_days ?? "—")} />
      </div>

      {/* Interpretation */}
      <p className="rounded bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)]">
        <strong>Interpretation: </strong>{interp}
      </p>

      {/* Equity curve */}
      {curveData.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--color-muted)]">Portfolio Equity Curve (indexed to 1.0)</p>
            <ChartExportButtons
              chartRef={equityRef}
              csvData={curveData as unknown as Record<string, unknown>[]}
              filename={`scenario_${preset?.id ?? index}_equity`}
            />
          </div>
          <div ref={equityRef}>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={curveData} margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={40} tickFormatter={(d: string) => d.slice(0, 7)} />
                <YAxis
                  yAxisId="left"
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  tick={{ fontSize: 10 }}
                  domain={["auto", "auto"]}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  tick={{ fontSize: 10 }}
                  domain={[(dataMin: number) => Math.min(dataMin, 0), 0]}
                />
                <Tooltip
                  formatter={(v: unknown, name: unknown) => {
                    const nm = String(name ?? "");
                    if (nm === "Drawdown") return [`${Number(v).toFixed(2)}%`, nm];
                    if (nm === "Return") return [`${Number(v).toFixed(2)}%`, nm];
                    return [fmtNum(Number(v), 4), nm];
                  }}
                  labelFormatter={(l) => `${l}`}
                />
                <ReferenceLine yAxisId="left" y={0} stroke="#6b7280" strokeDasharray="3 3" />
                {/* Drawdown shading on right axis */}
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="drawdown"
                  stroke="none"
                  fill="#ef4444"
                  fillOpacity={0.15}
                  name="Drawdown"
                />
                {/* Portfolio return on left axis */}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="ret_pct"
                  stroke={isGain ? "#10b981" : "#ef4444"}
                  strokeWidth={2}
                  dot={false}
                  name="Return"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Contributors bar chart */}
      {contribData.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--color-muted)]">Top Winners & Losers (weighted contribution)</p>
            <ChartExportButtons
              chartRef={contribRef}
              csvData={contribData as unknown as Record<string, unknown>[]}
              filename={`scenario_${preset?.id ?? index}_contributors`}
            />
          </div>
          <div ref={contribRef}>
            <ResponsiveContainer width="100%" height={Math.max(180, contribData.length * 22)}>
              <BarChart
                data={contribData}
                layout="vertical"
                margin={{ top: 5, right: 40, bottom: 5, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.3} />
                <XAxis type="number" tickFormatter={(v: number) => `${v.toFixed(1)}%`} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="ticker" tick={{ fontSize: 10 }} width={54} />
                <Tooltip
                  formatter={(v: unknown) => `${Number(v).toFixed(2)}%`}
                  labelFormatter={(l) => `Ticker: ${l}`}
                />
                <ReferenceLine x={0} stroke="#6b7280" />
                <Bar dataKey="contribution_pct" name="Contribution">
                  {contribData.map((d, i) => (
                    <Cell key={i} fill={d.contribution_pct >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {result.warnings && result.warnings.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {result.warnings.map((w, i) => (
            <p key={i}>&#9888; {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Market Shock Card ─────────────────────────────────────────────────────────

function MarketShockCard({
  result,
  notionalValue,
  index,
  onRemove,
}: {
  result: ScenarioResult;
  notionalValue: number | null;
  index: number;
  onRemove: () => void;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const impact = result.portfolio_impact ?? 0;
  const isGain = impact >= 0;

  const shockLabel = result.contributions?.length
    ? `${(impact / (result.contributions[0]?.impact / result.contributions[0]?.weight || 1) * 100).toFixed(1)}%`
    : "";

  const rows = (result.contributions ?? []).map((r) => ({
    ticker: r.ticker,
    impact_pct: r.impact * 100,
    weight_pct: r.weight * 100,
  }));

  const dollar = (pct: number) => (notionalValue != null ? fmtDollar(notionalValue * pct) : undefined);

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm space-y-4">
      <CardHeader
        tag={`#${index + 1} · Market Shock`}
        title={shockLabel ? `Shock: ${shockLabel}` : "Market Shock"}
        subtitle="Uniform return shock applied to every holding"
        onRemove={onRemove}
      />

      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
        <MetricTile
          label="Portfolio Impact"
          value={fmtPct(impact)}
          dollar={dollar(impact)}
          color={isGain ? "text-green-600" : "text-red-600"}
        />
        <MetricTile label="Holdings Affected" value={String(rows.length)} />
      </div>

      {/* Per-asset bar chart */}
      {rows.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--color-muted)]">Per-Asset Impact (weight × shock)</p>
            <ChartExportButtons
              chartRef={chartRef}
              csvData={rows as unknown as Record<string, unknown>[]}
              filename={`scenario_${index}_market_shock`}
            />
          </div>
          <div ref={chartRef}>
            <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 18)}>
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ top: 5, right: 40, bottom: 5, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.3} />
                <XAxis type="number" tickFormatter={(v: number) => `${v.toFixed(1)}%`} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="ticker" tick={{ fontSize: 10 }} width={54} />
                <Tooltip formatter={(v: unknown) => `${Number(v).toFixed(2)}%`} />
                <ReferenceLine x={0} stroke="#6b7280" />
                <Bar dataKey="impact_pct" fill={isGain ? "#10b981" : "#ef4444"} name="Impact" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Vol Shock Card ────────────────────────────────────────────────────────────

function VolShockCard({
  result,
  index,
  onRemove,
}: {
  result: ScenarioResult;
  index: number;
  onRemove: () => void;
}) {
  const baseVol = result.base_vol ?? 0;
  const shockedVol = result.shocked_vol ?? 0;
  const scale = result.vol_scale ?? 1;
  const delta = shockedVol - baseVol;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm space-y-4">
      <CardHeader
        tag={`#${index + 1} · Vol Shock`}
        title={`Vol Multiplier: ${scale.toFixed(1)}×`}
        subtitle="Covariance matrix scaled; portfolio volatility recomputed"
        onRemove={onRemove}
      />

      <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
        <MetricTile label="Base Vol" value={fmtPct(baseVol)} />
        <MetricTile
          label="Shocked Vol"
          value={fmtPct(shockedVol)}
          color="text-red-600"
        />
        <MetricTile label="Δ Vol" value={`+${fmtPct(delta)}`} color="text-red-600" />
      </div>

      <p className="rounded bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)]">
        <strong>Interpretation: </strong>
        A {scale.toFixed(1)}× vol shock raises portfolio annualised volatility from {fmtPct(baseVol)} to {fmtPct(shockedVol)}.
        Daily swings would be roughly {scale.toFixed(1)}× their normal magnitude.
      </p>

      {result.warnings && result.warnings.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {result.warnings.map((w, i) => (
            <p key={i}>&#9888; {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Factor Replay Card (Historical / Modeled tabs) ───────────────────────────

function FactorReplayCard({
  result,
  notionalValue,
  index,
  onRemove,
}: {
  result: ScenarioResult;
  notionalValue: number | null;
  index: number;
  onRemove: () => void;
}) {
  const [tab, setTab] = useState<"historical" | "modeled">("modeled");
  const preset = getPresetByDates(result.start, result.end);
  const title = preset?.name ?? "Factor Replay";
  const subtitle = `${result.start} → ${result.end} · ${result.n_days ?? result.regime_factors?.n_days ?? "?"} trading days`;

  const hasHistorical = result.equity_curve && result.equity_curve.length > 0;
  const hasModeled = !!result.projection_point && !!result.projection_mc;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm space-y-4">
      <CardHeader
        tag={`#${index + 1} · Scenario`}
        title={title}
        subtitle={subtitle}
        onRemove={onRemove}
      />

      <div className="flex gap-1 border-b border-[var(--color-border)]">
        <button
          onClick={() => setTab("modeled")}
          disabled={!hasModeled}
          className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
            tab === "modeled"
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed"
          }`}
        >
          Modeled Projection
        </button>
        <button
          onClick={() => setTab("historical")}
          disabled={!hasHistorical}
          className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
            tab === "historical"
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed"
          }`}
        >
          Historical Replay
        </button>
      </div>

      {tab === "modeled" ? (
        <ModeledProjectionContent result={result} notionalValue={notionalValue} index={index} />
      ) : (
        <HistoricalReplayContent result={result} notionalValue={notionalValue} index={index} />
      )}

      {result.warnings && result.warnings.length > 0 && tab === "historical" && (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {result.warnings.map((w, i) => (
            <p key={i}>&#9888; {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modeled tab content ──────────────────────────────────────────────────────

function ModeledProjectionContent({
  result,
  notionalValue,
  index,
}: {
  result: ScenarioResult;
  notionalValue: number | null;
  index: number;
}) {
  const fanRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  if (result.projection_error) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        Projection unavailable: {result.projection_error}
      </div>
    );
  }

  const point = result.projection_point;
  const mc = result.projection_mc;
  const betas = result.current_betas;
  const regime = result.regime_factors;
  if (!point || !mc) return null;

  const dollar = (pct: number) => (notionalValue != null ? fmtDollar(notionalValue * pct) : undefined);

  const pointTotal = point.total_pct;
  const isGain = pointTotal >= 0;

  const segments = [
    { key: "alpha",  label: "Alpha",   value: point.alpha_pct,  fill: "#8b5cf6" },
    { key: "market", label: "Market",  value: point.market_pct, fill: "#3b82f6" },
    { key: "smb",    label: "SMB",     value: point.smb_pct,    fill: "#10b981" },
    { key: "hml",    label: "HML",     value: point.hml_pct,    fill: "#f59e0b" },
    { key: "rf",     label: "Rf",      value: point.rf_pct,     fill: "#6b7280" },
  ];

  const histReturn = result.total_return;
  const compareText = histReturn != null
    ? `Historical replay returned ${fmtPct(histReturn)}. The modeled projection of ${fmtPct(pointTotal)} ${
        Math.abs(pointTotal - histReturn) < 0.02
          ? "closely matches historical."
          : pointTotal < histReturn
            ? "suggests today's portfolio is MORE crisis-sensitive than the holdings that existed then."
            : "suggests today's portfolio is LESS crisis-sensitive than the holdings that existed then."
      }`
    : null;

  const fanData = result.projection_paths ?? [];

  return (
    <div className="space-y-4">
      {betas && (
        <div className="rounded bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)]">
          <strong>Projection basis: </strong>
          β<sub>mkt</sub>={fmtNum(betas.beta_mkt)} · β<sub>smb</sub>={fmtNum(betas.beta_smb)} · β<sub>hml</sub>={fmtNum(betas.beta_hml)} · α<sub>daily</sub>={fmtNum(betas.alpha_daily, 5)} · R²={fmtNum(betas.r_squared)}
          <span className="ml-2 text-[var(--color-muted)]">({betas.n_obs} days of recent returns)</span>
        </div>
      )}

      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 col-span-2 sm:col-span-1">
          <p className="text-[10px] font-medium uppercase text-[var(--color-muted)]">Point Projection</p>
          <p className={`mt-0.5 text-2xl font-black ${isGain ? "text-green-600" : "text-red-600"}`}>
            {fmtPct(pointTotal)}
          </p>
          {notionalValue != null && <p className="text-[10px] text-[var(--color-muted)]">{dollar(pointTotal)}</p>}
        </div>
        <MetricTile label="Median (P50)" value={fmtPct(mc.p50)} dollar={dollar(mc.p50)} />
        <MetricTile label="5%-95% CI"  value={`${fmtPct(mc.p5)} — ${fmtPct(mc.p95)}`} />
        <MetricTile
          label="P(loss > 20%)"
          value={fmtPct(mc.prob_loss_gt_20)}
          color={mc.prob_loss_gt_20 > 0.3 ? "text-red-600" : "text-[var(--color-text)]"}
        />
      </div>

      {compareText && (
        <p className="rounded bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)]">
          <strong>Historical vs Modeled: </strong>{compareText}
        </p>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold text-[var(--color-muted)]">Monte Carlo Distribution ({mc.n_paths} paths)</p>
        <div className="grid gap-2 grid-cols-5">
          {[
            { label: "P5", value: mc.p5, color: "text-red-600" },
            { label: "P25", value: mc.p25, color: "text-red-500" },
            { label: "P50", value: mc.p50 },
            { label: "P75", value: mc.p75, color: "text-green-500" },
            { label: "P95", value: mc.p95, color: "text-green-600" },
          ].map((p) => (
            <div key={p.label} className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-center">
              <p className="text-[10px] text-[var(--color-muted)]">{p.label}</p>
              <p className={`mt-0.5 text-sm font-bold ${p.color ?? "text-[var(--color-text)]"}`}>{fmtPct(p.value)}</p>
              {notionalValue != null && <p className="text-[9px] text-[var(--color-muted)]">{dollar(p.value)}</p>}
            </div>
          ))}
        </div>
      </div>

      {fanData.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--color-muted)]">Projected Path Percentile Bands</p>
            <ChartExportButtons
              chartRef={fanRef}
              csvData={fanData as unknown as Record<string, unknown>[]}
              filename={`scenario_${index}_projection_paths`}
            />
          </div>
          <div ref={fanRef}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={fanData} margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} label={{ value: "Trading Days", position: "insideBottom", offset: -5, style: { fontSize: 10 } }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip formatter={(v: unknown) => fmtPct(Number(v))} />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Area dataKey="p5" stroke="none" fill="#fecaca" name="P5" />
                <Area dataKey="p25" stroke="none" fill="#fca5a5" name="P25" />
                <Area dataKey="p50" stroke="#3b82f6" strokeWidth={2} fill="#93c5fd" name="P50 (Median)" />
                <Area dataKey="p75" stroke="none" fill="#bbf7d0" name="P75" />
                <Area dataKey="p95" stroke="none" fill="#86efac" name="P95" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-[var(--color-muted)]">Factor Contribution Breakdown</p>
          <ChartExportButtons
            chartRef={stackRef}
            csvData={segments as unknown as Record<string, unknown>[]}
            filename={`scenario_${index}_factor_contributions`}
          />
        </div>
        <div ref={stackRef}>
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
                    {width > 6 && (
                      <span className="text-[10px] font-semibold text-white drop-shadow">
                        {(seg.value * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                );
              });
            })()}
          </div>
          <div className="mt-2 grid gap-1 sm:grid-cols-5">
            {segments.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 text-[10px]">
                <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: s.fill }} />
                <span className="text-[var(--color-muted)]">{s.label}:</span>
                <span className="font-mono text-[var(--color-text)]">{fmtPct(s.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {regime && (
        <p className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[10px] text-[var(--color-muted)]">
          <strong>Regime factor shocks: </strong>
          Mkt-RF = {fmtPct(regime.mkt_rf)} · SMB = {fmtPct(regime.smb)} · HML = {fmtPct(regime.hml)} · Rf = {fmtPct(regime.rf)} over {regime.n_days} days
        </p>
      )}

      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">
        <strong>Assumptions: </strong>
        Current factor betas (fit on last ~252 days) are held constant. Factor shocks resampled from the regime window via 5-day block bootstrap. Residual idiosyncratic shocks are Gaussian. Real crises typically show correlation breakdown and fat tails not captured here — treat P5/P95 as lower bounds on tail severity.
      </p>
    </div>
  );
}

// ── Historical tab content (reusable inside FactorReplayCard) ────────────────

function HistoricalReplayContent({
  result,
  notionalValue,
  index,
}: {
  result: ScenarioResult;
  notionalValue: number | null;
  index: number;
}) {
  const equityRef = useRef<HTMLDivElement>(null);
  const contribRef = useRef<HTMLDivElement>(null);

  const totalRet = result.total_return ?? 0;
  const isGain = totalRet >= 0;
  const preset = getPresetByDates(result.start, result.end);

  const curveData = useMemo(() => {
    if (!result.equity_curve?.length) return [];
    let peak = result.equity_curve[0].value;
    return result.equity_curve.map((p) => {
      peak = Math.max(peak, p.value);
      const dd = p.value / peak - 1;
      return {
        date: p.date,
        value: p.value,
        ret_pct: (p.value - 1) * 100,
        drawdown: dd * 100,
      };
    });
  }, [result.equity_curve]);

  const contribData = useMemo(() => {
    const c = result.contributors ?? [];
    const sorted = [...c].sort((a, b) => a.weighted_contribution - b.weighted_contribution);
    const losers = sorted.slice(0, 6);
    const winners = sorted.slice(-6).reverse();
    return [...losers, ...winners].map((r) => ({
      ticker: r.ticker,
      contribution_pct: r.weighted_contribution * 100,
      asset_return_pct: r.asset_return * 100,
      weight_pct: r.weight * 100,
    }));
  }, [result.contributors]);

  if (curveData.length === 0 && contribData.length === 0) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        No historical data for this window — likely all tickers post-date the start. Switch to the Modeled Projection tab.
      </div>
    );
  }

  const nPositive = (result.contributors ?? []).filter((c) => c.weighted_contribution > 0).length;
  const nTotal = result.contributors?.length ?? 0;

  const dollar = (pct: number) => (notionalValue != null ? fmtDollar(notionalValue * pct) : undefined);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-5">
        <MetricTile
          label="Total Return"
          value={fmtPct(totalRet)}
          dollar={dollar(totalRet)}
          color={isGain ? "text-green-600" : "text-red-600"}
        />
        <MetricTile label="Max Drawdown" value={fmtPct(result.max_dd)} dollar={dollar(result.max_dd ?? 0)} color="text-red-600" />
        <MetricTile label="Worst Day" value={fmtPct(result.worst_day)} dollar={dollar(result.worst_day ?? 0)} color="text-red-600" />
        <MetricTile label="Best Day" value={fmtPct(result.best_day)} dollar={dollar(result.best_day ?? 0)} color="text-green-600" />
        <MetricTile label="Trading Days" value={String(result.n_days ?? "—")} />
      </div>

      <p className="rounded bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)]">
        <strong>Interpretation: </strong>
        Over this {result.n_days ?? "?"}-day window, the portfolio {isGain ? "gained" : "lost"} {fmtPct(Math.abs(totalRet))}.
        Deepest drawdown: {fmtPct(result.max_dd ?? 0)}. {nPositive} of {nTotal} holdings contributed positively.
      </p>

      {curveData.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--color-muted)]">Portfolio Equity Curve</p>
            <ChartExportButtons
              chartRef={equityRef}
              csvData={curveData as unknown as Record<string, unknown>[]}
              filename={`scenario_${preset?.id ?? index}_equity`}
            />
          </div>
          <div ref={equityRef}>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={curveData} margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={40} tickFormatter={(d: string) => d.slice(0, 7)} />
                <YAxis yAxisId="left" tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 10 }} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  tick={{ fontSize: 10 }}
                  domain={[(dataMin: number) => Math.min(dataMin, 0), 0]}
                />
                <Tooltip formatter={(v: unknown) => `${Number(v).toFixed(2)}%`} />
                <ReferenceLine yAxisId="left" y={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Area yAxisId="right" type="monotone" dataKey="drawdown" stroke="none" fill="#ef4444" fillOpacity={0.15} name="Drawdown" />
                <Line yAxisId="left" type="monotone" dataKey="ret_pct" stroke={isGain ? "#10b981" : "#ef4444"} strokeWidth={2} dot={false} name="Return" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {contribData.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--color-muted)]">Top Winners & Losers</p>
            <ChartExportButtons
              chartRef={contribRef}
              csvData={contribData as unknown as Record<string, unknown>[]}
              filename={`scenario_${preset?.id ?? index}_contributors`}
            />
          </div>
          <div ref={contribRef}>
            <ResponsiveContainer width="100%" height={Math.max(180, contribData.length * 22)}>
              <BarChart data={contribData} layout="vertical" margin={{ top: 5, right: 40, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.3} />
                <XAxis type="number" tickFormatter={(v: number) => `${v.toFixed(1)}%`} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="ticker" tick={{ fontSize: 10 }} width={54} />
                <Tooltip formatter={(v: unknown) => `${Number(v).toFixed(2)}%`} />
                <ReferenceLine x={0} stroke="#6b7280" />
                <Bar dataKey="contribution_pct" name="Contribution">
                  {contribData.map((d, i) => (
                    <Cell key={i} fill={d.contribution_pct >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
