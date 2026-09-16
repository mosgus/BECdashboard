import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { getStrip } from '../api/client'
import type { StripQuote } from '../api/client'
import { priceChange } from '../lib/change'
import { Tooltip } from './Tooltip'

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const INDEX_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const MIN_DURATION_SECONDS = 60
const SECONDS_PER_ITEM = 5

function quoteDisplay(quote: StripQuote): { priceLabel: string; pctLabel: string; colorClass: string } {
  if (quote.price === null) {
    return { priceLabel: '—', pctLabel: '', colorClass: 'text-[var(--color-muted)]' }
  }

  // priceChange takes (current, lastClose); reconstructing lastClose from price - change lets
  // this reuse its rounded-direction rule instead of reimplementing it.
  const lastClose = quote.change === null ? null : quote.price - quote.change
  const { direction, label } = priceChange(quote.price, lastClose)
  const colorClass =
    direction === 'up'
      ? 'text-brand-positive'
      : direction === 'down'
        ? 'text-brand-negative'
        : 'text-[var(--color-muted)]'

  const priceLabel =
    quote.quote_type === 'INDEX'
      ? INDEX_FORMATTER.format(quote.price)
      : CURRENCY_FORMATTER.format(quote.price)

  return { priceLabel, pctLabel: label, colorClass }
}

function TickerCell({ quote }: { quote: StripQuote }): JSX.Element {
  const { priceLabel, pctLabel, colorClass } = quoteDisplay(quote)

  return (
    <Tooltip label={`${quote.name} (${quote.ticker}) — price and day change`}>
      <span className="inline-flex items-center gap-2 whitespace-nowrap px-6 text-sm">
        <span className="font-semibold text-brand-primary">{quote.name}</span>
        <span className="text-[var(--color-muted)]">({quote.ticker})</span>
        <span className="text-[var(--color-muted)]">{priceLabel}</span>
        {pctLabel && <span className={colorClass}>{pctLabel}</span>}
      </span>
    </Tooltip>
  )
}

export function TickerStrip(): JSX.Element | null {
  const [quotes, setQuotes] = useState<StripQuote[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    getStrip()
      .then((response) => {
        if (cancelled) return
        setQuotes(response.groups.flatMap((group) => group.today))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (failed || quotes.length === 0) return null

  const durationSeconds = Math.max(MIN_DURATION_SECONDS, quotes.length * SECONDS_PER_ITEM)

  return (
    <section className="border-b border-brand-border">
      <style>{`
        @keyframes ticker-strip-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .ticker-strip-marquee {
          animation-name: ticker-strip-scroll;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .ticker-strip-track:hover .ticker-strip-marquee {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .ticker-strip-marquee {
            animation: none;
            overflow-x: auto;
          }
        }
      `}</style>
      <div className="ticker-strip-track overflow-hidden">
        <div
          className="ticker-strip-marquee flex w-max items-center py-2"
          style={{ animationDuration: `${durationSeconds}s` }}
        >
          {quotes.map((quote) => (
            <TickerCell key={quote.ticker} quote={quote} />
          ))}
          {quotes.map((quote) => (
            <TickerCell key={`${quote.ticker}-repeat`} quote={quote} />
          ))}
        </div>
      </div>
    </section>
  )
}
