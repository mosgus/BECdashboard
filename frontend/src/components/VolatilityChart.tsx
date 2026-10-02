import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { JSX } from 'react'
import { formatVol } from '../lib/forecast'
import type { VolChartPoint } from '../lib/forecast'

export default function VolatilityChart({
  data,
  lookbackVol,
  size = 'inline',
}: {
  data: VolChartPoint[]
  lookbackVol: number
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
          <YAxis tickFormatter={formatVol} domain={[0, 'auto']} />
          <Line
            dataKey="realised"
            name="Realised (21-day)"
            stroke="var(--color-muted)"
            connectNulls
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="forecast"
            name="Forecast"
            stroke="var(--color-primary)"
            connectNulls
            dot={false}
            isAnimationActive={false}
          />
          <ReferenceLine y={lookbackVol} label="Lookback average" stroke="var(--color-muted)" strokeDasharray="6 3" />
          <ReferenceLine x={0} />
          <Legend />
          <Tooltip formatter={(value) => (typeof value === 'number' ? formatVol(value) : value)} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
