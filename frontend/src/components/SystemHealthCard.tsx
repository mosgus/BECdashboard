import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { ApiError, getOpsStatus } from '../api/client'
import type { OpsStatus } from '../api/client'
import { relativeTime } from '../lib/relativeTime'
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

export function SystemHealthCard(): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)

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
    load()
  }, [])

  function handleRefreshClick(): void {
    setRefreshing(true)
    load()
  }

  const now = new Date()

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[17px] font-semibold text-foreground">System Health</h2>
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

      {state.status === 'loading' && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}

      {/* Unlike TickerStrip/NewsSection, which return null on failure so a slow market
          endpoint never breaks the launch page, this card shows the error inline — an ops
          page that silently renders nothing when the backend is unwell is useless exactly
          when it is needed. */}
      {state.status === 'error' && <p className="text-sm text-brand-negative">{state.message}</p>}

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
