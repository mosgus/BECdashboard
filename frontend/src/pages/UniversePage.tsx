import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { AddTickerForm } from '../components/AddTickerForm'
import { UniverseTable } from '../components/UniverseTable'
import { ApiError, getUniverse } from '../api/client'
import type { UniverseDetail, UniverseEntry } from '../api/client'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: UniverseEntry[] }

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)]'

export function UniversePage(): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })

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

  function handleRowRefreshed(detail: UniverseDetail): void {
    setState((prev) => {
      if (prev.status !== 'ready') return prev
      return {
        status: 'ready',
        entries: prev.entries.map((entry) => (entry.ticker === detail.ticker ? detail : entry)),
      }
    })
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
            Loading universe…
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
          <UniverseTable rows={state.entries} onRowRefreshed={handleRowRefreshed} />
        )}
      </main>
    </div>
  )
}
