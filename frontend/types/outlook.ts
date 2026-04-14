/**
 * Outlook tab — CAPM Optimize, Monte Carlo, Forecast types.
 */

// ── CAPM Optimize ────────────────────────────────────────────────────────────

export interface TickerConfig {
  freeze: boolean;
  view: number;      // undervaluation fraction (-0.5 to 1.0)
  min_pct: number;
  max_pct: number;
}

export interface CAPMOptimizeRequest {
  target_value: number;
  rf?: number;         // omit = backend fetches live 10Y Treasury
  mrp: number;
  market_ticker: string;
  ticker_configs: Record<string, TickerConfig>;
  start?: string;
  end?: string;
}

export interface ActionRow {
  ticker: string;
  price: number;
  current_shares: number;
  current_value: number;
  current_pct: number;
  target_shares: number;
  target_value: number;
  target_pct: number;
  action_shares: number;
  action_dollars: number;
  action_pct: number;
  frozen?: boolean;
}

export interface CAPMMetrics {
  expected_return: number;
  expected_vol: number;
  expected_sharpe: number;
  portfolio_beta: number;
}

export interface VaR95 {
  daily: number;
  weekly: number;
  monthly: number;
  quarterly: number;
  annual: number;
}

export interface CAPMDetail {
  ticker: string;
  beta: number;
  capm_return: number;
  view: number;
  adj_return: number;
  opt_weight: number;
}

export interface CALAsset {
  ticker: string;
  vol: number;
  orig_return: number;
  adj_return: number;
}

export interface CALData {
  rf: number;
  optimal: { vol: number; ret: number };
  leverage_2x: { vol: number; ret: number };
  leverage_3x: { vol: number; ret: number };
  assets: CALAsset[];
}

export interface CAPMOptimizeResult {
  portfolio_id: string;
  action_table: ActionRow[];
  metrics: CAPMMetrics;
  var_95: VaR95;
  capm_details: CAPMDetail[];
  cal_data: CALData;
  as_of_date: string;
}

// ── Monte Carlo ──────────────────────────────────────────────────────────────

export interface MonteCarloRequest {
  num_simulations: number;
  horizon_days: number;
  initial_value: number;
  start?: string;
  end?: string;
}

export interface MCPathPoint {
  day: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface TerminalStats {
  mean: number;
  median: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
  prob_loss: number;
  mean_return: number;
  median_return: number;
}

export interface BrierScoring {
  brier_score: number | null;
  coverage_50: number | null;
  coverage_90: number | null;
  interpretation: "well_calibrated" | "overconfident" | "underconfident" | "insufficient_data";
}

export interface MonteCarloResult {
  portfolio_id: string;
  paths_summary: MCPathPoint[];
  terminal_stats: TerminalStats;
  horizon_days: number;
  num_simulations: number;
  initial_value: number;
  as_of_date: string;
  brier_scoring: BrierScoring;
}

// ── Efficient Frontier ───────────────────────────────────────────────────────

export interface FrontierPoint {
  vol: number;
  ret: number;
}

export interface EfficientFrontierResult {
  portfolio_id: string;
  frontier: FrontierPoint[];
  current_portfolio: FrontierPoint;
  max_sharpe: FrontierPoint | null;
  min_variance: FrontierPoint | null;
  risk_parity: FrontierPoint | null;
  random_portfolios: FrontierPoint[];
  as_of_date: string;
}
