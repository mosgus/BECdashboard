import {
  CartesianGrid,
  LabelList,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { JSX } from 'react'
import type { CalChartData } from '../lib/capm'

export default function CapmChart({ data, size = 'inline' }: { data: CalChartData; size?: 'inline' | 'expanded' }): JSX.Element {
  return (
    <div className={size === 'expanded' ? 'h-[70vh]' : 'h-[22rem]'}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis type="number" dataKey="vol" name="Volatility" tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={[0, 'auto']} />
          <YAxis type="number" dataKey="ret" name="Expected return" tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} />
          {data.line.length === 2 && <ReferenceLine segment={[{ x: data.line[0].vol, y: data.line[0].ret }, { x: data.line[1].vol, y: data.line[1].ret }]} stroke="var(--color-primary)" strokeDasharray="6 3" ifOverflow="extendDomain" />}
          <Legend />
          <ChartTooltip
            formatter={(value) => typeof value === 'number' ? `${value.toFixed(2)}%` : value}
            contentStyle={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
          <Scatter name="Holdings" data={data.assets} fill="var(--color-muted)" isAnimationActive={false}>
            <LabelList dataKey="ticker" position="top" fontSize={10} fill="var(--color-muted)" />
          </Scatter>
          <Scatter name="Current" data={[data.current]} fill="var(--color-accent)" isAnimationActive={false} />
          <Scatter name="Target" data={[data.target]} fill="var(--color-positive)" shape="star" isAnimationActive={false} />
          <Scatter name="Risk-free" data={[data.rf]} fill="var(--color-primary)" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
