import { getSweepStatus } from '../api/client'
import { clearSharedRequests } from './sharedRequests'
import { watchSweep } from './sweepWatch'

export interface SweepStoreOptions {
  poll: () => Promise<{ active: boolean }>
  intervalMs: number
  timeoutMs: number
}

export interface SweepStore {
  /** Current value. Stable between changes, so it is a valid useSyncExternalStore snapshot. */
  isActive: () => boolean
  /** Called whenever isActive() changes value, and only then. Returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void
  /** Called once each time a watch that saw `active: true` later sees `active: false`.
   *  Not called on timeout. Not called when a watch never saw an active poll. Returns an
   *  unsubscribe function. */
  onEnded: (listener: () => void) => () => void
  /** Starts a watch unless one is already running; if so, does nothing. */
  check: () => void
}

export function createSweepStore(options: SweepStoreOptions): SweepStore {
  let active = false
  let watching = false
  const changeListeners = new Set<() => void>()
  const endedListeners = new Set<() => void>()

  function setActive(value: boolean): void {
    if (value === active) return
    active = value
    for (const listener of [...changeListeners]) listener()
  }

  function check(): void {
    if (watching) return
    watching = true
    // A flag, not `polls > 1`: a rejected first poll followed by an inactive one makes polls 2
    // without any sweep having run.
    let sawActive = false
    watchSweep({
      poll: options.poll,
      isActive: (status) => status.active,
      onUpdate: (status) => {
        if (status.active) sawActive = true
        setActive(status.active)
      },
      onFinished: () => {
        watching = false
        setActive(false)
        if (sawActive) for (const listener of [...endedListeners]) listener()
      },
      onTimeout: () => {
        watching = false
        setActive(false)
      },
      intervalMs: options.intervalMs,
      timeoutMs: options.timeoutMs,
    })
  }

  return {
    isActive: () => active,
    subscribe: (listener) => {
      changeListeners.add(listener)
      return () => {
        changeListeners.delete(listener)
      }
    },
    onEnded: (listener) => {
      endedListeners.add(listener)
      return () => {
        endedListeners.delete(listener)
      }
    },
    check,
  }
}

/** One watcher for the whole app, rendered by the header. The shared portfolio request cache is
 * cleared whenever a watched sweep ends, whichever page the user is on. */
export const sweepStore = createSweepStore({
  poll: getSweepStatus,
  intervalMs: 10_000,
  timeoutMs: 600_000,
})
sweepStore.onEnded(clearSharedRequests)
