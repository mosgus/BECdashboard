"use client";
import { TimePoint } from "@/types/portfolio";
import { downsample } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface Props {
  data: TimePoint[];
  title?: string;
  lines?: { key: string; color: string; dashed?: boolean }[];
}

const DEFAULT_LINES = [
  { key: "portfolio", color: "#3b82f6" },
  { key: "benchmark", color: "#f59e0b", dashed: true },
];

const fmtDate = (d: string) => d.slice(0, 7); // YYYY-MM
const fmtVal = (v: number) => `${(v * 100 - 100).toFixed(1)}%`;

export default function EquityCurve({
  data,
  title = "Equity Curve",
  lines = DEFAULT_LINES,
}: Props) {
  const sampled = downsample(data);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={sampled} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} minTickGap={60} />
          <YAxis tickFormatter={fmtVal} tick={{ fontSize: 11 }} width={52} />
          <Tooltip
            formatter={(v: number | undefined) => `${(((v ?? 1) - 1) * 100).toFixed(2)}%`}
            labelFormatter={(l) => `Date: ${l}`}
          />
          <Legend />
          {lines.map(({ key, color, dashed }) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={color}
              strokeWidth={2}
              dot={false}
              strokeDasharray={dashed ? "5 3" : undefined}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
