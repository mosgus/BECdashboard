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
  weight: number | null;             // percentage units (25 = 25 %), always present
  shares: number | null;             // number of shares; null if weight-only entry
  cost_basis: number | null;         // per-share cost basis for P&L
  position_type: "stock";            // all positions are equity; cash is portfolio-level
  updated_at: string;
  price?: number | null;             // live last close (enriched by get_portfolio)
  market_value?: number | null;      // shares × price (enriched by get_portfolio)
}

export interface LastTargetSet {
  source: string;  // "optimizer" | "tilt" | "manual"
  weights: Record<string, number>;
  mode: string | null;
  views_applied: boolean;
  delta_mu?: Record<string, number> | null;
  as_of_date: string;
  created_at: string;
}

export interface PortfolioDetail extends PortfolioSummary {
  positions: Position[];
  notional_value: number | null;
  cash_value: number | null;
  cash_pct_target: number | null;
  last_target_set: LastTargetSet | null;
}

export interface ImplementationRow {
  ticker: string;
  price: number;
  current_weight: number;
  target_weight: number;
  current_value: number;
  target_value: number;
  current_shares_implied: number;
  target_shares_raw: number;
  target_shares: number;
  delta_shares: number;
  delta_value: number;
  action: "BUY" | "SELL" | "HOLD";
}

export interface ImplementationResult {
  rows: ImplementationRow[];
  residual_cash: number;
  total_turnover: number;
  notional_value: number;
  source: string;
  as_of_date: string;
}

export interface TiltResult {
  tilt_weights: Record<string, number>;
  base_weights: Record<string, number>;
  source: "tilt";
  params: {
    baseline: string;
    optimizer_mode: string | null;
    conviction: Record<string, number>;
    lam: number;
    u0: number;
  };
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
  bench_metrics?: {
    cagr: number;
    vol: number;
    sharpe: number;
    max_dd: number;
  };
  warnings: string[];
  data_source?: string;
}

export interface ForwardLookingMetrics {
  /** CAPM-implied portfolio expected return: Σ wᵢ × E[Rᵢ]  (annual) */
  expected_return: number;
  /** Portfolio volatility √(wᵀ Σ w) using historical covariance  (annual) */
  vol: number;
  /** Forward-looking Sharpe = (expected_return − rf) / vol */
  sharpe: number;
}

export interface PortfolioOptimizeResult {
  tickers: string[];
  current_weights: Record<string, number>;
  target_weights: Record<string, number>;
  implied_trades: Record<string, number>;
  metrics: {
    current: Record<string, number>;
    optimized: Record<string, number>;
    /** Only present for max_sharpe_capm mode. Uses CAPM expected returns, not historical actuals. */
    forward_looking?: ForwardLookingMetrics | null;
  };
  /** Per-ticker CAPM expected annual returns (rf + β × MRP). Only present for max_sharpe_capm. */
  capm_expected_returns?: Record<string, number> | null;
  equity_curves: Array<{
    date: string;
    current: number;
    optimized: number;
    benchmark?: number | null;
  }>;
  feasible: boolean;
  mode: string;
  min_weight?: number;
  views_applied?: boolean;
  delta_mu?: Record<string, number>;
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

export interface EmailConfig {
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  smtp_pass_set: boolean;
  email_from: string | null;
  recipients: string | null;
  updated_at: string | null;
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
