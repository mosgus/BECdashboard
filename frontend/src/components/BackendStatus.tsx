import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { getHealth } from '../api/client'

type Status =
  | { kind: 'loading' }
  | { kind: 'success'; python: string }
  | { kind: 'error' }

export function BackendStatus(): JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    getHealth()
      .then((data) => {
        if (!cancelled) setStatus({ kind: 'success', python: data.python })
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [])

  const dotClass =
    status.kind === 'success'
      ? 'bg-brand-positive'
      : status.kind === 'error'
        ? 'bg-brand-negative'
        : 'bg-[var(--color-muted)] opacity-[0.45]'

  const label =
    status.kind === 'success'
      ? `API ${status.python}`
      : status.kind === 'error'
        ? 'API offline'
        : 'Connecting…'

  return (
    <div className="flex items-center gap-1 md:gap-2 flex-shrink-0 ml-0 md:ml-4">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
      <span className="hidden md:inline text-xs text-[var(--color-muted)] whitespace-nowrap">{label}</span>
    </div>
  )
}
