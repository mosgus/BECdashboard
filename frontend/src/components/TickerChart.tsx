import type { JSX } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PriceBar } from '../api/client'
import { formatPrice } from '../lib/format'

interface TickerChartProps {
  bars: PriceBar[]
}

interface ChartTooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ value?: number | string }>
}

function ChartTooltip({ active, label, payload }: ChartTooltipProps): JSX.Element | null {
  const value = payload?.[0]?.value
  if (!active || typeof value !== 'number') return null

  return (
    <div className="bg-brand-surface border border-brand-border text-xs px-2 py-1 rounded-[var(--radius-btn)] shadow-sm">
      <span className="text-[var(--color-muted)]">{label}</span>{' '}
      <span className="font-semibold tabular-nums">{formatPrice(value)}</span>
    </div>
  )
}

export default function TickerChart({ bars }: TickerChartProps): JSX.Element {
  const points = bars.filter((bar): bar is PriceBar & { adj_close: number } => bar.adj_close !== null)
  const prices = points.map((bar) => bar.adj_close)
  const minimum = Math.min(...prices)
  const maximum = Math.max(...prices)
  const padding = (maximum - minimum) * 0.08 || 1

  return (
    <div className="h-[22rem]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => value.slice(0, 7)}
            minTickGap={48}
            tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickLine={false}
          />
          <YAxis
            domain={[minimum - padding, maximum + padding]}
            tickFormatter={(value: number) => formatPrice(value)}
            tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="adj_close"
            stroke="var(--color-primary)"
            strokeWidth={1.6}
            fill="var(--color-primary)"
            fillOpacity={0.06}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
