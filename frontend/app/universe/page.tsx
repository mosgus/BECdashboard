"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Search, ToggleLeft, ToggleRight, RefreshCw } from "lucide-react";
import { addUniverseTicker, enrichAllUniverseTickers, fetchUniverse, importUniverseCSV, patchUniverseTicker } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { UniverseTicker } from "@/types/sprint2";
import InfoTooltip from "@/components/InfoTooltip";
import TickerDetailPanel from "@/components/TickerDetailPanel";
import { fmtDollar, fmtNum, fmtPct } from "@/lib/utils";

export default function UniversePage() {
  const { checked } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; warnings: string[] } | null>(null);
  const [newTicker, setNewTicker] = useState("");
  const [newName, setNewName] = useState("");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const active = activeFilter === "all" ? undefined : activeFilter === "active";

  const { data, isLoading } = useQuery({
    queryKey: ["universe", search, activeFilter],
    queryFn: () => fetchUniverse(search || undefined, active),
  });

  const addMutation = useMutation({
    mutationFn: () => addUniverseTicker(newTicker.trim().toUpperCase(), newName.trim() || undefined),
    onSuccess: () => {
      setNewTicker("");
      setNewName("");
      qc.invalidateQueries({ queryKey: ["universe"] });
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => importUniverseCSV(file),
    onSuccess: (result) => {
      setImportResult(result);
      qc.invalidateQueries({ queryKey: ["universe"] });
    },
  });

  const [enrichAllResult, setEnrichAllResult] = useState<{ refreshed: number; total: number; errors: string[] } | null>(null);
  const enrichAllMutation = useMutation({
    mutationFn: enrichAllUniverseTickers,
    onSuccess: (r) => {
      setEnrichAllResult(r);
      qc.invalidateQueries({ queryKey: ["universe"] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ ticker, active }: { ticker: string; active: boolean }) =>
      patchUniverseTicker(ticker, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["universe"] }),
  });

  if (!checked) return null;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportResult(null);
      importMutation.mutate(file);
    }
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      {/* Ticker detail panel */}
      {selectedTicker && (
        <TickerDetailPanel ticker={selectedTicker} onClose={() => setSelectedTicker(null)} />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[var(--color-text)]">Universe</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Managed ticker universe — click any row to view metrics
            <InfoTooltip text="Only active tickers can be added to portfolio watchlists. Import via CSV to bulk-load tickers." />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => enrichAllMutation.mutate()}
            disabled={enrichAllMutation.isPending}
            className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 transition-colors"
            title="Re-fetch yfinance metadata (sector, market cap, P/E, dividend yield, 52w highs/lows) for every active ticker."
          >
            <RefreshCw size={14} className={enrichAllMutation.isPending ? "animate-spin" : ""} />
            {enrichAllMutation.isPending ? "Refreshing…" : "Refresh All Metadata"}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importMutation.isPending}
            className="flex items-center gap-2 rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Upload size={14} />
            {importMutation.isPending ? "Importing…" : "Import CSV"}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {/* Import result */}
      {importResult && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
          <p className="font-medium text-[var(--color-text)]">
            Import complete — <span className="text-green-700">{importResult.added} added</span>,{" "}
            <span className="text-[var(--color-muted)]">{importResult.skipped} skipped</span>
          </p>
          {importResult.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-negative)]">
              {importResult.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {importMutation.error && (
        <p className="text-sm text-[var(--color-negative)]">
          {(importMutation.error as Error).message}
        </p>
      )}

      {/* Enrich-all result */}
      {enrichAllResult && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
          <p className="font-medium text-[var(--color-text)]">
            Metadata refresh — <span className="text-green-700">{enrichAllResult.refreshed} refreshed</span>
            <span className="text-[var(--color-muted)]"> of {enrichAllResult.total}</span>
            {enrichAllResult.errors.length > 0 && (
              <span className="text-[var(--color-negative)]"> · {enrichAllResult.errors.length} errors</span>
            )}
          </p>
          {enrichAllResult.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-negative)]">
              {enrichAllResult.errors.slice(0, 5).map((e, i) => <li key={i}>⚠ {e}</li>)}
            </ul>
          )}
        </div>
      )}
      {enrichAllMutation.error && (
        <p className="text-sm text-[var(--color-negative)]">
          {(enrichAllMutation.error as Error).message}
        </p>
      )}

      {/* Add single ticker */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Add Ticker</h2>
        <div className="flex flex-wrap gap-3">
          <input
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter" && newTicker.trim()) addMutation.mutate(); }}
            placeholder="Ticker (e.g. AAPL)"
            className="w-32 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newTicker.trim()) addMutation.mutate(); }}
            placeholder="Company name (optional)"
            className="flex-1 min-w-48 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <button
            onClick={() => addMutation.mutate()}
            disabled={!newTicker.trim() || addMutation.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {addMutation.isPending ? "Adding…" : "Add"}
          </button>
        </div>
        {addMutation.error && (
          <p className="mt-2 text-xs text-[var(--color-negative)]">
            {(addMutation.error as Error).message}
          </p>
        )}
      </div>

      {/* Stats + filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm">
          <span className="text-[var(--color-muted)]">Active tickers</span>
          <span className="font-bold text-[var(--color-text)]">{data?.active_count ?? "—"}</span>
          <span className="text-[var(--color-muted)]">/ {data?.total ?? "—"} total</span>
        </div>

        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticker or name…"
            className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
        </div>

        <div className="flex rounded-[var(--radius-btn)] border border-[var(--color-border)] text-xs overflow-hidden">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                activeFilter === f
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-border)]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Ticker table */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-x-auto">
        {isLoading ? (
          <p className="p-6 text-center text-sm text-[var(--color-muted)]">Loading…</p>
        ) : !data?.tickers.length ? (
          <div className="p-12 text-center text-[var(--color-muted)]">
            <p className="text-sm">No tickers found.</p>
            <p className="mt-1 text-xs">Import a CSV to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted)]">Ticker</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted)]">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted)]">Sector</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted)]">Mkt Cap</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted)]">P/E</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted)]">Div Yield</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted)]">52w Range</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted)]">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {data.tickers.map((t: UniverseTicker) => (
                <tr
                  key={t.ticker}
                  className="hover:bg-[var(--color-bg)] transition-colors cursor-pointer"
                  onClick={() => setSelectedTicker(t.ticker)}
                >
                  <td className="px-4 py-3 font-mono font-semibold text-[var(--color-primary)]">
                    {t.ticker}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted)] max-w-[160px] truncate">{t.name ?? "—"}</td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">{t.sector ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-[var(--color-muted)]">
                    {t.market_cap != null ? fmtDollar(t.market_cap) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--color-muted)]">
                    {t.pe_ratio != null ? fmtNum(t.pe_ratio, 1) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--color-muted)]">
                    {t.dividend_yield != null ? fmtPct(t.dividend_yield) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--color-muted)] whitespace-nowrap">
                    {t.fifty_two_week_low != null && t.fifty_two_week_high != null
                      ? `$${fmtNum(t.fifty_two_week_low, 0)} – $${fmtNum(t.fifty_two_week_high, 0)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleMutation.mutate({ ticker: t.ticker, active: !t.active })}
                      className="inline-flex items-center text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                      title={t.active ? "Click to deactivate" : "Click to activate"}
                    >
                      {t.active ? (
                        <ToggleRight size={22} className="text-green-600" />
                      ) : (
                        <ToggleLeft size={22} />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* CSV format hint */}
      <p className="text-xs text-[var(--color-muted)]">
        CSV format: <code className="rounded bg-[var(--color-border)] px-1">ticker</code> column required,
        optional <code className="rounded bg-[var(--color-border)] px-1">name</code> column.
        Headerless files (one ticker per line) also accepted.
      </p>
    </div>
  );
}
