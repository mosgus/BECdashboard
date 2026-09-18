/** The display label for a stored quote_type. Yahoo's vocabulary is EQUITY / ETF / INDEX,
 *  stored verbatim from .info's quoteType or the chart endpoint's instrumentType — the two
 *  agree. null means we have no fundamentals row yet, which is a different claim from
 *  "equity" and must not be rendered as one. An unrecognised value is title-cased rather
 *  than swallowed: MUTUALFUND and CURRENCY exist and a silent "Equity" would be a lie. */
export function typeLabel(quoteType: string | null): string {
  if (quoteType === null) return '—'

  const upper = quoteType.toUpperCase()

  if (upper === 'EQUITY') return 'Equity'
  if (upper === 'ETF') return 'ETF'
  if (upper === 'INDEX') return 'Index'

  // Title case for unknown values
  if (quoteType.length === 0) return quoteType
  return quoteType.charAt(0).toUpperCase() + quoteType.slice(1).toLowerCase()
}
