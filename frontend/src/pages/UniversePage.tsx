import { Suspense, lazy, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { AddTickerForm } from '../components/AddTickerForm'
import { UniverseTable } from '../components/UniverseTable'
import { FilterDialog } from '../components/FilterDialog'
import { DownloadIcon } from '../components/DownloadIcon'
import { Tooltip } from '../components/Tooltip'
import { ApiError, getUniverse } from '../api/client'
import type { UniverseEntry } from '../api/client'
import { activeFilterCount, applyFilters, EMPTY_FILTERS } from '../lib/filters'
import type { FilterState } from '../lib/filters'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: UniverseEntry[] }

/** Lazy so recharts (9.3 MB on disk, ~400 kB of the bundle) is not in the initial download.
 * Nothing on the launch page charts anything, and most Universe visits never open a chart.
 * Gated on `selectedTicker` below as well as lazily imported — kept mounted-and-returning-null,
 * the chunk would still be fetched on page load and the split would buy nothing. */
const ChartDialog = lazy(() =>
  import('../components/ChartDialog').then((m) => ({ default: m.ChartDialog })),
)

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)]'

export function UniversePage(): JSX.Element {
  const messages = ['Loading universe…', 'Loading takes <60s…', 'Still loading…']
  const [state, setState] = useState<State>({ status: 'loading' })
  const [messageIndex, setMessageIndex] = useState(0)
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  useEffect(() => {
    const interval = setInterval(() => setMessageIndex((prev) => (prev + 1) % 3), 3000)
    return () => clearInterval(interval)
  }, [])

  function load(): void {
    setState({ status: 'loading' })
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

  // Warm the lazy chart chunk in the background once the table is on screen. Without this the
  // first row click waits on a ~103 kB download behind `fallback={null}`, which reads as the
  // click having done nothing. Preloading after mount keeps the initial bundle small *and* makes
  // the dialog feel instant, which a Suspense spinner would not.
  useEffect(() => {
    void import('../components/ChartDialog')
  }, [])

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
          {/* The form normally lives in the controls row below, but that row only renders once
              the universe has entries — without this fallback an empty universe would have no
              way to add the first ticker. */}
          {!(state.status === 'ready' && state.entries.length > 0) && (
            <AddTickerForm onAdded={load} />
          )}
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

              <div className="flex-shrink-0">
                <AddTickerForm onAdded={load} />
              </div>
            </div>

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

            {selectedTicker !== null && (
              <Suspense fallback={null}>
                <ChartDialog
                  ticker={selectedTicker}
                  entry={state.entries.find((entry) => entry.ticker === selectedTicker) ?? null}
                  onClose={() => setSelectedTicker(null)}
                  onDeleted={() => {
                    setSelectedTicker(null)
                    load()
                  }}
                />
              </Suspense>
            )}
          </>
        )}
      </main>
    </div>
  )
}
