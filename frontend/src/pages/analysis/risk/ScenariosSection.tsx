import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { getUniverse, riskPortfolio, stressPortfolio } from '../../../api/client'
import type { RiskRequest, RiskResponse } from '../../../api/client'
import { HelpButton } from '../../../components/GuidePanel'
import { Tooltip } from '../../../components/Tooltip'
import { tradeBasis } from '../../../lib/optimize'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'
import { buildRiskRequest, DEFAULT_RISK_SETTINGS, parseShock, sameRiskRequest } from '../../../lib/risk'
import {
  PRESET_TAGS,
  SCENARIO_KINDS,
  TAG_STYLES,
  comparisonRows,
  marketShock,
  parseVolScale,
  replay,
  volShock,
} from '../../../lib/scenarios'
import type { ScenarioKind, ScenarioResult } from '../../../lib/scenarios'
import { STRESS_PRESETS, buildStressRequest, parseWindow } from '../../../lib/stress'
import { ScenarioCard } from './ScenarioCards'
import { ScenarioGuide } from './ScenarioGuide'

const ScenarioComparisonChart = lazy(() => import('../../../components/ScenarioComparisonChart'))

type RunStatus = { status: 'idle' } | { status: 'running' } | { status: 'error'; message: string }
type UniverseState = { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null> }

const FIELD =
  'rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground'
const LABEL = 'flex flex-col gap-1 text-xs text-[var(--color-muted)]'

export function ScenariosSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const [kind, setKind] = useState<ScenarioKind>('market_shock')
  const [moveText, setMoveText] = useState('-20')
  const [scaleText, setScaleText] = useState('2')
  const [startText, setStartText] = useState('2022-01-03')
  const [endText, setEndText] = useState('2022-12-30')
  const [results, setResults] = useState<ScenarioResult[]>([])
  const [run, setRun] = useState<RunStatus>({ status: 'idle' })
  const [guideOpen, setGuideOpen] = useState(false)
  const [universe, setUniverse] = useState<UniverseState>({ status: 'loading' })
  const nextId = useRef(1)
  const riskCache = useRef<{ request: RiskRequest; response: RiskResponse } | null>(null)
  const mountedRef = useRef(true)

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

  if (portfolio === null) return null
  const busy = run.status === 'running' || universe.status === 'loading'

  const fail = (error: unknown, fallback: string): void => {
    if (mountedRef.current) setRun({ status: 'error', message: error instanceof Error ? error.message : fallback })
  }
  const append = (result: ScenarioResult): void => {
    if (!mountedRef.current) return
    setResults((previous) => [...previous, result])
    setRun({ status: 'idle' })
  }

  const runHistorical = (start: string, end: string): void => {
    if (universe.status !== 'ready') return
    const window = parseWindow(start, end)
    if (!window.ok) return setRun({ status: 'error', message: window.message })
    const built = buildStressRequest(portfolio, window, 'SPY', tradeBasis(portfolio, universe.lastClose))
    if (!built.ok) return setRun({ status: 'error', message: built.message })
    const id = nextId.current++
    setRun({ status: 'running' })
    void stressPortfolio(built.request)
      .then((response) => append(replay(response, window, id)))
      .catch((error: unknown) => fail(error, 'The scenario request failed.'))
  }

  const runShock = (): void => {
    if (universe.status !== 'ready') return
    const shock = kind === 'market_shock' ? parseShock(moveText) : parseVolScale(scaleText)
    if (!shock.ok) return setRun({ status: 'error', message: shock.message })
    const built = buildRiskRequest(portfolio, DEFAULT_RISK_SETTINGS, tradeBasis(portfolio, universe.lastClose))
    if (!built.ok) return setRun({ status: 'error', message: built.message })
    const make = (risk: RiskResponse): ScenarioResult => {
      const id = nextId.current++
      return kind === 'market_shock' ? marketShock(risk, shock.value, id) : volShock(risk, shock.value, id)
    }
    const cached = riskCache.current
    if (cached !== null && sameRiskRequest(cached.request, built.request)) return append(make(cached.response))
    setRun({ status: 'running' })
    void riskPortfolio(built.request)
      .then((response) => {
        riskCache.current = { request: built.request, response }
        append(make(response))
      })
      .catch((error: unknown) => fail(error, 'The risk request failed.'))
  }

  const submit = (): void => (kind === 'historical' ? runHistorical(startText, endText) : runShock())

  const comparison = comparisonRows(results)

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold text-[var(--color-muted)]">
          Preset Scenarios — click to replay one of these windows with today&apos;s holdings
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {STRESS_PRESETS.map((preset) => (
            <Tooltip
              key={preset.id}
              label={`Replay ${preset.name} (${preset.start} → ${preset.end}) with today's holdings`}
              block
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setKind('historical')
                  setStartText(preset.start)
                  setEndText(preset.end)
                  runHistorical(preset.start, preset.end)
                }}
                className="h-full w-full rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-3 text-left hover:border-brand-primary disabled:opacity-50"
              >
                <div className="text-xs font-semibold">{preset.name}</div>
                <div className="mt-1 text-[10px] text-[var(--color-muted)]">{preset.description}</div>
                <div className="mt-1 font-mono text-[10px] text-[var(--color-muted)]">
                  {preset.start} → {preset.end}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(PRESET_TAGS[preset.id] ?? []).map((tag) => (
                    <span key={tag} className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${TAG_STYLES[tag]}`}>
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className="border-t border-brand-border pt-2">
        <p className="text-xs font-semibold text-[var(--color-muted)]">Or run a custom scenario:</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className={LABEL}>
          <Tooltip label="Choose how to stress the portfolio">
            <span>Scenario Type</span>
          </Tooltip>
          <select value={kind} onChange={(event) => setKind(event.target.value as ScenarioKind)} className={FIELD}>
            {SCENARIO_KINDS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <HelpButton tooltip="What each scenario does and how to read the results" onClick={() => setGuideOpen(true)} />
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-4">
        {kind === 'market_shock' && (
          <label className={LABEL}>
            <Tooltip label="How much SPY moves, in percent, from -50 to +50">
              <span>SPY move % (e.g. −20)</span>
            </Tooltip>
            <input
              type="number"
              step="any"
              value={moveText}
              onChange={(event) => setMoveText(event.target.value)}
              className={`${FIELD} w-32`}
            />
          </label>
        )}
        {kind === 'vol_shock' && (
          <label className={LABEL}>
            <Tooltip label="How much to scale every holding's volatility, from 0.1× to 10×">
              <span>Vol multiplier (e.g. 2 = 2×)</span>
            </Tooltip>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={scaleText}
              onChange={(event) => setScaleText(event.target.value)}
              className={`${FIELD} w-32`}
            />
          </label>
        )}
        {kind === 'historical' && (
          <>
            <label className={LABEL}>
              <Tooltip label="First day of the replay window">
                <span>Start</span>
              </Tooltip>
              <input
                type="date"
                value={startText}
                onChange={(event) => setStartText(event.target.value)}
                className={FIELD}
              />
            </label>
            <label className={LABEL}>
              <Tooltip label="Last day of the replay window">
                <span>End</span>
              </Tooltip>
              <input
                type="date"
                value={endText}
                onChange={(event) => setEndText(event.target.value)}
                className={FIELD}
              />
            </label>
          </>
        )}
        <Tooltip label="Run this scenario and add it to the results below">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex rounded-[var(--radius-btn)] bg-btn-action px-4 py-2 text-sm font-semibold text-btn-action-text disabled:opacity-50"
          >
            {run.status === 'running' ? 'Running…' : 'Run Scenario'}
          </button>
        </Tooltip>
        {results.length > 0 && (
          <Tooltip label="Remove all scenario results">
            <button
              type="button"
              onClick={() => setResults([])}
              className="inline-flex rounded-[var(--radius-btn)] border border-brand-border px-4 py-2 text-sm font-medium text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
            >
              Clear
            </button>
          </Tooltip>
        )}
      </div>

      {run.status === 'error' && <p className="text-sm text-brand-negative">{run.message}</p>}

      {comparison.length >= 2 && (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-5">
          <div>
            <h3 className="text-sm font-semibold">Scenario Comparison</h3>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Total return and max drawdown across the {comparison.length} historical replays you&apos;ve run.
            </p>
          </div>
          <Suspense fallback={<p className="py-4 text-center text-sm text-[var(--color-muted)]">Loading chart…</p>}>
            <ScenarioComparisonChart data={comparison} />
          </Suspense>
        </div>
      )}

      {results.map((result, index) => (
        <ScenarioCard
          key={result.id}
          result={result}
          index={index}
          onRemove={() => setResults((previous) => previous.filter((item) => item.id !== result.id))}
        />
      ))}

      <p className="text-xs text-[var(--color-muted)]">
        Scenarios are estimates from past prices and betas, not forecasts. Not investment advice.
      </p>
      {guideOpen && <ScenarioGuide onClose={() => setGuideOpen(false)} />}
    </div>
  )
}
