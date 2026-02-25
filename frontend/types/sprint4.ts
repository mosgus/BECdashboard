// ── Sprint 4 types — portfolio workspace consolidation ────────────────────────

import type { SignalResult } from "./sprint2";

export interface CandidateRow {
  ticker: string;
  last_close: number | null;
  as_of_date: string | null;
  signals: SignalResult[];
}

export interface CandidateRefreshResponse {
  portfolio_id: string;
  rows: CandidateRow[];
  as_of_date: string;
  data_source: string;
}

export type IndicatorType = "sma" | "rsi" | "macd" | "atr";

export interface PortfolioIndicatorConfig {
  id: string;
  portfolio_id: string;
  ticker: string;
  indicator_type: IndicatorType;
  params_json: Record<string, unknown> | null;
  enabled: boolean;
  created_at: string;
}

export interface EnrichedUniverseTicker {
  ticker: string;
  name: string | null;
  active: boolean;
  created_at: string;
  sector: string | null;
  market_cap: number | null;
  pe_ratio: number | null;
  dividend_yield: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  last_enriched_at: string | null;
}
