// ── Shared request/response types for the Blue Eagle API ─────────────────────

export interface PortfolioRequest {
  tickers: string[];
  weights?: number[];
  benchmark?: string;
  start: string;
  end: string;
}

export interface AssetMetrics {
  cagr: number;
  vol: number;
  sharpe: number;
  max_dd: number;
  beta?: number;
  alpha?: number;
}

export interface AssetRow extends AssetMetrics {
  ticker: string;
  weight: number;
}

export interface TimePoint {
  date: string;
  [key: string]: string | number | null;
}

export interface PortfolioResponse {
  metrics: AssetMetrics;
  bench_metrics: AssetMetrics;
  equity_curve: TimePoint[];
  rolling_vol: TimePoint[];
  drawdown: TimePoint[];
  normalized_prices: TimePoint[];
  correlation: Record<string, Record<string, number>>;
  assets: AssetRow[];
  port_tickers: string[];
  weights: number[];
  missing: string[];
  benchmark: string;
  as_of_date?: string;
  data_source?: string;
}

// ── Optimization ─────────────────────────────────────────────────────────────

export type OptimizeMode = "min_variance" | "max_sharpe" | "max_sharpe_capm";

export interface AssetBound {
  min: number;
  max: number;
}

export interface OptimizeRequest {
  tickers: string[];
  current_weights?: number[];
  benchmark?: string;
  start: string;
  end: string;
  mode: OptimizeMode;
  max_weight: number;
  // CAPM fields
  rf?: number;
  market_risk_premium?: number;
  market_ticker?: string;
  views?: Record<string, number>;
  asset_bounds?: Record<string, AssetBound>;
  reserved_cash_pct?: number;
}

export interface CAPMInfo {
  betas: Record<string, number>;
  expected_returns: Record<string, number>;
  rf: number;
  market_risk_premium: number;
  market_ticker: string;
  views: Record<string, number>;
}

export interface OptimizeResponse {
  opt_weights: Record<string, number>;
  curr_weights: Record<string, number>;
  opt_metrics: AssetMetrics;
  current_metrics: AssetMetrics;
  equity_curves: TimePoint[];
  tickers: string[];
  mode: OptimizeMode;
  capm_info: CAPMInfo;
  reserved_cash_pct: number;
  as_of_date?: string;
  data_source?: string;
}

// ── Technicals ────────────────────────────────────────────────────────────────

export interface TechnicalsRequest {
  ticker: string;
  start: string;
  end: string;
}

export interface PriceSMAPoint {
  date: string;
  price: number | null;
  sma20: number | null;
  sma50: number | null;
}

export interface RSIPoint {
  date: string;
  rsi: number | null;
}

export interface MACDPoint {
  date: string;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

export interface TechnicalsResponse {
  ticker: string;
  price_sma: PriceSMAPoint[];
  rsi: RSIPoint[];
  macd: MACDPoint[];
  as_of_date?: string | null;
  data_source?: string;
}

