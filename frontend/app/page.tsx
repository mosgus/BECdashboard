"use client";
import { useState } from "react";
import { fetchPortfolioMetrics } from "@/lib/api";
import { PortfolioResponse } from "@/types/portfolio";
import MetricsBar from "@/components/MetricsBar";
import EquityCurve from "@/components/EquityCurve";
import DrawdownChart from "@/components/DrawdownChart";
import CorrelationHeatmap from "@/components/CorrelationHeatmap";
import PerformanceTable from "@/components/PerformanceTable";

const DEFAULT_TICKERS = "AAPL, MSFT, GOOGL, AMZN, NVDA";
const TODAY = new Date().toISOString().slice(0, 10);

export default function OverviewPage() {
  const [rawTickers, setRawTickers] = useState(DEFAULT_TICKERS);
  const [weightMode, setWeightMode] = useState<"equal" | "custom">("equal");
  const [customWeights, setCustomWeights] = useState<Record<string, string>>({});
  const [benchmark, setBenchmark] = useState("SPY");
  const [start, setStart] = useState("2020-01-01");
  const [end, setEnd] = useState(TODAY);
  const [result, setResult] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tickers = rawTickers
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      let weights: number[] | undefined;
      if (weightMode === "custom") {
        const raw = tickers.map((t) => parseFloat(customWeights[t] ?? "1"));
        const sum = raw.reduce((a, b) => a + b, 0);
        weights = raw.map((w) => w / sum);
      }
      const r = await fetchPortfolioMetrics({ tickers, weights, benchmark, start, end });
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Inputs */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-800">Portfolio Configuration</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Tickers (comma-separated)</label>
            <input
              value={rawTickers}
              onChange={(e) => setRawTickers(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="AAPL, MSFT, GOOGL"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Benchmark</label>
            <input
              value={benchmark}
              onChange={(e) => setBenchmark(e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Weight Mode</label>
            <select
              value={weightMode}
              onChange={(e) => setWeightMode(e.target.value as "equal" | "custom")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="equal">Equal Weight</option>
              <option value="custom">Custom Weights</option>
            </select>
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

        {weightMode === "custom" && tickers.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {tickers.map((t) => (
              <label key={t} className="block">
                <span className="text-xs font-medium text-gray-500">{t} weight</span>
                <input
                  type="number"
                  value={customWeights[t] ?? "1"}
                  onChange={(e) => setCustomWeights((prev) => ({ ...prev, [t]: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                  min={0}
                  step={0.01}
                />
              </label>
            ))}
          </div>
        )}

        <button
          onClick={run}
          disabled={loading}
          className="mt-4 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Fetching…" : "Run Analysis"}
        </button>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {result?.missing?.length > 0 && (
          <p className="mt-2 text-xs text-amber-600">
            No data for: {result.missing.join(", ")}
          </p>
        )}
      </div>

      {result && (
        <>
          <MetricsBar metrics={result.metrics} benchMetrics={result.bench_metrics} />
          <EquityCurve
            data={result.equity_curve}
            lines={[
              { key: "portfolio", color: "#3b82f6" },
              { key: "benchmark", color: "#f59e0b", dashed: true },
            ]}
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DrawdownChart data={result.drawdown} dataKey="dd" title="Portfolio Drawdown" color="#ef4444" label="Drawdown" />
            <DrawdownChart data={result.rolling_vol} dataKey="vol" title="Rolling 21-Day Volatility" color="#8b5cf6" label="Ann. Vol" />
          </div>
          <CorrelationHeatmap data={result.correlation} />
          <PerformanceTable
            assets={result.assets}
            portfolioMetrics={result.metrics}
            benchMetrics={result.bench_metrics}
            benchmark={result.benchmark}
          />
        </>
      )}

      {!result && !loading && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-400">
          <p className="text-4xl mb-2">🦅</p>
          <p className="text-sm">Enter tickers above and click <strong>Run Analysis</strong> to load your portfolio.</p>
        </div>
      )}
    </div>
  );
}
