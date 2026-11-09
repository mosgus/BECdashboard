/** Wraps a loader so it runs at most once per page load. Every caller shares the same promise, both
 * while it's in flight and after it resolves. A rejection clears the cache, so the next call
 * retries instead of returning the old failure. */
export function cachedLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null

  return () => {
    if (cached === null) {
      cached = load().catch((err) => {
        cached = null
        throw err
      })
    }
    return cached
  }
}
