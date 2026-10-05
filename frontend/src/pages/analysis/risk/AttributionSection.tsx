import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { attributionPortfolio, getUniverse } from '../../../api/client'
import type { AttributionRequest, AttributionResponse } from '../../../api/client'
import { Tooltip } from '../../../components/Tooltip'
import {
  attributionFootnote,
  attributionSummary,
  contributionRows,
  loadingRows,
  signedPct,
} from '../../../lib/attribution'
import { tradeBasis } from '../../../lib/optimize'
import type { TradeBasis } from '../../../lib/optimize'
import { buildPerformanceRequest, samePerformanceRequest } from '../../../lib/performance'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: AttributionResponse; request: AttributionRequest; basis: TradeBasis }
type UniverseState = { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null> }

const SECTION = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4'
const DATE_INPUT =
  'block mt-1 text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground'

export function AttributionSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [universe, setUniverse] = useState<UniverseState>({ status: 'loading' })
  const mountedRef = useRef(true)
  const autoRunRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void getUniverse()
      .then((entries) => {
        if (!cancelled)
          setUniverse({ status: 'ready', lastClose: new Map(entries.map((entry) => [entry.ticker, entry.last_close])) })
      })
      .catch(() => {
        if (!cancelled) setUniverse({ status: 'ready', lastClose: new Map() })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const submit = useCallback((): void => {
    if (portfolio === null || universe.status !== 'ready') return
    const nextBasis = tradeBasis(portfolio, universe.lastClose)
    const built = buildPerformanceRequest(portfolio, { start, end }, nextBasis)
    if (!built.ok) {
      setRun({ status: 'error', message: built.message })
      return
    }
    setRun({ status: 'running' })
    void attributionPortfolio(built.request)
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, request: built.request, basis: nextBasis })
      })
      .catch((error: unknown) => {
        if (mountedRef.current)
          setRun({
            status: 'error',
            message: error instanceof Error ? error.message : 'The attribution request failed.',
          })
      })
  }, [end, portfolio, start, universe])

  useEffect(() => {
    if (universe.status === 'ready' && !autoRunRef.current) {
      autoRunRef.current = true
      submit()
    }
  }, [submit, universe.status])

  if (portfolio === null) return null

  const basis: TradeBasis =
    universe.status === 'ready' ? tradeBasis(portfolio, universe.lastClose) : { kind: 'weights', reason: 'no-shares' }
  const built = buildPerformanceRequest(portfolio, { start, end }, basis)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-[var(--color-muted)]">
          Start (optional)
          <Tooltip label="First day of the window. Leave empty for one year before the end date.">
            <input
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className={DATE_INPUT}
            />
          </Tooltip>
        </label>
        <label className="text-xs font-medium text-[var(--color-muted)]">
          End (optional)
          <Tooltip label="Last day of the window. Leave empty for the latest Fama-French data, which runs about a month behind.">
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className={DATE_INPUT} />
          </Tooltip>
        </label>
        <Tooltip label="Re-run the Fama-French regression for these dates with the current holdings">
          <button
            type="button"
            onClick={submit}
            disabled={run.status === 'running' || universe.status === 'loading'}
            className="inline-flex rounded-[var(--radius-btn)] bg-btn-action px-4 py-2 text-sm font-semibold text-btn-action-text disabled:opacity-50"
          >
            Run Attribution
          </button>
        </Tooltip>
        <Tooltip label="Today's holdings bought at the start of the window and held, not your actual trade history.">
          <span className="rounded-full border border-brand-border px-2 py-1 text-xs text-[var(--color-muted)]">
            Buy &amp; hold
          </span>
        </Tooltip>
      </div>

      {run.status === 'running' && <p className="text-xs text-[var(--color-muted)]">Running Fama-French regression…</p>}
      {run.status === 'error' && <p className="text-brand-negative">{run.message}</p>}
      {run.status === 'ready' && (
        <>
          {(!built.ok || !samePerformanceRequest(built.request, run.request)) && (
            <p className="text-xs text-[var(--color-muted)]">
              Dates or holdings have changed since this run. Click Run Attribution to update.
            </p>
          )}
          <AttributionResults response={run.response} />
        </>
      )}
    </div>
  )
}

function Track({
  leftPct,
  widthPct,
  className,
}: {
  leftPct: number
  widthPct: number
  className: string
}): JSX.Element {
  return (
    <div className="relative h-5 rounded bg-[var(--color-bg)]">
      <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border)]" />
      <div
        className={`absolute inset-y-0 rounded ${className}`}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      />
    </div>
  )
}

function AttributionResults({ response }: { response: AttributionResponse }): JSX.Element {
  return (
    <>
      <section className={SECTION}>
        <h2 className="mb-3 text-sm font-semibold">Attribution Summary</h2>
        <p className="text-sm leading-6">{attributionSummary(response)}</p>
        <p className="mt-3 text-xs text-[var(--color-muted)]">{attributionFootnote(response)}</p>
        {response.warnings.map((warning) => (
          <p key={warning} className="mt-1 text-xs text-[var(--color-muted)]">
            {warning}
          </p>
        ))}
      </section>
      <section className={SECTION}>
        <h2 className="mb-3 text-sm font-semibold">
          <Tooltip label="OLS slopes from regressing the portfolio's daily return minus the T-bill rate on Mkt-RF, SMB and HML. ★ marks |t| > 1.96. These are plain OLS standard errors, which overstate significance somewhat when daily returns are autocorrelated.">
            <span>Factor Loadings (Fama-French 3)</span>
          </Tooltip>
        </h2>
        <div className="space-y-2">
          {loadingRows(response).map((row) => (
            <div key={row.key} className="grid grid-cols-[10rem_1fr_4rem_6rem] items-center gap-3 text-xs">
              <span className="text-[var(--color-muted)]">{row.label}</span>
              <Track
                leftPct={row.leftPct}
                widthPct={row.widthPct}
                className={row.positive ? 'bg-brand-primary' : 'bg-brand-negative'}
              />
              <span className="text-right font-mono">{row.betaText}</span>
              <span className="text-right text-[var(--color-muted)]">{row.tText}</span>
            </div>
          ))}
        </div>
      </section>
      <section className={SECTION}>
        <h2 className="mb-1 text-sm font-semibold">
          <Tooltip label="The period return split into alpha, the three factor exposures, T-bills and the compounding gap. The six rows add up exactly to the total period return.">
            <span>Return Contribution Breakdown</span>
          </Tooltip>
        </h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          Total period return: <strong className="text-foreground">{signedPct(response.period_return)}</strong>
        </p>
        <div className="space-y-2">
          {contributionRows(response).map((row) => (
            <div key={row.key} className="grid grid-cols-[12rem_1fr_5rem] items-center gap-3 text-xs">
              <Tooltip label={row.tooltip}>
                <span className="text-[var(--color-muted)]">{row.label}</span>
              </Tooltip>
              <Track
                leftPct={row.leftPct}
                widthPct={row.widthPct}
                className={row.positive ? 'bg-brand-positive' : 'bg-brand-negative'}
              />
              <span className="text-right font-mono">{row.text}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
