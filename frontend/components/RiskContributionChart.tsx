"use client";
import type { RiskContribution } from "@/types/sprint7";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface Props {
  contributions: RiskContribution[];
}

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
  payload?: RiskContribution & { weight_pct: number; rc_pct: number };
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-md text-xs">
      <p className="font-semibold text-[var(--color-text)] mb-1">{label}</p>
      <p className="text-[var(--color-muted)]">Weight: {(row.weight * 100).toFixed(1)}%</p>
      {row.rc != null && (
        <p className="text-[var(--color-text)]">
          Risk Contrib: {(row.rc * 100).toFixed(1)}%
        </p>
      )}
      {row.mctr != null && (
        <p className="text-[var(--color-muted)]">MCTR: {row.mctr.toFixed(4)}</p>
      )}
    </div>
  );
}

export default function RiskContributionChart({ contributions }: Props) {
  const data = contributions
    .filter((r) => r.rc != null)
    .slice(0, 20)
    .map((r) => ({
      ...r,
      weight_pct: parseFloat((r.weight * 100).toFixed(2)),
      rc_pct: parseFloat(((r.rc ?? 0) * 100).toFixed(2)),
    }));

  if (!data.length) {
    return (
      <p className="text-sm text-[var(--color-muted)] py-4 text-center">
        Insufficient data to compute risk contributions.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 24, bottom: 4, left: 64 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
        <XAxis
          type="number"
          unit="%"
          tick={{ fontSize: 11, fill: "var(--color-muted)" }}
          domain={[0, "auto"]}
        />
        <YAxis
          type="category"
          dataKey="ticker"
          tick={{ fontSize: 11, fill: "var(--color-text)" }}
          width={56}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="weight_pct" name="Weight %" fill="var(--color-primary)" opacity={0.35} radius={[0, 3, 3, 0]} />
        <Bar dataKey="rc_pct" name="Risk Contrib %" fill="var(--color-primary)" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
