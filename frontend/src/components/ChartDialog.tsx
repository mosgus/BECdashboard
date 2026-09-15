import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'
import { ApiError, getHistory } from '../api/client'
import type { PriceBar, UniverseEntry } from '../api/client'
import { formatPrice } from '../lib/format'
import { DEFAULT_RANGE, RANGE_KEYS, hasEnoughData, sliceRange } from '../lib/ranges'
import type { RangeKey } from '../lib/ranges'
import { Tooltip } from './Tooltip'

interface ChartDialogProps {
  ticker: string | null
  entry: UniverseEntry | null
  onClose: () => void
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; bars: PriceBar[] }

const RANGE_TOOLTIPS: Record<RangeKey, string> = {
  '10Y': 'Show the last 10 years',
  '5Y': 'Show the last 5 years',
  '1Y': 'Show the last year',
  YTD: 'Show this year so far',
  '6M': 'Show the last 6 months',
  '3M': 'Show the last 3 months',
  '1M': 'Show the last month',
  '5D': 'Show the last 5 days',
}

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)]'

function parseLocalDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

interface ChartTooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ value?: number | string }>
}

function ChartTooltipContent({ active, label, payload }: ChartTooltipProps): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null
  const value = payload[0]?.value
  if (typeof value !== 'number') return null
  return (
    <div className="bg-brand-surface border border-brand-border text-xs px-2 py-1 rounded-[var(--radius-btn)] shadow-sm">
      <span className="text-[var(--color-muted)]">{label}</span>{' '}
      <span className="font-semibold tabular-nums">{formatPrice(value)}</span>
    </div>
  )
}

export function ChartDialog({ ticker, entry, onClose }: ChartDialogProps): JSX.Element | null {
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' })
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  function load(currentTicker: string): void {
    setFetchState({ status: 'loading' })
    getHistory(currentTicker)
      .then((result) => setFetchState({ status: 'loaded', bars: result.bars }))
      .catch((err: unknown) => {
        const message = err instanceof ApiError || err instanceof Error ? err.message : 'Failed to load price history.'
        setFetchState({ status: 'error', message })
      })
  }

  useEffect(() => {
    if (ticker === null) return
    setRange(DEFAULT_RANGE)
    load(ticker)
    // load() is intentionally excluded — it's a stable function of `ticker`, which is already
    // the effect's own dependency; re-including it would just be re-listing the same trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker])

  useEffect(() => {
    if (ticker === null) return

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker])

  function handleClose(): void {
    onClose()
  }

  if (ticker === null) return null

  const bars = fetchState.status === 'loaded' ? fetchState.bars : []
  const lastBarDate = bars.length > 0 ? parseLocalDate(bars[bars.length - 1].date) : null
  const shown = lastBarDate ? sliceRange(bars, range, lastBarDate) : []

  let changeNode: JSX.Element | null = null
  if (shown.length >= 2) {
    const first = shown[0].close
    const last = shown[shown.length - 1].close
    if (first !== null && last !== null) {
      const delta = last - first
      const pct = first !== 0 ? (delta / first) * 100 : 0
      const positive = delta >= 0
      changeNode = (
        <div className={`text-xs tabular-nums mt-1 ${positive ? 'text-brand-positive' : 'text-brand-negative'}`}>
          {positive ? '+' : ''}
          {delta.toFixed(2)} ({positive ? '+' : ''}
          {pct.toFixed(2)}%) · {range}
        </div>
      )
    }
  }

  const lastClose = bars.length > 0 ? bars[bars.length - 1].close : null

  const closes = shown.map((bar) => bar.close).filter((c): c is number => c !== null)
  const yMin = closes.length > 0 ? Math.min(...closes) : 0
  const yMax = closes.length > 0 ? Math.max(...closes) : 1
  const yPad = (yMax - yMin) * 0.08 || 1
  const xAxisInterval = shown.length > 0 ? Math.max(0, Math.ceil(shown.length / 5) - 1) : 0

  return (
    <div
      className="fixed inset-0 bg-foreground/35 flex items-start justify-center pt-16 px-4 z-[100] overflow-y-auto"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${ticker} price chart`}
        tabIndex={-1}
        className={`${CARD} w-full max-w-[56rem] flex flex-col shadow-xl mb-16`}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-[1.125rem] border-b border-brand-border">
          <div>
            <div className="font-heading font-bold text-xl text-brand-primary">{ticker}</div>
            <div className="text-[0.8125rem] text-[var(--color-muted)] mt-1">
              {[entry?.short_name, entry?.sector, entry?.quote_type === 'ETF' ? 'ETF' : 'Equity']
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="text-right">
              <div className="text-2xl font-semibold tabular-nums leading-tight">{formatPrice(lastClose)}</div>
              {changeNode}
            </div>
            <Tooltip label="Close this chart">
              <button
                type="button"
                onClick={handleClose}
                className="text-lg leading-none text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground px-1.5 py-1 rounded-[var(--radius-btn)]"
              >
                ×
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="px-5 pt-4 pb-1">
          {fetchState.status === 'loading' && (
            <div className="h-[320px] flex items-center justify-center text-sm text-[var(--color-muted)]">
              Loading chart…
            </div>
          )}

          {fetchState.status === 'error' && (
            <div className="h-[320px] flex flex-col items-center justify-center gap-3 text-sm text-[var(--color-muted)]">
              <p>{fetchState.message}</p>
              <button
                type="button"
                onClick={() => load(ticker)}
                className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
              >
                Retry
              </button>
            </div>
          )}

          {fetchState.status === 'loaded' && shown.length < 2 && (
            <div className="h-[320px] flex items-center justify-center text-sm text-[var(--color-muted)]">
              Not enough data in range.
            </div>
          )}

          {fetchState.status === 'loaded' && shown.length >= 2 && (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={shown} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <XAxis
                  dataKey="date"
                  tickFormatter={(value: string) => value.slice(0, 7)}
                  interval={xAxisInterval}
                  tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
                  axisLine={{ stroke: 'var(--color-border)' }}
                  tickLine={false}
                />
                <YAxis
                  domain={[yMin - yPad, yMax + yPad]}
                  tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <RechartsTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="var(--color-primary)"
                  strokeWidth={1.6}
                  fill="var(--color-primary)"
                  fillOpacity={0.06}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flex flex-wrap gap-1 px-5 py-4">
          {RANGE_KEYS.map((key) => {
            const disabled = lastBarDate === null || !hasEnoughData(bars, key, lastBarDate)
            const active = key === range
            return (
              <Tooltip key={key} label={RANGE_TOOLTIPS[key]}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setRange(key)}
                  className={`text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-btn)] border border-transparent ${
                    active
                      ? 'bg-brand-primary text-white'
                      : 'text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'
                  } disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent ${disabled ? 'pointer-events-none' : ''}`}
                >
                  {key}
                </button>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </div>
  )
}
