import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { JSX } from 'react'

export default function StressChart({
  data,
  marketTicker,
}: {
  data: { date: string; portfolio: number; market: number | null }[]
  marketTicker: string
}): JSX.Element {
  const hasMarket = data.some((point) => point.market !== null)
  return (
    <div className="h-[22rem]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="date" />
          <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} />
          <ReferenceLine y={0} stroke="var(--color-muted)" />
          <Line
            dataKey="portfolio"
            name="Portfolio"
            stroke="var(--color-primary)"
            dot={false}
            isAnimationActive={false}
          />
          {hasMarket && (
            <Line
              dataKey="market"
              name={marketTicker}
              stroke="var(--color-muted)"
              strokeDasharray="6 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Legend />
          <Tooltip formatter={(v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : v)} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
