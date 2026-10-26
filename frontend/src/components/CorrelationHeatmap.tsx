import type { JSX } from 'react'
import type { Correlation } from '../api/client'
import { correlationCellBackground } from '../lib/research'

export function CorrelationHeatmap({ correlation }: { correlation: Correlation }): JSX.Element {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]">
          <thead>
            <tr>
              <th />
              {correlation.tickers.map((ticker) => (
                <th
                  key={ticker}
                  className="px-1 pb-1 font-medium text-[var(--color-muted)]"
                  style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}
                >
                  {ticker}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {correlation.tickers.map((rowTicker, i) => (
              <tr key={rowTicker}>
                <th className="whitespace-nowrap pr-2 text-right font-medium text-[var(--color-muted)]">{rowTicker}</th>
                {correlation.tickers.map((colTicker, j) =>
                  i === j ? (
                    <td key={colTicker} className="h-7 w-9 min-w-9 border border-brand-border" />
                  ) : (
                    <td
                      key={colTicker}
                      className="h-7 w-9 min-w-9 border border-brand-border text-center tabular-nums"
                      style={{ background: correlationCellBackground(correlation.matrix[i][j]) }}
                    >
                      {correlation.matrix[i][j].toFixed(2)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--color-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-6 border border-brand-border"
            style={{ background: correlationCellBackground(1) }}
          />
          Move together (+1)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-6 border border-brand-border"
            style={{ background: correlationCellBackground(-1) }}
          />
          Move opposite (−1)
        </span>
      </div>
    </div>
  )
}
