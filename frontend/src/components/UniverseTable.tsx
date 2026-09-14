import type { JSX } from 'react'
import type { UniverseEntry } from '../api/client'
import { formatCount, formatDateRange, formatMarketCap, formatPercent, formatPrice, formatRatio } from '../lib/format'

interface UniverseTableProps {
  rows: UniverseEntry[]
}

const TH = 'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-4 py-3 border-b border-brand-border whitespace-nowrap overflow-hidden'
const TD = 'px-4 py-[13px] border-b border-brand-border'
const NOWRAP = 'whitespace-nowrap'
const CLIP = 'whitespace-nowrap overflow-hidden text-ellipsis'

function TypePill({ quoteType }: { quoteType: string | null }): JSX.Element {
  const isEtf = quoteType === 'ETF'
  return (
    <span
      className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${
        isEtf ? 'bg-brand-primary/10 text-brand-primary' : 'bg-brand-border text-[var(--color-muted)]'
      }`}
    >
      {isEtf ? 'ETF' : 'Equity'}
    </span>
  )
}

export function UniverseTable({ rows }: UniverseTableProps): JSX.Element {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] overflow-hidden">
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="bg-brand-surface">
            <th className={`${TH} w-[22%] sm:w-[10%] lg:w-[7%]`}>Ticker</th>
            <th className={`${TH} w-[48%] sm:w-[26%] md:w-[19%] lg:w-[18%]`}>Name</th>
            <th className={`${TH} hidden sm:table-cell sm:w-[10%]`}>Type</th>
            <th className={`${TH} hidden md:table-cell md:w-[15%] lg:w-[11%]`}>Sector</th>
            <th className={`${TH} text-right w-[30%] sm:w-[12%]`}>Price</th>
            <th className={`${TH} text-right hidden lg:table-cell lg:w-[9%]`}>Mkt Cap</th>
            <th className={`${TH} text-right hidden lg:table-cell lg:w-[7%]`}>P/E</th>
            <th className={`${TH} text-right hidden md:table-cell md:w-[8%]`}>Yield</th>
            <th className={`${TH} text-right hidden sm:table-cell sm:w-[7%]`}>Bars</th>
            <th className={`${TH} hidden lg:table-cell lg:w-[20%]`}>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ticker} className="last:[&>td]:border-b-0 hover:bg-brand-border/40">
              <td className={`${TD} ${NOWRAP} font-semibold text-brand-primary`}>{row.ticker}</td>
              <td className={`${TD} ${CLIP}`}>{row.short_name ?? '—'}</td>
              <td className={`${TD} ${NOWRAP} hidden sm:table-cell`}>
                <TypePill quoteType={row.quote_type} />
              </td>
              <td className={`${TD} ${CLIP} hidden md:table-cell text-[var(--color-muted)]`}>
                {row.sector ?? '—'}
              </td>
              <td className={`${TD} ${NOWRAP} text-right tabular-nums`}>
                {formatPrice(row.regular_market_price)}
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
              <td className={`${TD} ${NOWRAP} text-right tabular-nums hidden sm:table-cell`}>
                {formatCount(row.bar_count)}
              </td>
              <td className={`${TD} ${CLIP} hidden lg:table-cell text-xs text-[var(--color-muted)]`}>
                {formatDateRange(row.first_bar, row.last_bar)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
