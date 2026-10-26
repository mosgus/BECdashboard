import { lazy, Suspense, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { attributionPortfolio, performancePortfolio } from '../../api/client'
import type { AttributionResponse, PerformanceResponse } from '../../api/client'
import { Tooltip } from '../../components/Tooltip'
import { attributionFootnote, attributionSummary, loadingRows } from '../../lib/attribution'
import { performanceRows, performanceSummary } from '../../lib/performance'
import { profileRequest, profileWindow, rollingVol } from '../../lib/tickerProfile'

const SeriesChart = lazy(() => import('../../components/SeriesChart'))

type RunState<T> = { status: 'running' } | { status: 'error'; message: string } | { status: 'ready'; response: T }
// Results are tagged with the request they answer, so a stale one reads as running without a reset inside the effect.
type Tagged<T> = { key: string; state: Exclude<RunState<T>, { status: 'running' }> }

const tone = {
  positive: 'text-brand-positive',
  negative: 'text-brand-negative',
  default: '',
  muted: 'text-[var(--color-muted)]',
} as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed.'
}

interface Props {
  symbol: string
  start: string
  end: string
  firstBarDate: string | null | undefined
}

export function RiskProfileSection({ symbol, start, end, firstBarDate }: Props): JSX.Element {
  const [performanceResult, setPerformanceResult] = useState<Tagged<PerformanceResponse> | null>(null)
  const [attributionResult, setAttributionResult] = useState<Tagged<AttributionResponse> | null>(null)
  const loadingHistory = firstBarDate === undefined
  const window = loadingHistory ? null : profileWindow(start, end, firstBarDate)
  const windowStart = window?.ok ? window.start : null
  const windowEnd = window?.ok ? window.end : null
  const requestKey = `${symbol}|${windowStart}|${windowEnd}`
  const performance: RunState<PerformanceResponse> =
    performanceResult?.key === requestKey ? performanceResult.state : { status: 'running' }
  const attribution: RunState<AttributionResponse> =
    attributionResult?.key === requestKey ? attributionResult.state : { status: 'running' }

  useEffect(() => {
    if (windowStart === null || windowEnd === null) return
    let cancelled = false
    const body = profileRequest(symbol, windowStart, windowEnd)
    const key = `${symbol}|${windowStart}|${windowEnd}`

    void performancePortfolio(body)
      .then((response) => {
        if (!cancelled) setPerformanceResult({ key, state: { status: 'ready', response } })
      })
      .catch((error: unknown) => {
        if (!cancelled) setPerformanceResult({ key, state: { status: 'error', message: errorMessage(error) } })
      })
    void attributionPortfolio(body)
      .then((response) => {
        if (!cancelled) setAttributionResult({ key, state: { status: 'ready', response } })
      })
      .catch((error: unknown) => {
        if (!cancelled) setAttributionResult({ key, state: { status: 'error', message: errorMessage(error) } })
      })

    return () => {
      cancelled = true
    }
  }, [symbol, windowStart, windowEnd])

  const loading = <p className="text-xs text-[var(--color-muted)]">Loading…</p>

  return (
    <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          <Tooltip label="This ticker alone, bought at the start of the window and held, compared with SPY. Same engine as the portfolio Performance and Factor Attribution tabs.">
            <span>Risk &amp; Factor Profile</span>
          </Tooltip>
        </h2>
      </div>

      {loadingHistory ? (
        loading
      ) : window !== null && !window.ok ? (
        <p className="text-xs text-[var(--color-muted)]">{window.message}</p>
      ) : (
        <>
          <div className="space-y-1 text-xs text-[var(--color-muted)]">
            {performance.status === 'ready' && <p>{performanceSummary(performance.response)}</p>}
            {window?.ok && window.clamped && (
              <p>
                {symbol} has stored prices only from {window.start}, so the window starts there.
              </p>
            )}
          </div>

          {performance.status === 'running' && loading}
          {performance.status === 'error' && <p className="text-xs text-brand-negative">{performance.message}</p>}
          {performance.status === 'ready' && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-brand-border text-[var(--color-muted)]">
                    <tr>
                      <th className="py-2 text-left font-medium">Metric</th>
                      <th className="py-2 text-right font-medium">{symbol}</th>
                      <th className="py-2 text-right font-medium">{performance.response.market_ticker}</th>
                      <th className="py-2 text-right font-medium">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performanceRows(performance.response, symbol).map((row) => (
                      <tr key={row.label} className="border-b border-brand-border">
                        <td className="py-2">
                          <Tooltip label={row.tooltip}>
                            <span>{row.label}</span>
                          </Tooltip>
                        </td>
                        <td className={`py-2 text-right tabular-nums font-semibold ${tone[row.portfolioTone]}`}>
                          {row.portfolio}
                        </td>
                        <td className="py-2 text-right tabular-nums text-[var(--color-muted)]">{row.benchmark}</td>
                        <td
                          className={`py-2 text-right tabular-nums ${row.diffTone === 'muted' ? '' : 'font-bold'} ${tone[row.diffTone]}`}
                        >
                          {row.diff}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {performance.response.warnings.map((warning) => (
                <p key={warning} className="text-xs text-[var(--color-muted)]">
                  {warning}
                </p>
              ))}
              <RollingVolatility symbol={symbol} response={performance.response} />
            </>
          )}

          {attribution.status === 'running' && loading}
          {attribution.status === 'error' && <p className="text-xs text-brand-negative">{attribution.message}</p>}
          {attribution.status === 'ready' && <Loadings symbol={symbol} response={attribution.response} />}
        </>
      )}
    </section>
  )
}

function RollingVolatility({ symbol, response }: { symbol: string; response: PerformanceResponse }): JSX.Element {
  const points = rollingVol(response.path)
  if (points.length === 0) {
    return (
      <p className="text-xs text-[var(--color-muted)]">
        Not enough history in this window for a 63-day rolling volatility.
      </p>
    )
  }
  return (
    <Suspense fallback={<p className="text-xs text-[var(--color-muted)]">Loading chart…</p>}>
      <SeriesChart
        title={`${symbol} — Rolling 63-day volatility`}
        valueName="Volatility"
        points={points}
        plain
        formatValue={(v) => `${(v * 100).toFixed(1)}%`}
      />
    </Suspense>
  )
}

function Loadings({ symbol, response }: { symbol: string; response: AttributionResponse }): JSX.Element {
  const rows = loadingRows(response)
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        <Tooltip
          label={`OLS slopes from regressing ${symbol}'s daily return minus the T-bill rate on Mkt-RF, SMB and HML. ★ marks |t| > 1.96. These are plain OLS standard errors, which overstate significance somewhat when daily returns are autocorrelated.`}
        >
          <span>Factor Loadings (Fama-French 3)</span>
        </Tooltip>
      </h3>
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[10rem_4rem_6rem] gap-3 text-xs">
          <span className="text-[var(--color-muted)]">{row.label}</span>
          <span className="font-mono">{row.betaText}</span>
          <span className="text-[var(--color-muted)]">{row.tText}</span>
        </div>
      ))}
      {rows.some((row) => !row.significant) && (
        <p className="text-xs text-[var(--color-muted)]">
          Loadings without ★ can&apos;t be told apart from zero over this window. Treat them as noise, not a tilt.
        </p>
      )}
      <p className="text-sm">{attributionSummary(response, symbol)}</p>
      <p className="text-xs text-[var(--color-muted)]">{attributionFootnote(response)}</p>
      {response.warnings.map((warning) => (
        <p key={warning} className="text-xs text-[var(--color-muted)]">
          {warning}
        </p>
      ))}
    </div>
  )
}
