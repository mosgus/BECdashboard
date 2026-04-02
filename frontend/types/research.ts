// ── Research Suite types ─────────────────────────────────────────────────────

// Optimizer Comparison
export interface OptimizerComparisonRequest {
  modes?: string[];
  max_weight?: number;
  lookback_days?: number;
}

export interface OptimizerModeResult {
  mode: string;
  label: string;
  weights?: Record<string, number>;
  metrics?: {
    cagr: number;
    vol: number;
    sharpe: number;
    max_dd: number;
    beta?: number;
    alpha?: number;
  };
  concentration?: {
    hhi: number;
    n_eff: number;
    top5: number;
  };
  turnover?: number;
  error?: string;
}

export interface OptimizerComparisonResult {
  results: OptimizerModeResult[];
  tickers: string[];
}

// Walk-Forward
export interface WalkForwardRequest {
  mode?: string;
  train_days?: number;
  test_days?: number;
  n_folds?: number;
  max_weight?: number;
  lookback_days?: number;
}

export interface WalkForwardFold {
  fold: number;
  train_start?: string;
  train_end?: string;
  test_start?: string;
  test_end?: string;
  train_days?: number;
  test_days?: number;
  is_metrics?: {
    cagr: number;
    vol: number;
    sharpe: number;
    max_dd: number;
  };
  oos_metrics?: {
    cagr: number;
    vol: number;
    sharpe: number;
    max_dd: number;
  };
  weights?: Record<string, number>;
  error?: string;
}

export interface WalkForwardResult {
  mode: string;
  train_days: number;
  test_days: number;
  n_folds: number;
  folds: WalkForwardFold[];
  aggregate_oos: {
    cagr: number;
    vol: number;
    sharpe: number;
    max_dd: number;
  };
  oos_equity_curve: { date: string; value: number }[];
  degradation_ratio: number | null;
  portfolio_id?: string;
  error?: string;
}

// Correlation
export interface CorrelationResult {
  tickers: string[];
  cluster_order: string[];
  matrix: Record<string, Record<string, number>>;
}

// Composite Score
export interface CompositeScoreCategory {
  score: number;
  detail: string;
  weight: number;
}

export interface CompositeScoreResult {
  total: number;
  categories: {
    validation: CompositeScoreCategory;
    concentration: CompositeScoreCategory;
    performance: CompositeScoreCategory;
    drawdown: CompositeScoreCategory;
  };
  go_decision: boolean;
  portfolio_id: string;
}

// Decision Memo
export interface DecisionMemo {
  id: string;
  portfolio_id: string;
  status: string;
  recommendation: string | null;
  composite_score: number | null;
  rationale: string | null;
  red_flags: { flag: string; severity: string; detail: string }[] | null;
  scorecard_json: Record<string, unknown> | null;
  monitoring_plan: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface DecisionMemoCreate {
  portfolio_id: string;
  status?: string;
  composite_score?: number | null;
  recommendation?: string | null;
  rationale?: string | null;
  red_flags?: { flag: string; severity: string; detail: string }[] | null;
  scorecard_json?: Record<string, unknown> | null;
  monitoring_plan?: string | null;
  created_by?: string | null;
}

// ── Universe Research ───────────────────────────────────────────────────────

export interface UniverseAuditRequest {
  tickers?: string[] | null;
  min_history_days?: number;
  lookback_years?: number;
}

export interface UniverseAuditResult {
  ticker: string;
  history_days: number;
  first_date: string | null;
  last_date: string | null;
  pct_gaps: number;
  avg_daily_volume: number | null;
  grade: string;
  issues: string[];
}

export interface UniverseAuditResponse {
  results: UniverseAuditResult[];
  summary: {
    total: number;
    grade_A: number;
    grade_B: number;
    grade_C: number;
    grade_F: number;
  };
}

export interface UniverseScreenRequest {
  min_market_cap?: number | null;
  max_pe?: number | null;
  min_div_yield?: number | null;
  sectors_include?: string[] | null;
  sectors_exclude?: string[] | null;
  min_history_days?: number | null;
}

export interface UniverseScreenResult {
  ticker: string;
  name: string | null;
  sector: string | null;
  market_cap: number | null;
  pe_ratio: number | null;
  dividend_yield: number | null;
  filters: Record<string, boolean>;
  eligible: boolean;
}

export interface UniverseScreenResponse {
  results: UniverseScreenResult[];
  summary: { total: number; eligible: number; dropped: number };
}

export interface UniverseStatsResult {
  total: number;
  active: number;
  sector_distribution: Record<string, number>;
  market_cap_percentiles: Record<string, number>;
  coverage: {
    sector: number;
    market_cap: number;
    pe_ratio: number;
    dividend_yield: number;
  };
}

// ── Asset Research ──────────────────────────────────────────────────────────

export interface AssetProfile {
  cagr: number;
  vol: number;
  sharpe: number;
  max_dd: number;
  beta: number | null;
  alpha: number | null;
  downside_dev: number;
  sortino: number;
  calmar: number;
  upside_capture: number;
  downside_capture: number;
  history_days: number;
  rolling_vol: { date: string; value: number }[];
  rolling_return: { date: string; value: number }[];
}

export interface FactorExposure {
  alpha_daily?: number;
  alpha_annual?: number;
  beta_mkt?: number;
  beta_smb?: number;
  beta_hml?: number;
  r_squared?: number;
  t_stats?: { alpha: number; mkt: number; smb: number; hml: number };
  residual_vol?: number;
  n_obs?: number;
  error?: string;
}

export interface PortfolioRole {
  primary_role: string;
  primary_score: number;
  secondary_role: string | null;
  secondary_score: number | null;
  rationale: string;
  scores: Record<string, number>;
}

export interface AssetCorrelations {
  per_holding: { ticker: string; correlation: number | null }[];
  avg_correlation: number | null;
  max_correlation: number | null;
  max_corr_ticker: string | null;
  crowding_warning: boolean;
}

export interface AssetResearchResult {
  ticker: string;
  portfolio_id: string;
  profile: AssetProfile;
  factor_exposure: FactorExposure;
  correlations: AssetCorrelations;
  role: PortfolioRole;
}
