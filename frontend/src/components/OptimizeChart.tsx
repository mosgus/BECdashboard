import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { JSX } from 'react'
import type { CurveRow } from '../lib/optimize'

export default function OptimizeChart({ rows, hasBenchmark, size = 'inline' }: { rows: CurveRow[]; hasBenchmark: boolean; size?: 'inline' | 'expanded' }): JSX.Element {
  return (
    <div className={size === 'expanded' ? 'h-[70vh]' : 'h-[22rem]'}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="date" />
          <YAxis allowDecimals={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} />
          <ReferenceLine y={0} stroke="var(--color-muted)" />
          <Legend />
          <ChartTooltip
            formatter={(value) => (typeof value === 'number' ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : value)}
            contentStyle={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
          <Line
            dataKey="optimized"
            name="Optimized"
            stroke="var(--color-positive)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="current"
            name="Current"
            stroke="var(--color-primary)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
          />
          {hasBenchmark && (
            <Line
              dataKey="benchmark"
              name="SPY"
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
