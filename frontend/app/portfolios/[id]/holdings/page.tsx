"use client";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Trash2, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  addPosition,
  fetchPortfolioDetail,
  importPortfolioCSV,
  fetchTickerTechnicals,
  patchPortfolioNotional,
  removePosition,
  updatePosition,
} from "@/lib/api";
import { fmtNum } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import InfoTooltip from "@/components/InfoTooltip";
import UniverseTickerPicker from "@/components/UniverseTickerPicker";
import { Position } from "@/types/sprint3";
import { SignalResult } from "@/types/sprint2";

// ── Quick Technicals accordion per holding row ─────────────────────────────────

function QuickTechnicals({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["quick-technicals", ticker],
    queryFn: () => fetchTickerTechnicals(ticker, undefined, undefined, true),
    staleTime: 60_000,
  });
  if (isLoading)
    return (
      <p className="text-xs text-[var(--color-muted)] py-1">Loading signals…</p>
    );
  if (!data?.signals?.length)
    return (
      <p className="text-xs text-[var(--color-muted)] py-1">
        No signals available.
      </p>
    );
  return (
    <div className="flex flex-wrap gap-2 py-1">
      {data.signals.map((s: SignalResult) => (
        <SignalBadge
          key={s.signal}
          state={s.state}
          lastDate={s.last_trigger_date}
        />
      ))}
      {data.atr14 != null && (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          ATR14: {fmtNum(data.atr14, 2)}
        </span>
      )}
      <span className="text-xs text-[var(--color-muted)] self-center">
        as of {data.as_of_date}
      </span>
    </div>
  );
}

// ── Holdings Page ──────────────────────────────────────────────────────────────

export default function HoldingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: portfolioId } = use(params);
  const { checked } = useAuth();
  const qc = useQueryClient();

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["portfolio", portfolioId],
    queryFn: () => fetchPortfolioDetail(portfolioId),
    enabled: checked,
  });

  const positions: Position[] = data?.positions ?? [];
  const notionalValue: number | null = data?.notional_value ?? null;

  const [newTicker, setNewTicker] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [editingTicker, setEditingTicker] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // Notional value editor state
  const [editingNotional, setEditingNotional] = useState(false);
  const [notionalInput, setNotionalInput] = useState(
    notionalValue != null ? String(notionalValue) : "",
  );
  const notionalMut = useMutation({
    mutationFn: (v: number | null) => patchPortfolioNotional(portfolioId, v),
    onSuccess: () => {
      setEditingNotional(false);
      qc.invalidateQueries({ queryKey: ["portfolio", portfolioId] });
      refetch();
    },
  });

  const [csvResult, setCsvResult] = useState<{
    positions_added: number;
    positions_updated: number;
    universe_added: string[];
    warnings: string[];
  } | null>(null);

  const csvMut = useMutation({
    mutationFn: (file: File) => importPortfolioCSV(portfolioId, file),
    onSuccess: (result) => {
      setCsvResult(result);
      refetch();
    },
  });

  const addMut = useMutation({
    mutationFn: () =>
      addPosition(
        portfolioId,
        newTicker.trim().toUpperCase(),
        newWeight ? parseFloat(newWeight) : null,
      ),
    onSuccess: () => {
      setNewTicker("");
      setNewWeight("");
      setAddError(null);
      refetch();
    },
    onError: (e: Error) => setAddError(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({
      ticker,
      weight,
    }: {
      ticker: string;
      weight: number | null;
    }) => updatePosition(portfolioId, ticker, weight),
    onSuccess: () => {
      setEditingTicker(null);
      setEditError(null);
      refetch();
    },
  });

  function saveWeight(ticker: string) {
    const val = parseFloat(editWeight) || 0;
    const otherSum = positions
      .filter((p) => p.ticker !== ticker)
      .reduce((s, p) => s + (p.weight ?? 0), 0);
    if (val < 0) {
      setEditError("Must be ≥ 0%");
      return;
    }
    if (otherSum + val > 100 + 0.001) {
      setEditError(
        `Total would be ${(otherSum + val).toFixed(1)}% — exceeds 100%`,
      );
      return;
    }
    setEditError(null);
    updateMut.mutate({ ticker, weight: val || null });
  }

  const removeMut = useMutation({
    mutationFn: (ticker: string) => removePosition(portfolioId, ticker),
    onSuccess: () => refetch(),
  });

  const totalWeight = positions.reduce((s, p) => s + (p.weight ?? 1), 0) || 1;
  const currentTotal = positions.reduce((s, p) => s + (p.weight ?? 0), 0);
  const editingCurrentWeight = editingTicker
    ? (positions.find((p) => p.ticker === editingTicker)?.weight ?? 0)
    : 0;
  const displayTotal = editingTicker
    ? currentTotal - editingCurrentWeight + (parseFloat(editWeight) || 0)
    : currentTotal;

  if (!checked) return null;
  if (isLoading)
    return (
      <p className="text-sm text-[var(--color-muted)] p-4">Loading…</p>
    );

  return (
    <div className="space-y-4">
      {/* Portfolio Value editor */}
      <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-sm">
        <span className="text-xs font-semibold text-[var(--color-muted)] shrink-0">
          Portfolio Value
        </span>
        {editingNotional ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--color-muted)]">$</span>
            <input
              autoFocus
              type="number"
              min={0}
              step={1000}
              value={notionalInput}
              onChange={(e) => setNotionalInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  notionalMut.mutate(
                    notionalInput ? parseFloat(notionalInput) : null,
                  );
                if (e.key === "Escape") setEditingNotional(false);
              }}
              onBlur={() =>
                notionalMut.mutate(
                  notionalInput ? parseFloat(notionalInput) : null,
                )
              }
              className="w-36 rounded border border-[var(--color-border)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              placeholder="e.g. 500000"
            />
          </div>
        ) : (
          <button
            onClick={() => {
              setNotionalInput(
                notionalValue != null ? String(notionalValue) : "",
              );
              setEditingNotional(true);
            }}
            className="text-sm text-[var(--color-primary)] hover:underline"
          >
            {notionalValue != null
              ? `$${notionalValue.toLocaleString("en-US", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}`
              : "Set portfolio value →"}
          </button>
        )}
        <InfoTooltip text="Used by the Rebalance tab to compute whole-share trade quantities." />
      </div>

      {/* Add position form */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Add Holding
            <InfoTooltip text="Tickers must be in the active Universe. Enter weight as a percentage (e.g. 25 = 25%). All weights must sum to exactly 100%." />
          </h3>
          <label
            className={`flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-gray-50 transition-colors ${csvMut.isPending ? "opacity-50 pointer-events-none" : ""}`}
          >
            <Upload className="h-3.5 w-3.5" />
            {csvMut.isPending ? "Importing…" : "Import CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setCsvResult(null);
                  csvMut.mutate(f);
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {csvMut.isError && (
          <p className="mb-2 text-xs text-[var(--color-negative)]">
            Import failed: {(csvMut.error as Error).message}
          </p>
        )}
        {csvResult && (
          <div className="mb-3 rounded-[var(--radius-btn)] border border-green-200 bg-green-50 p-3 text-xs text-green-800 space-y-1">
            <p className="font-semibold">
              Import complete — {csvResult.positions_added} added,{" "}
              {csvResult.positions_updated} updated
            </p>
            {csvResult.universe_added.length > 0 && (
              <p>
                Auto-added to universe:{" "}
                <span className="font-mono">
                  {csvResult.universe_added.join(", ")}
                </span>
              </p>
            )}
            {csvResult.warnings.map((w, i) => (
              <p key={i} className="text-amber-700">
                {w}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <UniverseTickerPicker
            value={newTicker}
            onChange={setNewTicker}
            placeholder="Ticker (e.g. AAPL)"
            className="w-44"
          />
          <input
            value={newWeight}
            onChange={(e) => {
              setNewWeight(e.target.value);
              setAddError(null);
            }}
            placeholder="Weight % (e.g. 25)"
            type="number"
            min={0}
            max={100}
            step={0.1}
            className="w-36 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <button
            onClick={() => {
              const newW = newWeight ? parseFloat(newWeight) : 0;
              if (newW < 0) {
                setAddError("Weight cannot be negative.");
                return;
              }
              if (newW > 0 && currentTotal + newW > 100 + 0.001) {
                setAddError(
                  `Adding ${newW}% would exceed 100% (current: ${currentTotal.toFixed(1)}%).`,
                );
                return;
              }
              addMut.mutate();
            }}
            disabled={!newTicker.trim() || addMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {addMut.isPending ? "Adding…" : "Add"}
          </button>
        </div>
        {addError && (
          <p className="mt-2 text-xs text-[var(--color-negative)]">
            {addError}
          </p>
        )}
      </div>

      {/* Positions table */}
      {positions.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          No holdings yet. Add tickers from the Universe above.
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)]">
                  Ticker
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">
                  Weight %
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">
                  Alloc %
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-[var(--color-muted)]">
                  Signals
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {positions.map((pos) => {
                const pct = ((pos.weight ?? 1) / totalWeight) * 100;
                const isExpanded = expandedTicker === pos.ticker;
                return (
                  <>
                    <tr key={pos.ticker} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-medium">
                        <Link
                          href={`/ticker/${pos.ticker}?from=/portfolios/${portfolioId}`}
                          className="text-[var(--color-primary)] hover:underline"
                        >
                          {pos.ticker}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editingTicker === pos.ticker ? (
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                value={editWeight}
                                onChange={(e) => {
                                  setEditWeight(e.target.value);
                                  setEditError(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    saveWeight(pos.ticker);
                                  if (e.key === "Escape") {
                                    setEditingTicker(null);
                                    setEditError(null);
                                  }
                                }}
                                className="w-20 rounded border border-[var(--color-border)] px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                              />
                              <span className="text-xs text-[var(--color-muted)]">
                                %
                              </span>
                            </div>
                            {editError && (
                              <span className="text-[10px] text-[var(--color-negative)]">
                                {editError}
                              </span>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingTicker(pos.ticker);
                              setEditWeight(
                                pos.weight != null ? String(pos.weight) : "",
                              );
                              setEditError(null);
                            }}
                            className="font-semibold text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
                          >
                            {pos.weight != null
                              ? `${pos.weight.toFixed(1)}%`
                              : "—"}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--color-muted)]">
                        {pct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() =>
                            setExpandedTicker(
                              isExpanded ? null : pos.ticker,
                            )
                          }
                          className="text-xs text-[var(--color-primary)] hover:underline"
                        >
                          {isExpanded ? "Hide" : "Signals"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editingTicker === pos.ticker ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => saveWeight(pos.ticker)}
                              disabled={updateMut.isPending}
                              className="rounded bg-[var(--color-primary)] px-2 py-1 text-[10px] font-bold text-white hover:opacity-90"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setEditingTicker(null);
                                setEditError(null);
                              }}
                              className="rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-muted)] hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => removeMut.mutate(pos.ticker)}
                            disabled={removeMut.isPending}
                            className="text-[var(--color-muted)] hover:text-[var(--color-negative)] transition-colors"
                            title="Remove holding"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${pos.ticker}-expand`} className="bg-gray-50">
                        <td colSpan={5} className="px-4 pb-2">
                          <QuickTechnicals ticker={pos.ticker} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
            <tfoot className="border-t border-[var(--color-border)] bg-gray-50">
              <tr>
                <td
                  className="px-4 py-2 text-xs font-semibold text-[var(--color-muted)]"
                  colSpan={2}
                >
                  Total
                </td>
                <td
                  className={`px-4 py-2 text-right text-xs font-bold ${
                    Math.abs(displayTotal - 100) < 0.1
                      ? "text-green-600"
                      : displayTotal > 100
                        ? "text-[var(--color-negative)]"
                        : "text-amber-600"
                  }`}
                >
                  {displayTotal.toFixed(1)}%
                </td>
                <td colSpan={2} className="px-4 py-2 text-xs text-[var(--color-muted)]">
                  {Math.abs(displayTotal - 100) < 0.1
                    ? "✓ sums to 100%"
                    : displayTotal > 100
                      ? `${(displayTotal - 100).toFixed(1)}% over`
                      : `${(100 - displayTotal).toFixed(1)}% remaining`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Next step CTA */}
      {positions.length > 0 && (
        <div className="mt-2 text-center">
          <Link
            href={`/portfolios/${portfolioId}/targets`}
            className="text-sm text-[var(--color-primary)] hover:underline"
          >
            Next step: Set Targets →
          </Link>
        </div>
      )}
    </div>
  );
}
