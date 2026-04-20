"use client";
import { use, useState, useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { capmOptimize, monteCarloSim, fetchPortfolioDetail, forecastPortfolio, patchPortfolioTargets, updatePosition, fetchEfficientFrontier } from "@/lib/api";
import { fmtPct, fmtNum, fmtDollar } from "@/lib/utils";
import InfoTooltip from "@/components/InfoTooltip";
import ForecastGuide from "@/components/ForecastGuide";
import MonteCarloGuide from "@/components/MonteCarloGuide";
import ChartExportButtons from "@/components/ChartExportButtons";
import FanChart from "@/components/FanChart";
import type { Position } from "@/types/sprint3";
import type {
  TickerConfig,
  CAPMOptimizeResult,
  MonteCarloResult,
  ActionRow,
} from "@/types/outlook";
import type { PortfolioForecastResult } from "@/types/sprint6";
import {
  ScatterChart,
  Scatter,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  LabelList,
} from "recharts";

type OutlookSection = "capm" | "montecarlo" | "forecast";

// ═══════════════════════════════════════════════════════════════════════════════
// CAPM Optimizer Section
// ═══════════════════════════════════════════════════════════════════════════════

function CAPMSection({ portfolioId, positions, notionalValue }: { portfolioId: string; positions: Position[]; notionalValue: number | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  // All positions are now equity; cash is tracked at portfolio level
  // Round up portfolio notional value to next 100k bucket; default to 1M if no notional value
  const defaultTargetValue = Math.ceil((notionalValue ?? 1_000_000) / 100_000) * 100_000;
  const [targetValue, setTargetValue] = useState(defaultTargetValue);
  const [lookbackDays, setLookbackDays] = useState(1825);
  const [rf, setRf] = useState(0);   // 0 = let backend fetch live Treasury
  const [mrp, setMrp] = useState(5.0);
  const [marketTicker, setMarketTicker] = useState("VT");
  const [globalMin, setGlobalMin] = useState(0);
  const [globalMax, setGlobalMax] = useState(100);

  const [configs, setConfigs] = useState<Record<string, TickerConfig>>(() => {
    const m: Record<string, TickerConfig> = {};
    positions.forEach((p) => {
      m[p.ticker] = { freeze: false, view: 0, min_pct: 0, max_pct: 100 };
    });
    return m;
  });

  const [result, setResult] = useState<CAPMOptimizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);

  const updateConfig = (ticker: string, patch: Partial<TickerConfig>) => {
    setConfigs((prev) => ({
      ...prev,
      [ticker]: { ...prev[ticker], ...patch },
    }));
  };

  const applyGlobalBounds = () => {
    setConfigs((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((t) => {
        if (!next[t].freeze) {
          next[t] = { ...next[t], min_pct: globalMin, max_pct: globalMax };
        }
      });
      return next;
    });
  };

  const mut = useMutation({
    mutationFn: () =>
      capmOptimize(portfolioId, {
        target_value: targetValue,
        ...(rf > 0 ? { rf: rf / 100 } : {}),
        mrp: mrp / 100,
        market_ticker: marketTicker,
        ticker_configs: configs,
        start: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      }),
    onSuccess: (data) => { setResult(data); setError(null); setApplySuccess(false); },
    onError: (e: Error) => setError(e.message),
  });

  const applyMut = useMutation({
    mutationFn: async (weights: Record<string, number>) => {
      for (const [ticker, w] of Object.entries(weights)) {
        await updatePosition(portfolioId, ticker, parseFloat((w * 100).toFixed(4)));
      }
      await patchPortfolioTargets(portfolioId, {
        source: "optimizer",
        weights,
        mode: "capm_outlook",
        views_applied: Object.values(configs).some((c) => c.view !== 0),
      });
      // Invalidate all portfolio-related queries to refresh analytics, health, scenarios, etc.
      qc.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key.length > 0 && key[1] === portfolioId;
        },
      });
    },
    onSuccess: () => setApplySuccess(true),
  });

  return (
    <div className="space-y-5">
      {/* Disclaimer */}
      <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
        Forward-looking: uses CAPM expected returns with analyst views, not historical backtests.
        Results are model-based projections, not guarantees.
      </div>

      {/* Settings Panel */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          CAPM Optimization Settings
          <InfoTooltip text="Replicates CAPM-based portfolio optimization: E[R_i] = Rf + Beta_i * MRP + MRP * View_i. Freeze locks a ticker at its current allocation." />
        </h3>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Target Value ($)</label>
            <input type="number" value={targetValue} onChange={(e) => setTargetValue(Number(e.target.value))}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Lookback</label>
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
                  className={`flex-1 rounded-[var(--radius-btn)] px-1.5 py-2 text-xs font-medium transition-colors ${
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
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Risk-Free Rate (%, 0=live)</label>
            <input type="number" step={0.01} value={rf} onChange={(e) => setRf(Number(e.target.value))}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">MRP (%)</label>
            <input type="number" step={0.1} value={mrp} onChange={(e) => setMrp(Number(e.target.value))}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Market Ticker</label>
            <input type="text" value={marketTicker} onChange={(e) => setMarketTicker(e.target.value.toUpperCase())}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
        </div>

        {/* Global bounds */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Global Min %</label>
            <input type="number" step={1} value={globalMin} onChange={(e) => setGlobalMin(Number(e.target.value))}
              className="w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Global Max %</label>
            <input type="number" step={1} value={globalMax} onChange={(e) => setGlobalMax(Number(e.target.value))}
              className="w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
          <button onClick={applyGlobalBounds}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors">
            Apply to All
          </button>
        </div>

        {/* Per-ticker config table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
                <th className="py-2 text-left font-medium">Ticker</th>
                <th className="py-2 text-center font-medium">Freeze</th>
                <th className="py-2 text-left font-medium">View (Undervalued %)
                  <InfoTooltip text="Analyst conviction that a stock is undervalued. Adjusts expected return: E[R] += MRP * view. Positive = bullish, negative = bearish." />
                </th>
                <th className="py-2 text-center font-medium">Min %</th>
                <th className="py-2 text-center font-medium">Max %</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const cfg = configs[p.ticker] ?? { freeze: false, view: 0, min_pct: 0, max_pct: 100 };
                return (
                  <tr key={p.ticker} className="border-b border-[var(--color-border)]">
                    <td className="py-2 font-medium text-[var(--color-text)]">{p.ticker}</td>
                    <td className="py-2 text-center">
                      <input type="checkbox" checked={cfg.freeze}
                        onChange={(e) => updateConfig(p.ticker, { freeze: e.target.checked })} />
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <input type="range" min={-50} max={100} step={5} value={cfg.view * 100}
                          onChange={(e) => updateConfig(p.ticker, { view: Number(e.target.value) / 100 })}
                          className="w-32" disabled={cfg.freeze} />
                        <span className={`w-12 text-right font-mono ${cfg.view > 0 ? "text-[var(--color-positive)]" : cfg.view < 0 ? "text-[var(--color-negative)]" : "text-[var(--color-muted)]"}`}>
                          {cfg.view >= 0 ? "+" : ""}{(cfg.view * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-center">
                      <input type="number" step={1} value={cfg.min_pct} disabled={cfg.freeze}
                        onChange={(e) => updateConfig(p.ticker, { min_pct: Number(e.target.value) })}
                        className="w-16 rounded border border-[var(--color-border)] px-2 py-1 text-center text-xs disabled:opacity-40" />
                    </td>
                    <td className="py-2 text-center">
                      <input type="number" step={1} value={cfg.max_pct} disabled={cfg.freeze}
                        onChange={(e) => updateConfig(p.ticker, { max_pct: Number(e.target.value) })}
                        className="w-16 rounded border border-[var(--color-border)] px-2 py-1 text-center text-xs disabled:opacity-40" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button onClick={() => mut.mutate()} disabled={mut.isPending}
          className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
          {mut.isPending ? "Optimizing..." : "RUN OPTIMIZATION"}
        </button>
        {error && <p className="text-xs text-[var(--color-negative)]">{error}</p>}
      </div>

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {result && (
        <>
          {/* Metrics + VaR cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Portfolio Metrics */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Expected Portfolio Statistics</h3>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ["E[Return]", fmtPct(result.metrics.expected_return)],
                  ["E[Volatility]", fmtPct(result.metrics.expected_vol)],
                  ["E[Sharpe]", fmtNum(result.metrics.expected_sharpe)],
                  ["Portfolio Beta", fmtNum(result.metrics.portfolio_beta)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <dt className="text-[var(--color-muted)]">{l}</dt>
                    <dd className="font-semibold text-[var(--color-text)]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* VaR */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
                Value at Risk (95%)
                <InfoTooltip text="Parametric VaR: the return threshold you would expect to exceed 95% of the time under normal market conditions." />
              </h3>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                {(["daily", "weekly", "monthly", "quarterly", "annual"] as const).map((h) => (
                  <div key={h}>
                    <dt className="text-[var(--color-muted)] capitalize">{h}</dt>
                    <dd className="font-semibold text-[var(--color-negative)]">
                      {fmtPct(result.var_95[h])}
                    </dd>
                    <dd className="text-[10px] text-[var(--color-muted)]">
                      {fmtDollar(Math.abs(targetValue * result.var_95[h]))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* Action Table */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
              Action Table
              <InfoTooltip text="Shows recommended trades to move from current holdings to the optimal CAPM portfolio at the target value." />
            </h3>
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
                  {result.action_table.map((row: ActionRow) => {
                    const actionColor = row.frozen ? "text-gray-400" : row.action_shares > 0 ? "text-[var(--color-positive)]" : row.action_shares < 0 ? "text-[var(--color-negative)]" : "text-[var(--color-muted)]";
                    return (
                      <tr key={row.ticker} className={`border-b border-[var(--color-border)] ${row.frozen ? "bg-gray-50 opacity-70" : ""}`}>
                        <td className="py-2 font-medium text-[var(--color-text)]">
                          {row.ticker}
                          {row.frozen && <span className="ml-1 text-[10px] text-gray-400">FROZEN</span>}
                        </td>
                        <td className="py-2 text-right">${row.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                        <td className="py-2 text-right">{row.current_shares.toLocaleString()}</td>
                        <td className="py-2 text-right">${row.current_value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                        <td className="py-2 text-right">{row.current_pct.toFixed(2)}%</td>
                        <td className="py-2 text-right">{row.target_shares.toLocaleString()}</td>
                        <td className="py-2 text-right">${row.target_value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                        <td className="py-2 text-right font-semibold">{row.target_pct.toFixed(2)}%</td>
                        <td className={`py-2 text-right font-bold ${actionColor}`}>
                          {row.action_shares > 0 ? "+" : ""}{row.action_shares.toLocaleString()}
                        </td>
                        <td className={`py-2 text-right font-bold ${actionColor}`}>
                          {row.action_dollars > 0 ? "+$" : row.action_dollars < 0 ? "-$" : "$"}{Math.abs(row.action_dollars).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </td>
                        <td className={`py-2 text-right font-bold ${actionColor}`}>
                          {row.action_pct > 0 ? "+" : ""}{row.action_pct.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Risk vs Return + CAL Chart */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
              Risk vs Return — Capital Allocation Line
              <InfoTooltip text="Shows each asset's expected return vs volatility. The CAL extends from the risk-free rate through the optimal portfolio to leveraged positions. Arrows show view adjustments." />
            </h3>
            <CALChart data={result.cal_data} rf={result.cal_data.rf} />
          </div>

          {/* CAPM Details Table */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">CAPM Details</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
                    <th className="py-2 text-left font-medium">Ticker</th>
                    <th className="py-2 text-right font-medium">Beta</th>
                    <th className="py-2 text-right font-medium">E[R] CAPM</th>
                    <th className="py-2 text-right font-medium">View</th>
                    <th className="py-2 text-right font-medium">E[R] Adj.</th>
                    <th className="py-2 text-right font-medium">Opt Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {result.capm_details.map((d) => (
                    <tr key={d.ticker} className="border-b border-[var(--color-border)]">
                      <td className="py-2 font-medium text-[var(--color-text)]">{d.ticker}</td>
                      <td className="py-2 text-right">{d.beta !== null ? d.beta.toFixed(2) : "—"}</td>
                      <td className="py-2 text-right">{d.capm_return !== null ? (d.capm_return * 100).toFixed(2) : "—"}%</td>
                      <td className={`py-2 text-right ${d.view > 0 ? "text-[var(--color-positive)]" : d.view < 0 ? "text-[var(--color-negative)]" : "text-[var(--color-muted)]"}`}>
                        {d.view >= 0 ? "+" : ""}{(d.view * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 text-right font-semibold">{d.adj_return !== null ? (d.adj_return * 100).toFixed(2) : "—"}%</td>
                      <td className="py-2 text-right font-semibold">{d.opt_weight !== null ? (d.opt_weight * 100).toFixed(2) : "—"}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Apply Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                const weights: Record<string, number> = {};
                result.action_table.forEach((r) => { weights[r.ticker] = r.target_pct / 100; });
                applyMut.mutate(weights);
              }}
              disabled={applyMut.isPending}
              className="rounded-[var(--radius-btn)] bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {applyMut.isPending ? "Applying..." : "Apply to Portfolio"}
            </button>
            {applySuccess && (
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                Weights saved and applied.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── CAL Chart Component ──────────────────────────────────────────────────────

function CALChart({ data, rf }: { data: CAPMOptimizeResult["cal_data"]; rf: number }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const calLine = [
    { vol: 0, ret: rf },
    { vol: data.optimal.vol, ret: data.optimal.ret },
    { vol: data.leverage_2x.vol, ret: data.leverage_2x.ret },
    { vol: data.leverage_3x.vol, ret: data.leverage_3x.ret },
  ].map((p) => ({ vol: +(p.vol * 100).toFixed(2), ret: +(p.ret * 100).toFixed(2) }));

  const assets = data.assets.map((a) => ({
    vol: +(a.vol * 100).toFixed(2),
    origRet: +(a.orig_return * 100).toFixed(2),
    adjRet: +(a.adj_return * 100).toFixed(2),
    ticker: a.ticker,
    hasView: Math.abs(a.adj_return - a.orig_return) > 0.0001,
  }));

  const keyPoints = [
    { vol: 0, ret: +(rf * 100).toFixed(2), label: "Rf" },
    { vol: +(data.optimal.vol * 100).toFixed(2), ret: +(data.optimal.ret * 100).toFixed(2), label: "Optimal" },
    { vol: +(data.leverage_2x.vol * 100).toFixed(2), ret: +(data.leverage_2x.ret * 100).toFixed(2), label: "2x Lev" },
    { vol: +(data.leverage_3x.vol * 100).toFixed(2), ret: +(data.leverage_3x.ret * 100).toFixed(2), label: "3x Lev" },
  ];

  const csvData = [
    ...assets.map((a) => ({ type: "asset", ticker: a.ticker, vol_pct: a.vol, return_pct: a.adjRet, orig_return_pct: a.origRet })),
    ...keyPoints.map((p) => ({ type: "key_point", ticker: p.label, vol_pct: p.vol, return_pct: p.ret, orig_return_pct: "" })),
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ChartExportButtons chartRef={chartRef} csvData={csvData} filename="cal_chart" />
      </div>
      <div ref={chartRef}>
    <ResponsiveContainer width="100%" height={400}>
      <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis
          dataKey="vol" type="number" name="Volatility"
          label={{ value: "Annualised Volatility (%)", position: "insideBottom", offset: -10, style: { fontSize: 11 } }}
          tick={{ fontSize: 10 }} domain={[0, "auto"]}
        />
        <YAxis
          dataKey="ret" type="number" name="Return"
          label={{ value: "Expected Return (%)", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
          tick={{ fontSize: 10 }} domain={[0, "auto"]}
        />
        <Tooltip
          formatter={(v: unknown) => `${Number(v).toFixed(2)}%`}
          labelFormatter={(l) => `Vol: ${l}%`}
        />
        {/* CAL Line */}
        <Scatter name="CAL" data={calLine} fill="none" line={{ stroke: "#3b82f6", strokeWidth: 2, strokeDasharray: "6 3" }} shape={() => null} legendType="line" />
        {/* Asset returns */}
        <Scatter name="Assets" data={assets.map((a) => ({ vol: a.vol, ret: a.adjRet, ticker: a.ticker }))} fill="#6b7280" shape="circle">
          <LabelList dataKey="ticker" position="top" style={{ fontSize: 9, fill: "var(--color-muted)" }} offset={8} />
        </Scatter>
        {/* Key points — hide from auto-legend */}
        <Scatter data={[keyPoints[0]]} fill="#22c55e" shape="circle" legendType="none" />
        <Scatter name="Optimal" data={[keyPoints[1]]} fill="#ef4444" shape="star" />
        <Scatter data={keyPoints.slice(2)} fill="#a855f7" shape="diamond" legendType="none" />
        <Legend
          wrapperStyle={{ fontSize: 10 }}
          content={() => (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-[var(--color-muted)] mt-2">
              <span className="flex items-center gap-1"><span className="inline-block w-5 border-t-2 border-dashed border-blue-500" />CAL</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-500" />Assets</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />Rf</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 text-red-500">&#9733;</span>Optimal</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rotate-45 bg-purple-500" />Leverage</span>
            </div>
          )}
        />
      </ScatterChart>
    </ResponsiveContainer>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Monte Carlo Section
// ═══════════════════════════════════════════════════════════════════════════════

function MonteCarloSection({ portfolioId }: { portfolioId: string }) {
  const [numSims, setNumSims] = useState(1000);
  const [horizon, setHorizon] = useState(252);
  const [initValue, setInitValue] = useState(1_000_000);
  const [lookbackDays, setLookbackDays] = useState(1825);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const frontierChartRef = useRef<HTMLDivElement>(null);
  const pathsChartRef = useRef<HTMLDivElement>(null);

  // Efficient frontier (auto-loads, refetches on lookback change)
  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const frontierQuery = useQuery({
    queryKey: ["efficient-frontier", portfolioId, lookbackDays],
    queryFn: () => fetchEfficientFrontier(portfolioId, 30, startDate),
    staleTime: 120_000,
  });

  const mut = useMutation({
    mutationFn: () =>
      monteCarloSim(portfolioId, {
        num_simulations: numSims,
        horizon_days: horizon,
        initial_value: initValue,
        start: startDate,
      }),
    onSuccess: (data) => { setResult(data); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const brier = result?.brier_scoring;
  const brierColor = brier?.interpretation === "well_calibrated"
    ? "border-green-300 bg-green-50 text-green-800"
    : brier?.interpretation === "overconfident"
      ? "border-red-300 bg-red-50 text-red-800"
      : brier?.interpretation === "underconfident"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-gray-300 bg-gray-50 text-gray-600";

  return (
    <div className="space-y-5">
      {showGuide && <MonteCarloGuide onClose={() => setShowGuide(false)} />}

      <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
        Forward-looking: simulates future portfolio paths using historical return statistics.
        Results are probabilistic, not predictions.
      </div>

      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Monte Carlo Settings
            <InfoTooltip text="Simulates N random paths of portfolio growth using Geometric Brownian Motion calibrated to historical daily returns." />
          </h3>
          <button onClick={() => setShowGuide(true)}
            className="flex items-center gap-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors">
            <BookOpen size={13} />
            MC Guide
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Lookback</label>
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
                  className={`flex-1 rounded-[var(--radius-btn)] px-1.5 py-2 text-xs font-medium transition-colors ${
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
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Simulations</label>
            <input type="number" step={100} value={numSims} onChange={(e) => setNumSims(Number(e.target.value))}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Horizon (days)</label>
            <div className="flex gap-1">
              {[63, 126, 252].map((d) => (
                <button key={d} onClick={() => setHorizon(d)}
                  className={`rounded-[var(--radius-btn)] px-3 py-2 text-sm font-medium transition-colors ${horizon === d ? "bg-[var(--color-primary)] text-white" : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-border)]"}`}>
                  {d === 63 ? "3mo" : d === 126 ? "6mo" : "1yr"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Initial Value ($)</label>
            <input type="number" step={10000} value={initValue} onChange={(e) => setInitValue(Number(e.target.value))}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
        </div>
        <button onClick={() => mut.mutate()} disabled={mut.isPending}
          className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
          {mut.isPending ? "Simulating..." : "RUN SIMULATION"}
        </button>
        {error && <p className="text-xs text-[var(--color-negative)]">{error}</p>}
      </div>

      {/* Efficient Frontier (loads independently) */}
      {frontierQuery.data && frontierQuery.data.frontier.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Efficient Frontier
              <InfoTooltip text="The curve shows the best risk-return tradeoff for your holdings. Your current portfolio is the orange dot. Closer to the frontier = more efficient use of risk." />
            </h3>
            <ChartExportButtons
              chartRef={frontierChartRef}
              csvData={[
                ...frontierQuery.data.frontier.map((p) => ({ type: "frontier", vol: p.vol, ret: p.ret })),
                ...(frontierQuery.data.current_portfolio ? [{ type: "current", vol: frontierQuery.data.current_portfolio.vol, ret: frontierQuery.data.current_portfolio.ret }] : []),
                ...(frontierQuery.data.max_sharpe ? [{ type: "max_sharpe", vol: frontierQuery.data.max_sharpe.vol, ret: frontierQuery.data.max_sharpe.ret }] : []),
                ...(frontierQuery.data.min_variance ? [{ type: "min_variance", vol: frontierQuery.data.min_variance.vol, ret: frontierQuery.data.min_variance.ret }] : []),
                ...(frontierQuery.data.risk_parity ? [{ type: "risk_parity", vol: frontierQuery.data.risk_parity.vol, ret: frontierQuery.data.risk_parity.ret }] : []),
              ]}
              filename="efficient_frontier"
            />
          </div>
          <div ref={frontierChartRef}>
          <ResponsiveContainer width="100%" height={460}>
            <ScatterChart margin={{ top: 50, right: 20, bottom: 40, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="vol" type="number" name="Volatility"
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                label={{ value: "Annualised Volatility", position: "insideBottom", offset: -10, style: { fontSize: 11 } }}
                tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <YAxis dataKey="ret" type="number" name="Return"
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                label={{ value: "Annualised Return", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip formatter={(v: unknown) => `${(Number(v) * 100).toFixed(2)}%`} />
              {/* Random portfolio cloud — render first (background) */}
              {frontierQuery.data.random_portfolios?.length > 0 && (
                <Scatter name="Random Portfolios"
                  data={frontierQuery.data.random_portfolios.filter((_, i) => i % 2 === 0)}
                  fill="#cbd5e1" fillOpacity={0.2} shape="circle" legendType="circle" />
              )}
              {/* Frontier curve — bold line with visible dots */}
              <Scatter name="Efficient Frontier" data={frontierQuery.data.frontier}
                fill="#3b82f6" fillOpacity={0.6}
                line={{ stroke: "#3b82f6", strokeWidth: 3 }}
                shape="circle" legendType="line" />
              {/* Current portfolio */}
              <Scatter name="Current Portfolio" data={[frontierQuery.data.current_portfolio]}
                fill="#f97316" shape="circle" legendType="circle" />
              {/* Max Sharpe */}
              {frontierQuery.data.max_sharpe && (
                <Scatter name="Max Sharpe" data={[frontierQuery.data.max_sharpe]}
                  fill="#ef4444" shape="star" legendType="star" />
              )}
              {/* Min Variance */}
              {frontierQuery.data.min_variance && (
                <Scatter name="Min Variance" data={[frontierQuery.data.min_variance]}
                  fill="#22c55e" shape="diamond" legendType="diamond" />
              )}
              {/* Risk Parity */}
              {frontierQuery.data.risk_parity && (
                <Scatter name="Risk Parity" data={[frontierQuery.data.risk_parity]}
                  fill="#8b5cf6" shape="triangle" legendType="triangle" />
              )}
              <Legend
                verticalAlign="top"
                align="center"
                wrapperStyle={{ fontSize: 10, paddingBottom: 12 }}
                iconSize={10}
              />
            </ScatterChart>
          </ResponsiveContainer>
          </div>
        </div>
      )}

      {result && (
        <>
          {/* Fan chart */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                Simulated Portfolio Paths (Percentile Bands)
              </h3>
              <ChartExportButtons
                chartRef={pathsChartRef}
                csvData={result.paths_summary as unknown as Record<string, unknown>[]}
                filename="monte_carlo_paths"
              />
            </div>
            <div ref={pathsChartRef}>
            <ResponsiveContainer width="100%" height={390}>
              <AreaChart data={result.paths_summary} margin={{ top: 40, right: 20, bottom: 30, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} label={{ value: "Trading Days", position: "insideBottom", offset: -5, style: { fontSize: 11 } }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: unknown) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
                <Area dataKey="p5" stroke="none" fill="#dbeafe" name="P5" />
                <Area dataKey="p25" stroke="none" fill="#93c5fd" name="P25" />
                <Area dataKey="p50" stroke="#3b82f6" strokeWidth={2} fill="#60a5fa" name="P50 (Median)" />
                <Area dataKey="p75" stroke="none" fill="#93c5fd" name="P75" />
                <Area dataKey="p95" stroke="none" fill="#dbeafe" name="P95" />
                <ReferenceLine y={result.initial_value} stroke="#6b7280" strokeDasharray="4 4" label={{ value: "Initial", position: "left", fill: "#6b7280", fontSize: 10 }} />
                <Legend
                  verticalAlign="top"
                  align="center"
                  wrapperStyle={{ fontSize: 10, paddingBottom: 10 }}
                  iconSize={10}
                />
              </AreaChart>
            </ResponsiveContainer>
            </div>
          </div>

          {/* Terminal stats + Brier scoring side-by-side */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
                Terminal Distribution ({result.horizon_days} days)
              </h3>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ["Mean", `$${result.terminal_stats.mean.toLocaleString("en-US", { maximumFractionDigits: 0 })}`],
                  ["Median", `$${result.terminal_stats.median.toLocaleString("en-US", { maximumFractionDigits: 0 })}`],
                  ["P5 (Worst 5%)", `$${result.terminal_stats.p5.toLocaleString("en-US", { maximumFractionDigits: 0 })}`],
                  ["P95 (Best 5%)", `$${result.terminal_stats.p95.toLocaleString("en-US", { maximumFractionDigits: 0 })}`],
                  ["Prob. of Loss", fmtPct(result.terminal_stats.prob_loss)],
                  ["Mean Return", fmtPct(result.terminal_stats.mean_return)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <dt className="text-[var(--color-muted)]">{l}</dt>
                    <dd className="font-semibold text-[var(--color-text)]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Brier Scoring */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
                Calibration (Brier Scoring)
                <InfoTooltip text="Hold-out backtest: the model is trained on earlier data, then its predicted percentile bands are compared to actual realized returns. Coverage 50/90 shows what fraction of actuals fell within the predicted bands (expect ~50% and ~90% for well-calibrated models)." />
              </h3>
              {brier && brier.brier_score != null ? (
                <>
                  <dl className="grid grid-cols-2 gap-3 text-xs mb-3">
                    <div>
                      <dt className="text-[var(--color-muted)]">Brier Score</dt>
                      <dd className="font-semibold text-[var(--color-text)]">{brier.brier_score.toFixed(4)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-muted)]">Coverage 50% band</dt>
                      <dd className="font-semibold text-[var(--color-text)]">{brier.coverage_50 != null ? fmtPct(brier.coverage_50) : "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-muted)]">Coverage 90% band</dt>
                      <dd className="font-semibold text-[var(--color-text)]">{brier.coverage_90 != null ? fmtPct(brier.coverage_90) : "-"}</dd>
                    </div>
                  </dl>
                  <div className={`rounded-[var(--radius-btn)] border px-3 py-2 text-xs ${brierColor}`}>
                    {brier.interpretation === "well_calibrated" && "Well calibrated: predicted bands match observed outcomes."}
                    {brier.interpretation === "overconfident" && "Overconfident: bands are too narrow \u2014 actual outcomes fall outside predicted ranges more than expected."}
                    {brier.interpretation === "underconfident" && "Underconfident: bands are too wide \u2014 model uncertainty exceeds realized dispersion."}
                  </div>
                </>
              ) : (
                <p className="text-xs text-[var(--color-muted)]">Insufficient data for calibration (need at least horizon + 60 days of history).</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Forecast Section (moved from Research tab)
// ═══════════════════════════════════════════════════════════════════════════════

function ForecastSection({ portfolioId }: { portfolioId: string }) {
  const [method, setMethod] = useState("ewma");
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
            <InfoTooltip text="Forecasts the simulated portfolio equity curve and rolling volatility using the selected method. Prophet may take 30-60 s." />
          </h3>
          <button onClick={() => setShowGuide(true)}
            className="flex items-center gap-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors">
            <BookOpen size={13} />
            Forecast Guide
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]">
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
                <button key={d} onClick={() => setHorizon(d)}
                  className={`rounded-[var(--radius-btn)] px-3 py-2 text-sm font-medium transition-colors ${horizon === d ? "bg-[var(--color-primary)] text-white" : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-border)]"}`}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => fcMut.mutate()} disabled={fcMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
            {fcMut.isPending ? "Forecasting..." : "Run Forecast"}
          </button>
        </div>
        {error && <p className="mt-3 text-xs text-[var(--color-negative)]">{error}</p>}
      </div>

      {result && (
        <>
          {result.warnings?.length > 0 && (
            <div className="space-y-1">
              {result.warnings.map((w: string, i: number) => (
                <p key={i} className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-700 border border-amber-200">{w}</p>
              ))}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <FanChart data={result.price_series} title={`Price Forecast - ${result.method} (${result.horizon_days}d)`} yLabel="Portfolio equity (start = 1.0)" />
            <FanChart data={result.vol_series} title="Volatility Forecast (annualised)" yLabel="Annualised vol" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Calibration (last 30-day hold-out)</h3>
              <dl className="grid grid-cols-3 gap-3 text-xs">
                {[
                  ["RMSE", result.calibration.rmse != null ? result.calibration.rmse.toFixed(4) : "-"],
                  ["MAE", result.calibration.mae != null ? result.calibration.mae.toFixed(4) : "-"],
                  ["Dir. Acc.", result.calibration.directional_accuracy != null ? `${(result.calibration.directional_accuracy * 100).toFixed(1)}%` : "-"],
                ].map(([l, v]) => (
                  <div key={l}><dt className="text-[var(--color-muted)]">{l}</dt><dd className="font-semibold text-[var(--color-text)]">{v}</dd></div>
                ))}
              </dl>
            </div>
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Model Info</h3>
              <dl className="space-y-1 text-xs">
                <div><dt className="text-[var(--color-muted)]">Method</dt><dd className="font-medium text-[var(--color-text)]">{result.method}</dd></div>
                <div><dt className="text-[var(--color-muted)]">Horizon</dt><dd className="font-medium text-[var(--color-text)]">{result.horizon_days} trading days</dd></div>
                {Object.entries(result.model_info).map(([k, v]) => (
                  <div key={k}><dt className="text-[var(--color-muted)]">{k.replace(/_/g, " ")}</dt><dd className="font-medium text-[var(--color-text)]">{Array.isArray(v) ? v.join(", ") : String(v)}</dd></div>
                ))}
              </dl>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Main Outlook Page
// ═══════════════════════════════════════════════════════════════════════════════

export default function OutlookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: portfolioId } = use(params);
  const { checked } = useAuth();
  const [section, setSection] = useState<OutlookSection>("capm");

  const { data, isLoading } = useQuery({
    queryKey: ["portfolio", portfolioId],
    queryFn: () => fetchPortfolioDetail(portfolioId),
    enabled: checked,
  });

  if (!checked || isLoading) {
    return <p className="p-8 text-sm text-[var(--color-muted)]">Loading...</p>;
  }

  const positions: Position[] = data?.positions ?? [];

  return (
    <div className="space-y-5">
      {/* Subtab bar */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {(
          [
            { key: "capm", label: "CAPM Optimizer" },
            { key: "montecarlo", label: "Monte Carlo" },
            { key: "forecast", label: "Forecast" },
          ] as { key: OutlookSection; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              section === key
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "capm" && <CAPMSection portfolioId={portfolioId} positions={positions} notionalValue={data?.notional_value ?? null} />}
      {section === "montecarlo" && <MonteCarloSection portfolioId={portfolioId} />}
      {section === "forecast" && <ForecastSection portfolioId={portfolioId} />}
    </div>
  );
}
