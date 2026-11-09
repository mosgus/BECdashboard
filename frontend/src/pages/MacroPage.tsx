import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ApiError, getMacroScorecard } from '../api/client'
import type { MacroScorecardResponse } from '../api/client'
import { MacroFundamentals } from '../components/MacroFundamentals'
import { MacroQuadrant } from '../components/MacroQuadrant'
import { MacroScorecard } from '../components/MacroScorecard'
import { cachedLoader } from '../lib/macroStore'
import '../styles/macro.css'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: MacroScorecardResponse }

type Tab = 'equity' | 'econ'

// One fetch per page load. Coming back to the tab reuses it, and a reload asks the server, which
// answers 304 when the snapshot is unchanged.
const loadMacroScorecard = cachedLoader(getMacroScorecard)

/** The scorecard project's Market Scorecards page (scorecard.html), rendered natively: a
 * Developed / Emerging switch, then the equity scorecard with its macro-vs-market quadrant and
 * fundamentals charts, or the economic scorecard. Data is a static snapshot (GET /macro/scorecard). */
export function MacroPage(): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('equity')

  useEffect(() => {
    loadMacroScorecard()
      .then((data) => setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        setState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'Failed to load the macro scorecard.',
        })
      })
  }, [])

  // The snapshot carries licensed vendor data (FactSet, Bloomberg, S&P Global); the scorecard
  // project asks for the page to be kept out of search indexes at minimum.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  const groups = state.status === 'ready' ? state.data.groups : []
  const group = groups.find((g) => g.key === groupKey) ?? groups[0]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="viz-root max-w-[1120px] mx-auto px-4 sm:px-6 pt-10 pb-20">
        <div className="mb-7">
          <h1 className="text-[1.875rem] font-bold tracking-tight text-brand-primary">Macro</h1>
          <p className="text-[0.9375rem] font-light text-[var(--color-muted)] mt-1.5">
            Macro analysis of the broader economy & financial markets.
          </p>
        </div>

        {state.status === 'loading' && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}
        {state.status === 'error' && <p className="text-sm text-brand-negative">{state.message}</p>}

        {group && (
          <>
            <div className="tabbar groupbar" role="group" aria-label="Market group">
              {groups.map((g) => (
                <button key={g.key} type="button" aria-pressed={g.key === group.key} onClick={() => setGroupKey(g.key)}>
                  {g.label}
                </button>
              ))}
            </div>
            <div className="tabbar" role="group" aria-label="Scorecard">
              <button type="button" aria-pressed={tab === 'equity'} onClick={() => setTab('equity')}>
                Equity Scorecard
              </button>
              <button type="button" aria-pressed={tab === 'econ'} onClick={() => setTab('econ')}>
                Economic Scorecard
              </button>
            </div>

            {tab === 'equity' ? (
              <div key={group.key}>
                <MacroScorecard scorecard={group.equity} />
                <MacroQuadrant groupKey={group.key} groupLabel={group.label} points={group.quadrant} />
                <MacroFundamentals
                  groupLabel={group.label}
                  regions={group.charts.regions}
                  metrics={group.charts.metrics}
                />
              </div>
            ) : (
              <MacroScorecard key={group.key} scorecard={group.econ} econ />
            )}
          </>
        )}
      </main>
    </div>
  )
}
