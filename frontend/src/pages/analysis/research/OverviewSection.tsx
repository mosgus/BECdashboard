import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import type { AttributionResponse, CompareResponse, PerformanceResponse, RiskResponse } from '../../../api/client'
import {
  cachedAttributionPortfolio,
  cachedComparePortfolio,
  cachedPerformancePortfolio,
  cachedRiskPortfolio,
  cachedUniverse,
} from '../../../lib/sharedRequests'
import { HelpButton } from '../../../components/GuidePanel'
import { Tooltip } from '../../../components/Tooltip'
import { downloadBlob } from '../../../lib/download'
import { holdingsChanged } from '../../../lib/memo'
import { buildEvidence, deriveRedFlags } from '../../../lib/memo'
import type { DecisionMemo, Recommendation } from '../../../lib/memo'
import { listMemos } from '../../../lib/memoStore'
import { overviewTiles, scoreTone, TONE_COLOR } from '../../../lib/overview'
import { tradeBasis } from '../../../lib/optimize'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'
import { buildPerformanceRequest } from '../../../lib/performance'
import { buildCompareRequest, DEFAULT_COMPARE_SETTINGS } from '../../../lib/research'
import { buildRiskRequest, DEFAULT_RISK_SETTINGS } from '../../../lib/risk'
import { computeScore, SCORE_DISCLAIMER } from '../../../lib/score'
import { ScoreGuide } from './ScoreGuide'

type RequestState<T> = { status: 'running' } | { status: 'error'; message: string } | { status: 'ready'; response: T }
type UniverseState = { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null> }

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4'
const TOO_FEW = 'Add at least two holdings to run the holdout comparison.'

const TEXT_CLASS: Record<Recommendation, string> = {
  GO: 'text-brand-positive',
  CONDITIONAL: 'text-foreground',
  'NO-GO': 'text-brand-negative',
}
const TOKEN: Record<Recommendation, string> = {
  GO: 'var(--color-positive)',
  CONDITIONAL: 'var(--color-accent)',
  'NO-GO': 'var(--color-negative)',
}

const COMPONENT_TIPS = {
  diversification: '1 ÷ HHI of the invested money. 20 or more effective holdings scores full points.',
  risk_concentration:
    "The largest single holding's share of portfolio volatility. 10% or less scores full points; 50% or more scores zero.",
  volatility:
    "Portfolio volatility divided by the market's over the same days. Up to 1.0× scores full points; 2.0× or more scores zero.",
  robustness:
    "Years in which this portfolio's holdout Sharpe beat equal weight's (1/N), out of the years that could be tested.",
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function OverviewSection({ onOpenMemo }: { onOpenMemo: () => void }): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const [universe, setUniverse] = useState<UniverseState>({ status: 'loading' })
  const [risk, setRisk] = useState<RequestState<RiskResponse>>({ status: 'running' })
  const [performance, setPerformance] = useState<RequestState<PerformanceResponse>>({ status: 'running' })
  const [compare, setCompare] = useState<RequestState<CompareResponse>>({ status: 'running' })
  const [attribution, setAttribution] = useState<RequestState<AttributionResponse>>({ status: 'running' })
  const [buildingPdf, setBuildingPdf] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [memos] = useState<DecisionMemo[]>(() => listMemos(portfolioId ?? ''))
  const mountedRef = useRef(true)
  const startedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void cachedUniverse()
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

  useEffect(() => {
    if (portfolio === null || universe.status !== 'ready' || startedRef.current) return
    startedRef.current = true
    const basis = tradeBasis(portfolio, universe.lastClose)

    const runRisk = async () => {
      const built = buildRiskRequest(portfolio, DEFAULT_RISK_SETTINGS, basis)
      if (!built.ok) throw new Error(built.message)
      return cachedRiskPortfolio(built.request)
    }
    void runRisk()
      .then((response) => {
        if (mountedRef.current) setRisk({ status: 'ready', response })
      })
      .catch((error: unknown) => {
        if (mountedRef.current) setRisk({ status: 'error', message: errorMessage(error, 'The risk request failed.') })
      })

    void Promise.resolve()
      .then(() => {
        const performanceBuilt = buildPerformanceRequest(portfolio, { start: '', end: '' }, basis)
        if (!performanceBuilt.ok) throw new Error(performanceBuilt.message)
        return performanceBuilt.request
      })
      .then((request) => {
        void cachedPerformancePortfolio(request)
          .then((response) => {
            if (mountedRef.current) setPerformance({ status: 'ready', response })
          })
          .catch((error: unknown) => {
            if (mountedRef.current)
              setPerformance({ status: 'error', message: errorMessage(error, 'The performance request failed.') })
          })
        void cachedAttributionPortfolio(request)
          .then((response) => {
            if (mountedRef.current) setAttribution({ status: 'ready', response })
          })
          .catch((error: unknown) => {
            if (mountedRef.current)
              setAttribution({ status: 'error', message: errorMessage(error, 'The attribution request failed.') })
          })
      })
      .catch((error: unknown) => {
        if (mountedRef.current) {
          const message = errorMessage(error, 'The performance request failed.')
          setPerformance({ status: 'error', message })
          setAttribution({ status: 'error', message })
        }
      })

    if (portfolio.positions.length < 2) {
      return
    } else {
      void cachedComparePortfolio(buildCompareRequest(portfolio, DEFAULT_COMPARE_SETTINGS, basis))
        .then((response) => {
          if (mountedRef.current) setCompare({ status: 'ready', response })
        })
        .catch((error: unknown) => {
          if (mountedRef.current)
            setCompare({ status: 'error', message: errorMessage(error, 'The comparison request failed.') })
        })
    }
  }, [portfolio, universe])

  const compareState: RequestState<CompareResponse> =
    portfolio !== null && portfolio.positions.length < 2 ? { status: 'error', message: TOO_FEW } : compare
  const settled = risk.status !== 'running' && performance.status !== 'running' && compareState.status !== 'running'
  const allRequestsSettled = settled && attribution.status !== 'running'
  const riskResponse = risk.status === 'ready' ? risk.response : null
  const performanceResponse = performance.status === 'ready' ? performance.response : null
  const compareResponse = compareState.status === 'ready' ? compareState.response : null
  const score = useMemo(
    () => (settled ? computeScore(riskResponse, performanceResponse, compareResponse) : null),
    [settled, riskResponse, performanceResponse, compareResponse],
  )
  const keyRisks = useMemo(
    () => (settled ? deriveRedFlags(buildEvidence(riskResponse, compareResponse)) : []),
    [settled, riskResponse, compareResponse],
  )

  if (portfolio === null) return null

  const latestMemo = memos[0]
  const requestErrors = [
    risk.status === 'error' ? ['Risk', risk.message] : null,
    performance.status === 'error' ? ['Performance', performance.message] : null,
    compareState.status === 'error' ? ['Comparison', compareState.message] : null,
  ].filter((item): item is [string, string] => item !== null)

  async function handleDownload(): Promise<void> {
    if (portfolio === null || score === null || !allRequestsSettled || buildingPdf) return
    setBuildingPdf(true)
    setPdfError(null)
    const generatedOn = new Date().toLocaleDateString('en-CA')
    try {
      const { buildResearchReport, reportFilename } = await import('../../../lib/reportPdf')
      const doc = buildResearchReport({
        portfolioName: portfolio.name,
        generatedOn,
        holdingsCount: portfolio.positions.length,
        cashPct: portfolio.cashWeight,
        score,
        risk: risk.status === 'ready' ? risk.response : null,
        performance: performance.status === 'ready' ? performance.response : null,
        compare: compareState.status === 'ready' ? compareState.response : null,
        attribution: attribution.status === 'ready' ? attribution.response : null,
        errors: {
          ...(risk.status === 'error' ? { risk: risk.message } : {}),
          ...(performance.status === 'error' ? { performance: performance.message } : {}),
          ...(compareState.status === 'error' ? { compare: compareState.message } : {}),
          ...(attribution.status === 'error' ? { attribution: attribution.message } : {}),
        },
        memo: latestMemo ?? null,
        memoHoldingsChanged: latestMemo !== undefined && holdingsChanged(latestMemo, portfolio),
      })
      downloadBlob(reportFilename(portfolio.name, generatedOn), doc.output('blob'))
    } catch (error: unknown) {
      setPdfError(`Could not build the PDF: ${errorMessage(error, 'unknown error')}`)
    } finally {
      setBuildingPdf(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-end gap-2">
        <HelpButton
          tooltip="How the Research Score is calculated, component by component"
          onClick={() => setGuideOpen(true)}
        />
        <Tooltip label="Download this portfolio's research as a PDF: score, performance, risk, factor attribution, optimizer comparison and the latest memo">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={!allRequestsSettled || buildingPdf}
            className="rounded-[var(--radius-btn)] bg-btn-action px-4 py-2 text-sm font-semibold text-btn-action-text disabled:opacity-50"
          >
            {buildingPdf ? 'Building PDF…' : 'Download PDF report'}
          </button>
        </Tooltip>
        {pdfError !== null && <p className="mt-2 text-sm text-brand-negative">{pdfError}</p>}
      </div>
      <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
        <section className={`${CARD} shadow-sm self-start`}>
          <h3 className="mb-3 text-sm font-semibold">Research Score</h3>
          {!settled ? (
            <p className="text-sm text-[var(--color-muted)]">Computing the score…</p>
          ) : score !== null ? (
            <>
              {score.total !== null ? (
                <div className="flex justify-center py-2">
                  <div
                    className="flex h-28 w-28 items-center justify-center rounded-full border-4"
                    style={{
                      borderColor: TONE_COLOR[scoreTone(score.total / 100)],
                      backgroundColor: `color-mix(in srgb, ${TONE_COLOR[scoreTone(score.total / 100)]} 10%, transparent)`,
                    }}
                  >
                    <div className="text-center">
                      <p className="text-3xl font-bold tabular-nums text-foreground">{Math.round(score.total)}</p>
                      <p className="text-xs text-[var(--color-muted)]">/ 100</p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex justify-center py-2">
                    <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-[var(--color-border)]">
                      <span className="text-3xl font-semibold text-[var(--color-muted)]">—</span>
                    </div>
                  </div>
                  <div className="mb-4 space-y-1">
                    <p className="text-xl font-semibold">Not scored</p>
                    <p className="text-sm text-[var(--color-muted)]">Missing: {score.missing.join(', ')}.</p>
                    {requestErrors.map(([label, message]) => (
                      <p key={label} className="text-sm text-[var(--color-muted)]">
                        {label}: {message}
                      </p>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : null}
        </section>

        <div className="space-y-5">
          <section className={`${CARD} space-y-3 shadow-sm`}>
            <h3 className="text-sm font-semibold">Latest decision memo</h3>
            {latestMemo === undefined ? (
              <>
                <p className="text-sm text-[var(--color-muted)]">No decision memo yet.</p>
                <Tooltip label="Go to the Decision Memo pill to record a decision for this portfolio">
                  <button
                    type="button"
                    onClick={onOpenMemo}
                    className="rounded-[var(--radius-btn)] bg-btn-action px-4 py-2 text-sm font-semibold text-btn-action-text"
                  >
                    Write a memo
                  </button>
                </Tooltip>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span
                    className={`font-semibold ${TEXT_CLASS[latestMemo.recommendation]}`}
                    style={{
                      backgroundColor: `color-mix(in srgb, ${TOKEN[latestMemo.recommendation]} 12%, transparent)`,
                    }}
                  >
                    {latestMemo.recommendation}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {new Date(latestMemo.createdAt).toLocaleDateString()}
                  </span>
                  <span className="text-[var(--color-muted)]">Latest of {memos.length} saved</span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{latestMemo.rationale}</p>
                <p className="text-sm text-[var(--color-muted)]">
                  {latestMemo.redFlags.length === 0
                    ? 'No red flags recorded'
                    : `${latestMemo.redFlags.length} red flag${latestMemo.redFlags.length === 1 ? '' : 's'} recorded`}
                </p>
                {holdingsChanged(latestMemo, portfolio) && (
                  <p className="text-sm text-[var(--color-muted)]">Holdings have changed since this memo.</p>
                )}
                <Tooltip label="Go to the Decision Memo pill to see every saved memo or write a new one">
                  <button
                    type="button"
                    onClick={onOpenMemo}
                    className="rounded-[var(--radius-btn)] border border-brand-border px-4 py-2 text-sm font-semibold"
                  >
                    Open Decision Memo
                  </button>
                </Tooltip>
              </>
            )}
          </section>

          {settled && score !== null && (
            <section className={`${CARD} shadow-sm`}>
              <h3 className="mb-3 text-sm font-semibold">Score breakdown</h3>
              <div className="space-y-3">
                {score.components.map((component) => (
                  <div key={component.key} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[10rem_1fr_7rem]">
                    <div className="w-40 text-sm font-medium">
                      <Tooltip label={COMPONENT_TIPS[component.key]}>
                        <span>{component.label}</span>
                      </Tooltip>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--color-border)]">
                      {component.subscore !== null && (
                        <div
                          className="h-2 rounded-full"
                          style={{
                            width: `${component.subscore * 100}%`,
                            backgroundColor: TONE_COLOR[scoreTone(component.subscore)],
                          }}
                        />
                      )}
                    </div>
                    <div className="text-right text-sm tabular-nums">
                      {component.points === null
                        ? `— / ${component.maxPoints}`
                        : `${component.points.toFixed(1)} / ${component.maxPoints}`}
                    </div>
                    <div className="text-sm sm:col-span-3 sm:pl-[10.75rem]">
                      <p>{component.measured ?? '—'}</p>
                      <p className="text-xs text-[var(--color-muted)]">{component.window ?? '—'}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                Diversification and risk concentration use Risk &amp; Perf → Health&apos;s one-year window. Volatility
                uses Risk &amp; Perf → Performance&apos;s default window. Holdout robustness counts the years in Compare
                Optimizers where this portfolio&apos;s holdout Sharpe beat equal weight&apos;s.
              </p>
              <p className="mt-2 text-xs text-[var(--color-muted)]">{SCORE_DISCLAIMER}</p>
            </section>
          )}
        </div>
      </div>

      {settled && (
        <>
          <div>
            <p className="mb-2 text-xs text-[var(--color-muted)]">
              For context only: these figures are not part of the score.
            </p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
              {overviewTiles(riskResponse, performanceResponse).map((tile) => (
                <section key={tile.label} className={`${CARD} shadow-sm`}>
                  <Tooltip label={tile.tooltip}>
                    <p className="text-sm text-[var(--color-muted)]">{tile.label}</p>
                  </Tooltip>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">{tile.sub}</p>
                </section>
              ))}
            </div>
          </div>

          <section
            className={`${CARD} shadow-sm`}
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)' }}
          >
            <h3 className="mb-2 text-sm font-semibold">Key risks</h3>
            {keyRisks.length === 0 ? (
              <p className="text-sm">No flags raised by the current evidence.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {keyRisks.map((flag) => (
                  <li key={flag.id} className="text-foreground">
                    {flag.severity === 'high' ? <span className="font-semibold">high</span> : 'medium'} · {flag.title}:{' '}
                    {flag.detail}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {guideOpen && <ScoreGuide onClose={() => setGuideOpen(false)} />}
    </div>
  )
}
