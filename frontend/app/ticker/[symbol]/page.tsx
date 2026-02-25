"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { fetchTickerTechnicals } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import TechnicalsChart from "@/components/TechnicalsChart";
import SignalBadge from "@/components/SignalBadge";
import HelpSidebar from "@/components/HelpSidebar";
import InfoTooltip from "@/components/InfoTooltip";
import type { SignalResult } from "@/types/sprint2";

const TODAY = new Date().toISOString().slice(0, 10);
const ONE_YEAR_AGO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const SIGNAL_DESCRIPTIONS: Record<string, string> = {
  sma_cross:
    "SMA crossover: bullish when the 20-day SMA crosses above the 50-day SMA. Bearish when it crosses below.",
  rsi_threshold:
    "RSI threshold: overbought when RSI > 70 (potential pullback), oversold when RSI < 30 (potential rebound).",
  macd_cross:
    "MACD crossover: bullish when the MACD line crosses above the signal line (positive histogram). Bearish when below.",
};

export default function TickerDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = use(params);
  const ticker = symbol.toUpperCase();
  const { checked } = useAuth();

  const [start, setStart] = useState(ONE_YEAR_AGO);
  const [end, setEnd] = useState(TODAY);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ticker-technicals", ticker, start, end],
    queryFn: () => fetchTickerTechnicals(ticker, start, end, true),
    enabled: !!ticker,
  });

  if (!checked) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/watchlists"
            className="mb-1 flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <ArrowLeft size={12} /> Watchlists
          </Link>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">{ticker}</h1>
          {data && (
            <p className="text-xs text-[var(--color-muted)]">
              As of {data.as_of_date} · {data.data_source}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <HelpSidebar />
        </div>
      </div>

      {/* Date controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Start</label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">End</label>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isLoading ? "Loading…" : "Update"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-[var(--color-negative)]">
          {(error as Error).message}
        </p>
      )}

      {isLoading && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-12 text-center text-sm text-[var(--color-muted)]">
          Loading charts…
        </div>
      )}

      {data && (
        <>
          {/* Charts — reuse TechnicalsChart (same data shape) */}
          <TechnicalsChart data={data} />

          {/* ATR card */}
          <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <div>
              <p className="text-xs text-[var(--color-muted)]">
                ATR (14)
                <InfoTooltip text="Average True Range — measures daily price volatility. Higher = wider swings." />
              </p>
              <p className="text-lg font-bold text-[var(--color-text)]">
                {data.atr14 != null ? `$${data.atr14.toFixed(2)}` : "—"}
              </p>
            </div>
            <p className="text-xs text-[var(--color-muted)]">
              14-day average of true range (Wilder EWM smoothing)
            </p>
          </div>

          {/* Signal panel */}
          {data.signals && data.signals.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
              <div className="border-b border-[var(--color-border)] px-4 py-3">
                <h2 className="text-sm font-semibold text-[var(--color-text)]">
                  Signal States
                  <InfoTooltip text="All signals computed on historical closes — no look-ahead bias. State reflects the most recent crossover/threshold event." />
                </h2>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {data.signals.map((sig: SignalResult) => (
                  <div key={sig.signal} className="flex flex-wrap items-start gap-4 px-4 py-4">
                    <div className="w-36 shrink-0">
                      <p className="text-xs font-semibold text-[var(--color-text)]">{sig.label}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                        {SIGNAL_DESCRIPTIONS[sig.signal] ?? ""}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <SignalBadge state={sig.state} lastDate={sig.last_trigger_date} />
                      {sig.current_rsi != null && (
                        <p className="text-xs text-[var(--color-muted)]">
                          Current RSI: {sig.current_rsi}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-[var(--color-muted)]">
                      {sig.last_trigger_date ? (
                        <>
                          <span>Last trigger: {sig.last_trigger_date}</span>
                          {sig.trigger_values && (
                            <p className="mt-0.5">
                              Values:{" "}
                              {Object.entries(sig.trigger_values)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(", ")}
                            </p>
                          )}
                        </>
                      ) : (
                        <span>No trigger in this date range</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!data && !isLoading && !error && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-12 text-center text-[var(--color-muted)]">
          <p className="text-sm">Adjust dates above and click Update to load {ticker}.</p>
        </div>
      )}
    </div>
  );
}
