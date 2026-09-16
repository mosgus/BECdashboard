const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** "3h ago", "2d ago", "just now" under a minute, "" for null or an unparseable date. Takes
 * `now` as an argument and never reads the system clock itself — the same discipline as
 * lib/ranges.ts and lib/change.ts; a function that constructs today's date internally cannot
 * be tested.
 *
 * A negative gap (a pub_date briefly ahead of `now`, e.g. clock skew) is clamped to zero
 * rather than rendering a negative duration. */
export function relativeTime(iso: string | null, now: Date): string {
  if (iso === null) return ''

  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const diffMs = Math.max(0, now.getTime() - then.getTime())

  if (diffMs < MINUTE_MS) return 'just now'
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`
  return `${Math.floor(diffMs / DAY_MS)}d ago`
}
