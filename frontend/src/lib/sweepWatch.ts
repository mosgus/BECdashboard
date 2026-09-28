export interface WatchSweepOptions<T> {
  poll: () => Promise<T>
  isActive: (result: T) => boolean
  onUpdate?: (result: T) => void
  onFinished: (result: T, polls: number) => void
  onTimeout: () => void
  intervalMs: number
  timeoutMs: number
}

export function watchSweep<T>(options: WatchSweepOptions<T>): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let polls = 0
  const maxPolls = 1 + Math.floor(options.timeoutMs / options.intervalMs)

  function scheduleNext(): void {
    if (cancelled) return
    if (polls >= maxPolls) {
      options.onTimeout()
      return
    }
    timer = setTimeout(runPoll, options.intervalMs)
  }

  function runPoll(): void {
    if (cancelled) return
    polls += 1

    let pending: Promise<T>
    try {
      pending = options.poll()
    } catch {
      scheduleNext()
      return
    }

    Promise.resolve(pending).then(
      (result) => {
        if (cancelled) return
        options.onUpdate?.(result)
        if (!options.isActive(result)) {
          options.onFinished(result, polls)
          return
        }
        scheduleNext()
      },
      () => {
        if (!cancelled) scheduleNext()
      },
    )
  }

  runPoll()

  return () => {
    cancelled = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
