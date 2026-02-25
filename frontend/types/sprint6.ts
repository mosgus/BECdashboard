// Sprint 6 types: Validation Suite + Forecasting Tab

export interface ValidationTestResult {
  test: string;
  label: string;
  passed: boolean;
  statistic: number | null;
  p_value: number | null;
  details: Record<string, number | string | null>;
}

export interface PortfolioValidationResult {
  portfolio_id: string;
  tests: ValidationTestResult[];
  n_passing: number;
  n_total: number;
  go_decision: boolean;
  quick_mode: boolean;
  returns_used: number;
  warnings: string[];
}

export interface ForecastPoint {
  date: string;
  actual?: number | null;
  p10?: number | null;
  p25?: number | null;
  p50?: number | null;
  p75?: number | null;
  p90?: number | null;
}

export interface PortfolioForecastResult {
  portfolio_id: string;
  method: string;
  horizon_days: number;
  price_series: ForecastPoint[];
  vol_series: ForecastPoint[];
  calibration: {
    rmse: number | null;
    mae: number | null;
    directional_accuracy: number | null;
    methods_used?: string[];
  };
  model_info: Record<string, string | number | string[]>;
  warnings: string[];
  simulated: boolean;
}
