import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ApiError, getJobRuns } from '../api/client'
import type { JobRun } from '../api/client'
import { formatDuration, summariseDetail } from '../lib/opsFormat'
import { relativeTime } from '../lib/relativeTime'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; runs: JobRun[] }

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-5'
const LIMIT = 10

// Derived from a lookup with a neutral fallback, so an unknown status renders muted rather
// than crashing — job_runs.status is a plain string column, not an enum the frontend controls.
const STATUS_PILL_COLOR: Record<string, string> = {
  success: 'bg-brand-positive/10 text-brand-positive',
  partial: 'bg-brand-accent/10 text-brand-accent',
  failure: 'bg-brand-negative/10 text-brand-negative',
}

function StatusPill({ status }: { status: string }): JSX.Element {
  const color = STATUS_PILL_COLOR[status] ?? 'bg-brand-border text-[var(--color-muted)]'
  return (
    <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${color}`}>
      {status}
    </span>
  )
}

function errorList(detail: Record<string, unknown> | null): string[] {
  const errors = detail?.errors
  return Array.isArray(errors) ? errors.map(String).filter((e) => e !== '') : []
}

export function JobRunsCard(): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })

  // No synchronous setState before this — state already initialises to 'loading', and this
  // runs directly inside the mount effect below. A setState here (even just to re-set
  // 'loading') would fire synchronously during the effect and trip oxlint's
  // set-state-in-effect rule the same way an earlier draft of UniversePage.tsx did.
  function load(): void {
    getJobRuns(LIMIT)
      .then((response) => setState({ status: 'ready', runs: response.job_runs }))
      .catch((err: unknown) => {
        setState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'Failed to load job runs.',
        })
      })
  }

  useEffect(() => {
    load()
  }, [])

  const now = new Date()

  return (
    <div className={CARD}>
      <h2 className="text-[17px] font-semibold text-foreground mb-4">Recent Job Runs</h2>

      {state.status === 'loading' && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}

      {/* Same inversion as SystemHealthCard: an error here must be visible, not silently
          swallowed the way TickerStrip/NewsSection handle a failed fetch elsewhere. */}
      {state.status === 'error' && <p className="text-sm text-brand-negative">{state.message}</p>}

      {state.status === 'ready' && state.runs.length === 0 && (
        <p className="text-sm text-[var(--color-muted)]">No job runs recorded yet.</p>
      )}

      {state.status === 'ready' && state.runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap">
                  Job
                </th>
                <th className="text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap">
                  Status
                </th>
                <th className="text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap">
                  Duration
                </th>
                <th className="text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap">
                  Finished
                </th>
                <th className="text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              {state.runs.map((run) => {
                const errors = errorList(run.detail)
                return (
                  <tr key={run.id}>
                    <td className="px-3 py-2.5 border-b border-brand-border font-mono text-xs whitespace-nowrap">
                      {run.job_name}
                    </td>
                    <td className="px-3 py-2.5 border-b border-brand-border">
                      <StatusPill status={run.status} />
                    </td>
                    <td className="px-3 py-2.5 border-b border-brand-border whitespace-nowrap">
                      {formatDuration(run.duration_ms)}
                    </td>
                    <td className="px-3 py-2.5 border-b border-brand-border whitespace-nowrap">
                      {run.finished_at === null ? '—' : relativeTime(run.finished_at, now)}
                    </td>
                    <td className="px-3 py-2.5 border-b border-brand-border">
                      <div>{summariseDetail(run.detail)}</div>
                      {errors.length > 0 && (
                        <div className="text-brand-negative text-xs mt-0.5">{errors.join(', ')}</div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
