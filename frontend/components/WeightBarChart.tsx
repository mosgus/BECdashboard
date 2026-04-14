"use client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface Props {
  tickers: string[];
  current: Record<string, number>;
  optimized: Record<string, number>;
}

export default function WeightBarChart({ tickers, current, optimized }: Props) {
  const data = tickers.map((t) => ({
    ticker: t,
    current: parseFloat(((current[t] ?? 0) * 100).toFixed(2)),
    optimized: parseFloat(((optimized[t] ?? 0) * 100).toFixed(2)),
  }));

  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">Weight Comparison</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="ticker" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={fmtPct} tick={{ fontSize: 11 }} width={44} />
          <Tooltip formatter={(v: unknown) => `${(Number(v) || 0).toFixed(2)}%`} />
          <Legend />
          <Bar dataKey="current" name="Current" fill="#93c5fd" radius={[3, 3, 0, 0]} />
          <Bar dataKey="optimized" name="Optimized" fill="#22c55e" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
