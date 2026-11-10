export interface RequestCacheOptions {
  /** How long a stored result stays valid, in milliseconds. */
  ttlMs: number
  /** Most results kept at once; the oldest-stored is dropped first. */
  maxEntries: number
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number
}

/** Wraps a request function so identical requests share one result. */
export function memoizeRequest<Req, Res>(
  fetcher: (request: Req) => Promise<Res>,
  options: RequestCacheOptions,
): (request: Req) => Promise<Res> {
  const cache = new Map<string, { promise: Promise<Res>; createdAt: number }>()
  const now = options.now ?? (() => Date.now())

  return (request: Req): Promise<Res> => {
    const key = JSON.stringify(request) ?? ''

    // Check for cache hit
    const entry = cache.get(key)
    if (entry !== undefined && now() - entry.createdAt < options.ttlMs) {
      return entry.promise
    }

    // Cache miss: fetch and store
    const promise = fetcher(request)

    // Delete old entry if it exists
    if (cache.has(key)) {
      cache.delete(key)
    }

    // Store new entry (moves to end of insertion order)
    cache.set(key, { promise, createdAt: now() })

    // Evict oldest entries if over capacity
    while (cache.size > options.maxEntries) {
      const firstKey = cache.keys().next().value as string
      cache.delete(firstKey)
    }

    // Handle rejection cleanup
    void promise.catch(() => {
      // Only delete if the map still holds this same promise for the key
      if (cache.get(key)?.promise === promise) {
        cache.delete(key)
      }
    })

    return promise
  }
}
