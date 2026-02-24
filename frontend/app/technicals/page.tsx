"use client";
import { useState } from "react";
import { fetchTechnicals } from "@/lib/api";
import { TechnicalsResponse } from "@/types/portfolio";
import TechnicalsChart from "@/components/TechnicalsChart";

const TODAY = new Date().toISOString().slice(0, 10);

export default function TechnicalsPage() {
  const [ticker, setTicker] = useState("NVDA");
  const [start, setStart] = useState("2022-01-01");
  const [end, setEnd] = useState(TODAY);
  const [result, setResult] = useState<TechnicalsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchTechnicals({ ticker: ticker.toUpperCase(), start, end });
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-800">Technical Analysis</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ticker</label>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <button onClick={run} disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? "Loading…" : "Load Chart"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {result && <TechnicalsChart data={result} />}

      {!result && !loading && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-400">
          <p className="text-sm">Enter a ticker and click <strong>Load Chart</strong> to see SMA, RSI, and MACD.</p>
        </div>
      )}
    </div>
  );
}
