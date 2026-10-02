import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { JSX } from 'react'
import type { FanPoint } from '../lib/monteCarlo'
import { formatMoney } from '../lib/optimize'

function compactDollars(value: number): string {
  return Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : `$${value.toFixed(0)}`
}

export default function MonteCarloChart({ data, initialValue, size = 'inline' }: {
  data: FanPoint[]
  initialValue: number
  size?: 'inline' | 'expanded'
}): JSX.Element {
  return (
    <div className={size === 'expanded' ? 'h-[70vh]' : 'h-[22rem]'}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="day"
            height={50}
            label={{ value: 'Trading days ahead', position: 'insideBottom', offset: 8 }}
          />
          <YAxis tickFormatter={compactDollars} domain={['auto', 'auto']} />
          <Area dataKey="outer" name="5th–95th percentile" fill="var(--color-primary)" fillOpacity={0.18} stroke="none" isAnimationActive={false} />
          <Area dataKey="inner" name="25th–75th percentile" fill="var(--color-primary)" fillOpacity={0.42} stroke="none" isAnimationActive={false} />
          <Line dataKey="median" name="Median" stroke="var(--color-primary)" dot={false} isAnimationActive={false} />
          <ReferenceLine y={initialValue} stroke="var(--color-muted)" strokeDasharray="6 3" />
          <Legend />
          <ChartTooltip formatter={(value) => Array.isArray(value)
            ? `${formatMoney(value[0])} – ${formatMoney(value[1])}`
            : typeof value === 'number' ? formatMoney(value) : value} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
