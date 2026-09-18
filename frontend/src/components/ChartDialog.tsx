import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'
import { ApiError, deleteTicker, getHistory } from '../api/client'
import type { PriceBar, UniverseEntry } from '../api/client'
import { formatPrice } from '../lib/format'
import { DEFAULT_RANGE, RANGE_KEYS, hasEnoughData, sliceRange, withLiveQuote } from '../lib/ranges'
import type { RangeKey } from '../lib/ranges'
import { Tooltip } from './Tooltip'

interface ChartDialogProps {
  ticker: string | null
  entry: UniverseEntry | null
  onClose: () => void
  onDeleted: () => void
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; bars: PriceBar[] }

type DeleteState =
  | { status: 'idle' }
  | { status: 'deleting' }
  | { status: 'error'; message: string }

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

export function ChartDialog({ ticker, entry, onClose, onDeleted }: ChartDialogProps): JSX.Element | null {
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' })
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteState, setDeleteState] = useState<DeleteState>({ status: 'idle' })
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  // The keydown listener below is attached once per `ticker` change (see that effect's own
  // comment for why) but must always act on the *current* confirmOpen — a ref sidesteps the
  // stale-closure problem without adding confirmOpen to that effect's deps, which would also
  // re-run the focus-capture logic in there every time the confirmation opens or closes.
  const confirmOpenRef = useRef(false)

  useEffect(() => {
    confirmOpenRef.current = confirmOpen
  }, [confirmOpen])

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
    setConfirmOpen(false)
    setDeleteState({ status: 'idle' })
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
      if (event.key !== 'Escape') return
      // Escape closes whichever layer is on top. With the confirmation open, it must close
      // only that — not the chart underneath, which would leave nothing to return focus to
      // and orphan the confirmation's own cleanup.
      if (confirmOpenRef.current) {
        setConfirmOpen(false)
        return
      }
      handleClose()
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

  async function handleDelete(currentTicker: string): Promise<void> {
    setDeleteState({ status: 'deleting' })
    try {
      await deleteTicker(currentTicker)
      setConfirmOpen(false)
      setDeleteState({ status: 'idle' })
      onDeleted()
      onClose()
    } catch (err) {
      const message = err instanceof ApiError || err instanceof Error ? err.message : 'Failed to delete ticker.'
      setDeleteState({ status: 'error', message })
    }
  }

  if (ticker === null) return null

  const bars = fetchState.status === 'loaded' ? fetchState.bars : []
  const lastBarDate = bars.length > 0 ? parseLocalDate(bars[bars.length - 1].date) : null
  // entry.current_price is the only signal the client needs — it is already null outside
  // market hours or when the stored quote is stale, so no market-hours logic lives here.
  // UniverseEntry carries no explicit quote timestamp, so "today" (UTC) labels the live
  // point; market hours never span a UTC day boundary, so this never disagrees with ET.
  const currentPrice = entry?.current_price ?? null
  const asOfISODate = new Date().toISOString().slice(0, 10)
  const shown = lastBarDate
    ? withLiveQuote(sliceRange(bars, range, lastBarDate), currentPrice, asOfISODate)
    : []

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

  // The header price is the last point of the *plotted* series, not the raw tail bar — during
  // market hours that's the live quote withLiveQuote appended/replaced in, not yesterday's close.
  const headerPrice = shown.length > 0 ? shown[shown.length - 1].close : null

  const closes = shown.map((bar) => bar.close).filter((c): c is number => c !== null)
  const yMin = closes.length > 0 ? Math.min(...closes) : 0
  const yMax = closes.length > 0 ? Math.max(...closes) : 1
  const yPad = (yMax - yMin) * 0.08 || 1
  const xAxisInterval = shown.length > 0 ? Math.max(0, Math.ceil(shown.length / 5) - 1) : 0

  const yTicks = (() => {
    if (yMin === yMax) return []
    const range = yMax - yMin
    return [
      yMin + range * 0.25,
      yMin + range * 0.5,
      yMin + range * 0.75,
      yMax + yPad,
    ]
  })()

  return (
    <div
      className="fixed inset-0 bg-overlay flex items-center justify-center px-4 z-[100] overflow-y-auto"
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
        className={`${CARD} w-full max-w-[80rem] flex flex-col shadow-xl mb-16`}
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
              <div className="text-2xl font-semibold tabular-nums leading-tight">{formatPrice(headerPrice)}</div>
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
            <ResponsiveContainer width="100%" height={500}>
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
                  domain={[yMin, yMax + yPad]}
                  ticks={yTicks}
                  tickFormatter={(value: number) => formatPrice(value)}
                  tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
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

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
          <div className="flex flex-wrap gap-1">
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

          <Tooltip label={`Permanently delete ${ticker} and all of its stored data`}>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-btn)] border border-brand-border text-[var(--color-muted)] hover:bg-brand-negative hover:text-white"
            >
              Delete ticker
            </button>
          </Tooltip>
        </div>
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 bg-overlay flex items-center justify-center px-4 z-[110]"
          onClick={(event) => {
            if (event.target === event.currentTarget && deleteState.status !== 'deleting') {
              setConfirmOpen(false)
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-ticker-heading"
            className={`${CARD} w-full max-w-sm p-5 shadow-xl`}
          >
            <h2 id="delete-ticker-heading" className="font-heading font-bold text-lg text-foreground mb-2">
              Delete {ticker}?
            </h2>
            <p className="text-sm text-[var(--color-muted)] leading-relaxed mb-4">
              Permanently delete <strong className="text-foreground">{ticker}</strong>?{' '}
              {entry ? (
                <>This removes its {entry.bar_count.toLocaleString()} stored price bars, fundamentals and latest quote.</>
              ) : (
                <>This removes its stored price bars, fundamentals and latest quote.</>
              )}{' '}
              Re-adding it later refetches ten years of history.
            </p>

            {deleteState.status === 'error' && (
              <p className="text-sm text-brand-negative mb-4">{deleteState.message}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                disabled={deleteState.status === 'deleting'}
                onClick={() => setConfirmOpen(false)}
                className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteState.status === 'deleting'}
                onClick={() => void handleDelete(ticker)}
                className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-negative text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteState.status === 'deleting' ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
