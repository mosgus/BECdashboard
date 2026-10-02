import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Symbols,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { JSX } from 'react'
import type { FrontierChartData } from '../lib/optimize'

type ShapeProps = { cx?: number; cy?: number }

function markerShape(type: 'circle' | 'diamond' | 'star', color: string, size: number, hollow = false) {
  return ({ cx = 0, cy = 0 }: ShapeProps): JSX.Element => (
    <Symbols cx={cx} cy={cy} type={type} size={size} fill={hollow ? 'none' : color} stroke={color} strokeWidth={hollow ? 2 : 1} />
  )
}

const MARKERS = {
  Current: { color: 'var(--color-accent)', shape: markerShape('circle', 'var(--color-accent)', 160), legendType: 'circle' as const },
  Optimized: { color: 'var(--color-primary)', shape: markerShape('circle', 'var(--color-primary)', 260, true), legendType: 'circle' as const },
  'Min Variance': { color: 'var(--color-positive)', shape: markerShape('diamond', 'var(--color-positive)', 160), legendType: 'diamond' as const },
  'Max Sharpe': { color: 'var(--color-negative)', shape: markerShape('star', 'var(--color-negative)', 160), legendType: 'star' as const },
}

export default function FrontierChart({ data, size = 'inline' }: {
  data: FrontierChartData
  size?: 'inline' | 'expanded'
}): JSX.Element {
  const optimized = data.markers.find((marker) => marker.name.startsWith('Optimized'))
  const orderedMarkers = [
    optimized,
    data.markers.find((marker) => marker.name === 'Current'),
    data.markers.find((marker) => marker.name === 'Min Variance'),
    data.markers.find((marker) => marker.name === 'Max Sharpe'),
  ].filter((marker): marker is FrontierChartData['markers'][number] => marker !== undefined)

  return (
    <div className={size === 'expanded' ? 'h-[70vh]' : 'h-[28rem]'}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis type="number" dataKey="vol" name="Volatility" domain={['auto', 'auto']} tickFormatter={(value: number) => `${value.toFixed(0)}%`} label={{ value: 'Annualized volatility', position: 'insideBottom', offset: -12 }} />
          <YAxis type="number" dataKey="ret" name="Average return" domain={['auto', 'auto']} tickFormatter={(value: number) => `${value.toFixed(0)}%`} label={{ value: 'Annualized average return', angle: -90, position: 'insideLeft', offset: -4 }} />
          <Legend verticalAlign="top" />
          <ChartTooltip formatter={(value) => typeof value === 'number' ? `${value.toFixed(2)}%` : value} />
          {data.cloud.length > 0 && <Scatter name="Random portfolios" data={data.cloud} legendType="circle" fill="var(--color-muted)" fillOpacity={0.25} shape={markerShape('circle', 'var(--color-muted)', 16)} isAnimationActive={false} />}
          <Scatter name="Efficient frontier" data={data.curve} line={{ stroke: 'var(--color-primary)', strokeWidth: 3 }} legendType="line" fill="var(--color-primary)" shape={markerShape('circle', 'var(--color-primary)', 36)} isAnimationActive={false} />
          {orderedMarkers.map((marker) => {
            const style = marker.name.startsWith('Optimized') ? MARKERS.Optimized : MARKERS[marker.name as 'Current' | 'Min Variance' | 'Max Sharpe']
            return <Scatter key={marker.name} name={marker.name} data={[marker]} fill={style.color} shape={style.shape} legendType={style.legendType} isAnimationActive={false} />
          })}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
