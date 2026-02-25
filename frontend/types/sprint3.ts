// ── Sprint 3 types ────────────────────────────────────────────────────────────

import { SignalResult } from "./sprint2";

// ── Portfolios ────────────────────────────────────────────────────────────────

export interface PortfolioSummary {
  id: string;
  name: string;
  created_at: string;
  position_count: number;
}

export interface Position {
  ticker: string;
  weight: number | null;
  shares: number | null;
  cost_basis: number | null;
  updated_at: string;
}

export interface PortfolioDetail extends PortfolioSummary {
  positions: Position[];
}

export interface PortfolioAnalytics {
  portfolio_id: string;
  simulated: true;
  as_of_date: string;
  lookback_start: string;
  tickers: string[];
  weights: Record<string, number>;
  metrics: {
    cagr: number;
    vol: number;
    sharpe: number;
    max_dd: number;
    beta?: number;
    alpha?: number;
  };
  equity_curves: Array<{
    date: string;
    portfolio: number;
    benchmark?: number | null;
  }>;
  signals_by_ticker: Array<{
    ticker: string;
    signals: SignalResult[];
  }>;
  warnings: string[];
  data_source?: string;
}

export interface PortfolioOptimizeResult {
  tickers: string[];
  current_weights: Record<string, number>;
  target_weights: Record<string, number>;
  implied_trades: Record<string, number>;
  metrics: {
    current: Record<string, number>;
    optimized: Record<string, number>;
  };
  equity_curves: Array<{
    date: string;
    current: number;
    optimized: number;
    benchmark?: number | null;
  }>;
  feasible: boolean;
  mode: string;
  warnings: string[];
  simulated: true;
  as_of_date?: string;
  data_source?: string;
}

// ── Alert Rules ────────────────────────────────────────────────────────────────

export type AlertScope = "watchlist" | "portfolio" | "ticker";

export type AlertRuleType =
  | "sma_cross_up"
  | "sma_cross_down"
  | "rsi_rebound"
  | "rsi_fade"
  | "macd_cross_up"
  | "macd_cross_down"
  | "price_cross_above"
  | "price_cross_below";

export interface AlertRule {
  id: string;
  scope: AlertScope;
  scope_id: string | null;
  ticker: string | null;
  rule_type: AlertRuleType;
  params_json: Record<string, unknown> | null;
  enabled: boolean;
  cooldown_days: number;
  created_at: string;
}

export interface AlertEvent {
  id: string;
  alert_id: string;
  triggered_at: string;
  as_of_date: string;
  payload_json: Record<string, unknown> | null;
}

export interface EvaluateResult {
  evaluated: number;
  triggered: number;
  skipped: number;
  as_of_date: string;
  data_source?: string;
  events: Array<Record<string, unknown>>;
}
