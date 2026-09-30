import { isSharesBased, WEIGHT_EPSILON } from './portfolio'
import type { EntryMode, Portfolio } from './portfolio'

export interface SeedRow {
  ticker: string
  shares: string
  weight: string
}

export interface DraftSeed {
  name: string
  mode: EntryMode
  cash: string
  rows: SeedRow[]
}

export interface DroppedRow {
  ticker: string
  weightPct: number | null
}

export interface TargetAdjustment {
  ticker: string
  fromPct: number
  toPct: number
  fileTotalPct: number
}

export type CsvImportResult =
  | { ok: true; seed: DraftSeed; dropped: DroppedRow[]; adjustment?: TargetAdjustment; zeroTargets?: string[] }
  | { ok: false; error: string; line: number | null }

interface CsvRow {
  fields: string[]
  line: number
}

interface ParsedCsv {
  rows: CsvRow[]
  error: string | null
  line: number | null
}

interface ParsedPosition {
  ticker: string
  shares: string
  weight: string
  weightPct: number | null
  line: number
}

const MAX_INPUT_LENGTH = 1_000_000
const MAX_DATA_ROWS = 5000
/** Exports before 2026-09-21 opened with this line, followed by `# name: <name>`. Contract 0067
 *  stopped writing both — the name now travels in the filename — but the reader keeps them so
 *  previously-exported files still import. Do not remove: files in this format exist on disk. */
const LEGACY_MARKER = '# Blue Eagle Portfolio v1'

function failure(error: string, line: number | null): CsvImportResult {
  return { ok: false, error, line }
}

function parseCsv(text: string): ParsedCsv {
  const rows: CsvRow[] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  let atFieldStart = true
  let line = 1
  let rowLine = 1

  const finishRow = () => {
    fields.push(field)
    rows.push({ fields, line: rowLine })
    fields = []
    field = ''
    atFieldStart = true
    rowLine = line + 1
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        if (character === '\r' && text[index + 1] === '\n') index += 1
        if (character === '\r' || character === '\n') line += 1
        field += character === '\r' ? '\n' : character
      }
      continue
    }

    if (character === '"') {
      if (!atFieldStart) return { rows, error: 'Unexpected quote in a CSV field', line, }
      quoted = true
      atFieldStart = false
    } else if (character === ',') {
      fields.push(field)
      field = ''
      atFieldStart = true
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      finishRow()
      line += 1
    } else {
      field += character
      atFieldStart = false
    }
  }

  if (quoted) return { rows, error: 'Unclosed quoted CSV field', line }
  if (fields.length > 0 || field !== '' || text.length > 0 && !text.endsWith('\n') && !text.endsWith('\r')) {
    fields.push(field)
    rows.push({ fields, line: rowLine })
  }
  return { rows, error: null, line: null }
}

function isBlank(row: CsvRow): boolean {
  return row.fields.every((field) => field.trim() === '')
}

function headerIndex(row: CsvRow, names: readonly string[]): number | null {
  const index = row.fields.findIndex((field) => names.includes(field.trim().toLowerCase()))
  return index === -1 ? null : index
}

function cell(row: CsvRow, index: number | null): string {
  return index === null ? '' : (row.fields[index] ?? '')
}

function finitePositive(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function datePart(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field
}

export function parsePortfolioCsv(text: string, universeTickers: ReadonlySet<string>): CsvImportResult {
  if (text.trim() === '') return failure('Choose a non-empty CSV file', null)
  if (text.length > MAX_INPUT_LENGTH) return failure('CSV files must be 1 MB or smaller', null)

  const normalized = text.startsWith('\uFEFF') ? text.slice(1) : text
  const sourceLines = normalized.split(/\r\n|\n/)
  const canonical = sourceLines[0] === LEGACY_MARKER
  let leadingCommentLines = 0
  while (sourceLines[leadingCommentLines]?.trimStart().startsWith('#')) leadingCommentLines += 1
  const parsed = parseCsv(sourceLines.slice(leadingCommentLines).join('\n'))
  if (parsed.error !== null) return failure(parsed.error, parsed.line === null ? null : parsed.line + leadingCommentLines)
  for (const row of parsed.rows) row.line += leadingCommentLines

  let name = ''
  if (canonical && sourceLines[1]?.startsWith('# name:')) name = sourceLines[1].slice('# name:'.length).trim()

  let header: CsvRow | null = null
  let tickerIndex: number | null = null
  let weightIndex: number | null = null
  let sharesIndex: number | null = null
  let targetWeights = false
  let headerRowIndex = -1
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const row = parsed.rows[index]
    if (isBlank(row) || (row.fields.length === 1 && row.fields[0].trim().startsWith('#'))) continue
    const candidateTickerIndex = headerIndex(row, ['ticker', 'symbol'])
    if (candidateTickerIndex !== null) {
      header = row
      tickerIndex = candidateTickerIndex
      const targetWeightIndex = headerIndex(row, ['target_pct'])
      const targetSharesIndex = headerIndex(row, ['target_shares'])
      targetWeights = targetWeightIndex !== null
      weightIndex = targetWeightIndex ?? headerIndex(row, ['weight_pct', 'weight'])
      sharesIndex = targetSharesIndex ?? headerIndex(row, ['shares', 'quantity', 'qty'])
      headerRowIndex = index
      break
    }
  }
  if (header === null || tickerIndex === null) {
    const firstCandidate = parsed.rows.find((row) => !isBlank(row))
    return failure('No header row with a ticker or symbol column was found', firstCandidate?.line ?? null)
  }

  const dataRows = parsed.rows.slice(headerRowIndex + 1).filter((row) => !isBlank(row))
  if (dataRows.length > MAX_DATA_ROWS) return failure('CSV files may contain at most 5000 data rows', dataRows[MAX_DATA_ROWS].line)
  if (dataRows.length === 0) return failure('The CSV has no data rows', null)

  if (targetWeights) {
    const shorts: Array<{ ticker: string; raw: string; line: number }> = []
    for (const row of dataRows) {
      const ticker = cell(row, tickerIndex).trim().toUpperCase()
      if (ticker === '' || ticker === 'CASH') continue
      const raw = cell(row, weightIndex)
      if (raw.trim() === '') continue
      const value = Number(raw)
      if (!Number.isFinite(value)) return failure(`Target weight for ${ticker} must be a number`, row.line)
      if (value < 0) shorts.push({ ticker, raw, line: row.line })
    }
    if (shorts.length > 0) {
      return failure(`Short target weights can't be imported: ${shorts.map((short) => `${short.ticker} (${short.raw.trim()}%)`).join(', ')}. Portfolios hold long positions only; re-run the optimizer with shorting turned off.`, shorts[0].line)
    }
  }

  const mode: EntryMode = targetWeights || weightIndex !== null ? 'weight' : sharesIndex !== null ? 'shares' : 'weight'
  const seen = new Set<string>()
  const positions: ParsedPosition[] = []
  let statedCash: { raw: string; value: number; line: number } | null = null
  let cashDollars: string | null = null
  let positionWeightTotal = 0
  const zeroTargets: string[] = []

  for (const row of dataRows) {
    const tickerRaw = cell(row, tickerIndex)
    const ticker = tickerRaw.trim().toUpperCase()
    const weight = cell(row, weightIndex)
    const shares = cell(row, sharesIndex)
    const hasOtherValue = row.fields.some((value, index) => index !== tickerIndex && value.trim() !== '')
    if (ticker === '') {
      if (hasOtherValue) return failure('A row with values needs a ticker', row.line)
      continue
    }
    if (targetWeights && ticker !== 'CASH' && weight.trim() !== '' && Number(weight) === 0) {
      zeroTargets.push(ticker)
      continue
    }
    if (seen.has(ticker)) return failure(`Duplicate ticker: ${ticker}`, row.line)
    seen.add(ticker)

    if (mode === 'shares' && ticker === 'CASH') {
      const dollars = Number(shares)
      if (shares.trim() === '' || !Number.isFinite(dollars) || dollars < 0) {
        return failure('CASH needs a dollar amount of zero or greater in the shares column', row.line)
      }
      cashDollars = shares.trim()
      continue
    }

    let weightPct: number | null = null
    if (sharesIndex !== null && shares.trim() !== '' && finitePositive(shares) === null) {
      return failure(`Shares for ${ticker} must be a finite number greater than zero`, row.line)
    }

    if (ticker === 'CASH') {
      const cashValue = Number(weight)
      if (weight.trim() === '' || !Number.isFinite(cashValue) || cashValue < 0) {
        return failure('CASH needs a finite weight of zero or greater', row.line)
      }
      weightPct = cashValue
      statedCash = { raw: weight, value: weightPct, line: row.line }
      continue
    }

    if (weightIndex !== null && weight.trim() !== '') {
      weightPct = finitePositive(weight)
      if (weightPct === null) return failure(`Weight for ${ticker} must be a finite number greater than zero`, row.line)
    }

    if (weightPct !== null) positionWeightTotal += weightPct
    positions.push({ ticker, shares, weight, weightPct, line: row.line })
  }

  const fileTotal = positionWeightTotal + (statedCash?.value ?? 0)
  const targetOvershoot = targetWeights && statedCash === null && fileTotal - 100 > WEIGHT_EPSILON ? fileTotal - 100 : null
  if (targetOvershoot !== null && targetOvershoot > Math.max(0.01, 0.005 * positions.length)) {
    return failure(`Target weights add up to ${fileTotal.toFixed(2)}%, which is more than export rounding can explain.`, null)
  }
  if ((!targetWeights || statedCash !== null) && fileTotal > 100.01) {
    return failure('Position weights and cash cannot exceed 100%', statedCash?.line ?? positions[positions.length - 1]?.line ?? null)
  }
  if (statedCash !== null && Math.abs(fileTotal - 100) > 0.01) {
    return failure('A stated CASH weight requires the file total to equal 100%', statedCash.line)
  }

  const dropped: DroppedRow[] = []
  const surviving = positions.filter((position) => {
    if (universeTickers.has(position.ticker)) return true
    dropped.push({ ticker: position.ticker, weightPct: position.weightPct })
    return false
  })
  if (positions.length === 0) {
    if (mode === 'shares') {
      return { ok: true, seed: { name, mode: 'shares', cash: cashDollars ?? '', rows: [] }, dropped: [] }
    }
    return {
      ok: true,
      seed: { name, mode: 'weight', cash: targetWeights ? '0' : statedCash?.raw ?? '', rows: [] },
      dropped: [],
      ...(zeroTargets.length > 0 ? { zeroTargets } : {}),
    }
  }
  if (surviving.length === 0) return failure('No holdable portfolio tickers are in the current universe', null)

  if (weightIndex === null && sharesIndex === null) {
    const equalWeight = String(100 / surviving.length)
    return {
      ok: true,
      seed: { name, mode: 'weight', cash: '0', rows: surviving.map((position) => ({ ticker: position.ticker, shares: '', weight: equalWeight })) },
      dropped,
    }
  }

  if (mode === 'shares') {
    return {
      ok: true,
      seed: { name, mode, cash: cashDollars ?? '', rows: surviving.map((position) => ({ ticker: position.ticker, shares: position.shares, weight: '' })) },
      dropped,
    }
  }

  const droppedWeight = dropped.reduce((total, row) => total + (row.weightPct ?? 0), 0)
  let adjustment: TargetAdjustment | undefined
  const rows = surviving.map((position) => ({ ticker: position.ticker, shares: position.shares, weight: position.weight }))
  if (targetOvershoot !== null) {
    const largest = surviving.reduce((best, position) => best === null || position.weightPct! > best.weightPct! ? position : best, null as ParsedPosition | null)
    if (largest !== null) {
      const toPct = Number((largest.weightPct! - targetOvershoot).toFixed(6))
      const row = rows.find((candidate) => candidate.ticker === largest.ticker)!
      row.weight = String(toPct)
      adjustment = { ticker: largest.ticker, fromPct: largest.weightPct!, toPct, fileTotalPct: fileTotal }
    }
  }
  let cash = targetOvershoot !== null ? String(droppedWeight) : statedCash === null ? String(100 - positionWeightTotal + droppedWeight) :
    droppedWeight === 0 ? statedCash.raw : String(statedCash.value + droppedWeight)
  if (targetWeights && targetOvershoot === null) {
    const value = Number(cash)
    cash = Math.abs(value) < WEIGHT_EPSILON ? '0' : String(Number(value.toFixed(6)))
  }
  return {
    ok: true,
    seed: { name, mode, cash, rows },
    dropped,
    ...(adjustment === undefined ? {} : { adjustment }),
    ...(zeroTargets.length === 0 ? {} : { zeroTargets }),
  }
}

export function serializePortfolioCsv(portfolio: Portfolio): string {
  if (isSharesBased(portfolio)) {
    const rows = portfolio.positions.map((position) => [position.ticker, String(position.shares)])
    rows.push(['CASH', String(portfolio.cashDollars)])
    return ['ticker,shares', ...rows.map((row) => row.map(quote).join(','))].join('\n') + '\n'
  }
  const rows = portfolio.positions.map((position) => [position.ticker, String(position.weight), position.shares === undefined ? '' : String(position.shares)])
  rows.push(['CASH', String(portfolio.cashWeight), ''])
  return ['ticker,weight_pct,shares', ...rows.map((row) => row.map(quote).join(','))].join('\n') + '\n'
}

export function filenameSafeName(name: string): string {
  return Array.from(name)
    .map((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1F || code === 0x7F || '/\\:*?"<>|'.includes(character) ? ' ' : character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

export function portfolioCsvFilename(portfolio: Portfolio, now: Date): string {
  const name = filenameSafeName(portfolio.name.trim()) || 'portfolio'
  return `${name}-${datePart(now)}.csv`
}

export function portfolioNameFromFilename(filename: string): string {
  return filename
    .replace(/^.*[\\/]/, '')
    .replace(/\.csv$/i, '')
    .replace(/ \(\d+\)$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .trim()
}
