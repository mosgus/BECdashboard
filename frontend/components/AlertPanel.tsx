"use client";
import { useState } from "react";
import { AlertType, AlertResponse } from "@/types/portfolio";
import { fetchAlertCheck } from "@/lib/api";

interface Props {
  tickers: string[];
  start: string;
  end: string;
}

export default function AlertPanel({ tickers, start, end }: Props) {
  const [ticker, setTicker] = useState(tickers[0] ?? "");
  const [alertType, setAlertType] = useState<AlertType>("rsi_threshold");
  const [overbought, setOverbought] = useState(70);
  const [oversold, setOversold] = useState(30);
  const [threshold, setThreshold] = useState(0);
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [result, setResult] = useState<AlertResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    setShowEmail(false);
    try {
      const params: Record<string, number | string> = {};
      if (alertType === "rsi_threshold") {
        params.overbought = overbought;
        params.oversold = oversold;
      } else if (alertType === "price_threshold") {
        params.threshold = threshold;
        params.direction = direction;
      }
      const r = await fetchAlertCheck({ ticker, alert_type: alertType, start, end, params });
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Alert Configuration</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Asset</label>
            <select
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {tickers.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Alert Type</label>
            <select
              value={alertType}
              onChange={(e) => setAlertType(e.target.value as AlertType)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="sma_crossover">SMA Crossover (20/50)</option>
              <option value="rsi_threshold">RSI Overbought/Oversold</option>
              <option value="price_threshold">Price Threshold</option>
            </select>
          </div>
        </div>

        {alertType === "rsi_threshold" && (
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Overbought</span>
              <input type="number" value={overbought} onChange={(e) => setOverbought(+e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Oversold</span>
              <input type="number" value={oversold} onChange={(e) => setOversold(+e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
          </div>
        )}

        {alertType === "price_threshold" && (
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Price ($)</span>
              <input type="number" value={threshold} onChange={(e) => setThreshold(+e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Direction</span>
              <select value={direction} onChange={(e) => setDirection(e.target.value as "above" | "below")}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="above">Above</option>
                <option value="below">Below</option>
              </select>
            </label>
          </div>
        )}

        <button
          onClick={run}
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Checking…" : "Check Alert"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className={`rounded-xl border p-4 shadow-sm ${result.triggered
          ? "border-red-300 bg-red-50"
          : "border-green-300 bg-green-50"}`}>
          <div className={`text-base font-bold mb-1 ${result.triggered ? "text-red-700" : "text-green-700"}`}>
            {result.triggered ? "🚨 ALERT TRIGGERED" : "✅ No Alert"}
          </div>
          <p className={`text-sm ${result.triggered ? "text-red-600" : "text-green-600"}`}>{result.message}</p>

          {result.rsi != null && (
            <p className="mt-1 text-xs text-gray-500">RSI: {result.rsi.toFixed(1)}</p>
          )}
          {result.price != null && (
            <p className="mt-1 text-xs text-gray-500">Price: ${result.price.toFixed(2)}</p>
          )}

          <button
            onClick={() => setShowEmail(!showEmail)}
            className="mt-3 text-xs font-medium text-blue-600 underline"
          >
            {showEmail ? "Hide" : "Show"} email payload stub
          </button>

          {showEmail && (
            <div className="mt-3">
              <pre className="text-xs bg-gray-900 text-gray-100 rounded-lg p-3 overflow-auto whitespace-pre-wrap">
                {`TO:      ${result.email_payload.to}
SUBJECT: ${result.email_payload.subject}

${result.email_payload.body}`}
              </pre>
              <p className="mt-1 text-xs text-gray-400">(stub) Integrate with SendGrid / AWS SES / Resend for live delivery.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
