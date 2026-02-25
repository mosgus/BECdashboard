"use client";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { ForecastPoint } from "@/types/sprint6";

interface Props {
  data: ForecastPoint[];
  title: string;
  yLabel?: string;
  height?: number;
}

function fmt(v: number | null | undefined, decimals = 3): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number | null }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const fields = [
    { key: "actual", label: "Actual" },
    { key: "p90",    label: "P90" },
    { key: "p75",    label: "P75" },
    { key: "p50",    label: "Median" },
    { key: "p25",    label: "P25" },
    { key: "p10",    label: "P10" },
  ];
  const byName = Object.fromEntries(payload.map((p) => [p.name, p.value]));
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-[var(--color-text)]">{label}</p>
      {fields.map(({ key, label: l }) =>
        byName[key] != null ? (
          <p key={key} className="text-[var(--color-muted)]">
            {l}: <span className="font-medium text-[var(--color-text)]">{fmt(byName[key])}</span>
          </p>
        ) : null
      )}
    </div>
  );
}

export default function FanChart({ data, title, yLabel, height = 260 }: Props) {
  // Find last date with 'actual' value (the forecast cutoff)
  const lastActualIdx = data.reduce((acc, pt, i) => (pt.actual != null ? i : acc), -1);
  const lastActualDate = lastActualIdx >= 0 ? data[lastActualIdx].date : undefined;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      {yLabel && <p className="mb-1 text-xs text-[var(--color-muted)]">{yLabel}</p>}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => d.slice(0, 7)}
            tick={{ fontSize: 11 }}
            minTickGap={60}
          />
          <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v: number) => v.toFixed(2)} />
          <Tooltip content={<CustomTooltip />} />

          {/* Outer band: P90 filled, P10 masked with bg */}
          <Area
            dataKey="p90"
            name="p90"
            fill="var(--color-primary)"
            fillOpacity={0.10}
            stroke="none"
            isAnimationActive={false}
          />
          <Area
            dataKey="p10"
            name="p10"
            fill="var(--color-surface)"
            fillOpacity={1.0}
            stroke="none"
            isAnimationActive={false}
          />
          {/* Inner band: P75 filled, P25 masked */}
          <Area
            dataKey="p75"
            name="p75"
            fill="var(--color-primary)"
            fillOpacity={0.18}
            stroke="none"
            isAnimationActive={false}
          />
          <Area
            dataKey="p25"
            name="p25"
            fill="var(--color-surface)"
            fillOpacity={1.0}
            stroke="none"
            isAnimationActive={false}
          />

          {/* Median forecast */}
          <Line
            type="monotone"
            dataKey="p50"
            name="p50"
            stroke="var(--color-primary)"
            strokeDasharray="5 3"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {/* Historical actual */}
          <Line
            type="monotone"
            dataKey="actual"
            name="actual"
            stroke="var(--color-text)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />

          {/* Forecast cutoff line */}
          {lastActualDate && (
            <ReferenceLine
              x={lastActualDate}
              strokeDasharray="3 2"
              stroke="var(--color-muted)"
              label={{ value: "Forecast →", position: "insideTopRight", fontSize: 10 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
