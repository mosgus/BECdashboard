"use client";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Pencil, Trash2, Upload, Check, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  addPosition,
  fetchPortfolioDetail,
  fetchTickerTechnicals,
  importPortfolioCSV,
  removePosition,
  setCashAllocation,
  updatePositionShares,
} from "@/lib/api";
import { fmtDollar, fmtNum } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import InfoTooltip from "@/components/InfoTooltip";
import UniverseTickerPicker from "@/components/UniverseTickerPicker";
import { Position } from "@/types/sprint3";
import { SignalResult } from "@/types/sprint2";

// ── Signal type options ────────────────────────────────────────────────────────

const SIGNAL_OPTIONS = [
  { value: "sma",  label: "SMA Cross" },
  { value: "rsi",  label: "RSI" },
  { value: "macd", label: "MACD" },
  { value: "atr",  label: "ATR" },
  { value: "all",  label: "All" },
] as const;
type SignalFilter = typeof SIGNAL_OPTIONS[number]["value"];

// ── Per-row inline signal cell ─────────────────────────────────────────────────

function SignalCell({ ticker }: { ticker: string }) {
  const [filter, setFilter] = useState<SignalFilter>("sma");

  const { data, isLoading } = useQuery({
    queryKey: ["quick-technicals", ticker],
    queryFn: () => fetchTickerTechnicals(ticker, undefined, undefined, true),
    staleTime: 120_000,
  });

  const signals: SignalResult[] = data?.signals ?? [];
  const shown =
    filter === "all"
      ? signals
      : signals.filter((s) => s.signal.toLowerCase().includes(filter));

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as SignalFilter)}
        className="shrink-0 rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
      >
        {SIGNAL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {isLoading ? (
        <span className="text-[10px] text-[var(--color-muted)]">…</span>
      ) : shown.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {shown.map((s) => (
            <SignalBadge key={s.signal} state={s.state} lastDate={s.last_trigger_date} />
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-[var(--color-muted)]">—</span>
      )}

      {filter === "atr" && data?.atr14 != null && (
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
          {fmtNum(data.atr14, 2)}
        </span>
      )}
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
  const cashValue: number | null = data?.cash_value ?? null;
  const cashPctTarget: number | null = data?.cash_pct_target ?? null;

  // ── Add form state ──────────────────────────────────────────────────────────
  const [newTicker, setNewTicker]             = useState("");
  const [newShares, setNewShares]             = useState("");
  const [newCostBasis, setNewCostBasis]       = useState("");
  const [addError, setAddError]               = useState<string | null>(null);
  const [cashUpdateMode, setCashUpdateMode]   = useState<"value" | "pct">("value");
  const [cashInputValue, setCashInputValue]   = useState<string>("");
  const [cashInputPct, setCashInputPct]       = useState<string>("");

  // ── Inline edit state ───────────────────────────────────────────────────────
  const [editingTicker, setEditingTicker]     = useState<string | null>(null);
  const [editShares, setEditShares]           = useState("");
  const [editCostBasis, setEditCostBasis]     = useState("");

  // ── CSV import ──────────────────────────────────────────────────────────────
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
    mutationFn: () => {
      const shares = parseFloat(newShares);
      const cb = newCostBasis ? parseFloat(newCostBasis) : null;
      return addPosition(portfolioId, newTicker.trim().toUpperCase(), shares, cb);
    },
    onSuccess: () => {
      setNewTicker("");
      setNewShares("");
      setNewCostBasis("");
      setAddError(null);
      qc.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key.length > 0 && key[1] === portfolioId;
        },
      });
    },
    onError: (e: Error) => setAddError(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ ticker, shares, costBasis }: { ticker: string; shares: number; costBasis?: number | null }) =>
      updatePositionShares(portfolioId, ticker, shares, costBasis),
    onSuccess: () => {
      setEditingTicker(null);
      qc.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key.length > 0 && key[1] === portfolioId;
        },
      });
    },
  });

  const removeMut = useMutation({
    mutationFn: (ticker: string) => removePosition(portfolioId, ticker),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio", portfolioId] }),
  });

  // ── Derived totals ──────────────────────────────────────────────────────────
  const equityMV = positions.reduce((s, p) => s + (p.market_value ?? 0), 0);
  const totalMarketValue = equityMV + (cashValue ?? 0);

  function startEdit(pos: Position) {
    setEditingTicker(pos.ticker);
    setEditShares(pos.shares != null ? String(pos.shares) : "");
    setEditCostBasis(pos.cost_basis != null ? String(pos.cost_basis) : "");
  }

  function saveEdit(ticker: string) {
    const shares = parseFloat(editShares);
    if (isNaN(shares) || shares < 0) return;
    updateMut.mutate({
      ticker,
      shares,
      costBasis: editCostBasis ? parseFloat(editCostBasis) : null,
    });
  }

  if (!checked) return null;
  if (isLoading)
    return <p className="text-sm text-[var(--color-muted)] p-4">Loading…</p>;

  const hasShares = positions.some((p) => p.shares != null);

  return (
    <div className="space-y-4">

      {/* Portfolio value banner — auto-computed from shares × price */}
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-sm">
        <span className="text-xs font-semibold text-[var(--color-muted)] shrink-0">
          Portfolio Value
        </span>
        {hasShares || cashValue != null ? (
          <>
            <span className="text-sm font-bold text-[var(--color-text)]">
              {totalMarketValue > 0 ? fmtDollar(totalMarketValue) : "—"}
            </span>
            {equityMV > 0 || cashValue != null ? (
              <span className="text-xs text-[var(--color-muted)]">
                Equities: <strong className="text-[var(--color-text)]">{fmtDollar(equityMV)}</strong>
                {cashValue != null && cashValue > 0 && (
                  <>
                    {" · "}
                    Cash: <strong className="text-amber-600">{fmtDollar(cashValue)}</strong>
                  </>
                )}
              </span>
            ) : null}
            <span className="text-xs text-[var(--color-muted)]">
              (equities auto-computed from shares × price)
              <InfoTooltip text="Equity value is automatically computed from your share counts × live prices. Cash is managed separately via the Cash & Equivalents panel." />
            </span>
          </>
        ) : (
          <span className="text-xs text-[var(--color-muted)]">
            Add holdings or set cash value.
          </span>
        )}
        {notionalValue != null && (
          <span className="ml-auto text-xs text-[var(--color-muted)]">
            Saved:{" "}
            <strong className="text-[var(--color-text)]">
              {fmtDollar(notionalValue)}
            </strong>
          </span>
        )}
      </div>

      {/* Last Rebalance Date */}
      {data?.last_rebalance_date && (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs shadow-sm">
          <span className="text-[var(--color-muted)]">Last Rebalance:</span>
          <span className="font-semibold text-[var(--color-text)]">
            {new Date(data.last_rebalance_date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <InfoTooltip text="Date when positions were last imported or rebalanced. Used as the baseline for PnL calculations." />
        </div>
      )}

      {/* Add holding form */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Add Holding
            <InfoTooltip text="Enter a ticker and number of shares. Weights are computed automatically from shares × live price. Any ticker not yet in the Universe is auto-added and enriched on submit." />
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
                if (f) { setCsvResult(null); csvMut.mutate(f); }
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
                <span className="font-mono">{csvResult.universe_added.join(", ")}</span>
              </p>
            )}
            {csvResult.warnings.map((w, i) => (
              <p key={i} className="text-amber-700">{w}</p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-[var(--color-muted)]">Ticker</label>
            <UniverseTickerPicker
              value={newTicker}
              onChange={setNewTicker}
              placeholder="e.g. AAPL"
              className="w-36"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-[var(--color-muted)]">Shares</label>
            <input
              value={newShares}
              onChange={(e) => { setNewShares(e.target.value); setAddError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && newTicker && newShares) addMut.mutate(); }}
              placeholder="e.g. 100"
              type="number"
              min={0}
              step={0.001}
              className="w-28 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-[var(--color-muted)]">
              Cost Basis / share
              <InfoTooltip text="Optional. Your average purchase price per share for P&L tracking." />
            </label>
            <input
              value={newCostBasis}
              onChange={(e) => setNewCostBasis(e.target.value)}
              placeholder="Optional"
              type="number"
              min={0}
              step={0.01}
              className="w-28 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <button
            onClick={() => {
              if (!newTicker.trim()) { setAddError("Ticker required."); return; }
              const s = parseFloat(newShares);
              if (isNaN(s) || s <= 0) { setAddError("Enter a positive share count."); return; }
              addMut.mutate();
            }}
            disabled={!newTicker.trim() || !newShares || addMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {addMut.isPending ? "Adding…" : "Add"}
          </button>
        </div>
        {addError && (
          <p className="mt-2 text-xs text-[var(--color-negative)]">{addError}</p>
        )}
      </div>

      {/* Cash & Equivalents panel */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Cash & Equivalents
            <InfoTooltip text="Cash and money-market positions held in the portfolio. Set either a dollar amount or a percentage target." />
          </h3>
        </div>

        <div className="space-y-3">
          {/* Display current cash value */}
          {cashValue != null && cashValue > 0 && (
            <div className="flex items-center justify-between rounded bg-amber-50 px-3 py-2">
              <span className="text-xs font-medium text-[var(--color-muted)]">Current:</span>
              <span className="text-sm font-semibold text-amber-700">{fmtDollar(cashValue)}</span>
            </div>
          )}

          {/* Input fields */}
          <div className="flex flex-wrap items-end gap-3">
            {/* Dollar amount input */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-[var(--color-muted)]">$ Amount</label>
              <input
                value={cashInputValue}
                onChange={(e) => setCashInputValue(e.target.value)}
                placeholder={cashValue ? fmtDollar(cashValue) : "0"}
                type="number"
                min={0}
                step={0.01}
                className="w-36 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>

            {/* Percentage target input */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-[var(--color-muted)]">% Target</label>
              <div className="flex items-center gap-2">
                <input
                  value={cashInputPct}
                  onChange={(e) => setCashInputPct(e.target.value)}
                  placeholder={cashPctTarget ? String(cashPctTarget.toFixed(1)) : "0"}
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  className="w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <span className="text-xs text-[var(--color-muted)]">%</span>
              </div>
            </div>

            {/* Save button */}
            <button
              onClick={async () => {
                const val = cashInputValue ? parseFloat(cashInputValue) : null;
                const pct = cashInputPct ? parseFloat(cashInputPct) : null;
                if (val != null || pct != null) {
                  try {
                    await setCashAllocation(portfolioId, val, pct);
                    setCashInputValue("");
                    setCashInputPct("");
                    qc.invalidateQueries({ queryKey: ["portfolio", portfolioId] });
                  } catch (e) {
                    alert("Failed to update cash: " + (e as Error).message);
                  }
                }
              }}
              className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Save Cash
            </button>
          </div>

          {/* Computed info */}
          {totalMarketValue > 0 && cashPctTarget != null && cashPctTarget > 0 && (
            <div className="rounded bg-gray-50 px-3 py-2 text-xs text-[var(--color-muted)]">
              <span>Computed: {cashPctTarget.toFixed(1)}% of {fmtDollar(totalMarketValue)} = {fmtDollar((totalMarketValue * cashPctTarget) / 100)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Positions table */}
      {positions.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          No holdings yet. Add tickers above.
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-border)] bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)]">Ticker</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">Shares</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">Price</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">Mkt Value</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">
                    Weight %
                    <InfoTooltip text="Computed automatically: position market value ÷ total portfolio value." />
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">
                    Cost Basis
                    <InfoTooltip text="Your average purchase price per share. Used for unrealised P&L." />
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-muted)]">
                    P&L
                    <InfoTooltip text="Unrealised P&L: (current price − cost basis) × shares." />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)]">Signal</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {positions.map((pos) => {
                  const weight = pos.weight != null ? pos.weight : null;
                  const pnl =
                    pos.price != null && pos.cost_basis != null && pos.shares != null
                      ? (pos.price - pos.cost_basis) * pos.shares
                      : null;
                  const pnlPct =
                    pos.price != null && pos.cost_basis != null && pos.cost_basis > 0
                      ? (pos.price - pos.cost_basis) / pos.cost_basis
                      : null;

                  const isEditing = editingTicker === pos.ticker;

                  return (
                    <tr key={pos.ticker} className={`hover:bg-gray-50 ${isEditing ? "bg-blue-50" : ""}`}>
                      {/* Ticker */}
                      <td className="px-4 py-3 font-mono font-semibold">
                        <Link
                          href={`/ticker/${pos.ticker}?from=/portfolios/${portfolioId}`}
                          className="text-[var(--color-primary)] hover:underline"
                        >
                          {pos.ticker}
                        </Link>
                      </td>

                      {/* Shares */}
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <input
                            autoFocus
                            type="number"
                            min={0}
                            step={0.001}
                            value={editShares}
                            onChange={(e) => setEditShares(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(pos.ticker);
                              if (e.key === "Escape") setEditingTicker(null);
                            }}
                            className="w-24 rounded border border-[var(--color-border)] px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                          />
                        ) : (
                          <span className="font-medium">
                            {pos.shares != null ? pos.shares.toLocaleString() : "—"}
                          </span>
                        )}
                      </td>

                      {/* Price */}
                      <td className="px-4 py-3 text-right text-[var(--color-muted)]">
                        {pos.price != null ? `$${pos.price.toFixed(2)}` : "—"}
                      </td>

                      {/* Market Value */}
                      <td className="px-4 py-3 text-right font-medium">
                        {pos.market_value != null ? fmtDollar(pos.market_value) : "—"}
                      </td>

                      {/* Weight */}
                      <td className="px-4 py-3 text-right">
                        {weight != null ? (
                          <span className="font-semibold">{weight.toFixed(1)}%</span>
                        ) : "—"}
                      </td>

                      {/* Cost Basis */}
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={editCostBasis}
                            onChange={(e) => setEditCostBasis(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(pos.ticker);
                              if (e.key === "Escape") setEditingTicker(null);
                            }}
                            placeholder="Optional"
                            className="w-24 rounded border border-[var(--color-border)] px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                          />
                        ) : (
                          <span className="text-[var(--color-muted)]">
                            {pos.cost_basis != null ? `$${pos.cost_basis.toFixed(2)}` : "—"}
                          </span>
                        )}
                      </td>

                      {/* P&L */}
                      <td className="px-4 py-3 text-right">
                        {pnl != null ? (
                          <span
                            className={`font-semibold text-xs ${pnl >= 0 ? "text-green-600" : "text-red-600"}`}
                          >
                            {pnl >= 0 ? "+" : ""}
                            {fmtDollar(pnl)}
                            {pnlPct != null && (
                              <span className="ml-1 opacity-75">
                                ({pnlPct >= 0 ? "+" : ""}
                                {(pnlPct * 100).toFixed(1)}%)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-muted)]">—</span>
                        )}
                      </td>

                      {/* Signal dropdown */}
                      <td className="px-4 py-3">
                        <SignalCell ticker={pos.ticker} />
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => saveEdit(pos.ticker)}
                              disabled={updateMut.isPending}
                              className="rounded bg-[var(--color-primary)] p-1 text-white hover:opacity-90 disabled:opacity-50"
                              title="Save"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={() => setEditingTicker(null)}
                              className="rounded border border-[var(--color-border)] p-1 text-[var(--color-muted)] hover:bg-gray-100"
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => startEdit(pos)}
                              className="rounded p-1 text-[var(--color-muted)] hover:text-[var(--color-primary)] hover:bg-gray-100 transition-colors"
                              title="Edit shares"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => {
                                if (!window.confirm(`Remove ${pos.ticker} from this portfolio?`)) return;
                                removeMut.mutate(pos.ticker);
                              }}
                              disabled={removeMut.isPending}
                              className="rounded p-1 text-[var(--color-muted)] hover:text-[var(--color-negative)] hover:bg-red-50 transition-colors"
                              title="Remove holding"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Footer totals */}
              {positions.length > 0 && (
                <tfoot className="border-t border-[var(--color-border)] bg-gray-50">
                  <tr>
                    <td className="px-4 py-2 text-xs font-semibold text-[var(--color-muted)]" colSpan={3}>
                      Total
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-bold text-[var(--color-text)]">
                      {totalMarketValue > 0 ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span>{fmtDollar(totalMarketValue)}</span>
                          {cashValue != null && cashValue > 0 && equityMV > 0 && (
                            <span className="text-[10px] font-normal text-[var(--color-muted)]">
                              {fmtDollar(equityMV)} eq · <span className="text-amber-600">{fmtDollar(cashValue)} cash</span>
                            </span>
                          )}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-bold">
                      {positions.reduce((s, p) => s + (p.weight ?? 0), 0).toFixed(1)}%
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
