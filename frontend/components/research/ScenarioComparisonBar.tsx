"use client";
import { useRef } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import type { ScenarioResult, HistoricalReplayResult } from "@/types/sprint7";
import { getPresetByDates } from "@/lib/scenarios";
import ChartExportButtons from "@/components/ChartExportButtons";

interface Props {
  results: ScenarioResult[];
}

/**
 * Comparison bar chart: one bar per scenario, grouped by Total Return + Max DD.
 * Renders only when 2+ scenarios are present.
 */
export default function ScenarioComparisonBar({ results }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);

  // Filter to historical_replay (the only type with both total_return AND max_dd)
  const rows = results
    .filter((r): r is HistoricalReplayResult => r.scenario_type === "historical_replay")
    .map((r, i) => {
      const preset = getPresetByDates(r.start, r.end);
      const label = preset?.name
        ? preset.name.length > 22
          ? preset.name.slice(0, 20) + "…"
          : preset.name
        : `${r.start} → ${r.end}`;
      return {
        name: label,
        total_return_pct: (r.total_return ?? 0) * 100,
        max_dd_pct: (r.max_dd ?? 0) * 100,
        idx: i,
      };
    });

  if (rows.length < 2) return null;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Scenario Comparison</h3>
          <p className="text-xs text-[var(--color-muted)]">
            Side-by-side total return and max drawdown across the {rows.length} historical replays you&apos;ve run.
          </p>
        </div>
        <ChartExportButtons
          chartRef={chartRef}
          csvData={rows as unknown as Record<string, unknown>[]}
          filename="scenario_comparison"
        />
      </div>

      <div ref={chartRef}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} margin={{ top: 20, right: 20, bottom: 60, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.3} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10 }}
              angle={-25}
              textAnchor="end"
              interval={0}
              height={80}
            />
            <YAxis tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: unknown) => `${Number(v).toFixed(2)}%`} />
            <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 10 }} iconSize={10} />
            <ReferenceLine y={0} stroke="#6b7280" />
            <Bar dataKey="total_return_pct" name="Total Return">
              {rows.map((r, i) => (
                <Cell key={i} fill={r.total_return_pct >= 0 ? "#10b981" : "#ef4444"} />
              ))}
            </Bar>
            <Bar dataKey="max_dd_pct" name="Max Drawdown" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
