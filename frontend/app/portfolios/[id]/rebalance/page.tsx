"use client";
import { use, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { computeImplementation, fetchPortfolioDetail } from "@/lib/api";
import { ImplementationResult, Position } from "@/types/sprint3";
import InfoTooltip from "@/components/InfoTooltip";

export default function RebalancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: portfolioId } = use(params);
  const { checked } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["portfolio", portfolioId],
    queryFn: () => fetchPortfolioDetail(portfolioId),
    enabled: checked,
  });

  const positions: Position[] = data?.positions ?? [];
  const notionalValue: number | null = data?.notional_value ?? null;
  const lastTargetSet = data?.last_target_set ?? null;

  const [worksheetSource, setWorksheetSource] = useState<
    "current" | "saved" | "optimizer" | "tilt"
  >("saved");
  const [worksheetResult, setWorksheetResult] =
    useState<ImplementationResult | null>(null);
  const [worksheetError, setWorksheetError] = useState<string | null>(null);

  const worksheetMut = useMutation({
    mutationFn: () => {
      let targetWeights: Record<string, number> = {};
      const total =
        positions.reduce((s, p) => s + (p.weight ?? 1), 0) || 1;

      if (worksheetSource === "current") {
        positions.forEach(
          (p) => (targetWeights[p.ticker] = (p.weight ?? 1) / total),
        );
      } else if (
        worksheetSource === "saved" &&
        lastTargetSet?.weights
      ) {
        targetWeights = lastTargetSet.weights;
      } else if (worksheetSource === "optimizer" && lastTargetSet?.source === "optimizer") {
        targetWeights = lastTargetSet.weights;
      } else if (worksheetSource === "tilt" && lastTargetSet?.source === "tilt") {
        targetWeights = lastTargetSet.weights;
      } else {
        // Fall back to current weights if source unavailable
        positions.forEach(
          (p) => (targetWeights[p.ticker] = (p.weight ?? 1) / total),
        );
      }
      return computeImplementation(portfolioId, targetWeights, worksheetSource);
    },
    onSuccess: (d) => {
      setWorksheetResult(d);
      setWorksheetError(null);
    },
    onError: (e: Error) => setWorksheetError(e.message),
  });

  if (!checked) return null;
  if (isLoading)
    return (
      <p className="text-sm text-[var(--color-muted)] p-4">Loading…</p>
    );

  // Guard: no notional value set
  if (notionalValue == null) {
    return (
      <div className="rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 p-6">
        <p className="text-sm font-semibold text-amber-800">
          Portfolio value not set
        </p>
        <p className="mt-1 text-xs text-amber-700">
          The Rebalance worksheet requires a portfolio dollar value to compute
          whole-share quantities.
        </p>
        <Link
          href={`/portfolios/${portfolioId}/holdings`}
          className="mt-3 inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
        >
          Go to Holdings to set portfolio value →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Back link */}
      <div>
        <Link
          href={`/portfolios/${portfolioId}/targets`}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-primary)]"
        >
          ← Back to Targets
        </Link>
      </div>

      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
          Implementation Worksheet
          <InfoTooltip text="Translates target weights into whole-share trade quantities. Floor to whole shares then greedily allocate residual cash." />
        </h3>

        {/* Source selector */}
        <div className="mb-4 flex flex-wrap gap-4">
          {(
            [
              {
                key: "saved",
                label: "Saved Target Set",
                detail: lastTargetSet
                  ? `${lastTargetSet.as_of_date}${lastTargetSet.mode ? `, ${lastTargetSet.mode.replace(/_/g, " ")}` : ""}`
                  : null,
              },
              { key: "current", label: "Current Weights", detail: null },
            ] as const
          ).map(({ key, label, detail }) => (
            <label
              key={key}
              className="flex items-start gap-2 text-xs cursor-pointer"
            >
              <input
                type="radio"
                name="worksheet-source"
                value={key}
                checked={worksheetSource === key}
                onChange={() => setWorksheetSource(key)}
                className="mt-0.5 accent-[var(--color-primary)]"
              />
              <span>
                {label}
                {detail && (
                  <span className="ml-1 text-[var(--color-muted)]">
                    ({detail})
                  </span>
                )}
                {key === "saved" && !lastTargetSet && (
                  <span className="ml-1 text-amber-600">(none saved)</span>
                )}
              </span>
            </label>
          ))}
        </div>

        {/* No targets CTA */}
        {worksheetSource === "saved" && !lastTargetSet && (
          <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm">
            No target set saved yet.{" "}
            <Link
              href={`/portfolios/${portfolioId}/targets`}
              className="text-[var(--color-primary)] underline"
            >
              Go to Targets →
            </Link>
          </div>
        )}

        {worksheetError && (
          <p className="mb-3 text-xs text-[var(--color-negative)]">
            {worksheetError}
          </p>
        )}

        <button
          onClick={() => worksheetMut.mutate()}
          disabled={
            worksheetMut.isPending ||
            positions.length === 0 ||
            (worksheetSource === "saved" && !lastTargetSet)
          }
          className="mb-2 rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {worksheetMut.isPending ? "Computing…" : "Compute Worksheet"}
        </button>

        {/* Rounding policy note */}
        <p className="text-xs text-[var(--color-muted)]">
          Whole shares only. Residual cash allocated greedily to
          most-underweight position.
          {worksheetResult?.as_of_date
            ? ` Prices as of ${worksheetResult.as_of_date}.`
            : ""}
        </p>

        {worksheetResult && (
          <div className="mt-4 space-y-3">
            {/* Summary bar */}
            <div className="flex flex-wrap gap-4 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-gray-50 px-4 py-2.5 text-xs text-[var(--color-muted)]">
              <span>
                Notional:{" "}
                <strong className="text-[var(--color-text)]">
                  $
                  {worksheetResult.notional_value.toLocaleString("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </strong>
              </span>
              <span>
                Turnover:{" "}
                <strong className="text-[var(--color-text)]">
                  {(worksheetResult.total_turnover * 100).toFixed(1)}%
                </strong>
              </span>
              <span>
                Residual Cash:{" "}
                <strong className="text-[var(--color-text)]">
                  $
                  {worksheetResult.residual_cash.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </span>
              <span>
                As of:{" "}
                <strong className="text-[var(--color-text)]">
                  {worksheetResult.as_of_date}
                </strong>
              </span>
            </div>

            {/* Export CSV */}
            <div className="flex justify-end">
              <button
                className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-bg)] transition-colors"
                onClick={() => {
                  const headers = [
                    "ticker",
                    "price",
                    "current_weight",
                    "target_weight",
                    "current_value",
                    "target_value",
                    "current_shares_implied",
                    "target_shares_raw",
                    "target_shares",
                    "delta_shares",
                    "delta_value",
                    "action",
                  ];
                  const rows = worksheetResult.rows.map((r) =>
                    [
                      r.ticker,
                      r.price,
                      r.current_weight,
                      r.target_weight,
                      r.current_value,
                      r.target_value,
                      r.current_shares_implied,
                      r.target_shares_raw,
                      r.target_shares,
                      r.delta_shares,
                      r.delta_value,
                      r.action,
                    ].join(","),
                  );
                  const csv = [headers.join(","), ...rows].join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "implementation_worksheet.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export CSV
              </button>
            </div>

            {/* Trade table */}
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-[var(--color-border)] bg-gray-50">
                  <tr>
                    {[
                      "Ticker",
                      "Price",
                      "Cur Wt%",
                      "Tgt Wt%",
                      "Cur $Val",
                      "Tgt $Val",
                      "Δ Shares",
                      "Δ $",
                      "Action",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {worksheetResult.rows.map((r) => (
                    <tr
                      key={r.ticker}
                      className={
                        r.action === "BUY"
                          ? "bg-green-50 hover:bg-green-100"
                          : r.action === "SELL"
                            ? "bg-red-50 hover:bg-red-100"
                            : "hover:bg-gray-50"
                      }
                    >
                      <td className="px-3 py-2 font-mono font-semibold">
                        {r.ticker}
                      </td>
                      <td className="px-3 py-2">${r.price.toFixed(2)}</td>
                      <td className="px-3 py-2">
                        {(r.current_weight * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2">
                        {(r.target_weight * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2">
                        ${r.current_value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-3 py-2">
                        ${r.target_value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                      <td
                        className={`px-3 py-2 font-semibold ${r.delta_shares > 0 ? "text-green-700" : r.delta_shares < 0 ? "text-red-700" : "text-[var(--color-muted)]"}`}
                      >
                        {r.delta_shares > 0 ? "+" : ""}
                        {r.delta_shares}
                      </td>
                      <td
                        className={`px-3 py-2 font-semibold ${r.delta_value > 0 ? "text-green-700" : r.delta_value < 0 ? "text-red-700" : "text-[var(--color-muted)]"}`}
                      >
                        {r.delta_value > 0 ? "+" : ""}$
                        {Math.abs(r.delta_value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            r.action === "BUY"
                              ? "bg-green-200 text-green-800"
                              : r.action === "SELL"
                                ? "bg-red-200 text-red-800"
                                : "bg-gray-200 text-gray-600"
                          }`}
                        >
                          {r.action}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
