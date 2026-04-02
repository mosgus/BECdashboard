"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { fetchWalkForward } from "@/lib/api";
import { fmtPct, fmtNum } from "@/lib/utils";
import type { WalkForwardResult } from "@/types/research";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";

const MODES = [
  { value: "max_sharpe", label: "Max Sharpe" },
  { value: "min_variance", label: "Min Variance" },
  { value: "risk_parity", label: "Risk Parity" },
  { value: "max_sortino", label: "Max Sortino" },
  { value: "min_cvar", label: "Min CVaR" },
  { value: "max_diversification", label: "Max Diversification" },
  { value: "equal_weight", label: "Equal Weight" },
  { value: "target_volatility", label: "Target Volatility" },
];

export default function WalkForwardPanel({
  portfolioId,
}: {
  portfolioId: string;
}) {
  const [mode, setMode] = useState("max_sharpe");
  const [trainDays, setTrainDays] = useState(504);
  const [testDays, setTestDays] = useState(63);
  const [nFolds, setNFolds] = useState(4);

  const wfMut = useMutation({
    mutationFn: () =>
      fetchWalkForward(portfolioId, {
        mode,
        train_days: trainDays,
        test_days: testDays,
        n_folds: nFolds,
      }),
  });

  const result = wfMut.data;

  // Build fold comparison chart data
  const foldChartData =
    result?.folds
      ?.filter((f) => !f.error)
      .map((f) => ({
        name: `Fold ${f.fold}`,
        IS: f.is_metrics?.sharpe ?? 0,
        OOS: f.oos_metrics?.sharpe ?? 0,
      })) ?? [];

  const degradationOk =
    result?.degradation_ratio != null && result.degradation_ratio > 0.5;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)]">
            Optimizer Mode
          </label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="mt-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)]">
            Train (days)
          </label>
          <input
            type="number"
            value={trainDays}
            onChange={(e) => setTrainDays(Number(e.target.value))}
            className="mt-1 w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)]">
            Test (days)
          </label>
          <input
            type="number"
            value={testDays}
            onChange={(e) => setTestDays(Number(e.target.value))}
            className="mt-1 w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)]">
            Folds
          </label>
          <input
            type="number"
            value={nFolds}
            onChange={(e) => setNFolds(Number(e.target.value))}
            min={2}
            max={10}
            className="mt-1 w-20 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          />
        </div>
        <button
          onClick={() => wfMut.mutate()}
          disabled={wfMut.isPending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {wfMut.isPending ? "Running..." : "Run Walk-Forward"}
        </button>
      </div>

      {wfMut.isError && (
        <p className="text-xs text-[var(--color-negative)]">
          {(wfMut.error as Error).message}
        </p>
      )}

      {result?.error && (
        <p className="text-xs text-[var(--color-negative)]">{result.error}</p>
      )}

      {result && !result.error && (
        <>
          {/* Degradation badge */}
          <div
            className={`flex items-center gap-4 rounded-[var(--radius-card)] border p-4 shadow-sm ${
              degradationOk
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <span
              className={`text-2xl font-black ${
                degradationOk ? "text-green-600" : "text-red-600"
              }`}
            >
              {degradationOk ? "ROBUST" : "FRAGILE"}
            </span>
            <div className="text-xs">
              <p className="font-semibold text-[var(--color-text)]">
                Degradation Ratio:{" "}
                {result.degradation_ratio?.toFixed(2) ?? "N/A"}
              </p>
              <p className="text-[var(--color-muted)]">
                OOS Sharpe: {fmtNum(result.aggregate_oos?.sharpe)} | OOS CAGR:{" "}
                {fmtPct(result.aggregate_oos?.cagr)} | OOS Max DD:{" "}
                {fmtPct(result.aggregate_oos?.max_dd)}
              </p>
            </div>
          </div>

          {/* Fold IS vs OOS bar chart */}
          {foldChartData.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-[var(--color-muted)]">
                In-Sample vs Out-of-Sample Sharpe by Fold
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={foldChartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                  />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="IS" fill="var(--color-primary)" opacity={0.5} name="In-Sample Sharpe" />
                  <Bar dataKey="OOS" fill="#10b981" name="OOS Sharpe" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* OOS equity curve */}
          {result.oos_equity_curve && result.oos_equity_curve.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-[var(--color-muted)]">
                Combined OOS Equity Curve
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={result.oos_equity_curve}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                  />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                  <Tooltip />
                  <Line
                    dataKey="value"
                    stroke="var(--color-primary)"
                    dot={false}
                    strokeWidth={2}
                    name="OOS Equity"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Fold detail table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    Fold
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    Train Window
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    Test Window
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    IS Sharpe
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    OOS Sharpe
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    OOS CAGR
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                    OOS Max DD
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.folds.map((f) => (
                  <tr
                    key={f.fold}
                    className="border-b border-[var(--color-border)]"
                  >
                    <td className="px-3 py-2 font-medium">{f.fold}</td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">
                      {f.train_start} \u2192 {f.train_end}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">
                      {f.test_start} \u2192 {f.test_end}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {fmtNum(f.is_metrics?.sharpe)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {fmtNum(f.oos_metrics?.sharpe)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {fmtPct(f.oos_metrics?.cagr)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {fmtPct(f.oos_metrics?.max_dd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
