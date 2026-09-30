import type { JSX } from 'react'
import type { ValuedPortfolio } from '../lib/portfolio'
import { formatPercent, formatShares } from '../lib/format'
import { formatMoney } from '../lib/optimize'
import { Tooltip } from './Tooltip'

interface PositionsTableProps {
  valued: ValuedPortfolio
  onRemove: (ticker: string) => void
}

const TH = 'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap'
const TD = 'px-3 py-2.5 border-b border-brand-border'

export function PositionsTable({ valued, onRemove }: PositionsTableProps): JSX.Element {
  const showMissingWarning = valued.missingTickers.length > 0

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className={TH}>Ticker</th>
              <th className={TH}>Name</th>
              <th className={`${TH} text-right`}>Shares</th>
              <th className={`${TH} text-right`}>Weight</th>
              <th className={TH} aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {valued.rows.map((row) => (
              <tr key={row.ticker}>
                <td className={`${TD} font-mono text-xs whitespace-nowrap ${row.missing ? 'text-brand-negative' : ''}`}>
                  {row.ticker}
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  {row.name ?? (row.missing ? 'No longer in Universe' : '—')}
                </td>
                <td className={`${TD} text-right tabular-nums`}>{row.shares === null ? '—' : formatShares(row.shares)}</td>
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
            ))}
            <tr className="bg-brand-positive/10">
              <td className={`${TD} whitespace-nowrap`}>Cash</td>
              <td className={TD} />
              <td className={valued.cashDollars === null ? TD : `${TD} text-right tabular-nums`}>
                {valued.cashDollars === null ? null : (
                  <Tooltip
                    label={valued.cashFixed
                      ? 'Cash in dollars, saved with this portfolio. It stays fixed while holding weights move with prices.'
                      : "Estimated from your share counts at current prices: cash is this portfolio's cash weight of its implied total value. It moves with prices; it isn't the amount you originally typed."}
                  >
                    <span>{formatMoney(valued.cashDollars)}</span>
                  </Tooltip>
                )}
              </td>
              <td className={`${TD} text-right tabular-nums`}>{formatPercent(valued.cashWeight)}</td>
              <td className={TD} />
            </tr>
            <tr>
              <td className={`${TD} font-semibold`}>Total</td>
              <td className={TD} />
              <td className={TD} />
              <td className={`${TD} text-right tabular-nums font-semibold`}>{formatPercent(100)}</td>
              <td className={TD} />
            </tr>
          </tbody>
        </table>
      </div>

      {showMissingWarning && (
        <p className="text-xs text-brand-negative mt-2">
          {valued.missingTickers.length === 1
            ? `${valued.missingTickers[0]} is no longer in the Universe.`
            : `${valued.missingTickers.join(', ')} are no longer in the Universe.`}
        </p>
      )}
    </div>
  )
}
