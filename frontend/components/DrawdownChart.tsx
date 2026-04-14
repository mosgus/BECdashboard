"use client";
import { TimePoint } from "@/types/portfolio";
import { downsample } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Props {
  data: TimePoint[];
  dataKey?: string;
  title?: string;
  color?: string;
  label?: string;
}

export default function DrawdownChart({
  data,
  dataKey = "dd",
  title = "Drawdown",
  color = "#ef4444",
  label = "Drawdown",
}: Props) {
  const sampled = downsample(data);
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={sampled} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={60} tickFormatter={(d) => d.slice(0, 7)} />
          <YAxis tickFormatter={fmtPct} tick={{ fontSize: 11 }} width={52} />
          <Tooltip formatter={(v: unknown) => fmtPct(Number(v) || 0)} labelFormatter={(l) => `Date: ${l}`} />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            fill={`url(#grad-${dataKey})`}
            strokeWidth={1.5}
            dot={false}
            name={label}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
