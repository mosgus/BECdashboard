import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { JSX } from 'react'

const TICK = { fontSize: 10, fill: 'var(--color-muted)' }

export default function ScenarioImpactChart({
  data,
  name,
}: {
  data: { ticker: string; pct: number }[]
  name: string
}): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 22)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
        <XAxis type="number" tick={TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
        <YAxis type="category" dataKey="ticker" tick={TICK} width={54} />
        <ReferenceLine x={0} stroke="var(--color-muted)" />
        <Tooltip formatter={(v) => (typeof v === 'number' ? `${v.toFixed(2)}%` : String(v))} />
        <Bar dataKey="pct" name={name} isAnimationActive={false}>
          {data.map((row) => (
            <Cell key={row.ticker} fill={row.pct >= 0 ? 'var(--color-positive)' : 'var(--color-negative)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
