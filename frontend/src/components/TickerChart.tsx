import type { JSX } from 'react'
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { IndicatorsResponse, PriceBar } from '../api/client'
import { formatPrice } from '../lib/format'

interface TickerChartProps {
  bars: PriceBar[]
  indicators?: IndicatorsResponse
}

interface ChartTooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ value?: number | string }>
}

interface ChartPoint {
  date: string
  adj_close: number
  [key: string]: string | number | null
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

function ChartXAxis(): JSX.Element {
  return (
    <XAxis
      dataKey="date"
      tickFormatter={(value: string) => value.slice(0, 7)}
      minTickGap={48}
      tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
      axisLine={{ stroke: 'var(--color-border)' }}
      tickLine={false}
    />
  )
}

function ChartYAxis({
  domain,
  width = 56,
  tickFormatter = formatPrice,
}: {
  domain?: [number | 'auto', number | 'auto']
  width?: number
  tickFormatter?: (value: number) => string
}): JSX.Element {
  return (
    <YAxis
      domain={domain}
      tickFormatter={tickFormatter}
      tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
      axisLine={false}
      tickLine={false}
      width={width}
    />
  )
}

export default function TickerChart({ bars, indicators }: TickerChartProps): JSX.Element {
  const points = bars.filter((bar): bar is PriceBar & { adj_close: number } => bar.adj_close !== null)
  const prices = points.map((bar) => bar.adj_close)
  const minimum = Math.min(...prices)
  const maximum = Math.max(...prices)
  const padding = (maximum - minimum) * 0.08 || 1
  const indicatorDates = indicators?.dates ?? []
  const seriesByKey = new Map<string, Map<string, number | null>>()

  for (const indicator of indicators?.series ?? []) {
    const valuesByDate = new Map<string, number | null>()
    indicatorDates.forEach((date, index) => valuesByDate.set(date, indicator.points[index] ?? null))
    seriesByKey.set(indicator.key, valuesByDate)
  }

  const chartData: ChartPoint[] = points.map((bar) => {
    const point: ChartPoint = { date: bar.date, adj_close: bar.adj_close }
    for (const [key, valuesByDate] of seriesByKey) {
      point[key] = valuesByDate.get(bar.date) ?? null
    }
    return point
  })
  const showOscillatorPane = seriesByKey.has('adx') || seriesByKey.has('stochastic_k')
  const showObvPane = seriesByKey.has('obv')

  return (
    <div className="space-y-4">
      <div className="h-[22rem]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <ChartXAxis />
            <ChartYAxis domain={[minimum - padding, maximum + padding]} />
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
            {seriesByKey.has('ema_fast') && <Line type="monotone" dataKey="ema_fast" stroke="var(--color-accent)" strokeWidth={1.4} dot={false} isAnimationActive={false} />}
            {seriesByKey.has('ema_slow') && <Line type="monotone" dataKey="ema_slow" stroke="var(--color-accent)" strokeWidth={1.2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />}
            {seriesByKey.has('bollinger_upper') && <Line type="monotone" dataKey="bollinger_upper" stroke="var(--color-muted)" strokeWidth={1.1} strokeDasharray="3 2" dot={false} isAnimationActive={false} />}
            {seriesByKey.has('bollinger_middle') && <Line type="monotone" dataKey="bollinger_middle" stroke="var(--color-muted)" strokeWidth={1.2} dot={false} isAnimationActive={false} />}
            {seriesByKey.has('bollinger_lower') && <Line type="monotone" dataKey="bollinger_lower" stroke="var(--color-muted)" strokeWidth={1.1} strokeDasharray="3 2" dot={false} isAnimationActive={false} />}
            {seriesByKey.has('donchian_upper') && <Line type="monotone" dataKey="donchian_upper" stroke="var(--color-positive)" strokeWidth={1.1} strokeDasharray="4 2" dot={false} isAnimationActive={false} />}
            {seriesByKey.has('donchian_lower') && <Line type="monotone" dataKey="donchian_lower" stroke="var(--color-positive)" strokeWidth={1.1} strokeDasharray="4 2" dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {showOscillatorPane && (
        <div className="h-[8rem]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <ChartXAxis />
              <ChartYAxis domain={[0, 100]} width={40} tickFormatter={(value) => String(value)} />
              <Tooltip />
              {seriesByKey.has('adx') && <Line type="monotone" dataKey="adx" stroke="var(--color-primary)" strokeWidth={1.4} dot={false} isAnimationActive={false} />}
              {seriesByKey.has('stochastic_k') && <Line type="monotone" dataKey="stochastic_k" stroke="var(--color-accent)" strokeWidth={1.4} dot={false} isAnimationActive={false} />}
              {seriesByKey.has('stochastic_d') && <Line type="monotone" dataKey="stochastic_d" stroke="var(--color-accent)" strokeWidth={1.1} strokeDasharray="4 2" dot={false} isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {showObvPane && (
        <div className="h-[8rem]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <ChartXAxis />
              <ChartYAxis domain={['auto', 'auto']} width={72} tickFormatter={(value) => `${(value / 1_000_000).toFixed(1)}M`} />
              <Tooltip />
              <Line type="monotone" dataKey="obv" stroke="var(--color-positive)" strokeWidth={1.4} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
