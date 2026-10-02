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
import type { ValuePoint } from '../lib/forecast'
import { formatMoney } from '../lib/optimize'

function compactDollars(value: number): string {
  return Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : `$${value.toFixed(0)}`
}

export default function ForecastChart({
  data,
  initialValue,
  size = 'inline',
}: {
  data: ValuePoint[]
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
            type="number"
            domain={['dataMin', 'dataMax']}
            height={50}
            label={{ value: 'Trading days from the last close', position: 'insideBottom', offset: 8 }}
          />
          <YAxis tickFormatter={compactDollars} domain={['auto', 'auto']} />
          <Area
            dataKey="outer"
            name="5th–95th percentile"
            fill="var(--color-primary)"
            fillOpacity={0.18}
            stroke="none"
            isAnimationActive={false}
          />
          <Area
            dataKey="inner"
            name="25th–75th percentile"
            fill="var(--color-primary)"
            fillOpacity={0.42}
            stroke="none"
            isAnimationActive={false}
          />
          <Line
            dataKey="history"
            name="History"
            stroke="var(--color-muted)"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line dataKey="median" name="Median" stroke="var(--color-primary)" dot={false} isAnimationActive={false} />
          <ReferenceLine y={initialValue} stroke="var(--color-muted)" strokeDasharray="6 3" />
          <ReferenceLine x={0} />
          <Legend />
          <ChartTooltip
            formatter={(value) =>
              Array.isArray(value)
                ? `${formatMoney(value[0])} – ${formatMoney(value[1])}`
                : typeof value === 'number'
                  ? formatMoney(value)
                  : value
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
