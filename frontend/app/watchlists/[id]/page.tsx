"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Plus, Trash2, ExternalLink, ArrowLeft } from "lucide-react";
import {
  addWatchlistItem,
  fetchWatchlist,
  refreshWatchlist,
  removeWatchlistItem,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import SignalBadge from "@/components/SignalBadge";
import InfoTooltip from "@/components/InfoTooltip";
import UniverseTickerPicker from "@/components/UniverseTickerPicker";
import type { SignalResult, WatchlistRefreshResponse } from "@/types/sprint2";

export default function WatchlistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { checked } = useAuth();
  const qc = useQueryClient();

  const [newTicker, setNewTicker] = useState("");
  const [refreshData, setRefreshData] = useState<WatchlistRefreshResponse | null>(null);

  const { data: wl, isLoading } = useQuery({
    queryKey: ["watchlist", id],
    queryFn: () => fetchWatchlist(id),
    enabled: !!id,
  });

  const addMutation = useMutation({
    mutationFn: () => addWatchlistItem(id, newTicker.trim().toUpperCase()),
    onSuccess: () => {
      setNewTicker("");
      qc.invalidateQueries({ queryKey: ["watchlist", id] });
      qc.invalidateQueries({ queryKey: ["watchlists"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (ticker: string) => removeWatchlistItem(id, ticker),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist", id] });
      qc.invalidateQueries({ queryKey: ["watchlists"] });
      // Remove from refresh data too
      setRefreshData((prev) =>
        prev ? { ...prev, rows: prev.rows.filter((r) => r.ticker !== removeMutation.variables) } : prev,
      );
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshWatchlist(id),
    onSuccess: (data) => setRefreshData(data),
  });

  if (!checked) return null;

  const getSignal = (ticker: string, signalName: string): SignalResult | undefined => {
    const row = refreshData?.rows.find((r) => r.ticker === ticker);
    return row?.signals.find((s) => s.signal === signalName);
  };

  const tickers = wl?.tickers ?? [];

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/watchlists"
            className="mb-1 flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <ArrowLeft size={12} /> Watchlists
          </Link>
          {isLoading ? (
            <div className="h-6 w-40 animate-pulse rounded bg-[var(--color-border)]" />
          ) : (
            <h1 className="text-lg font-bold text-[var(--color-text)]">{wl?.name}</h1>
          )}
          <p className="text-xs text-[var(--color-muted)]">
            {tickers.length} ticker{tickers.length !== 1 ? "s" : ""}
            {refreshData?.as_of_date ? ` · as of ${refreshData.as_of_date}` : ""}
            {refreshData?.data_source ? ` · ${refreshData.data_source}` : ""}
          </p>
        </div>
        <button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending || !tickers.length}
          className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 transition-colors"
          title="Fetch latest prices and compute signals (cached 1h)"
        >
          <RefreshCw size={14} className={refreshMutation.isPending ? "animate-spin" : ""} />
          {refreshMutation.isPending ? "Refreshing…" : "Refresh prices"}
        </button>
      </div>

      {refreshMutation.error && (
        <p className="text-sm text-[var(--color-negative)]">
          {(refreshMutation.error as Error).message}
        </p>
      )}

      {/* Add ticker */}
      <div className="flex gap-3">
        <UniverseTickerPicker
          value={newTicker}
          onChange={setNewTicker}
          placeholder="Add ticker from Universe…"
          className="flex-1"
        />
        <button
          onClick={() => addMutation.mutate()}
          disabled={!newTicker.trim() || addMutation.isPending}
          className="flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Plus size={14} />
          Add
        </button>
      </div>
      {addMutation.error && (
        <p className="-mt-4 text-xs text-[var(--color-negative)]">
          {(addMutation.error as Error).message}
        </p>
      )}

      {/* Ticker table */}
      {isLoading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : !tickers.length ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-12 text-center text-[var(--color-muted)]">
          <p className="text-sm">No tickers yet.</p>
          <p className="mt-1 text-xs">Add a ticker above (it must exist in the Universe).</p>
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted)]">Ticker</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted)]">
                  Last Close
                  <InfoTooltip text="Adjusted close from Yahoo Finance. Click Refresh prices to update." />
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-[var(--color-muted)]">
                  SMA 20/50
                  <InfoTooltip text="Bullish = SMA20 above SMA50. Bearish = below." />
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-[var(--color-muted)]">
                  RSI 14
                  <InfoTooltip text="Overbought > 70. Oversold < 30. Neutral in between." />
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-[var(--color-muted)]">
                  MACD
                  <InfoTooltip text="Bullish = MACD line above signal line (positive histogram)." />
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted)]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {tickers.map((ticker) => {
                const row = refreshData?.rows.find((r) => r.ticker === ticker);
                const sma = getSignal(ticker, "sma_cross");
                const rsi = getSignal(ticker, "rsi_threshold");
                const macd = getSignal(ticker, "macd_cross");

                return (
                  <tr key={ticker} className="hover:bg-[var(--color-bg)] transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/ticker/${ticker}`}
                        className="flex items-center gap-1 font-mono font-semibold text-[var(--color-primary)] hover:underline"
                      >
                        {ticker}
                        <ExternalLink size={11} />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text)]">
                      {row?.last_close != null ? (
                        <>
                          ${row.last_close.toFixed(2)}
                          {row.as_of_date && (
                            <span className="ml-1 text-xs text-[var(--color-muted)]">
                              ({row.as_of_date})
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {sma ? (
                        <SignalBadge state={sma.state} lastDate={sma.last_trigger_date} small />
                      ) : (
                        <span className="text-xs text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {rsi ? (
                        <SignalBadge state={rsi.state} lastDate={rsi.last_trigger_date} small />
                      ) : (
                        <span className="text-xs text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {macd ? (
                        <SignalBadge state={macd.state} lastDate={macd.last_trigger_date} small />
                      ) : (
                        <span className="text-xs text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => removeMutation.mutate(ticker)}
                        disabled={removeMutation.isPending}
                        className="text-[var(--color-muted)] hover:text-[var(--color-negative)] transition-colors"
                        title="Remove from watchlist"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!refreshData && tickers.length > 0 && (
        <p className="text-xs text-[var(--color-muted)]">
          Click <strong>Refresh prices</strong> to load latest closes and signal states.
        </p>
      )}
    </div>
  );
}
