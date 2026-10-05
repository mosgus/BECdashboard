import { lazy, Suspense } from 'react'
import type { JSX, ReactNode } from 'react'
import { Tooltip } from '../../../components/Tooltip'
import { formatSigned, riskSummary } from '../../../lib/risk'
import { contributionBars, replayCurve, replayInterpretation, shockBars } from '../../../lib/scenarios'
import type { MarketShockResult, ReplayResult, ScenarioResult, VolShockResult } from '../../../lib/scenarios'
import { stressSummary } from '../../../lib/stress'

const ScenarioReplayChart = lazy(() => import('../../../components/ScenarioReplayChart'))
const ScenarioImpactChart = lazy(() => import('../../../components/ScenarioImpactChart'))

const CARD = 'space-y-4 rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-5'
const CHART_FALLBACK = <p className="py-4 text-center text-sm text-[var(--color-muted)]">Loading chart…</p>

function CardHeader({
  tag,
  title,
  subtitle,
  onRemove,
}: {
  tag: string
  title: string
  subtitle: string
  onRemove: () => void
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-brand-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand-primary">
            {tag}
          </span>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <p className="mt-1 text-xs text-[var(--color-muted)]">{subtitle}</p>
      </div>
      <Tooltip label="Remove this scenario">
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this scenario"
          className="text-lg leading-none text-[var(--color-muted)] hover:text-foreground"
        >
          ×
        </button>
      </Tooltip>
    </div>
  )
}

function MetricTile({
  label,
  value,
  tooltip,
  tone,
}: {
  label: string
  value: string
  tooltip: string
  tone?: 'positive' | 'negative'
}): JSX.Element {
  return (
    <div className="rounded-[var(--radius-card)] border border-brand-border p-3">
      <div className="text-[10px] uppercase text-[var(--color-muted)]">
        <Tooltip label={tooltip}>
          <span>{label}</span>
        </Tooltip>
      </div>
      <div
        className={`mt-0.5 text-lg font-bold ${tone === 'positive' ? 'text-brand-positive' : tone === 'negative' ? 'text-brand-negative' : ''}`}
      >
        {value}
      </div>
    </div>
  )
}

function Heading({ children }: { children: ReactNode }): JSX.Element {
  return <h4 className="mb-2 text-xs font-semibold text-[var(--color-muted)]">{children}</h4>
}

function Interpretation({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="rounded bg-[var(--color-bg)] px-3 py-2 text-xs">
      <strong>Interpretation: </strong>
      {children}
    </p>
  )
}

const signTone = (value: number): 'positive' | 'negative' => (value >= 0 ? 'positive' : 'negative')

function HistoricalCard({
  result,
  index,
  onRemove,
}: {
  result: ReplayResult
  index: number
  onRemove: () => void
}): JSX.Element {
  const r = result.response
  const bars = contributionBars(r)
  return (
    <div className={CARD}>
      <CardHeader
        tag={`#${index + 1} · Historical`}
        title={result.preset?.name ?? 'Historical Replay'}
        subtitle={stressSummary(r)}
        onRemove={onRemove}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile
          label="Total Return"
          value={formatSigned(r.portfolio_return * 100)}
          tone={signTone(r.portfolio_return)}
          tooltip="Today's holdings bought at the start of the window and held to the end. Cash stays flat."
        />
        <MetricTile
          label="Max Drawdown"
          value={formatSigned(r.max_drawdown * 100)}
          tone="negative"
          tooltip="Largest fall from a high point during the window."
        />
        <MetricTile
          label="Worst Day"
          value={formatSigned(r.worst_day * 100)}
          tone="negative"
          tooltip={`Worst single-day move, on ${r.worst_day_date}.`}
        />
        <MetricTile
          label="Best Day"
          value={formatSigned(result.bestDay * 100)}
          tone="positive"
          tooltip="Best single-day move in the window."
        />
        <MetricTile
          label={`${r.market_ticker} Return`}
          value={r.market_return === null ? '—' : formatSigned(r.market_return * 100)}
          tooltip={`What ${r.market_ticker} returned over the same window.`}
        />
        <MetricTile label="Trading Days" value={String(r.n_days)} tooltip="Trading days in the window." />
      </div>
      <Interpretation>{replayInterpretation(r)}</Interpretation>
      <div>
        <Heading>Portfolio return and drawdown</Heading>
        <Suspense fallback={CHART_FALLBACK}>
          <ScenarioReplayChart data={replayCurve(r)} marketTicker={r.market_ticker} gain={r.portfolio_return >= 0} />
        </Suspense>
      </div>
      {bars.length > 0 && (
        <div>
          <Heading>Top winners &amp; losers (contribution to portfolio return)</Heading>
          <Suspense fallback={CHART_FALLBACK}>
            <ScenarioImpactChart data={bars} name="Contribution" />
          </Suspense>
        </div>
      )}
      {r.warnings.map((warning) => (
        <p key={warning} className="text-xs text-[var(--color-muted)]">
          ⚠ {warning}
        </p>
      ))}
    </div>
  )
}

function MarketShockCard({
  result,
  index,
  onRemove,
}: {
  result: MarketShockResult
  index: number
  onRemove: () => void
}): JSX.Element {
  const ticker = result.marketTicker
  return (
    <div className={CARD}>
      <CardHeader
        tag={`#${index + 1} · Market Shock`}
        title={`If ${ticker} moves ${formatSigned(result.movePct)}`}
        subtitle={`Each holding moves by its beta × the ${ticker} move; cash doesn't move. ${riskSummary(result.risk)}`}
        onRemove={onRemove}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <MetricTile
          label="Portfolio Impact"
          value={formatSigned(result.impact * 100)}
          tone={signTone(result.impact)}
          tooltip="Portfolio beta × the market move, cash included."
        />
        <MetricTile
          label="Portfolio Beta"
          value={result.portfolioBeta.toFixed(2)}
          tooltip={`How much the whole portfolio moves per 1% move in ${ticker}. Cash counts as 0.`}
        />
        <MetricTile label="Holdings" value={String(result.rows.length)} tooltip="Holdings included in the estimate." />
      </div>
      <div>
        <Heading>Per-holding impact (weight × beta × move)</Heading>
        <Suspense fallback={CHART_FALLBACK}>
          <ScenarioImpactChart data={shockBars(result)} name="Impact" />
        </Suspense>
      </div>
    </div>
  )
}

function VolShockCard({
  result,
  index,
  onRemove,
}: {
  result: VolShockResult
  index: number
  onRemove: () => void
}): JSX.Element {
  const base = (result.baseVol * 100).toFixed(1)
  const shocked = (result.shockedVol * 100).toFixed(1)
  const scale = result.scale.toFixed(1)
  return (
    <div className={CARD}>
      <CardHeader
        tag={`#${index + 1} · Vol Shock`}
        title={`Vol multiplier: ${scale}×`}
        subtitle={`Every holding's volatility scaled; correlations held fixed. ${riskSummary(result.risk)}`}
        onRemove={onRemove}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <MetricTile
          label="Base Vol"
          value={`${base}%`}
          tooltip="Annualised volatility of the whole portfolio now, cash included."
        />
        <MetricTile label="Shocked Vol" value={`${shocked}%`} tooltip="Base volatility × the multiplier." />
        <MetricTile
          label="Δ Vol"
          value={formatSigned((result.shockedVol - result.baseVol) * 100)}
          tooltip="Change in annualised volatility."
        />
      </div>
      <Interpretation>
        {`A ${scale}× vol shock moves annualised volatility from ${base}% to ${shocked}%. Daily swings would be roughly ${scale}× their usual size. With correlations held fixed this is exact arithmetic; in real crises correlations also rise, so treat it as a floor.`}
      </Interpretation>
    </div>
  )
}

export function ScenarioCard({
  result,
  index,
  onRemove,
}: {
  result: ScenarioResult
  index: number
  onRemove: () => void
}): JSX.Element {
  switch (result.kind) {
    case 'historical':
      return <HistoricalCard result={result} index={index} onRemove={onRemove} />
    case 'market_shock':
      return <MarketShockCard result={result} index={index} onRemove={onRemove} />
    case 'vol_shock':
      return <VolShockCard result={result} index={index} onRemove={onRemove} />
  }
}
