import {
  CartesianGrid,
  Legend,
  LabelList,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Symbols,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { LabelProps } from 'recharts'
import type { JSX } from 'react'
import type { CompareFrontierData, CompareFrontierPoint } from '../lib/research'

type ShapeProps = { cx?: number; cy?: number }

function markerShape(type: 'circle' | 'diamond' | 'star', color: string, size: number) {
  return ({ cx = 0, cy = 0 }: ShapeProps): JSX.Element => (
    <Symbols cx={cx} cy={cy} type={type} size={size} fill={color} stroke={color} strokeWidth={1} />
  )
}

// Plain <text> instead of recharts' <Text>, which word-wraps at spaces to the point's width.
// x/y/width/height describe the marker's bounding box (top-left origin), so the centre is x + width / 2.
function renderModeLabel({ x, y, width, height, value }: LabelProps): JSX.Element {
  const cx = Number(x ?? 0) + Number(width ?? 0) / 2
  const cy = Number(y ?? 0) + Number(height ?? 0) / 2
  return (
    <text x={cx} y={cy - 10} textAnchor="middle" fontSize={11} fill="var(--color-foreground)">
      {value}
    </text>
  )
}

function PointTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: CompareFrontierPoint }[]
}): JSX.Element | null {
  const point = payload?.[0]?.payload
  if (!active || point === undefined || point.name === undefined) return null
  return (
    <div className="rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface px-3 py-2 text-xs">
      <div className="font-semibold">{point.name}</div>
      <div>Vol {point.vol.toFixed(1)}%</div>
      <div>Return {point.ret.toFixed(1)}%</div>
    </div>
  )
}

export default function CompareFrontierChart({
  data,
  size = 'inline',
}: {
  data: CompareFrontierData
  size?: 'inline' | 'expanded'
}): JSX.Element {
  return (
    <div className={size === 'expanded' ? 'h-[70vh]' : 'h-[28rem]'}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            type="number"
            dataKey="vol"
            name="Volatility"
            domain={['auto', 'auto']}
            tickFormatter={(value: number) => `${value.toFixed(0)}%`}
            label={{ value: 'Annualized volatility', position: 'insideBottom', offset: -12 }}
          />
          <YAxis
            type="number"
            dataKey="ret"
            name="Average return"
            domain={['auto', 'auto']}
            tickFormatter={(value: number) => `${value.toFixed(0)}%`}
            label={{ value: 'Annualized average return', angle: -90, position: 'insideLeft', offset: -4 }}
          />
          <Legend verticalAlign="top" />
          <ChartTooltip content={<PointTooltip />} />
          {data.cloud.length > 0 && (
            <Scatter
              name="Random portfolios"
              data={data.cloud}
              legendType="circle"
              fill="var(--color-muted)"
              fillOpacity={0.25}
              shape={markerShape('circle', 'var(--color-muted)', 16)}
              isAnimationActive={false}
            />
          )}
          <Scatter
            name="Efficient frontier"
            data={data.curve}
            line={{ stroke: 'var(--color-primary)', strokeWidth: 3 }}
            legendType="line"
            fill="var(--color-primary)"
            shape={markerShape('circle', 'var(--color-primary)', 36)}
            isAnimationActive={false}
          />
          <Scatter
            name="Optimizers"
            data={data.modes}
            legendType="circle"
            fill="var(--color-primary)"
            shape={markerShape('circle', 'var(--color-primary)', 90)}
            isAnimationActive={false}
          >
            <LabelList dataKey="label" content={renderModeLabel} />
          </Scatter>
          {data.current !== null && (
            <Scatter
              name="Current"
              data={[data.current]}
              legendType="circle"
              fill="var(--color-accent)"
              shape={markerShape('circle', 'var(--color-accent)', 220)}
              isAnimationActive={false}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
