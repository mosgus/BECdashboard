"use client";
import { useState } from "react";
import type { OptimizerModeResult } from "@/types/research";
import { fmtPct, fmtNum } from "@/lib/utils";

type SortKey = "mode" | "sharpe" | "vol" | "cagr" | "max_dd" | "turnover" | "hhi";

export default function OptimizerComparisonTable({
  results,
}: {
  results: OptimizerModeResult[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("sharpe");
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const getValue = (r: OptimizerModeResult, key: SortKey): number => {
    if (r.error) return -Infinity;
    switch (key) {
      case "mode":
        return 0;
      case "sharpe":
        return r.metrics?.sharpe ?? -Infinity;
      case "vol":
        return r.metrics?.vol ?? Infinity;
      case "cagr":
        return r.metrics?.cagr ?? -Infinity;
      case "max_dd":
        return r.metrics?.max_dd ?? -Infinity;
      case "turnover":
        return r.turnover ?? Infinity;
      case "hhi":
        return r.concentration?.hhi ?? Infinity;
    }
  };

  // Keep current first, then sort the rest
  const current = results.filter((r) => r.mode === "current");
  const others = [...results.filter((r) => r.mode !== "current")].sort((a, b) => {
    const va = getValue(a, sortKey);
    const vb = getValue(b, sortKey);
    return sortAsc ? va - vb : vb - va;
  });
  const sorted = [...current, ...others];

  // Find best values for highlighting
  const validResults = results.filter((r) => !r.error && r.mode !== "current");
  const bestSharpe = Math.max(...validResults.map((r) => r.metrics?.sharpe ?? -Infinity));
  const bestVol = Math.min(...validResults.map((r) => r.metrics?.vol ?? Infinity));
  const bestDD = Math.max(...validResults.map((r) => r.metrics?.max_dd ?? -Infinity));

  const header = (label: string, key: SortKey) => (
    <th
      className="cursor-pointer px-3 py-2 text-left text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-text)]"
      onClick={() => handleSort(key)}
    >
      {label}
      {sortKey === key && (
        <span className="ml-1">{sortAsc ? "\u25B2" : "\u25BC"}</span>
      )}
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {header("Mode", "mode")}
            {header("CAGR", "cagr")}
            {header("Vol", "vol")}
            {header("Sharpe", "sharpe")}
            {header("Max DD", "max_dd")}
            {header("Turnover", "turnover")}
            {header("HHI", "hhi")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            if (r.error) {
              return (
                <tr
                  key={r.mode}
                  className="border-b border-[var(--color-border)] text-[var(--color-muted)]"
                >
                  <td className="px-3 py-2 font-medium">{r.label}</td>
                  <td colSpan={6} className="px-3 py-2 italic text-red-500">
                    {r.error}
                  </td>
                </tr>
              );
            }

            const isCurrent = r.mode === "current";
            const isBestSharpe =
              !isCurrent && r.metrics?.sharpe === bestSharpe;
            const isBestVol = !isCurrent && r.metrics?.vol === bestVol;
            const isBestDD = !isCurrent && r.metrics?.max_dd === bestDD;

            return (
              <tr
                key={r.mode}
                className={`border-b border-[var(--color-border)] ${
                  isCurrent
                    ? "bg-[var(--color-primary)]/5 font-semibold"
                    : "hover:bg-[var(--color-border)]/30"
                }`}
              >
                <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                  {r.label}
                </td>
                <td className="px-3 py-2 font-mono">
                  {fmtPct(r.metrics?.cagr)}
                </td>
                <td
                  className={`px-3 py-2 font-mono ${
                    isBestVol ? "font-bold text-green-600" : ""
                  }`}
                >
                  {fmtPct(r.metrics?.vol)}
                </td>
                <td
                  className={`px-3 py-2 font-mono ${
                    isBestSharpe ? "font-bold text-green-600" : ""
                  }`}
                >
                  {fmtNum(r.metrics?.sharpe)}
                </td>
                <td
                  className={`px-3 py-2 font-mono ${
                    isBestDD ? "font-bold text-green-600" : ""
                  }`}
                >
                  {fmtPct(r.metrics?.max_dd)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {r.turnover != null ? fmtPct(r.turnover) : "—"}
                </td>
                <td className="px-3 py-2 font-mono">
                  {fmtNum(r.concentration?.hhi, 3)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
