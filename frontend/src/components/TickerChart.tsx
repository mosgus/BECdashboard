import type { JSX } from 'react'
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { IndicatorsResponse, PriceBar } from '../api/client'
import { downsample, priceDomain } from '../lib/chart'
import { formatPrice } from '../lib/format'

interface TickerChartProps {
  ticker: string
  bars: PriceBar[]
  indicators?: IndicatorsResponse
}

interface ChartTooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ value?: number | string; name?: string; color?: string }>
  format: (value: number) => string
}

interface ChartPoint {
  date: string
  adj_close: number
  [key: string]: string | number | number[] | null
}

function ChartTooltip({ active, label, payload, format }: ChartTooltipProps): JSX.Element | null {
  const rows = payload?.filter((entry): entry is { value: number; name?: string; color?: string } => typeof entry.value === 'number') ?? []
  if (!active || rows.length === 0) return null

  return (
    <div className="bg-brand-surface border border-brand-border text-xs px-2 py-1 rounded-[var(--radius-btn)] shadow-sm space-y-1">
      <p className="text-[var(--color-muted)]">{label}</p>
      {rows.map((entry, index) => (
        <p key={`${entry.name ?? 'series'}-${index}`} className="flex justify-between gap-4 tabular-nums" style={{ color: entry.color }}>
          <span>{entry.name ?? 'Series'}</span>
          <span className="font-semibold">{format(entry.value)}</span>
        </p>
      ))}
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

export default function TickerChart({ ticker, bars, indicators }: TickerChartProps): JSX.Element {
  const points = bars.filter((bar): bar is PriceBar & { adj_close: number } => bar.adj_close !== null)
  const indicatorDates = indicators?.dates ?? []
  const seriesByKey = new Map<string, Map<string, number | null>>()
  const labelsByKey = new Map<string, string>()

  for (const indicator of indicators?.series ?? []) {
    const valuesByDate = new Map<string, number | null>()
    indicatorDates.forEach((date, index) => valuesByDate.set(date, indicator.points[index] ?? null))
    seriesByKey.set(indicator.key, valuesByDate)
    labelsByKey.set(indicator.key, indicator.label)
  }

  const seriesName = (key: string): string => labelsByKey.get(key) ?? key
  const chartData: ChartPoint[] = points.map((bar) => {
    const point: ChartPoint = { date: bar.date, adj_close: bar.adj_close }
    for (const [key, valuesByDate] of seriesByKey) {
      point[key] = valuesByDate.get(bar.date) ?? null
    }
    const lower = point.bollinger_lower
    const upper = point.bollinger_upper
    point.bollinger_band =
      typeof lower === 'number' && typeof upper === 'number' ? [lower, upper] : null
    return point
  })
  const renderedData = downsample(chartData)
  const priceYDomain = priceDomain(renderedData)
  const showAdxPane = seriesByKey.has('adx')
  const showStochasticPane = seriesByKey.has('stochastic_k')
  const showObvPane = seriesByKey.has('obv')

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{ticker} — Price &amp; Moving Averages</h3>
        <div className="h-[22rem]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={renderedData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <ChartXAxis />
              <ChartYAxis domain={priceYDomain} />
              <Tooltip content={<ChartTooltip format={formatPrice} />} />
              <Legend />
              <Area
                type="monotone"
                dataKey="adj_close"
                name="Price"
                stroke="var(--color-primary)"
                strokeWidth={1.6}
                fill="var(--color-primary)"
                fillOpacity={0.06}
                dot={false}
                isAnimationActive={false}
              />
              {seriesByKey.has('sma_fast') && <Line type="monotone" dataKey="sma_fast" name={seriesName('sma_fast')} stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} />}
              {seriesByKey.has('sma_slow') && <Line type="monotone" dataKey="sma_slow" name={seriesName('sma_slow')} stroke="var(--color-negative)" strokeWidth={1.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} />}
              {seriesByKey.has('ema_fast') && <Line type="monotone" dataKey="ema_fast" name={seriesName('ema_fast')} stroke="var(--color-accent)" strokeWidth={1.4} dot={false} isAnimationActive={false} />}
              {seriesByKey.has('ema_slow') && <Line type="monotone" dataKey="ema_slow" name={seriesName('ema_slow')} stroke="var(--color-accent)" strokeWidth={1.2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />}
              {seriesByKey.has('bollinger_upper') && <Area type="monotone" dataKey="bollinger_band" name="Bollinger (20, 2σ)" stroke="none" fill="var(--color-muted)" fillOpacity={0.14} dot={false} isAnimationActive={false} legendType="none" />}
              {seriesByKey.has('bollinger_middle') && <Line type="monotone" dataKey="bollinger_middle" name={seriesName('bollinger_middle')} stroke="var(--color-muted)" strokeWidth={1.2} dot={false} isAnimationActive={false} />}
              {seriesByKey.has('donchian_upper') && <Line type="monotone" dataKey="donchian_upper" name={seriesName('donchian_upper')} stroke="var(--color-positive)" strokeWidth={1.1} strokeDasharray="4 2" dot={false} isAnimationActive={false} />}
              {seriesByKey.has('donchian_mid') && <Line type="monotone" dataKey="donchian_mid" name={seriesName('donchian_mid')} stroke="var(--color-positive)" strokeWidth={1.1} strokeDasharray="2 2" dot={false} isAnimationActive={false} />}
              {seriesByKey.has('donchian_lower') && <Line type="monotone" dataKey="donchian_lower" name={seriesName('donchian_lower')} stroke="var(--color-positive)" strokeWidth={1.1} strokeDasharray="4 2" dot={false} isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">RSI (14)</h3>
          <div className="h-[12rem]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={renderedData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <ChartXAxis />
                <ChartYAxis domain={[0, 100]} width={40} tickFormatter={(value) => String(value)} />
                <Tooltip content={<ChartTooltip format={(value) => value.toFixed(2)} />} />
                <ReferenceLine y={70} stroke="var(--color-negative)" strokeDasharray="4 2" label={{ value: 'OB 70', fontSize: 10 }} />
                <ReferenceLine y={30} stroke="var(--color-positive)" strokeDasharray="4 2" label={{ value: 'OS 30', fontSize: 10 }} />
                {seriesByKey.has('rsi') && <Line type="monotone" dataKey="rsi" name={seriesName('rsi')} stroke="var(--color-primary)" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">MACD (12, 26, 9)</h3>
          <div className="h-[12rem]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={renderedData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <ChartXAxis />
                <ChartYAxis domain={['auto', 'auto']} width={56} />
                <Tooltip content={<ChartTooltip format={(value) => value.toFixed(2)} />} />
                <ReferenceLine y={0} stroke="var(--color-border)" />
                {seriesByKey.has('macd_histogram') && <Bar dataKey="macd_histogram" name={seriesName('macd_histogram')} fill="var(--color-muted)" radius={[1, 1, 0, 0]} isAnimationActive={false} />}
                {seriesByKey.has('macd_line') && <Line type="monotone" dataKey="macd_line" name={seriesName('macd_line')} stroke="var(--color-primary)" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
                {seriesByKey.has('macd_signal') && <Line type="monotone" dataKey="macd_signal" name={seriesName('macd_signal')} stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {showAdxPane && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">ADX (14) — Trend Strength</h3>
          <div className="h-[12rem]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={renderedData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <ChartXAxis />
                <ChartYAxis domain={[0, 100]} width={40} tickFormatter={(value) => String(value)} />
                <Tooltip content={<ChartTooltip format={(value) => value.toFixed(2)} />} />
                <ReferenceLine y={25} stroke="var(--color-accent)" strokeDasharray="4 2" label={{ value: 'Trending 25', fontSize: 10 }} />
                <Line type="monotone" dataKey="adx" name={seriesName('adx')} stroke="var(--color-primary)" strokeWidth={1.4} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {showStochasticPane && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Stochastic (14, 3, 3)</h3>
          <div className="h-[12rem]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={renderedData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <ChartXAxis />
                <ChartYAxis domain={[0, 100]} width={40} tickFormatter={(value) => String(value)} />
                <Tooltip content={<ChartTooltip format={(value) => value.toFixed(2)} />} />
                <ReferenceLine y={80} stroke="var(--color-negative)" strokeDasharray="4 2" label={{ value: 'OB 80', fontSize: 10 }} />
                <ReferenceLine y={20} stroke="var(--color-positive)" strokeDasharray="4 2" label={{ value: 'OS 20', fontSize: 10 }} />
                <Line type="monotone" dataKey="stochastic_k" name={seriesName('stochastic_k')} stroke="var(--color-accent)" strokeWidth={1.4} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="stochastic_d" name={seriesName('stochastic_d')} stroke="var(--color-accent)" strokeWidth={1.1} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {showObvPane && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">On-Balance Volume (OBV)</h3>
          <div className="h-[12rem]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={renderedData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <ChartXAxis />
                <ChartYAxis domain={['auto', 'auto']} width={72} tickFormatter={(value) => `${(value / 1_000_000).toFixed(1)}M`} />
                <Tooltip content={<ChartTooltip format={(value) => `${(value / 1_000_000).toFixed(1)}M`} />} />
                <Line type="monotone" dataKey="obv" name={seriesName('obv')} stroke="var(--color-positive)" strokeWidth={1.4} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
