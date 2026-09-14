import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { AddTickerForm } from '../components/AddTickerForm'
import { UniverseTable } from '../components/UniverseTable'
import { ApiError, getUniverse, refreshTicker } from '../api/client'
import type { UniverseDetail, UniverseEntry } from '../api/client'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: UniverseEntry[] }

interface RefreshFailure {
  ticker: string
  message: string
}

type BulkRefreshState =
  | { status: 'idle' }
  | { status: 'running'; completed: number; total: number }
  | { status: 'done'; total: number; failures: RefreshFailure[] }

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)]'

export function UniversePage(): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [showHint, setShowHint] = useState(false)
  const [bulkRefresh, setBulkRefresh] = useState<BulkRefreshState>({ status: 'idle' })
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setShowHint((prev) => !prev), 3000)
    return () => clearInterval(interval)
  }, [])

  function load(): void {
    setState({ status: 'loading' })
    // Clear a lingering "done" summary from a previous run — but never stomp on an
    // active one: AddTickerForm can call load() while a bulk refresh is still running
    // (they're deliberately not coupled), and that run's progress must survive.
    setBulkRefresh((prev) => (prev.status === 'running' ? prev : { status: 'idle' }))
    getUniverse()
      .then((entries) => setState({ status: 'ready', entries }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 503) {
          setState({
            status: 'error',
            message: 'Database not configured — the backend is running without persistence.',
          })
          return
        }
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load the universe.',
        })
      })
  }

  useEffect(() => {
    load()
  }, [])

  function patchRow(detail: UniverseDetail): void {
    setState((prev) => {
      if (prev.status !== 'ready') return prev
      return {
        status: 'ready',
        entries: prev.entries.map((entry) => (entry.ticker === detail.ticker ? detail : entry)),
      }
    })
  }

  async function handleRefreshAll(): Promise<void> {
    if (state.status !== 'ready' || state.entries.length === 0) return
    if (bulkRefresh.status === 'running') return

    // Snapshot now — adding a ticker mid-run must not change what this loop iterates.
    const tickers = state.entries.map((entry) => entry.ticker)
    setBulkRefresh({ status: 'running', completed: 0, total: tickers.length })

    const failures: RefreshFailure[] = []
    for (const ticker of tickers) {
      // Navigating away must stop the work, not just the re-renders — without this, every
      // remaining ticker still fires its request after unmount.
      if (!isMountedRef.current) break

      try {
        const result = await refreshTicker(ticker)
        if (isMountedRef.current) patchRow(result.detail)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'refresh failed'
        console.error(`Bulk refresh failed for ${ticker}:`, err)
        failures.push({ ticker, message })
      }
      if (isMountedRef.current) {
        setBulkRefresh((prev) =>
          prev.status === 'running' ? { ...prev, completed: prev.completed + 1 } : prev
        )
      }
    }

    if (isMountedRef.current) {
      setBulkRefresh({ status: 'done', total: tickers.length, failures })
    }
  }

  const bulkRefreshLabel =
    bulkRefresh.status === 'running'
      ? `Refreshing ${bulkRefresh.completed + 1} of ${bulkRefresh.total}…`
      : 'Refresh all'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <div className="flex items-end justify-between gap-6 flex-wrap mb-7">
          <div>
            <h1 className="text-[1.875rem] font-bold tracking-tight text-brand-primary">
              Universe
            </h1>
            <p className="text-[0.9375rem] font-light text-[var(--color-muted)] mt-1.5">
              Securities tracked for analysis. Data is shared and persists across sessions.
            </p>
          </div>
          <AddTickerForm onAdded={load} />
        </div>

        {state.status === 'loading' && (
          <div className={`${CARD} p-16 text-center text-[var(--color-muted)]`}>
            {showHint ? 'Loading takes up to 90s…' : 'Loading universe…'}
          </div>
        )}

        {state.status === 'error' && (
          <div className={`${CARD} p-16 text-center`}>
            <p className="text-sm text-[var(--color-muted)] mb-4">{state.message}</p>
            <button
              type="button"
              onClick={load}
              className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
            >
              Retry
            </button>
          </div>
        )}

        {state.status === 'ready' && state.entries.length === 0 && (
          <div className={`${CARD} p-16 text-center`}>
            <h2 className="text-lg font-semibold mb-2">No securities yet</h2>
            <p className="text-sm text-[var(--color-muted)] max-w-md mx-auto leading-relaxed">
              Add a ticker above to start building the universe. Ten years of daily price history
              and current fundamentals are fetched on add — expect it to take a few seconds.
            </p>
          </div>
        )}

        {state.status === 'ready' && state.entries.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-4 mb-3">
              <button
                type="button"
                onClick={() => void handleRefreshAll()}
                disabled={bulkRefresh.status === 'running'}
                className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkRefreshLabel}
              </button>
            </div>

            {bulkRefresh.status === 'running' && (
              <div className="w-full h-1.5 bg-brand-border rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-brand-primary transition-[width]"
                  style={{ width: `${(bulkRefresh.completed / bulkRefresh.total) * 100}%` }}
                />
              </div>
            )}

            {bulkRefresh.status === 'done' && (
              <p
                className={`text-xs mb-3 ${
                  bulkRefresh.failures.length > 0
                    ? 'text-brand-negative'
                    : 'text-[var(--color-muted)]'
                }`}
              >
                {bulkRefresh.failures.length === 0
                  ? `Refreshed all ${bulkRefresh.total}.`
                  : `Refreshed ${bulkRefresh.total - bulkRefresh.failures.length} of ${bulkRefresh.total} — ${bulkRefresh.failures.length} failed: ${bulkRefresh.failures
                      .map((f) => `${f.ticker} (${f.message})`)
                      .join(', ')}`}
              </p>
            )}

            <UniverseTable rows={state.entries} />
          </>
        )}
      </main>
    </div>
  )
}
