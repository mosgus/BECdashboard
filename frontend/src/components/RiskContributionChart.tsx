import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { JSX } from 'react'
import type { healthChartData } from '../lib/health'

type ChartData = ReturnType<typeof healthChartData>

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { payload?: ChartData[number] }[]
  label?: string
}): JSX.Element | null {
  const row = payload?.[0]?.payload
  if (!active || row === undefined) return null
  return (
    <div className="rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface p-3 text-xs shadow-md">
      <p className="mb-1 font-semibold">{label}</p>
      <p className="text-[var(--color-muted)]">Weight: {row.weightPct.toFixed(1)}%</p>
      <p>Risk contribution: {row.rcPct.toFixed(1)}%</p>
      {row.mctr !== null && <p className="text-[var(--color-muted)]">MCTR: {row.mctr.toFixed(4)}</p>}
    </div>
  )
}

export default function RiskContributionChart({ data }: { data: ChartData }): JSX.Element {
  if (data.length === 0)
    return (
      <p className="py-4 text-center text-sm text-[var(--color-muted)]">
        Insufficient data to compute risk contributions.
      </p>
    )
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 64 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
        <XAxis type="number" unit="%" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} domain={[0, 'auto']} />
        <YAxis type="category" dataKey="ticker" tick={{ fontSize: 11, fill: 'var(--color-text)' }} width={56} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          dataKey="weightPct"
          name="Weight %"
          fill="var(--color-primary)"
          opacity={0.35}
          radius={[0, 3, 3, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="rcPct"
          name="Risk Contrib %"
          fill="var(--color-primary)"
          radius={[0, 3, 3, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
