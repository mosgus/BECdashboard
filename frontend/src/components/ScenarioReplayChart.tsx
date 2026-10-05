import {
  Area,
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
import type { replayCurve } from '../lib/scenarios'

const TICK = { fontSize: 10, fill: 'var(--color-muted)' }
const pct = (v: unknown): string => (typeof v === 'number' ? `${v.toFixed(2)}%` : String(v))

export default function ScenarioReplayChart({
  data,
  marketTicker,
  gain,
}: {
  data: ReturnType<typeof replayCurve>
  marketTicker: string
  gain: boolean
}): JSX.Element {
  const hasMarket = data.some((point) => point.market !== null)
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="date" tick={TICK} tickFormatter={(d: string) => d.slice(0, 7)} minTickGap={40} />
        <YAxis yAxisId="left" tick={TICK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={TICK}
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          domain={[(min: number) => Math.min(min, 0), 0]}
        />
        <ReferenceLine yAxisId="left" y={0} stroke="var(--color-muted)" />
        <Area
          yAxisId="right"
          dataKey="drawdown"
          name="Drawdown"
          fill="var(--color-negative)"
          fillOpacity={0.15}
          stroke="none"
          isAnimationActive={false}
        />
        <Line
          yAxisId="left"
          dataKey="ret"
          name="Return"
          stroke={gain ? 'var(--color-positive)' : 'var(--color-negative)'}
          dot={false}
          isAnimationActive={false}
        />
        {hasMarket && (
          <Line
            yAxisId="left"
            dataKey="market"
            name={marketTicker}
            stroke="var(--color-muted)"
            strokeDasharray="6 3"
            dot={false}
            isAnimationActive={false}
          />
        )}
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Tooltip formatter={pct} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
