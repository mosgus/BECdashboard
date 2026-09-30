import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getReturns, getSignals, getUniverse } from '../../api/client'
import type { TickerReturns, TickerSignals, UniverseEntry } from '../../api/client'
import { SignalBadge } from '../../components/SignalBadge'
import { PortfolioCharts } from '../../components/PortfolioCharts'
import { Tooltip } from '../../components/Tooltip'
import HelpSidebar from '../../components/HelpSidebar'
import { priceChange } from '../../lib/change'
import { formatPercent, formatPrice, formatShares } from '../../lib/format'
import { formatMoney } from '../../lib/optimize'
import { positionPrice, valuePortfolio } from '../../lib/portfolio'
import { isLegacyPortfolio, listPortfolios } from '../../lib/portfolioStore'

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T }

const TH = 'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap'
const TD = 'px-3 py-2.5 border-b border-brand-border'
const MUTED = 'text-[var(--color-muted)]'
const SIGNAL_OPTIONS = [
  { value: 'sma_cross', label: 'SMA Cross' },
  { value: 'rsi_threshold', label: 'RSI' },
  { value: 'macd_cross', label: 'MACD' },
] as const

function signedColor(value: number | null): string {
  if (value === null) return MUTED
  const rounded = Math.round(value * 100) / 100
  if (rounded > 0) return 'text-brand-positive'
  if (rounded < 0) return 'text-brand-negative'
  return MUTED
}

export function HoldingsPage(): JSX.Element {
  const { portfolioId } = useParams()
  const portfolio = listPortfolios().find((candidate) => candidate.id === portfolioId)
  const current = portfolio === undefined || isLegacyPortfolio(portfolio) ? null : portfolio
  const tickerKey = current === null ? null : current.positions.map((position) => position.ticker).join(',')
  const [universe, setUniverse] = useState<LoadState<UniverseEntry[]>>({ status: 'loading' })
  const [returns, setReturns] = useState<LoadState<TickerReturns[]>>({ status: 'loading' })
  const [signals, setSignals] = useState<LoadState<TickerSignals[]>>({ status: 'loading' })
  const [selectedSignal, setSelectedSignal] = useState<(typeof SIGNAL_OPTIONS)[number]['value']>('sma_cross')

  useEffect(() => {
    if (tickerKey === null) return
    let cancelled = false
    const tickers = tickerKey === '' ? [] : tickerKey.split(',')

    void getUniverse()
      .then((entries) => {
        if (!cancelled) setUniverse({ status: 'ready', data: entries })
      })
      .catch(() => {
        if (!cancelled) setUniverse({ status: 'error' })
      })

    void getReturns(tickers)
      .then((response) => {
        if (!cancelled) setReturns({ status: 'ready', data: response.returns })
      })
      .catch(() => {
        if (!cancelled) setReturns({ status: 'error' })
      })

    void getSignals(tickers)
      .then((response) => {
        if (!cancelled) setSignals({ status: 'ready', data: response.signals })
      })
      .catch(() => {
        if (!cancelled) setSignals({ status: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [tickerKey])

  if (current === null) return <></>

  const universeByTicker = new Map(
    universe.status === 'ready' ? universe.data.map((entry) => [entry.ticker, entry]) : [],
  )
  const returnsByTicker = new Map(
    returns.status === 'ready' ? returns.data.map((entry) => [entry.ticker, entry]) : [],
  )
  const signalsByTicker = new Map(
    signals.status === 'ready' ? signals.data.map((entry) => [entry.ticker, entry]) : [],
  )
  const selectedOption = SIGNAL_OPTIONS.find((option) => option.value === selectedSignal) ?? SIGNAL_OPTIONS[0]
  const selectedSignalLabel =
    signals.status === 'ready'
      ? signals.data
          .flatMap((entry) => entry.signals)
          .find((signal) => signal.signal === selectedSignal)?.label ?? selectedOption.label
      : selectedOption.label
  const valued = valuePortfolio(current, universeByTicker)
  const rows = valued.rows
    .slice()
    .sort((left, right) => right.weight - left.weight)

  return (
    <div>
      {universe.status === 'error' && (
        <p className="text-sm text-brand-negative mb-3">
          The Universe could not be reached. Saved allocations and share counts are still shown.
        </p>
      )}
      {returns.status === 'error' && (
        <p className="text-sm text-brand-negative mb-3">Returns could not be loaded.</p>
      )}
      {signals.status === 'error' && (
        <p className="text-sm text-brand-negative mb-3">Signals could not be loaded.</p>
      )}

      <div className="flex items-center justify-end gap-2 mb-3">
        <Tooltip label="Choose which technical signal the table shows for every holding">
          <select
            value={selectedSignal}
            onChange={(event) => setSelectedSignal(event.target.value as (typeof SIGNAL_OPTIONS)[number]['value'])}
            className="text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground"
          >
            {SIGNAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </Tooltip>
        <HelpSidebar />
      </div>

      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] border-collapse text-sm">
            <thead>
              <tr className="bg-brand-surface">
                <th className={TH}>Ticker</th>
                <th className={TH}>Name</th>
                <th className={`${TH} text-right`}>
                  <Tooltip
                    label={valued.cashFixed
                      ? "Each holding's share of the portfolio at the last loaded prices. Share counts and cash dollars are fixed; weights move with prices."
                      : 'The saved allocation. It does not change as prices move.'}
                  >
                    <span>Weight %</span>
                  </Tooltip>
                </th>
                <th className={`${TH} text-right`}>Shares</th>
                <th className={`${TH} text-right`}>Price</th>
                <th className={`${TH} text-right`}>
                  <Tooltip label="Change from the last close. When the market is closed this is the last completed session's move.">
                    <span>Day</span>
                  </Tooltip>
                </th>
                {['5D', 'YTD'].map((label) => (
                  <th key={label} className={`${TH} text-right`}>
                    <Tooltip label="Total return including dividends, from stored price history.">
                      <span>{label}</span>
                    </Tooltip>
                  </th>
                ))}
                <th className={TH}>
                  <Tooltip label="Computed from stored price history. ATR is average true range as a percentage of price — it measures volatility, not direction.">
                    <span>Signal ({selectedSignalLabel})</span>
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const entry = universeByTicker.get(row.ticker)
                const tickerReturns = returnsByTicker.get(row.ticker)
                const tickerSignals = signalsByTicker.get(row.ticker)
                const change = priceChange(
                  entry?.current_price ?? null,
                  entry?.last_close ?? null,
                  entry?.prior_close,
                )
                const day = change.label || '—'

                return (
                  <tr key={row.ticker}>
                    <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>
                      <Tooltip label="Open this ticker's detail page">
                        <Link to={`/ticker/${row.ticker}?from=/portfolios/${current.id}/holdings`} className="hover:text-brand-primary">
                          {row.ticker}
                        </Link>
                      </Tooltip>
                    </td>
                    <td
                      className={`${TD} max-w-[14rem] overflow-hidden text-ellipsis whitespace-nowrap`}
                      title={row.name ?? undefined}
                    >
                      {row.name ?? '—'}
                    </td>
                    <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatPercent(row.weight)}</td>
                    <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                      {row.shares === null ? '—' : formatShares(row.shares)}
                    </td>
                    <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                      {formatPrice(positionPrice(entry))}
                    </td>
                    <td className={`${TD} text-right tabular-nums whitespace-nowrap ${signedColor(change.percent)}`}>
                      {day}
                    </td>
                    <ReturnCell value={tickerReturns?.five_day ?? null} />
                    <ReturnCell value={tickerReturns?.ytd ?? null} />
                    <SignalCell tickerSignals={tickerSignals} selectedSignal={selectedSignal} />
                  </tr>
                )
              })}
              <tr className="border-t-2 border-brand-border bg-brand-positive/10">
                <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>CASH</td>
                <td className={`${TD} ${MUTED}`}>—</td>
                <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatPercent(current.cashWeight)}</td>
                {valued.cashDollars === null ? (
                  <td className={`${TD} text-right ${MUTED}`}>—</td>
                ) : (
                  <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                    <Tooltip
                      label={valued.cashFixed
                        ? 'Cash in dollars, saved with this portfolio. It stays fixed while holding weights move with prices.'
                        : "Estimated from your share counts at current prices: cash is this portfolio's cash weight of its implied total value. It moves with prices; it isn't the amount you originally typed."}
                    >
                      <span>{formatMoney(valued.cashDollars)}</span>
                    </Tooltip>
                  </td>
                )}
                <td className={`${TD} text-right ${MUTED}`}>—</td>
                <td className={`${TD} text-right ${MUTED}`}>—</td>
                <td className={`${TD} text-right ${MUTED}`}>—</td>
                <td className={`${TD} text-right ${MUTED}`}>—</td>
                <td className={`${TD} ${MUTED}`}>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <PortfolioCharts key={current.id} portfolio={current} />
    </div>
  )
}

function ReturnCell({ value }: { value: number | null }): JSX.Element {
  return (
    <td className={`${TD} text-right tabular-nums whitespace-nowrap ${signedColor(value)}`}>
      {formatPercent(value)}
    </td>
  )
}

function SignalCell({
  tickerSignals,
  selectedSignal,
}: {
  tickerSignals: TickerSignals | undefined
  selectedSignal: string
}): JSX.Element {
  const signal = tickerSignals?.signals.find((candidate) => candidate.signal === selectedSignal)
  if (tickerSignals === undefined || signal === undefined) return <td className={`${TD} ${MUTED}`}>—</td>

  return (
    <td className={`${TD} whitespace-nowrap`}>
      <div className="flex items-center gap-2">
        <SignalBadge state={signal.state} />
        {tickerSignals.atr_pct !== null && (
          <span className={`text-xs tabular-nums ${MUTED}`}>ATR {formatPercent(tickerSignals.atr_pct)}</span>
        )}
      </div>
    </td>
  )
}
