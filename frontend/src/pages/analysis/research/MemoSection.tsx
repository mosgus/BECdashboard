import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { comparePortfolio, getUniverse, riskPortfolio } from '../../../api/client'
import type { CompareResponse, RiskResponse } from '../../../api/client'
import { Tooltip } from '../../../components/Tooltip'
import { buildEvidence, deriveRedFlags, holdingsChanged, memoHoldings, RECOMMENDATIONS } from '../../../lib/memo'
import type { DecisionMemo, FlagSeverity, Recommendation, RedFlag } from '../../../lib/memo'
import { deleteMemo, listMemos, saveMemo } from '../../../lib/memoStore'
import { tradeBasis } from '../../../lib/optimize'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'
import { buildRiskRequest, DEFAULT_RISK_SETTINGS } from '../../../lib/risk'
import { buildCompareRequest, DEFAULT_COMPARE_SETTINGS } from '../../../lib/research'

type RequestState<T> = { status: 'running' } | { status: 'error'; message: string } | { status: 'ready'; response: T }
type UniverseState = { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null> }

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4'
const FIELD =
  'w-full rounded-[var(--radius-btn)] border border-brand-border bg-background px-3 py-2 text-sm text-foreground'
const TOO_FEW = 'Add at least two holdings to run the holdout comparison.'

const TOKEN: Record<Recommendation, string> = {
  GO: 'var(--color-positive)',
  CONDITIONAL: 'var(--color-accent)',
  'NO-GO': 'var(--color-negative)',
}
const TEXT_CLASS: Record<Recommendation, string> = {
  GO: 'text-brand-positive',
  CONDITIONAL: 'text-foreground',
  'NO-GO': 'text-brand-negative',
}
const RECOMMENDATION_TIPS: Record<Recommendation, string> = {
  GO: 'Proceed with this portfolio as it stands',
  CONDITIONAL: 'Proceed only if the conditions in the rationale are met',
  'NO-GO': 'Do not proceed with this portfolio as it stands',
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function MemoSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const tooFew = portfolio !== null && portfolio.positions.length < 2

  const [universe, setUniverse] = useState<UniverseState>({ status: 'loading' })
  const [risk, setRisk] = useState<RequestState<RiskResponse>>({ status: 'running' })
  const [compare, setCompare] = useState<RequestState<CompareResponse>>({ status: 'running' })
  const [recommendation, setRecommendation] = useState<Recommendation>('CONDITIONAL')
  const [rationale, setRationale] = useState('')
  const [monitoringPlan, setMonitoringPlan] = useState('')
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [custom, setCustom] = useState<RedFlag[]>([])
  const [newFlagText, setNewFlagText] = useState('')
  const [newFlagSeverity, setNewFlagSeverity] = useState<FlagSeverity>('medium')
  const [memos, setMemos] = useState<DecisionMemo[]>(() => listMemos(portfolioId ?? ''))
  const [saveMessage, setSaveMessage] = useState<'saved' | 'failed' | null>(null)
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

  useEffect(() => {
    if (portfolio === null || universe.status !== 'ready' || startedRef.current) return
    startedRef.current = true
    const basis = tradeBasis(portfolio, universe.lastClose)

    void (async () => {
      const built = buildRiskRequest(portfolio, DEFAULT_RISK_SETTINGS, basis)
      if (!built.ok) throw new Error(built.message)
      return riskPortfolio(built.request)
    })()
      .then((response) => {
        if (mountedRef.current) setRisk({ status: 'ready', response })
      })
      .catch((error: unknown) => {
        if (mountedRef.current) setRisk({ status: 'error', message: errorMessage(error, 'The risk request failed.') })
      })

    if (portfolio.positions.length < 2) return
    void comparePortfolio(buildCompareRequest(portfolio, DEFAULT_COMPARE_SETTINGS, basis))
      .then((response) => {
        if (mountedRef.current) setCompare({ status: 'ready', response })
      })
      .catch((error: unknown) => {
        if (mountedRef.current)
          setCompare({ status: 'error', message: errorMessage(error, 'The comparison request failed.') })
      })
  }, [portfolio, universe])

  const compareState: RequestState<CompareResponse> = tooFew ? { status: 'error', message: TOO_FEW } : compare
  const settled = risk.status !== 'running' && compareState.status !== 'running'
  const riskResponse = risk.status === 'ready' ? risk.response : null
  const compareResponse = compareState.status === 'ready' ? compareState.response : null
  const evidence = useMemo(
    () => (settled ? buildEvidence(riskResponse, compareResponse) : null),
    [settled, riskResponse, compareResponse],
  )
  const suggested = useMemo(() => deriveRedFlags(evidence), [evidence])

  if (portfolio === null) return null

  const flags = [...suggested.filter((flag) => !dismissed.has(flag.id)), ...custom]
  const canSave = settled && rationale.trim() !== ''

  function dismissFlag(id: string): void {
    if (custom.some((flag) => flag.id === id)) setCustom(custom.filter((flag) => flag.id !== id))
    else setDismissed(new Set([...dismissed, id]))
  }

  function addFlag(): void {
    const title = newFlagText.trim()
    if (title === '') return
    setCustom([...custom, { id: `custom-${crypto.randomUUID()}`, severity: newFlagSeverity, title, detail: '' }])
    setNewFlagText('')
    setNewFlagSeverity('medium')
  }

  function handleSave(): void {
    if (portfolio === null || portfolioId === undefined || !canSave) return
    const memo: DecisionMemo = {
      id: crypto.randomUUID(),
      portfolioId,
      createdAt: new Date().toISOString(),
      recommendation,
      rationale,
      monitoringPlan,
      redFlags: flags,
      holdings: memoHoldings(portfolio),
      cashWeight: portfolio.cashWeight,
      ...(portfolio.cashDollars === undefined ? {} : { cashDollars: portfolio.cashDollars }),
      evidence,
    }
    if (!saveMemo(memo)) {
      setSaveMessage('failed')
      return
    }
    setMemos([memo, ...memos])
    setRecommendation('CONDITIONAL')
    setRationale('')
    setMonitoringPlan('')
    setDismissed(new Set())
    setCustom([])
    setSaveMessage('saved')
  }

  function handleDelete(id: string): void {
    deleteMemo(id)
    setMemos(memos.filter((memo) => memo.id !== id))
  }

  return (
    <div className="space-y-5">
      <p className="rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-3 text-xs text-[var(--color-muted)]">
        A memo records your decision and the evidence you had when you made it. It is not investment advice. The
        evidence comes from past prices over the windows shown, and past results don&apos;t predict future ones.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={CARD}>
          <h3 className="mb-3 text-sm font-semibold">Evidence</h3>
          {!settled ? (
            <p className="text-xs text-[var(--color-muted)]">Checking the portfolio…</p>
          ) : (
            <>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
                <EvidenceRow
                  label="Effective holdings"
                  value={
                    evidence?.effectiveHoldings == null
                      ? '—'
                      : `${evidence.effectiveHoldings.toFixed(1)} of ${evidence.holdingsCount}`
                  }
                />
                <EvidenceRow
                  label="Largest holding"
                  value={
                    evidence?.largest == null
                      ? '—'
                      : `${evidence.largest.ticker} ${pct(evidence.largest.investedWeight)}`
                  }
                />
                <EvidenceRow
                  label="Largest risk share"
                  value={
                    evidence?.topRiskShare == null
                      ? '—'
                      : `${evidence.topRiskShare.ticker} ${pct(evidence.topRiskShare.share)}`
                  }
                />
                <EvidenceRow
                  label="Sharpe, last 12 months"
                  value={evidence?.holdoutSharpe == null ? '—' : evidence.holdoutSharpe.toFixed(2)}
                />
                <EvidenceRow
                  label="Equal weight, same 12 months"
                  value={
                    evidence?.equalWeightHoldoutSharpe == null ? '—' : evidence.equalWeightHoldoutSharpe.toFixed(2)
                  }
                />
                <EvidenceRow label="Max drawdown" value={pct(evidence?.maxDrawdown ?? null)} />
              </dl>
              <div className="mt-3 space-y-1 text-xs text-[var(--color-muted)]">
                {evidence?.riskWindow != null && (
                  <p>
                    Concentration and risk: {evidence.riskWindow.start} → {evidence.riskWindow.end}.
                  </p>
                )}
                {evidence?.holdoutWindow != null && (
                  <p>
                    Holdout: {evidence.holdoutWindow.start} → {evidence.holdoutWindow.end}.
                  </p>
                )}
                {evidence?.drawdownWindow != null && (
                  <p>
                    Drawdown: {evidence.drawdownWindow.start} → {evidence.drawdownWindow.end}.
                  </p>
                )}
              </div>
              {risk.status === 'error' && <p className="mt-2 text-xs text-brand-negative">{risk.message}</p>}
              {compareState.status === 'error' && (
                <p className="mt-2 text-xs text-brand-negative">{compareState.message}</p>
              )}
            </>
          )}
        </section>

        <section className={`${CARD} space-y-4`}>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Recommendation</h3>
            <div className="flex gap-2">
              {RECOMMENDATIONS.map((option) => {
                const selected = recommendation === option
                return (
                  <Tooltip key={option} label={RECOMMENDATION_TIPS[option]}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setRecommendation(option)}
                      style={
                        selected
                          ? { backgroundColor: `color-mix(in srgb, ${TOKEN[option]} 12%, transparent)` }
                          : undefined
                      }
                      className={`rounded-[var(--radius-btn)] px-4 py-2 text-sm font-semibold ${
                        selected
                          ? `border-2 border-current ${TEXT_CLASS[option]}`
                          : 'border border-brand-border text-[var(--color-muted)] hover:text-foreground'
                      }`}
                    >
                      {option}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          </div>

          <div>
            <label htmlFor="memo-rationale" className="mb-1 block text-sm font-semibold">
              Rationale
            </label>
            <textarea
              id="memo-rationale"
              rows={4}
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              placeholder="Why this recommendation?"
              className={FIELD}
            />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Red flags</h3>
            {flags.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No red flags.</p>
            ) : (
              <ul className="space-y-2">
                {flags.map((flag) => (
                  <FlagRow key={flag.id} flag={flag} onDismiss={() => dismissFlag(flag.id)} />
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="text"
                aria-label="New red flag"
                value={newFlagText}
                onChange={(event) => setNewFlagText(event.target.value)}
                placeholder="Describe the concern"
                className={`${FIELD} min-w-0 flex-1`}
              />
              <select
                aria-label="New red flag severity"
                value={newFlagSeverity}
                onChange={(event) => setNewFlagSeverity(event.target.value as FlagSeverity)}
                className={`${FIELD} w-auto`}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
              </select>
              <Tooltip label="Add your own red flag to this memo">
                <button
                  type="button"
                  onClick={addFlag}
                  disabled={newFlagText.trim() === ''}
                  className="rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Add
                </button>
              </Tooltip>
            </div>
          </div>

          <div>
            <label htmlFor="memo-plan" className="mb-1 block text-sm font-semibold">
              Monitoring plan
            </label>
            <textarea
              id="memo-plan"
              rows={3}
              value={monitoringPlan}
              onChange={(event) => setMonitoringPlan(event.target.value)}
              placeholder="What would change your mind? Drift limits, rebalance triggers, metrics to watch."
              className={FIELD}
            />
          </div>

          <div className="flex items-center gap-3">
            <Tooltip label="Save this memo in this browser session. All fields must be filled in.">
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className="inline-flex rounded-[var(--radius-btn)] bg-btn-action px-4 py-2 text-sm font-semibold text-btn-action-text disabled:opacity-50"
              >
                Save memo
              </button>
            </Tooltip>
            {saveMessage === 'saved' && <span className="text-sm text-[var(--color-muted)]">Saved.</span>}
            {saveMessage === 'failed' && (
              <span className="text-sm text-brand-negative">
                Couldn&apos;t save: this browser&apos;s storage is unavailable or full.
              </span>
            )}
          </div>
        </section>
      </div>

      <section className={CARD}>
        <h3 className="mb-3 text-sm font-semibold">Saved memos ({memos.length})</h3>
        {memos.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">No memos yet for this portfolio.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {memos.map((memo) => (
              <SavedMemoRow
                key={memo.id}
                memo={memo}
                changed={holdingsChanged(memo, portfolio)}
                onDelete={() => handleDelete(memo.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function EvidenceRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <>
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </>
  )
}

function FlagRow({ flag, onDismiss }: { flag: RedFlag; onDismiss?: () => void }): JSX.Element {
  return (
    <li
      className="flex items-start gap-3 rounded-[var(--radius-btn)] border border-brand-border py-2 pl-3 pr-2"
      style={{ borderLeft: `4px solid ${flag.severity === 'high' ? 'var(--color-negative)' : 'var(--color-accent)'}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span
            className={`mr-2 text-xs font-medium ${flag.severity === 'high' ? 'text-brand-negative' : 'text-[var(--color-muted)]'}`}
          >
            {flag.severity === 'high' ? 'High' : 'Medium'}
          </span>
          <span className="font-semibold">{flag.title}</span>
        </div>
        {flag.detail !== '' && <p className="text-xs text-[var(--color-muted)]">{flag.detail}</p>}
      </div>
      {onDismiss !== undefined && (
        <Tooltip label="Remove this flag from the memo">
          <button
            type="button"
            aria-label={`Remove flag: ${flag.title}`}
            onClick={onDismiss}
            className="px-2 text-[var(--color-muted)] hover:text-foreground"
          >
            ×
          </button>
        </Tooltip>
      )}
    </li>
  )
}

function SavedMemoRow({
  memo,
  changed,
  onDelete,
}: {
  memo: DecisionMemo
  changed: boolean
  onDelete: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const firstLine = memo.rationale.split('\n')[0]
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <Tooltip label="Show or hide this memo">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm"
          >
            <span className="tabular-nums text-[var(--color-muted)]">{memo.createdAt.slice(0, 10)}</span>
            <span className={`font-semibold ${TEXT_CLASS[memo.recommendation]}`}>{memo.recommendation}</span>
            <span className="min-w-0 flex-1 truncate">{firstLine}</span>
          </button>
        </Tooltip>
        {confirming ? (
          <span className="flex items-center gap-2 text-sm">
            Delete this memo?
            <button
              type="button"
              onClick={onDelete}
              className="rounded-[var(--radius-btn)] bg-btn-danger px-3 py-1 text-btn-danger-text"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-[var(--radius-btn)] border border-brand-border px-3 py-1"
            >
              Cancel
            </button>
          </span>
        ) : (
          <Tooltip label="Delete this memo from this browser">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-[var(--radius-btn)] border border-brand-border px-3 py-1 text-sm"
            >
              Delete
            </button>
          </Tooltip>
        )}
      </div>
      {changed && <p className="mt-1 text-xs text-[var(--color-muted)]">Holdings have changed since this memo.</p>}
      {open && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="whitespace-pre-wrap">{memo.rationale}</p>
          {memo.redFlags.length > 0 && (
            <ul className="space-y-2">
              {memo.redFlags.map((flag) => (
                <FlagRow key={flag.id} flag={flag} />
              ))}
            </ul>
          )}
          {memo.monitoringPlan !== '' && <p className="whitespace-pre-wrap">{memo.monitoringPlan}</p>}
          <p className="text-xs text-[var(--color-muted)]">
            {memo.holdings.map((holding) => `${holding.ticker} ${holding.weight.toFixed(1)}%`).join(', ')}
            {memo.holdings.length > 0 ? ', ' : ''}Cash {memo.cashWeight.toFixed(1)}%
          </p>
        </div>
      )}
    </li>
  )
}
