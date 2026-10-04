import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { calibratePortfolio } from '../../../api/client'
import type { CalibrationResponse, MonteCarloRequest } from '../../../api/client'
import { CALIBRATION_NOTE, calibrationRequest, calibrationRows } from '../../../lib/calibration'

const TH =
  'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border'
const TD = 'px-3 py-2.5 border-b border-brand-border'
const NUMERIC = `${TD} text-right tabular-nums whitespace-nowrap`
type State =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ready'; response: CalibrationResponse }
  | { status: 'error'; message: string }

export default function CalibrationPanel({ request }: { request: MonteCarloRequest }): JSX.Element {
  const [state, setState] = useState<State>({ status: 'idle' })
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  if (request.model === 'prophet') {
    return (
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        Calibration does not cover Prophet, which is untested by design.
      </div>
    )
  }
  function check(): void {
    setState({ status: 'running' })
    void calibratePortfolio(calibrationRequest(request))
      .then((response) => {
        if (mountedRef.current) setState({ status: 'ready', response })
      })
      .catch((error: unknown) => {
        if (mountedRef.current)
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'The calibration request failed.',
          })
      })
  }
  const rows = state.status === 'ready' ? calibrationRows(state.response) : []
  return (
    <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
      <h2 className="text-sm font-semibold">Calibration</h2>
      <p className="mt-2 text-xs text-[var(--color-muted)]">{CALIBRATION_NOTE}</p>
      <button
        type="button"
        onClick={check}
        disabled={state.status === 'running'}
        className="inline-flex mt-4 px-4 py-3 text-sm rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text font-semibold disabled:opacity-50"
      >
        {state.status === 'running' ? 'Checking…' : 'Check calibration'}
      </button>
      {state.status === 'error' && <p className="mt-3 text-sm text-brand-negative">{state.message}</p>}
      {state.status === 'ready' && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>Horizon</th>
                <th className={TH}>Windows</th>
                <th className={`${TH} text-right`}>Inside 90% band</th>
                <th className={`${TH} text-right`}>Inside 50% band</th>
                <th className={`${TH} text-right`}>Misses (90%)</th>
                <th className={TH}>Reading</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.horizon}>
                  <td className={TD}>{row.horizon}</td>
                  <td className={TD}>{row.windows}</td>
                  <td className={NUMERIC}>{row.inside90}</td>
                  <td className={NUMERIC}>{row.inside50}</td>
                  <td className={NUMERIC}>{row.misses}</td>
                  <td className={`${TD}${row.flagged ? ' text-brand-negative' : ''}`}>{row.reading}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
