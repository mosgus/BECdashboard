// ── Sprint 2 types ────────────────────────────────────────────────────────────

export interface UniverseTicker {
  ticker: string;
  name: string | null;
  active: boolean;
  created_at: string;
  // Sprint 4 enrichment fields (nullable — populated via yfinance on add)
  sector?: string | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  dividend_yield?: number | null;
  fifty_two_week_high?: number | null;
  fifty_two_week_low?: number | null;
  last_enriched_at?: string | null;
}

export interface UniverseResponse {
  tickers: UniverseTicker[];
  total: number;
  active_count: number;
}

export interface ImportResult {
  added: number;
  skipped: number;
  warnings: string[];
}

// ── Watchlists ────────────────────────────────────────────────────────────────

export interface WatchlistSummary {
  id: string;
  name: string;
  created_at: string;
  item_count: number;
}

export interface WatchlistDetail {
  id: string;
  name: string;
  created_at: string;
  tickers: string[];
}

export type SignalState =
  | "BULLISH"
  | "BEARISH"
  | "NEUTRAL"
  | "OVERBOUGHT"
  | "OVERSOLD";

export interface SignalResult {
  signal: string;
  label: string;
  params: Record<string, number>;
  state: SignalState;
  last_trigger_date: string | null;
  trigger_values: Record<string, number> | null;
  current_rsi?: number | null;
}

export interface WatchlistRow {
  ticker: string;
  last_close: number | null;
  as_of_date: string | null;
  signals: SignalResult[];
}

export interface WatchlistRefreshResponse {
  watchlist_id: string;
  watchlist_name: string;
  rows: WatchlistRow[];
  as_of_date: string | null;
  data_source: string;
}

// ── Ticker bars / technicals ──────────────────────────────────────────────────

export interface TickerBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface TickerBarsResponse {
  ticker: string;
  bars: TickerBar[];
  as_of_date: string | null;
  data_source: string;
}

export interface TickerTechnicalsResponse {
  ticker: string;
  price_sma: Array<{
    date: string;
    price: number | null;
    sma20: number | null;
    sma50: number | null;
  }>;
  rsi: Array<{ date: string; rsi: number | null }>;
  macd: Array<{
    date: string;
    macd: number | null;
    signal: number | null;
    histogram: number | null;
  }>;
  atr14: number | null;
  as_of_date: string | null;
  data_source: string;
  signals?: SignalResult[];
}
