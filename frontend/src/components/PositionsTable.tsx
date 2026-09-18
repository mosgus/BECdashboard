import type { JSX } from 'react'
import type { ValuedPortfolio } from '../lib/portfolio'
import { formatPercent, formatPrice, formatShares } from '../lib/format'
import { Tooltip } from './Tooltip'

interface PositionsTableProps {
  valued: ValuedPortfolio
  onRemove: (ticker: string) => void
  /** True while the Universe hasn't loaded (yet, or at all) — every row's price/value/weight
   * shows "—" the same way a genuinely deleted ticker's does, but this must NOT read as "this
   * ticker was deleted": no red styling, no "no longer in Universe" text, no entry in the
   * missing-tickers line. That per-row `missing` flag means something different (contract
   * 0038's permanent delete) than "we don't have Universe data right now," and conflating the
   * two would make an offline reload look like every holding vanished. Defaults to false so
   * every other caller (there is only one today) is unaffected. */
  pricingUnavailable?: boolean
}

const TH = 'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap'
const TD = 'px-3 py-2.5 border-b border-brand-border'

export function PositionsTable({ valued, onRemove, pricingUnavailable = false }: PositionsTableProps): JSX.Element {
  const showMissingWarning = !pricingUnavailable && valued.missingTickers.length > 0
  const totalWeightLabel = formatPercent(valued.totalValue > 0 ? 100 : null)

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className={TH}>Ticker</th>
              <th className={TH}>Name</th>
              <th className={`${TH} text-right`}>Shares</th>
              <th className={`${TH} text-right`}>Price</th>
              <th className={`${TH} text-right`}>Value</th>
              <th className={`${TH} text-right`}>Weight</th>
              <th className={TH} aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {valued.rows.map((row) => {
              const flagged = row.missing && !pricingUnavailable
              return (
                <tr key={row.ticker}>
                  <td className={`${TD} font-mono text-xs whitespace-nowrap ${flagged ? 'text-brand-negative' : ''}`}>
                    {row.ticker}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {row.name ?? (flagged ? 'No longer in Universe' : '—')}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{formatShares(row.shares)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatPrice(row.price)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatPrice(row.value)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatPercent(row.weight)}</td>
                  <td className={`${TD} text-right`}>
                    <Tooltip label={`Remove ${row.ticker} from this portfolio`}>
                      <button
                        type="button"
                        onClick={() => onRemove(row.ticker)}
                        className="text-xs font-medium px-2 py-1 rounded-[var(--radius-btn)] text-[var(--color-muted)] hover:text-brand-negative hover:bg-brand-border"
                      >
                        Remove
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              )
            })}
            <tr>
              <td className={`${TD} whitespace-nowrap`}>Cash</td>
              <td className={TD} />
              <td className={TD} />
              <td className={TD} />
              <td className={`${TD} text-right tabular-nums`}>{formatPrice(valued.cash)}</td>
              <td className={`${TD} text-right tabular-nums`}>{formatPercent(valued.cashWeight)}</td>
              <td className={TD} />
            </tr>
            <tr>
              <td className={`${TD} font-semibold`}>Total</td>
              <td className={TD} />
              <td className={TD} />
              <td className={TD} />
              <td className={`${TD} text-right tabular-nums font-semibold`}>{formatPrice(valued.totalValue)}</td>
              <td className={`${TD} text-right tabular-nums font-semibold`}>{totalWeightLabel}</td>
              <td className={TD} />
            </tr>
          </tbody>
        </table>
      </div>

      {showMissingWarning && (
        <p className="text-xs text-brand-negative mt-2">
          {valued.missingTickers.length === 1
            ? `${valued.missingTickers[0]} is no longer in the Universe and was excluded from the total above.`
            : `${valued.missingTickers.join(', ')} are no longer in the Universe and were excluded from the total above.`}
        </p>
      )}
    </div>
  )
}
