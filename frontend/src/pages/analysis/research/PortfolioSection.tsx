import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { comparePortfolio, getUniverse } from '../../../api/client'
import type { CompareMetrics, CompareRequest, CompareResponse } from '../../../api/client'
import { CorrelationHeatmap } from '../../../components/CorrelationHeatmap'
import { ExpandableChart } from '../../../components/ExpandableChart'
import { LookbackPicker } from '../../../components/LookbackPicker'
import { Tooltip } from '../../../components/Tooltip'
import { formatMoney, tradeBasis } from '../../../lib/optimize'
import type { TradeBasis } from '../../../lib/optimize'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'
import {
  bestHoldout,
  buildCompareRequest,
  compareFrontierData,
  compareFrontierNote,
  compareRows,
  correlationNote,
  DEFAULT_COMPARE_SETTINGS,
  DEFAULT_COST_BPS,
  sameCompareRequest,
  sortCompareRows,
  tradeCost,
} from '../../../lib/research'
import type { CompareRow, CompareSortKey } from '../../../lib/research'

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: CompareResponse; request: CompareRequest; basis: TradeBasis }
type UniverseState = { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null> }

const CompareFrontierChart = lazy(() => import('../../../components/CompareFrontierChart'))

const TH =
  'border-b border-brand-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)] whitespace-nowrap'
const TD = 'border-b border-brand-border px-3 py-2.5'
const NUMERIC = `${TD} text-right tabular-nums whitespace-nowrap`
const POSITIVE = 'font-semibold text-brand-positive'
const METRICS = ['cagr', 'vol', 'sharpe', 'max_dd'] as const
const METRIC_LABELS = { cagr: 'CAGR', vol: 'Vol', sharpe: 'Sharpe', max_dd: 'Max DD' } as const

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function metricText(metric: (typeof METRICS)[number], value: number | null): string {
  if (value === null) return '—'
  return metric === 'sharpe' ? value.toFixed(2) : pct(value)
}

export function PortfolioSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const [settings, setSettings] = useState(DEFAULT_COMPARE_SETTINGS)
  const [bps, setBps] = useState(DEFAULT_COST_BPS)
  const [sort, setSort] = useState<{ key: CompareSortKey; ascending: boolean }>({
    key: 'holdout.sharpe',
    ascending: false,
  })
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
    if (portfolio.positions.length < 2) {
      setRun({ status: 'error', message: 'Add at least two holdings to compare optimizers.' })
      return
    }
    const basis = tradeBasis(portfolio, universe.lastClose)
    const request = buildCompareRequest(portfolio, settings, basis)
    setRun({ status: 'running' })
    void comparePortfolio(request)
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, request, basis })
      })
      .catch((error: unknown) => {
        if (mountedRef.current)
          setRun({
            status: 'error',
            message: error instanceof Error ? error.message : 'The comparison request failed.',
          })
      })
  }, [portfolio, settings, universe])

  useEffect(() => {
    if (universe.status === 'ready' && !autoRunRef.current) {
      autoRunRef.current = true
      submit()
    }
  }, [submit, universe.status])

  if (portfolio === null) return null
  const liveBasis: TradeBasis =
    universe.status === 'ready' ? tradeBasis(portfolio, universe.lastClose) : { kind: 'weights', reason: 'no-shares' }
  const stale =
    run.status === 'ready' && !sameCompareRequest(buildCompareRequest(portfolio, settings, liveBasis), run.request)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <LookbackPicker
          lookbackDays={settings.lookbackDays}
          onChange={(lookbackDays) => setSettings({ ...settings, lookbackDays })}
          customTooltip="Fit each optimizer on daily prices from a start date you choose"
          optionTooltip={(option) => `Fit each optimizer on the last ${option.label} of daily prices`}
        />
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            Max weight: {settings.maxWeightPct}%
          </label>
          <Tooltip
            dismissOnPointerDown
            block
            label="No optimizer may put more than this share of the invested money in one holding"
          >
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={settings.maxWeightPct}
              onChange={(event) => setSettings({ ...settings, maxWeightPct: Number(event.target.value) })}
              className="w-full accent-[var(--color-primary)]"
            />
          </Tooltip>
        </div>
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            Vol target: {settings.volTargetPct}% (Target Volatility only)
          </label>
          <Tooltip
            dismissOnPointerDown
            block
            label="The volatility Target Volatility aims for. The other seven optimizers ignore it."
          >
            <input
              type="range"
              min={5}
              max={50}
              step={1}
              value={settings.volTargetPct}
              onChange={(event) => setSettings({ ...settings, volTargetPct: Number(event.target.value) })}
              className="w-full accent-[var(--color-primary)]"
            />
          </Tooltip>
        </div>
        <Tooltip label="Fit all eight optimizers again with these settings and the current holdings">
          <button
            type="button"
            onClick={submit}
            disabled={run.status === 'running' || universe.status === 'loading'}
            className="inline-flex rounded-[var(--radius-btn)] bg-btn-action px-4 py-2 text-sm font-semibold text-btn-action-text disabled:opacity-50"
          >
            {run.status === 'running' ? 'Comparing 8 optimizers…' : 'Run comparison'}
          </button>
        </Tooltip>
      </div>

      {run.status === 'running' && <p className="text-xs text-[var(--color-muted)]">Comparing 8 optimizers…</p>}
      {run.status === 'error' && <p className="text-brand-negative">{run.message}</p>}
      {run.status === 'ready' && (
        <>
          <RunNotes response={run.response} stale={stale} />
          <p className="text-xs text-[var(--color-muted)]">
            In-sample numbers show how each optimizer did on the same prices it was fit to, so each one tends to win at
            its own goal. The holdout columns are the real test: weights fit on the prior period, then scored on the
            last 12 months, which the fit never saw. Green marks the best holdout value. One year is one test, not
            proof.
          </p>
          <div className="max-w-xs">
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              Trading cost: {bps} bps per dollar traded
            </label>
            <Tooltip
              dismissOnPointerDown
              block
              label="Estimated cost per dollar bought or sold, in basis points (1 bp = 0.01%). Used only for the Cost column."
            >
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={bps}
                onChange={(event) => setBps(Number(event.target.value))}
                className="w-full accent-[var(--color-primary)]"
              />
            </Tooltip>
          </div>
          <ComparisonTable
            response={run.response}
            basis={run.basis}
            cashWeight={portfolio.cashWeight}
            bps={bps}
            sort={sort}
            onSort={(key) =>
              setSort((previous) =>
                previous.key === key ? { key, ascending: !previous.ascending } : { key, ascending: key === 'mode' },
              )
            }
          />
          <FrontierCard response={run.response} />
          <CorrelationCard response={run.response} />
        </>
      )}
    </div>
  )
}

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4'

function FrontierCard({ response }: { response: CompareResponse }): JSX.Element {
  const data = compareFrontierData(response)
  const note = response.frontier === null ? null : compareFrontierNote(response.frontier)
  return (
    <section className={CARD}>
      <h3 className="mb-1 text-sm font-semibold">Efficient frontier</h3>
      {data === null ? (
        <p className="text-xs text-[var(--color-muted)]">The efficient frontier could not be computed for this run.</p>
      ) : (
        <>
          <div className="mt-3">
            <Suspense
              fallback={
                <p className="flex h-[22rem] items-center justify-center text-sm text-[var(--color-muted)]">
                  Loading chart…
                </p>
              }
            >
              <ExpandableChart title="Efficient frontier">
                {(expanded) => <CompareFrontierChart data={data} size={expanded ? 'expanded' : 'inline'} />}
              </ExpandableChart>
            </Suspense>
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            In-sample: the curve and every point use the same prices the optimizers were fit on. The comparison
            table's holdout columns are the out-of-sample check.
          </p>
          {note !== null && <p className="mt-1 text-xs text-[var(--color-muted)]">{note}</p>}
        </>
      )}
    </section>
  )
}

function CorrelationCard({ response }: { response: CompareResponse }): JSX.Element {
  const correlation = response.correlation
  return (
    <section className={CARD}>
      <h3 className="mb-1 text-sm font-semibold">Correlation</h3>
      {correlation === null ? (
        <p className="text-xs text-[var(--color-muted)]">
          Correlation needs at least two holdings with price movement over a common window.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            Ordered so holdings that move together sit next to each other. A block of dark cells is a group that will
            tend to fall at the same time.
          </p>
          <CorrelationHeatmap correlation={correlation} />
          <p className="mt-2 text-xs text-[var(--color-muted)]">{correlationNote(correlation)}</p>
        </>
      )}
    </section>
  )
}

function RunNotes({ response, stale }: { response: CompareResponse; stale: boolean }): JSX.Element {
  const holdout = response.holdout
  return (
    <div className="space-y-1 text-xs text-[var(--color-muted)]">
      <p>
        In-sample: fit and scored on {response.fit_start} → {response.fit_end}.
      </p>
      {holdout !== null ? (
        <p>
          Holdout: fit on {holdout.fit_start} → {holdout.fit_end}, scored on {holdout.score_start} → {holdout.score_end}
          .
          {holdout.excluded.length > 0 &&
            ` Not in the holdout (no prices before ${holdout.fit_end}): ${holdout.excluded.join(', ')}.`}
        </p>
      ) : (
        response.holdout_unavailable !== null && <p>{response.holdout_unavailable}</p>
      )}
      {response.pinned.length > 0 && (
        <p>Held at current weight (too little history to fit): {response.pinned.join(', ')}.</p>
      )}
      {response.warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      {stale && <p>Settings or holdings have changed since this run. Click Run comparison to update.</p>}
    </div>
  )
}

function ComparisonTable({
  response,
  basis,
  cashWeight,
  bps,
  sort,
  onSort,
}: {
  response: CompareResponse
  basis: TradeBasis
  cashWeight: number
  bps: number
  sort: { key: CompareSortKey; ascending: boolean }
  onSort: (key: CompareSortKey) => void
}): JSX.Element {
  const rows = compareRows(response)
  const best = bestHoldout(rows)
  const sorted = sortCompareRows(rows, sort.key, sort.ascending)
  return (
    <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <SortHeader sortKey="mode" label="Mode" tipName="Mode" sort={sort} onSort={onSort} rowSpan={2} />
            <th colSpan={4} className={`${TH} text-center`}>
              Holdout, last 12 months
            </th>
            <th colSpan={4} className={`${TH} text-center`}>
              In-sample
            </th>
            <th colSpan={2} className={`${TH} text-center`}>
              Trade
            </th>
          </tr>
          <tr>
            {METRICS.map((metric) => (
              <SortHeader
                key={`h-${metric}`}
                sortKey={`holdout.${metric}`}
                label={METRIC_LABELS[metric]}
                tipName={`Holdout ${METRIC_LABELS[metric]}`}
                sort={sort}
                onSort={onSort}
              />
            ))}
            {METRICS.map((metric) => (
              <SortHeader
                key={`i-${metric}`}
                sortKey={`in_sample.${metric}`}
                label={METRIC_LABELS[metric]}
                tipName={`In-sample ${METRIC_LABELS[metric]}`}
                sort={sort}
                onSort={onSort}
              />
            ))}
            <SortHeader sortKey="traded" label="Traded" tipName="Traded" sort={sort} onSort={onSort} />
            <th className={`${TH} text-right`}>Cost (one-time)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <ModeRow key={row.key} row={row} best={best} basis={basis} cashWeight={cashWeight} bps={bps} />
          ))}
        </tbody>
      </table>
    </section>
  )
}

function ModeRow({
  row,
  best,
  basis,
  cashWeight,
  bps,
}: {
  row: CompareRow
  best: ReturnType<typeof bestHoldout>
  basis: TradeBasis
  cashWeight: number
  bps: number
}): JSX.Element {
  const rowClass = row.isCurrent ? 'bg-brand-primary/10 font-semibold' : ''
  const label = (
    <td className={TD}>
      <div>{row.label}</div>
      {row.feasible === false && <div className="font-normal text-[var(--color-muted)]">did not converge</div>}
    </td>
  )
  if (row.error !== null) {
    return (
      <tr className={rowClass}>
        {label}
        <td colSpan={10} className={`${TD} text-brand-negative`}>
          {row.error}
        </td>
      </tr>
    )
  }
  const cost = row.traded === null || row.isCurrent ? null : tradeCost(row.traded, bps, cashWeight, basis)
  return (
    <tr className={rowClass}>
      {label}
      {row.holdout === null ? (
        <td colSpan={4} className={`${TD} text-[var(--color-muted)]`}>
          {row.holdoutError ?? '—'}
        </td>
      ) : (
        METRICS.map((metric) => (
          <td key={metric} className={`${NUMERIC} ${isBestHoldout(row.holdout, best, metric) ? POSITIVE : ''}`}>
            {metricText(metric, row.holdout![metric])}
          </td>
        ))
      )}
      {METRICS.map((metric) => (
        <td key={`i-${metric}`} className={NUMERIC}>
          {row.inSample === null ? '—' : metricText(metric, row.inSample[metric])}
        </td>
      ))}
      <td className={NUMERIC}>{row.isCurrent || row.traded === null ? '—' : pct(row.traded)}</td>
      <td className={NUMERIC}>
        {cost === null
          ? '—'
          : `${cost.pct.toFixed(2)}%${cost.dollars === null ? '' : ` · ${formatMoney(cost.dollars)}`}`}
      </td>
    </tr>
  )
}

// Highlighting reads only a row's holdout metrics and bestHoldout(): no in-sample value can reach it.
function isBestHoldout(
  holdout: CompareMetrics | null,
  best: ReturnType<typeof bestHoldout>,
  metric: (typeof METRICS)[number],
): boolean {
  const value = holdout?.[metric] ?? null
  return value !== null && value === best[metric]
}

function SortHeader({
  sortKey,
  label,
  tipName,
  sort,
  onSort,
  rowSpan,
}: {
  sortKey: CompareSortKey
  label: string
  tipName: string
  sort: { key: CompareSortKey; ascending: boolean }
  onSort: (key: CompareSortKey) => void
  rowSpan?: number
}): JSX.Element {
  const active = sort.key === sortKey
  return (
    <th
      rowSpan={rowSpan}
      className={`${TH} ${sortKey === 'mode' ? 'text-left align-bottom' : 'text-right'}`}
      aria-sort={active ? (sort.ascending ? 'ascending' : 'descending') : 'none'}
    >
      <Tooltip label={`Sort by ${tipName} — click again to reverse`}>
        <button type="button" onClick={() => onSort(sortKey)} className="uppercase hover:text-foreground">
          {label}
          {active ? (sort.ascending ? ' ▲' : ' ▼') : ''}
        </button>
      </Tooltip>
    </th>
  )
}
