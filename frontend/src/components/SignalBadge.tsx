import type { JSX } from 'react'

const BASE = 'inline-flex items-center rounded-full bg-brand-border/50 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap'

const CONFIG: Record<string, { label: string; treatment: string }> = {
  BULLISH: { label: '↑ Bullish', treatment: 'text-brand-positive' },
  BEARISH: { label: '↓ Bearish', treatment: 'text-brand-negative' },
  NEUTRAL: { label: '— Neutral', treatment: 'text-[var(--color-muted)]' },
  OVERBOUGHT: { label: '↑↑ Overbought', treatment: 'text-[var(--color-muted)]' },
  OVERSOLD: { label: '↓↓ Oversold', treatment: 'text-[var(--color-muted)]' },
}

const EMPTY = { label: '—', treatment: 'text-[var(--color-muted)]' }

export function SignalBadge({ state }: { state: string | null }): JSX.Element {
  const config = state === null ? EMPTY : (CONFIG[state] ?? EMPTY)

  return <span className={`${BASE} ${config.treatment}`}>{config.label}</span>
}
