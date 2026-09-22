import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { getReturns, getUniverse } from '../../api/client'
import type { TickerReturns, UniverseEntry } from '../../api/client'
import { Tooltip } from '../../components/Tooltip'
import { priceChange } from '../../lib/change'
import { formatPercent, formatPrice, formatShares } from '../../lib/format'
import { positionPrice, valuePortfolio } from '../../lib/portfolio'
import { isLegacyPortfolio, listPortfolios } from '../../lib/portfolioStore'

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T }

const TH = 'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap'
const TD = 'px-3 py-2.5 border-b border-brand-border'
const MUTED = 'text-[var(--color-muted)]'

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
  const rows = valuePortfolio(current, universeByTicker).rows
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

      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] border-collapse text-sm">
            <thead>
              <tr className="bg-brand-surface">
                <th className={TH}>Ticker</th>
                <th className={TH}>Name</th>
                <th className={`${TH} text-right`}>
                  <Tooltip label="The saved allocation. It does not change as prices move.">
                    <span>Weight %</span>
                  </Tooltip>
                </th>
                <th className={`${TH} text-right`}>Shares</th>
                <th className={`${TH} text-right`}>Price</th>
                <th className={`${TH} text-right`}>Day</th>
                {['5D', '30D', 'YTD'].map((label) => (
                  <th key={label} className={`${TH} text-right`}>
                    <Tooltip label="Total return including dividends, from stored price history.">
                      <span>{label}</span>
                    </Tooltip>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const entry = universeByTicker.get(row.ticker)
                const tickerReturns = returnsByTicker.get(row.ticker)
                const change = priceChange(
                  entry?.current_price ?? null,
                  entry?.last_close ?? null,
                  entry?.prior_close,
                )
                const day = change.label || '—'

                return (
                  <tr key={row.ticker}>
                    <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>{row.ticker}</td>
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
                    <td className={`${TD} text-right tabular-nums whitespace-nowrap ${change.live ? signedColor(change.percent) : MUTED}`}>
                      {day}
                    </td>
                    <ReturnCell value={tickerReturns?.five_day ?? null} />
                    <ReturnCell value={tickerReturns?.thirty_day ?? null} />
                    <ReturnCell value={tickerReturns?.ytd ?? null} />
                  </tr>
                )
              })}
              <tr className="border-t-2 border-brand-border">
                <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>CASH</td>
                <td className={`${TD} ${MUTED}`}>—</td>
                <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatPercent(current.cashWeight)}</td>
                <td className={`${TD} text-right ${MUTED}`}>—</td>
                <td className={`${TD} text-right ${MUTED}`}>—</td>
                <td className={`${TD} text-right ${MUTED}`}>—</td>
                <td className={`${TD} text-right ${MUTED}`}>—</td>
                <td className={`${TD} text-right ${MUTED}`}>—</td>
                <td className={`${TD} text-right ${MUTED}`}>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
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
