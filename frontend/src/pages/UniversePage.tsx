import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { AddTickerForm } from '../components/AddTickerForm'
import { UniverseTable } from '../components/UniverseTable'
import { FilterDialog } from '../components/FilterDialog'
import { ChartDialog } from '../components/ChartDialog'
import { DownloadIcon } from '../components/DownloadIcon'
import { Tooltip } from '../components/Tooltip'
import { ApiError, getUniverse, refreshTicker } from '../api/client'
import type { UniverseDetail, UniverseEntry } from '../api/client'
import { activeFilterCount, applyFilters, EMPTY_FILTERS } from '../lib/filters'
import type { FilterState } from '../lib/filters'

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
  const messages = ['Loading universe…', 'Loading takes up to 90s…', 'Bazinga 😃']
  const [state, setState] = useState<State>({ status: 'loading' })
  const [messageIndex, setMessageIndex] = useState(0)
  const [bulkRefresh, setBulkRefresh] = useState<BulkRefreshState>({ status: 'idle' })
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setMessageIndex((prev) => (prev + 1) % 3), 3000)
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

  const totalCount = state.status === 'ready' ? state.entries.length : 0

  const bulkRefreshLabel =
    bulkRefresh.status === 'running'
      ? `Updating ${bulkRefresh.completed + 1} of ${bulkRefresh.total}…`
      : `Update all data ${totalCount}`

  const filterResult = state.status === 'ready' ? applyFilters(state.entries, filters) : null
  const activeCount = activeFilterCount(filters)
  const isFiltering = filters.query.trim() !== '' || activeCount > 0

  function clearAllFilters(): void {
    setFilters(EMPTY_FILTERS)
  }

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
            {messages[messageIndex]}
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
            <div className="flex items-center gap-2 mb-3">
              <Tooltip label="Filter the table by type, sector, price, market cap, P/E or yield">
                <button
                  type="button"
                  onClick={() => setFilterDialogOpen(true)}
                  className="inline-flex items-center gap-1.5 flex-shrink-0 text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                  >
                    <path d="M3 5h18M7 12h10M10 19h4" />
                  </svg>
                  <span className="hidden sm:inline">Filters</span>
                  {activeCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-brand-primary text-white text-[0.6875rem] font-semibold">
                      {activeCount}
                    </span>
                  )}
                </button>
              </Tooltip>

              <div className="relative flex-1 min-w-[9rem]">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none"
                >
                  <circle cx={11} cy={11} r={7} />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <Tooltip label="Show only rows whose ticker or company name matches">
                  <input
                    type="text"
                    value={filters.query}
                    onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
                    placeholder="Search ticker or name"
                    autoComplete="off"
                    className="w-full text-sm pl-8 pr-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-background text-foreground"
                  />
                </Tooltip>
              </div>

              {isFiltering && (
                <Tooltip label="Clear every filter and the search box">
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="flex-shrink-0 text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
                  >
                   Ｘ Reset Filters
                  </button>
                </Tooltip>
              )}

              <Tooltip label="Fetch any missing price history for every ticker, up to the last close">
                <button
                  type="button"
                  onClick={() => void handleRefreshAll()}
                  disabled={bulkRefresh.status === 'running'}
                  className={`flex-shrink-0 text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-primary text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${bulkRefresh.status === 'running' ? 'pointer-events-none' : ''}`}
                >
                  {bulkRefreshLabel}
                </button>
              </Tooltip>
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

            <p className="text-xs mb-3 min-h-[1rem]">
              {isFiltering && filterResult && (
                <>
                  {`Showing ${filterResult.shown.length} of ${state.entries.length}`}
                  {filterResult.hiddenForMissingData > 0 && (
                    <span className="text-brand-accent">
                      {` · ${filterResult.hiddenForMissingData} hidden — no ${filterResult.missingFields.join(', ')} data`}
                    </span>
                  )}
                </>
              )}
            </p>

            {filterResult && filterResult.shown.length === 0 && isFiltering ? (
              <div className={`${CARD} p-16 text-center text-[var(--color-muted)]`}>
                No securities match these filters.
              </div>
            ) : (
              <UniverseTable
                rows={filterResult ? filterResult.shown : state.entries}
                onRowClick={setSelectedTicker}
              />
            )}

            <div className="flex justify-end mt-4">
              <Tooltip label="Download every ticker's price history as a single zip">
                <a
                  href={`${import.meta.env.VITE_API_URL}/universe/export.zip`}
                  className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
                >
                  <DownloadIcon />
                  <span>Download Universe</span>
                </a>
              </Tooltip>
            </div>

            <FilterDialog
              open={filterDialogOpen}
              rows={state.entries}
              filters={filters}
              onChange={setFilters}
              onClose={() => setFilterDialogOpen(false)}
            />

            <ChartDialog
              ticker={selectedTicker}
              entry={state.entries.find((entry) => entry.ticker === selectedTicker) ?? null}
              onClose={() => setSelectedTicker(null)}
            />
          </>
        )}
      </main>
    </div>
  )
}
