import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { JSX } from 'react'
import type { comparisonRows } from '../lib/scenarios'

const TICK = { fontSize: 10, fill: 'var(--color-muted)' }

export default function ScenarioComparisonChart({ data }: { data: ReturnType<typeof comparisonRows> }): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="name" tick={TICK} angle={-25} textAnchor="end" interval={0} height={80} />
        <YAxis tick={TICK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
        <ReferenceLine y={0} stroke="var(--color-muted)" />
        <Tooltip formatter={(v) => (typeof v === 'number' ? `${v.toFixed(2)}%` : String(v))} />
        <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="totalReturn" name="Total Return" isAnimationActive={false}>
          {data.map((row, i) => (
            <Cell
              key={`${row.name}-${i}`}
              fill={row.totalReturn >= 0 ? 'var(--color-positive)' : 'var(--color-negative)'}
            />
          ))}
        </Bar>
        <Bar dataKey="maxDrawdown" name="Max Drawdown" fill="var(--color-accent)" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}
