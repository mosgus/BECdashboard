/**
 * Sprint 7 / Epic S4 — Institutional Insights & Action Layer
 * Portfolio Health, Scenario Analysis, Rebalance, and Extended Technicals.
 */

import type { TickerTechnicalsResponse } from "./sprint2";

// ── Portfolio Health ───────────────────────────────────────────────────────────

export interface ConcentrationMetrics {
  hhi: number;
  n_eff: number;
  top5: number;
}

export interface RiskContribution {
  ticker: string;
  weight: number;
  rc: number | null;
  mctr: number | null;
}

export interface PortfolioHealthResult {
  portfolio_id: string;
  concentration: ConcentrationMetrics;
  beta: number | null;
  vol: number | null;
  risk_contributions: RiskContribution[];
  as_of_date: string;
  data_source: string;
  warnings: string[];
}

// ── Scenario Analysis ──────────────────────────────────────────────────────────

export type ScenarioType = "market_shock" | "vol_shock" | "historical_replay" | "factor_replay";

export interface ShockContribution {
  ticker: string;
  weight: number;
  impact: number;
}

export interface EquityCurvePoint {
  date: string;
  value: number;
}

export interface ReplayContributor {
  ticker: string;
  asset_return: number;
  weight: number;
  weighted_contribution: number;
}

interface ScenarioBase {
  portfolio_id: string;
  as_of_date: string;
  warnings?: string[];
}

export interface MarketShockResult extends ScenarioBase {
  scenario_type: "market_shock";
  portfolio_impact: number;
  contributions: ShockContribution[];
}

export interface VolShockResult extends ScenarioBase {
  scenario_type: "vol_shock";
  base_vol: number | null;
  shocked_vol: number | null;
  vol_scale: number;
}

export interface HistoricalReplayResult extends ScenarioBase {
  scenario_type: "historical_replay";
  total_return: number;
  max_dd: number;
  worst_day: number;
  best_day: number;
  contributors: ReplayContributor[];
  equity_curve: EquityCurvePoint[];
  n_days: number;
  start: string;
  end: string;
}

export interface FactorReplayResult extends ScenarioBase {
  scenario_type: "factor_replay";
  // Historical replay fields (factor replay includes these)
  total_return?: number;
  max_dd?: number;
  worst_day?: number;
  best_day?: number;
  contributors?: ReplayContributor[];
  equity_curve?: EquityCurvePoint[];
  n_days?: number;
  start?: string;
  end?: string;
  // Factor-specific projection fields
  current_betas?: {
    alpha_daily: number;
    beta_mkt: number;
    beta_smb: number;
    beta_hml: number;
    r_squared: number;
    residual_vol_daily: number;
    n_obs: number;
  };
  regime_factors?: {
    mkt_rf: number;
    smb: number;
    hml: number;
    rf: number;
    n_days: number;
  };
  projection_point?: {
    total_pct: number;
    market_pct: number;
    smb_pct: number;
    hml_pct: number;
    alpha_pct: number;
    rf_pct: number;
  };
  projection_mc?: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
    mean: number;
    prob_loss_gt_20: number;
    prob_loss_gt_10: number;
    prob_loss: number;
    n_paths: number;
  };
  projection_paths?: { day: number; p5: number; p25: number; p50: number; p75: number; p95: number }[];
  projection_error?: string;
}

export type ScenarioResult = MarketShockResult | VolShockResult | HistoricalReplayResult | FactorReplayResult;

export interface ScenarioRequest {
  scenario_type: ScenarioType;
  shock_pct?: number;
  vol_scale?: number;
  start_date?: string;
  end_date?: string;
}

// ── Rebalance ─────────────────────────────────────────────────────────────────

export type TradeAction = "BUY" | "SELL" | "HOLD";

export interface DriftRow {
  ticker: string;
  current_weight: number;
  target_weight: number;
  drift: number;
  action: TradeAction;
}

export interface RebalanceResult {
  portfolio_id: string;
  turnover: number;
  drift_table: DriftRow[];
  top_trades: DriftRow[];
  as_of_date: string;
  warnings: string[];
}

// ── Extended Technicals ────────────────────────────────────────────────────────

export interface EMAPoint {
  date: string;
  ema20: number | null;
  ema50: number | null;
}

export interface BollingerPoint {
  date: string;
  upper: number | null;
  mid: number | null;
  lower: number | null;
}

export interface ADXPoint {
  date: string;
  adx: number | null;
}

export interface DonchianPoint {
  date: string;
  upper: number | null;
  mid: number | null;
  lower: number | null;
}

export interface StochasticPoint {
  date: string;
  k: number | null;
  d: number | null;
}

export interface OBVPoint {
  date: string;
  obv: number | null;
}

export interface ExtendedTechnicalsResponse
  extends TickerTechnicalsResponse {
  ema?: EMAPoint[];
  bollinger?: BollingerPoint[];
  adx?: ADXPoint[];
  donchian?: DonchianPoint[];
  stochastic?: StochasticPoint[];
  obv?: OBVPoint[];
}
