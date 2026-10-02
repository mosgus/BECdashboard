import { remarkStoredPortfolios } from '../lib/portfolioStore'

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
  current_price: number | null
  last_close: number | null
  prior_close: number | null
  quote_fetched_at: string | null
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

export interface PriceBar {
  date: string
  close: number | null
  adj_close: number | null
}

export interface HistoryResponse {
  ticker: string
  bars: PriceBar[]
}

export interface IndicatorSeries {
  key: string
  label: string
  points: (number | null)[]
}

export interface IndicatorsResponse {
  ticker: string
  dates: string[]
  series: IndicatorSeries[]
}

export interface PortfolioHolding {
  ticker: string
  weight: number
  first_bar: string
  last_close: number
}

export interface PortfolioSeriesResponse {
  dates: string[]
  value: number[]
  cash_value: number
  holdings: PortfolioHolding[]
  series: IndicatorSeries[]
  signals: SignalOut[]
}

export interface StripQuote {
  ticker: string
  name: string
  quote_type: string | null
  price: number | null
  change: number | null
  pct: number | null
}

export interface StripReturn {
  ticker: string
  pct: number
}

export interface StripGroup {
  label: string
  today: StripQuote[]
  five_day: StripReturn[]
  thirty_day: StripReturn[]
  ytd: StripReturn[]
}

export interface StripResponse {
  groups: StripGroup[]
  as_of: string | null
  quotes_stale: boolean
}

export interface TickerReturns {
  ticker: string
  five_day: number | null
  thirty_day: number | null
  ytd: number | null
}

export interface ReturnsResponse {
  returns: TickerReturns[]
  as_of: string | null
}

export interface SignalOut {
  signal: string
  label: string
  state: string | null
  last_trigger_date: string | null
  /** The indicator's current scalar reading where one exists: the RSI for `rsi_threshold`,
   *  the histogram for `macd_cross`, null for `sma_cross` — a crossover is a relationship
   *  between two lines, not a single number. Null whenever `state` is null. */
  value: number | null
}

export interface TickerSignals {
  ticker: string
  signals: SignalOut[]
  /** ATR(14) in the ticker's price units. Null together with `atr_pct`. */
  atr: number | null
  atr_pct: number | null
}

export interface SignalsResponse {
  signals: TickerSignals[]
  as_of: string | null
}

export interface NewsArticle {
  id: string
  title: string
  summary: string | null
  publisher: string | null
  url: string | null
  thumbnail_url: string | null
  pub_date: string | null
  source_ticker: string | null
}

export interface NewsSummary {
  text: string
  created_at: string
  model: string | null
  article_count: number | null
}

export interface NewsResponse {
  articles: NewsArticle[]
  as_of: string | null
  summary: NewsSummary | null
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_URL
  if (!baseUrl) {
    throw new Error('VITE_API_URL environment variable is not set')
  }

  const method = options.method ?? 'GET'
  const hasBody = options.body !== undefined
  const init: RequestInit = {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  }

  // Retry only a GET against a transient failure — a dropped/refused connection (fetch itself
  // rejects) or a 502/503/504, which is what a uvicorn restart or a short Render deploy blip
  // looks like. Never POST or DELETE: POST /universe is not idempotent, and a retried add would
  // double-fetch ten years of history. Never a 4xx or a 500 either — a 404 means the ticker
  // doesn't exist and retrying cannot change that, and a 500 means the app already raised.
  const retryDelaysMs = method === 'GET' ? [1000, 3000] : []

  for (let attempt = 0; ; attempt++) {
    const isLastAttempt = attempt >= retryDelaysMs.length

    let response: Response
    try {
      response = await fetch(`${baseUrl}${path}`, init)
    } catch (err) {
      if (isLastAttempt) throw err
      await sleep(retryDelaysMs[attempt])
      continue
    }

    if (!response.ok && isTransientStatus(response.status) && !isLastAttempt) {
      await sleep(retryDelaysMs[attempt])
      continue
    }

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
}

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health')
}

export async function getUniverse(): Promise<UniverseEntry[]> {
  const entries = await request<UniverseEntry[]>('/universe')
  remarkStoredPortfolios(entries)
  return entries
}

export async function addTicker(ticker: string): Promise<UniverseDetail> {
  return request<UniverseDetail>('/universe', { method: 'POST', body: { ticker } })
}

export async function refreshTicker(ticker: string): Promise<RefreshResult> {
  return request<RefreshResult>(`/universe/${ticker}/refresh`, { method: 'POST' })
}

export interface DeleteResult {
  ticker: string
  bars_deleted: number
  fundamentals_deleted: number
  quotes_deleted: number
}

export async function deleteTicker(ticker: string): Promise<DeleteResult> {
  return request<DeleteResult>(`/universe/${ticker}`, { method: 'DELETE' })
}

export interface QuoteRefreshResult {
  refreshed: number
  fetched_at: string | null
}

export async function refreshQuotes(): Promise<QuoteRefreshResult> {
  return request<QuoteRefreshResult>('/universe/quotes/refresh', { method: 'POST' })
}

export async function getHistory(ticker: string): Promise<HistoryResponse> {
  return request<HistoryResponse>(`/universe/${ticker}/history`)
}

export async function getIndicators(ticker: string, include: string[]): Promise<IndicatorsResponse> {
  if (include.length === 0) return { ticker, dates: [], series: [] }
  const query = new URLSearchParams({ include: include.join(',') })
  return request<IndicatorsResponse>(`/universe/${ticker}/indicators?${query}`)
}

export type OptimizeRebalance = 'none' | 'monthly' | 'quarterly' | 'annual'

export interface OptimizeRequest {
  tickers: string[]
  weights: number[]
  mode: string
  lookback_days: number
  max_weight: number
  min_weight: number
  vol_target: number
  allow_short: boolean
  max_short: number
  rebalance: OptimizeRebalance
}

export interface PinnedHolding {
  ticker: string
  first_bar: string
  weight: number
  exceeds_max: boolean
}

export interface OptimizeCurves {
  dates: string[]
  current: number[]
  optimized: number[]
  benchmark: number[] | null
}

export interface FrontierPoint {
  vol: number
  ret: number
}

export interface Frontier {
  points: FrontierPoint[]
  cloud: FrontierPoint[]
  current: FrontierPoint
  optimized: FrontierPoint
  min_variance: FrontierPoint
  max_sharpe: FrontierPoint | null
  tickers: string[]
  excluded: string[]
}

export type OptimizeMetrics = Record<string, number | null>

export interface OptimizeResponse {
  tickers: string[]
  current_weights: Record<string, number>
  target_weights: Record<string, number>
  implied_trades: Record<string, number>
  pinned: PinnedHolding[]
  fit_start: string
  fit_end: string
  score_start: string
  score_limited_by: string | null
  curves: OptimizeCurves
  metrics: {
    current: OptimizeMetrics | null
    optimized: OptimizeMetrics | null
  }
  feasible: boolean
  mode: string
  rebalance: OptimizeRebalance
  lookback_days: number
  rf: number
  rf_source: 'live' | 'fallback'
  warnings: string[]
  frontier: Frontier | null
}

export async function optimizePortfolio(body: OptimizeRequest): Promise<OptimizeResponse> {
  return request<OptimizeResponse>('/portfolio/optimize', { method: 'POST', body })
}

export interface CapmHoldingConfig {
  freeze: boolean
  view: number
  min_weight: number
  max_weight: number
}

export interface CapmRequest {
  tickers: string[]
  weights: number[]
  lookback_days: number
  rf: number | null
  mrp: number
  market_ticker: string
  configs: Record<string, CapmHoldingConfig>
}

export interface CapmHolding {
  ticker: string
  current_weight: number
  target_weight: number
  beta: number
  capm_return: number
  view: number
  expected_return: number
  vol: number
  frozen: boolean
  pinned: boolean
  first_bar: string
}

export interface CapmResponse {
  tickers: string[]
  holdings: CapmHolding[]
  current_weights: Record<string, number>
  target_weights: Record<string, number>
  metrics: { expected_return: number; expected_vol: number; expected_sharpe: number | null; portfolio_beta: number }
  current_metrics: { expected_return: number; expected_vol: number; expected_sharpe: number | null; portfolio_beta: number }
  var_95: { daily: number; weekly: number; monthly: number; quarterly: number; annual: number }
  rf: number
  rf_source: 'live' | 'fallback' | 'manual'
  mrp: number
  market_ticker: string
  lookback_days: number
  fit_start: string
  fit_end: string
  score_start: string
  warnings: string[]
}

export async function capmPortfolio(body: CapmRequest): Promise<CapmResponse> {
  return request<CapmResponse>('/portfolio/capm', { method: 'POST', body })
}

export interface MonteCarloRequest {
  tickers: string[]
  weights: number[]
  cash: number
  initial_value: number
  horizon_days: number
  num_simulations: number
  lookback_days: number
  model: string
}
export interface MonteCarloPathPoint { day: number; p5: number; p25: number; p50: number; p75: number; p95: number }
export interface MonteCarloTerminal {
  mean: number; median: number; p5: number; p25: number; p75: number; p95: number
  prob_loss: number; mean_return: number; median_return: number
}
export interface MonteCarloResponse {
  tickers: string[]; weights: Record<string, number>; cash_weight: number; model: string; seed: number
  horizon_days: number; num_simulations: number; initial_value: number; lookback_days: number
  fit_start: string; fit_end: string; n_returns: number; daily_mean: number; daily_vol: number
  paths: MonteCarloPathPoint[]; terminal: MonteCarloTerminal; warnings: string[]
}
export async function monteCarloPortfolio(body: MonteCarloRequest): Promise<MonteCarloResponse> {
  return request<MonteCarloResponse>('/portfolio/montecarlo', { method: 'POST', body })
}

export type ForecastRequest = MonteCarloRequest
export interface ForecastVolPoint { date: string; day: number; vol: number }
export interface ForecastVolForecastPoint { day: number; vol: number }
export interface ForecastHistoryPoint { date: string; day: number; value: number }
export interface ForecastResponse {
  tickers: string[]; weights: Record<string, number>; cash_weight: number; model: string; seed: number
  horizon_days: number; num_simulations: number; initial_value: number; lookback_days: number
  fit_start: string; fit_end: string; n_returns: number; daily_drift: number; current_vol: number | null; lookback_vol: number
  params: Record<string, number>; members: string[]; member_medians: Record<string, number>
  paths: MonteCarloPathPoint[]; terminal: MonteCarloTerminal; vol_forecast: ForecastVolForecastPoint[]
  vol_history: ForecastVolPoint[]; history: ForecastHistoryPoint[]; warnings: string[]
}
export async function forecastPortfolio(body: ForecastRequest): Promise<ForecastResponse> {
  return request<ForecastResponse>('/portfolio/forecast', { method: 'POST', body })
}

export async function getPortfolioSeries(
  tickers: string[], weights: number[], cash: number, include: string[],
): Promise<PortfolioSeriesResponse> {
  const query = new URLSearchParams({
    tickers: tickers.join(','),
    weights: weights.map(String).join(','),
    cash: String(cash),
    include: include.join(','),
  })
  return request<PortfolioSeriesResponse>(`/portfolio/series?${query}`)
}

export async function getStrip(): Promise<StripResponse> {
  return request<StripResponse>('/universe/strip')
}

export async function getReturns(tickers: string[]): Promise<ReturnsResponse> {
  if (tickers.length === 0) return { returns: [], as_of: null }
  const query = new URLSearchParams({ tickers: tickers.join(',') })
  return request<ReturnsResponse>(`/universe/returns?${query}`)
}

export async function getSignals(tickers: string[]): Promise<SignalsResponse> {
  if (tickers.length === 0) return { signals: [], as_of: null }
  const query = new URLSearchParams({ tickers: tickers.join(',') })
  return request<SignalsResponse>(`/universe/signals?${query}`)
}

export async function getNews(limit: number, maxPerTicker: number): Promise<NewsResponse> {
  return request<NewsResponse>(`/news?limit=${limit}&max_per_ticker=${maxPerTicker}`)
}

export interface OpsDatabaseStatus {
  connected: boolean
  revision: string | null
}

export interface OpsUniverseStatus {
  active_tickers: number
  total_bars: number
  newest_bar_date: string | null
  sweep_active: boolean
}

export interface OpsNewsStatus {
  article_count: number
  newest_fetched_at: string | null
}

export interface OpsBriefingStatus {
  exists: boolean
  model: string | null
  created_at: string | null
}

export interface OpsWindowsStatus {
  auto_refresh_last_claim: string | null
  news_refresh_last_claim: string | null
  current_window_start: string | null
}

export interface OpsStatus {
  database: OpsDatabaseStatus
  universe: OpsUniverseStatus
  news: OpsNewsStatus
  briefing: OpsBriefingStatus
  gemini_key_configured: boolean
  python: string
  windows: OpsWindowsStatus
}

export interface JobRun {
  id: number
  job_name: string
  started_at: string
  finished_at: string | null
  status: string
  duration_ms: number | null
  detail: Record<string, unknown> | null
}

export interface JobRunsResponse {
  job_runs: JobRun[]
}

export async function getOpsStatus(): Promise<OpsStatus> {
  return request<OpsStatus>('/ops/status')
}

export interface ForceRefreshStarted {
  started: boolean
  started_at: string
}

export interface SweepStatus {
  active: boolean
}

export async function forceUniverseRefresh(): Promise<ForceRefreshStarted> {
  return request<ForceRefreshStarted>('/ops/universe/refresh', { method: 'POST' })
}

export async function getSweepStatus(): Promise<SweepStatus> {
  return request<SweepStatus>('/universe/sweep_status')
}

export async function getJobRuns(limit: number): Promise<JobRunsResponse> {
  return request<JobRunsResponse>(`/ops/job_runs?limit=${limit}`)
}
