/** "840ms" under a second, else "19.5s". Null → "—". Real durations are seconds, not
 * milliseconds — a universe sweep measures around 19,500ms. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** A job run's detail object as one compact line, e.g. "22 tickers · 2 refreshed". Null or
 * empty → "".
 *
 * Generic over the keys, not a switch on the job that wrote them — the two jobs today write
 * different shapes and a third will write a third; a renderer that knows the key names breaks
 * silently the moment one changes. A key is skipped when its value is null, undefined, an
 * empty array, or an empty string. An array value renders as its joined contents. The
 * "errors" key is omitted entirely — JobRunsCard renders it separately, in the negative
 * colour, so including it here would print it twice. */
export function summariseDetail(detail: Record<string, unknown> | null): string {
  if (detail === null) return ''

  const parts: string[] = []
  for (const [key, value] of Object.entries(detail)) {
    if (key === 'errors') continue
    if (value === null || value === undefined || value === '') continue

    if (Array.isArray(value)) {
      if (value.length === 0) continue
      parts.push(`${value.join(', ')} ${key}`)
      continue
    }

    // A nested object — jobrun.py writes detail["error"] = {type, message} on a failed run.
    // String() on that yields "[object Object]", which is the least useful thing this card
    // could say in the one situation it exists for. Render the values instead: the error case
    // becomes "RuntimeError: connection refused", and it stays generic over the keys.
    if (typeof value === 'object') {
      const inner = Object.values(value as Record<string, unknown>).map(String).filter(Boolean)
      if (inner.length === 0) continue
      parts.push(inner.join(': '))
      continue
    }

    // A true flag reads better as the bare noun — "briefing", not "true briefing". A false one
    // says nothing worth a slot.
    if (typeof value === 'boolean') {
      if (value) parts.push(key)
      continue
    }

    parts.push(`${String(value)} ${key}`)
  }

  return parts.join(' · ')
}
