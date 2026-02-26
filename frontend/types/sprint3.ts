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

export type AlertEventStatus = "new" | "ack" | "snoozed" | "resolved";

export interface AlertEvent {
  id: string;
  alert_id: string;
  triggered_at: string;
  as_of_date: string;
  payload_json: Record<string, unknown> | null;
  // S5 additions
  ticker: string | null;
  fingerprint: string | null;
  status: AlertEventStatus;
  updated_at: string | null;
}

export interface EvaluateResult {
  evaluated: number;
  triggered: number;
  skipped: number;
  as_of_date: string;
  data_source?: string;
  events: Array<Record<string, unknown>>;
  warnings?: string[];
}

export interface RuleMetadata {
  rule_type: string;
  direction: string;
  label: string;
  description: string;
  required_indicators: string[];
  default_params: Record<string, number>;
}

export interface JobRunRecord {
  id: string;
  job_name: string;
  asof_date: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  details_json: Record<string, unknown> | null;
}

export interface OpsStatus {
  as_of_date: string;
  last_job_run: {
    id: string;
    job_name: string;
    asof_date: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    duration_ms: number | null;
  } | null;
  alert_rules_enabled: number;
  alert_events_new: number;
  email_configured: boolean;
  data_source: string;
}

export interface OpsDigest {
  as_of_date: string;
  portfolio_movers: Array<{ ticker: string; daily_return: number; weight: number }>;
  watchlist_movers: Array<{ ticker: string; daily_return: number }>;
  alerts_triggered: { entry: number; exit: number };
  new_alert_events: Array<{
    id: string;
    ticker: string;
    rule_type: string | null;
    triggered_at: string;
    status: string;
  }>;
  job_run: {
    job_name: string;
    asof_date: string;
    status: string;
    duration_ms: number | null;
    finished_at: string | null;
  } | null;
  digest_text: string;
}
