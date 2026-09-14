export interface HealthResponse {
  status: string
  python: string
}

export interface UniverseEntry {
  ticker: string
  short_name: string | null
  sector: string | null
  quote_type: string | null
  regular_market_price: number | null
  market_cap: number | null
  trailing_pe: number | null
  dividend_yield: number | null
  bar_count: number
  first_bar: string | null
  last_bar: string | null
  fetched_at: string | null
  added_at: string
}

export interface UniverseDetail extends UniverseEntry {
  long_name: string | null
  industry: string | null
  currency: string | null
  exchange: string | null
  previous_close: number | null
  forward_pe: number | null
  fifty_two_week_high: number | null
  fifty_two_week_low: number | null
  beta: number | null
  average_volume: number | null
}

export interface RefreshResult {
  ticker: string
  action: string
  last_session: string | null
  bars_before: number
  bars_after: number
  drift_detected: boolean
  detail: UniverseDetail
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
}

function extractDetail(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && 'detail' in parsed) {
      const detail = (parsed as { detail: unknown }).detail
      if (typeof detail === 'string') return detail
    }
  } catch {
    // Not JSON — no detail to extract.
  }
  return null
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_URL
  if (!baseUrl) {
    throw new Error('VITE_API_URL environment variable is not set')
  }

  const hasBody = options.body !== undefined
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()

  if (!response.ok) {
    const detail = extractDetail(text)
    const message = detail
      ? `${detail} (${response.status})`
      : `Request failed with status ${response.status}: ${text}`
    throw new ApiError(response.status, message)
  }

  return text ? JSON.parse(text) : (undefined as T)
}

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health')
}

export async function getUniverse(): Promise<UniverseEntry[]> {
  return request<UniverseEntry[]>('/universe')
}

export async function addTicker(ticker: string): Promise<UniverseDetail> {
  return request<UniverseDetail>('/universe', { method: 'POST', body: { ticker } })
}

export async function refreshTicker(ticker: string): Promise<RefreshResult> {
  return request<RefreshResult>(`/universe/${ticker}/refresh`, { method: 'POST' })
}
