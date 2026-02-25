"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, RefreshCw, ExternalLink } from "lucide-react";
import Link from "next/link";
import { enrichUniverseTicker, fetchUniverseTicker } from "@/lib/api";
import { fmtDollar, fmtNum, fmtPct } from "@/lib/utils";

interface Props {
  ticker: string;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
      <span className="text-sm font-medium text-[var(--color-text)]">{value}</span>
    </div>
  );
}

export default function TickerDetailPanel({ ticker, onClose }: Props) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["universe-ticker", ticker],
    queryFn: () => fetchUniverseTicker(ticker),
  });

  const enrichMutation = useMutation({
    mutationFn: () => enrichUniverseTicker(ticker),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["universe-ticker", ticker] }),
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-14 bottom-0 z-50 w-80 bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div>
            <p className="font-mono font-bold text-[var(--color-primary)] text-lg">{ticker}</p>
            {data?.name && (
              <p className="text-xs text-[var(--color-muted)] truncate max-w-[200px]">{data.name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-[var(--radius-btn)] p-1 text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-8">Loading…</p>
          ) : data ? (
            <div>
              <Row label="Sector" value={data.sector ?? "—"} />
              <Row
                label="Market Cap"
                value={data.market_cap != null ? fmtDollar(data.market_cap) : "—"}
              />
              <Row
                label="P/E Ratio"
                value={data.pe_ratio != null ? fmtNum(data.pe_ratio, 1) : "—"}
              />
              <Row
                label="Dividend Yield"
                value={data.dividend_yield != null ? fmtPct(data.dividend_yield) : "—"}
              />
              <Row
                label="52w High"
                value={data.fifty_two_week_high != null ? `$${fmtNum(data.fifty_two_week_high, 2)}` : "—"}
              />
              <Row
                label="52w Low"
                value={data.fifty_two_week_low != null ? `$${fmtNum(data.fifty_two_week_low, 2)}` : "—"}
              />
              <Row label="Status" value={data.active ? "Active" : "Inactive"} />
              <Row
                label="Last Enriched"
                value={data.last_enriched_at ? data.last_enriched_at.slice(0, 10) : "Never"}
              />
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)] text-center py-8">No data.</p>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex flex-col gap-2">
          <button
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending}
            className="flex items-center justify-center gap-2 w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-border)] disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={enrichMutation.isPending ? "animate-spin" : ""} />
            {enrichMutation.isPending ? "Refreshing…" : "Re-enrich Metadata"}
          </button>
          <Link
            href={`/ticker/${ticker}`}
            className="flex items-center justify-center gap-2 w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            View Chart <ExternalLink size={13} />
          </Link>
        </div>
      </div>
    </>
  );
}
