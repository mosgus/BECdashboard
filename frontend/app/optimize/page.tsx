"use client";
import { useState } from "react";
import { fetchOptimize } from "@/lib/api";
import { OptimizeMode, OptimizeResponse, AssetBound } from "@/types/portfolio";
import EquityCurve from "@/components/EquityCurve";
import WeightBarChart from "@/components/WeightBarChart";
import { fmtNum, fmtPct } from "@/lib/utils";

const DEFAULT_TICKERS = "AAPL, MSFT, GOOGL, AMZN, NVDA";
const TODAY = new Date().toISOString().slice(0, 10);

export default function OptimizePage() {
  const [rawTickers, setRawTickers] = useState(DEFAULT_TICKERS);
  const [benchmark, setBenchmark] = useState("SPY");
  const [start, setStart] = useState("2020-01-01");
  const [end, setEnd] = useState(TODAY);
  const [mode, setMode] = useState<OptimizeMode>("max_sharpe_capm");
  const [maxWeight, setMaxWeight] = useState(1.0);
  const [rf, setRf] = useState(0.0364);
  const [mrp, setMrp] = useState(0.05);
  const [marketTicker, setMarketTicker] = useState("VT");
  const [reservedCash, setReservedCash] = useState(0);
  const [views, setViews] = useState<Record<string, string>>({});
  const [assetBoundsMin, setAssetBoundsMin] = useState<Record<string, string>>({});
  const [assetBoundsMax, setAssetBoundsMax] = useState<Record<string, string>>({});

  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tickers = rawTickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const viewsPayload: Record<string, number> = {};
      for (const t of tickers) {
        const v = parseFloat(views[t] ?? "0");
        if (v !== 0) viewsPayload[t] = v;
      }
      const boundsPayload: Record<string, AssetBound> = {};
      for (const t of tickers) {
        const lo = parseFloat(assetBoundsMin[t] ?? "0");
        const hi = parseFloat(assetBoundsMax[t] ?? "1");
        if (lo > 0 || hi < 1) boundsPayload[t] = { min: lo, max: hi };
      }
      const r = await fetchOptimize({
        tickers,
        benchmark,
        start,
        end,
        mode,
        max_weight: maxWeight,
        rf,
        market_risk_premium: mrp,
        market_ticker: marketTicker,
        views: Object.keys(viewsPayload).length ? viewsPayload : undefined,
        asset_bounds: Object.keys(boundsPayload).length ? boundsPayload : undefined,
        reserved_cash_pct: reservedCash / 100,
      });
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-gray-800">Optimizer Configuration</h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Tickers</label>
            <input value={rawTickers} onChange={(e) => setRawTickers(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as OptimizeMode)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="max_sharpe_capm">Max Sharpe (CAPM + Views) ★</option>
              <option value="max_sharpe">Max Sharpe (Historical)</option>
              <option value="min_variance">Min Variance</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Benchmark</label>
            <input value={benchmark} onChange={(e) => setBenchmark(e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Max Weight per Asset: {(maxWeight * 100).toFixed(0)}%
            </label>
            <input type="range" min={5} max={100} step={5} value={maxWeight * 100}
              onChange={(e) => setMaxWeight(+e.target.value / 100)}
              className="w-full accent-blue-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Reserved Cash: {reservedCash.toFixed(0)}%
            </label>
            <input type="range" min={0} max={50} step={1} value={reservedCash}
              onChange={(e) => setReservedCash(+e.target.value)}
              className="w-full accent-blue-600" />
          </div>
          {mode === "max_sharpe_capm" && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Risk-Free Rate (%)</label>
                <input type="number" value={(rf * 100).toFixed(2)} step={0.1}
                  onChange={(e) => setRf(+e.target.value / 100)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Market Risk Premium (%)</label>
                <input type="number" value={(mrp * 100).toFixed(2)} step={0.1}
                  onChange={(e) => setMrp(+e.target.value / 100)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Market Ticker (for β)</label>
                <input value={marketTicker} onChange={(e) => setMarketTicker(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </>
          )}
        </div>

        {mode === "max_sharpe_capm" && tickers.length > 0 && (
          <details className="rounded-lg border border-gray-200 p-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-600 select-none">
              Analyst Views &amp; Per-Asset Bounds (optional)
            </summary>
            <div className="mt-3 overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-semibold text-gray-500">Ticker</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500">View (undervaluation %)</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500">Min Weight</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500">Max Weight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tickers.map((t) => (
                    <tr key={t}>
                      <td className="px-3 py-2 font-mono font-medium">{t}</td>
                      <td className="px-3 py-2">
                        <input type="number" value={views[t] ?? "0"} step={0.1} min={-0.5} max={2}
                          onChange={(e) => setViews((p) => ({ ...p, [t]: e.target.value }))}
                          className="w-24 rounded border border-gray-300 px-2 py-1 text-xs" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={assetBoundsMin[t] ?? "0"} step={0.01} min={0} max={1}
                          onChange={(e) => setAssetBoundsMin((p) => ({ ...p, [t]: e.target.value }))}
                          className="w-20 rounded border border-gray-300 px-2 py-1 text-xs" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={assetBoundsMax[t] ?? "1"} step={0.01} min={0} max={1}
                          onChange={(e) => setAssetBoundsMax((p) => ({ ...p, [t]: e.target.value }))}
                          className="w-20 rounded border border-gray-300 px-2 py-1 text-xs" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        <button onClick={run} disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {loading ? "Optimizing…" : "Run Optimizer"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {result && (
        <>
          {/* Metrics comparison */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { label: "Current Portfolio", m: result.current_metrics, color: "blue" },
              { label: `Optimized (${result.mode.replace(/_/g, " ")})`, m: result.opt_metrics, color: "green" },
            ].map(({ label, m, color }) => (
              <div key={label} className={`rounded-xl border border-${color}-200 bg-${color}-50 p-4 shadow-sm`}>
                <h3 className={`mb-2 text-sm font-semibold text-${color}-700`}>{label}</h3>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ["CAGR", fmtPct(m.cagr)],
                    ["Volatility", fmtPct(m.vol)],
                    ["Sharpe", fmtNum(m.sharpe)],
                    ["Max Drawdown", fmtPct(m.max_dd)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-gray-500">{k}</dt>
                      <dd className="font-semibold text-gray-800">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          <WeightBarChart tickers={result.tickers} current={result.curr_weights} optimized={result.opt_weights} />

          <EquityCurve
            data={result.equity_curves}
            title="Equity Curve: Current vs Optimized"
            lines={[
              { key: "optimized", color: "#22c55e" },
              { key: "current", color: "#3b82f6", dashed: true },
              { key: "benchmark", color: "#f59e0b", dashed: true },
            ]}
          />

          {result.capm_info?.betas && Object.keys(result.capm_info.betas).length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm overflow-auto">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">CAPM Details</h3>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {["Ticker", "Beta", "E[R] CAPM", "View", "E[R] Adj.", "Opt. Weight"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.tickers.map((t) => (
                    <tr key={t} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono font-medium">{t}</td>
                      <td className="px-3 py-2">{fmtNum(result.capm_info.betas[t])}</td>
                      <td className="px-3 py-2">{fmtPct(result.capm_info.expected_returns[t])}</td>
                      <td className="px-3 py-2">{fmtNum(result.capm_info.views?.[t] ?? 0)}</td>
                      <td className="px-3 py-2">{fmtPct(result.capm_info.expected_returns[t])}</td>
                      <td className="px-3 py-2 font-semibold text-green-700">{fmtPct(result.opt_weights[t])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
