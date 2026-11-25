import { useEffect, useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { useLocation } from 'react-router-dom'
import { sweepStore } from '../lib/sweepStore'
import { Tooltip } from './Tooltip'

const TOOLTIP =
  'Prices and fundamentals are refreshing in the background. You can keep using the app. The Universe table reloads itself when this finishes; other pages show the new data the next time you open them.'

export function SweepIndicator(): JSX.Element | null {
  const active = useSyncExternalStore(sweepStore.subscribe, sweepStore.isActive)
  const { pathname } = useLocation()

  // One check on app load and one per navigation. The store ignores checks while a watch runs,
  // and the backend starts a due sweep on each status request (contract 0196).
  useEffect(() => {
    sweepStore.check()
  }, [pathname])

  if (!active) return null

  return (
    <Tooltip label={TOOLTIP}>
      <span role="status" className="flex items-center gap-2 mx-2 md:mx-4 text-xs text-[var(--color-muted)]">
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent opacity-70 motion-safe:animate-spin"
        />
        <span className="hidden md:inline whitespace-nowrap">Updating universe data</span>
      </span>
    </Tooltip>
  )
}
