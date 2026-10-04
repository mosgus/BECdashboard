import { formatPercent } from './format'
import { parsePortfolioCsv } from './portfolioCsv'

export interface PresetPreview {
  ok: boolean
  lines: string[]
  more: number
}

/** The first `limit` holdings of a preset CSV, for its admin card. */
export function presetPreview(csv: string, limit = 3): PresetPreview {
  const ownTickers = new Set(
    csv
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(',')[0].trim().toUpperCase())
      .filter((ticker) => ticker !== '' && ticker !== 'CASH'),
  )
  const result = parsePortfolioCsv(csv, ownTickers)
  if (!result.ok) return { ok: false, lines: [], more: 0 }
  const lines = result.seed.rows.map((row) =>
    result.seed.mode === 'weight'
      ? `${row.ticker} · ${formatPercent(Number(row.weight))}`
      : `${row.ticker} · ${row.shares} sh`,
  )
  return { ok: true, lines: lines.slice(0, limit), more: Math.max(0, lines.length - limit) }
}
