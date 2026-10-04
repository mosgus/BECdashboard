import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { ApiError, forceUniverseRefresh, getOpsStatus } from '../api/client'
import type { OpsStatus } from '../api/client'
import { relativeTime } from '../lib/relativeTime'
import { watchSweep } from '../lib/sweepWatch'
import { Tooltip } from './Tooltip'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: OpsStatus }

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-5'

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string | null }): JSX.Element {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="text-sm font-semibold text-foreground mt-0.5">{value}</div>
      {sub && <div className="text-xs text-[var(--color-muted)] mt-0.5">{sub}</div>}
    </div>
  )
}

function relativeOrClosed(iso: string | null, now: Date, whenNull: string): string {
  return iso === null ? whenNull : relativeTime(iso, now)
}

export function SystemHealthCard({ onSweepFinished }: { onSweepFinished?: () => void }): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [watching, setWatching] = useState(false)
  const [forceError, setForceError] = useState<string | null>(null)
  const cancelWatch = useRef<(() => void) | null>(null)
  const mounted = useRef(false)

  // No synchronous setState before this — called directly inside the mount effect below, and
  // a setState synchronous with an effect's execution is exactly what oxlint's
  // set-state-in-effect rule flags (the same pattern behind UniversePage.tsx's baseline
  // warning). The Refresh button's own click handler sets `refreshing` itself, synchronously,
  // which is fine — that happens in an event handler, not during an effect.
  function load(): void {
    getOpsStatus()
      .then((data) => setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        setState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'Failed to load system status.',
        })
      })
      .finally(() => setRefreshing(false))
  }

  useEffect(() => {
    mounted.current = true
    load()
    return () => {
      mounted.current = false
      cancelWatch.current?.()
    }
  }, [])

  function handleRefreshClick(): void {
    setRefreshing(true)
    load()
  }

  function beginWatching(): void {
    setForceError(null)
    setWatching(true)
    cancelWatch.current?.()
    cancelWatch.current = watchSweep({
      poll: getOpsStatus,
      isActive: (status) => status.universe.sweep_active,
      onUpdate: (data) => setState({ status: 'ready', data }),
      onFinished: () => {
        setWatching(false)
        onSweepFinished?.()
      },
      onTimeout: () => {
        setWatching(false)
        setForceError('Still running — check Job history shortly.')
      },
      intervalMs: 5000,
      timeoutMs: 600000,
    })
  }

  function handleForceUpdateClick(): void {
    setForceError(null)
    forceUniverseRefresh().then(
      () => {
        if (mounted.current) beginWatching()
      },
      (err: unknown) => {
        if (!mounted.current) return
        if (err instanceof ApiError && err.status === 409) {
          beginWatching()
          return
        }
        setForceError(err instanceof ApiError ? err.message : 'Failed to start universe update.')
      },
    )
  }

  const now = new Date()

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[17px] font-semibold text-foreground">System Health</h2>
        <div className="flex items-center gap-2">
          <Tooltip label="Bring every universe ticker's price history and quotes up to date, fetch the latest news and write a fresh briefing now, without waiting for the next refresh window">
            <button
              type="button"
              onClick={handleForceUpdateClick}
              disabled={watching || state.status === 'loading'}
              className="text-xs font-medium px-3 py-1.5 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {watching ? 'Updating…' : 'Force update'}
            </button>
          </Tooltip>
          <Tooltip label="Re-read system status">
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={refreshing || state.status === 'loading'}
              className="text-xs font-medium px-3 py-1.5 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Refresh
            </button>
          </Tooltip>
        </div>
      </div>

      {state.status === 'loading' && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}

      {/* Unlike TickerStrip/NewsSection, which return null on failure so a slow market
          endpoint never breaks the launch page, this card shows the error inline — an ops
          page that silently renders nothing when the backend is unwell is useless exactly
          when it is needed. */}
      {state.status === 'error' && <p className="text-sm text-brand-negative">{state.message}</p>}
      {forceError && <p className="text-sm text-brand-negative">{forceError}</p>}

      {state.status === 'ready' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          <Stat
            label="Database"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    state.data.database.connected ? 'bg-brand-positive' : 'bg-brand-negative'
                  }`}
                />
                {state.data.database.connected ? 'Connected' : 'Disconnected'}
              </span>
            }
            sub={state.data.database.revision ? `Migration ${state.data.database.revision}` : '—'}
          />
          <Stat
            label="Universe"
            value={`${state.data.universe.active_tickers} tickers`}
            sub={`${state.data.universe.total_bars} bars · newest ${state.data.universe.newest_bar_date ?? '—'}`}
          />
          <Stat
            label="News"
            value={`${state.data.news.article_count} articles`}
            sub={relativeOrClosed(state.data.news.newest_fetched_at, now, '—')}
          />
          <Stat
            label="Briefing"
            value={state.data.briefing.exists ? 'Present' : 'None'}
            sub={
              state.data.briefing.exists
                ? `${state.data.briefing.model ?? 'unknown model'} · ${relativeOrClosed(state.data.briefing.created_at, now, '—')}`
                : undefined
            }
          />
          <Stat label="Gemini key" value={state.data.gemini_key_configured ? 'Configured' : 'Not configured'} />
          <Stat label="Python" value={state.data.python} />
          <Stat
            label="Last universe sweep"
            value={relativeOrClosed(state.data.windows.auto_refresh_last_claim, now, '—')}
          />
          <Stat
            label="Last news refresh"
            value={relativeOrClosed(state.data.windows.news_refresh_last_claim, now, '—')}
          />
          <Stat
            label="Current window"
            value={relativeOrClosed(state.data.windows.current_window_start, now, 'Closed')}
          />
        </div>
      )}
    </div>
  )
}
