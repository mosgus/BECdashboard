import type { JSX } from 'react'
import type { UniverseEntry } from '../api/client'
import { formatDateRange, formatMarketCap, formatPercent, formatPrice, formatRatio } from '../lib/format'
import { priceChange } from '../lib/change'
import type { ChangeDirection } from '../lib/change'
import { typeLabel } from '../lib/tickerType'
import { DownloadIcon } from './DownloadIcon'
import { Tooltip } from './Tooltip'

interface UniverseTableProps {
  rows: UniverseEntry[]
  onRowClick: (ticker: string) => void
}

const TH = 'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-4 py-3 border-b border-brand-border whitespace-nowrap overflow-hidden'
const TD = 'px-4 py-[13px] border-b border-brand-border'
const NOWRAP = 'whitespace-nowrap'
const CLIP = 'whitespace-nowrap overflow-hidden text-ellipsis'

const CHANGE_COLOR: Record<ChangeDirection, string> = {
  up: 'text-brand-positive',
  down: 'text-brand-negative',
  flat: 'text-[var(--color-muted)]',
}

function TypePill({ quoteType }: { quoteType: string | null }): JSX.Element {
  if (quoteType === null) {
    return <span className="text-[var(--color-muted)]">—</span>
  }

  const isEtf = quoteType === 'ETF'
  return (
    <span
      className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${
        isEtf ? 'bg-brand-primary/10 text-brand-primary' : 'bg-brand-border text-[var(--color-muted)]'
      }`}
    >
      {typeLabel(quoteType)}
    </span>
  )
}

function formatPriceHeaderSuffix(rows: UniverseEntry[]): string {
  const quoteFetchedAt = rows.find((row) => row.quote_fetched_at !== null)?.quote_fetched_at
  if (quoteFetchedAt === undefined || quoteFetchedAt === null) return 'close'
  return new Date(quoteFetchedAt).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function UniverseTable({ rows, onRowClick }: UniverseTableProps): JSX.Element {
  const priceHeaderSuffix = formatPriceHeaderSuffix(rows)

  return (
    <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] overflow-hidden">
      <table className="w-full table-auto border-collapse text-sm">
        <thead>
          <tr className="bg-brand-surface">
            <th className={TH}>Ticker</th>
            <th className={TH}>Name</th>
            <th className={`${TH} hidden sm:table-cell`}>Type</th>
            <th className={`${TH} hidden md:table-cell`}>Sector</th>
            <th className={`${TH} text-right hidden lg:table-cell`}>Last Close</th>
            <th className={`${TH} text-right`}>
              <Tooltip label="Price as of the last quote fetch; refreshes at most every 10 minutes while the market is open">
                <span>
                  Price <span className="text-[10px] text-[var(--color-muted)]">@ {priceHeaderSuffix}</span>
                </span>
              </Tooltip>
            </th>
            <th className={`${TH} text-right hidden lg:table-cell`}>Mkt Cap</th>
            <th className={`${TH} text-right hidden lg:table-cell`}>P/E</th>
            <th className={`${TH} text-right hidden md:table-cell`}>Yield</th>
            <th className={`${TH} hidden xl:table-cell`}>Coverage</th>
            <th className={`${TH} text-right`}>.csv</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const change = priceChange(row.current_price, row.last_close)
            return (
            <tr
              key={row.ticker}
              role="button"
              tabIndex={0}
              onClick={() => onRowClick(row.ticker)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRowClick(row.ticker)
              }}
              className="last:[&>td]:border-b-0 hover:bg-brand-border/40 cursor-pointer"
            >
              <td className={`${TD} ${NOWRAP} font-semibold text-brand-primary`}>
                <Tooltip label="Open this ticker's price chart">
                  <span>{row.ticker}</span>
                </Tooltip>
              </td>
              <td
                className={`${TD} ${CLIP} max-w-[6rem] sm:max-w-[16rem] md:max-w-[10rem] lg:max-w-[14rem] xl:max-w-[16rem]`}
                title={row.short_name ?? undefined}
              >
                {row.short_name ?? '—'}
              </td>
              <td className={`${TD} ${NOWRAP} hidden sm:table-cell`}>
                <TypePill quoteType={row.quote_type} />
              </td>
              <td className={`${TD} ${NOWRAP} hidden md:table-cell text-[var(--color-muted)]`}>
                {row.sector ?? '—'}
              </td>
              <td className={`${TD} ${NOWRAP} text-right tabular-nums hidden lg:table-cell text-[var(--color-muted)]`}>
                <Tooltip label="Closing price of the most recent completed session">
                  <span>{formatPrice(row.last_close)}</span>
                </Tooltip>
              </td>
              <td className={`${TD} ${NOWRAP} text-right tabular-nums`}>
                <Tooltip
                  label={
                    row.current_price !== null
                      ? 'Live price during market hours'
                      : 'Most recent closing price'
                  }
                >
                  <span>
                    {formatPrice(row.current_price ?? row.last_close ?? row.regular_market_price)}
                  </span>
                </Tooltip>{' '}
                <Tooltip
                  label={
                    row.current_price !== null
                      ? 'Change from the last close'
                      : 'Market closed — showing the last close'
                  }
                >
                  <span className={`text-xs ${CHANGE_COLOR[change.direction]}`}>{change.label}</span>
                </Tooltip>
              </td>
              <td className={`${TD} ${NOWRAP} text-right tabular-nums hidden lg:table-cell text-[var(--color-muted)]`}>
                {formatMarketCap(row.market_cap)}
              </td>
              <td className={`${TD} ${NOWRAP} text-right tabular-nums hidden lg:table-cell text-[var(--color-muted)]`}>
                {formatRatio(row.trailing_pe)}
              </td>
              <td className={`${TD} ${NOWRAP} text-right tabular-nums hidden md:table-cell text-[var(--color-muted)]`}>
                {formatPercent(row.dividend_yield)}
              </td>
              <td className={`${TD} ${NOWRAP} hidden xl:table-cell text-xs text-[var(--color-muted)]`}>
                {formatDateRange(row.first_bar, row.last_bar)}
              </td>
              <td className={`${TD} ${NOWRAP} text-right`}>
                <Tooltip label="Download this ticker's full price history as CSV">
                  <a
                    href={`${import.meta.env.VITE_API_URL}/universe/${row.ticker}/history.csv`}
                    aria-label={`Download ${row.ticker} history as CSV`}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex items-center justify-center p-1.5 rounded-[var(--radius-btn)] text-[var(--color-muted)] hover:text-foreground hover:bg-brand-border"
                  >
                    <DownloadIcon />
                  </a>
                </Tooltip>
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
