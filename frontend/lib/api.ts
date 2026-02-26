import {
  AlertRequest,
  AlertResponse,
  OptimizeRequest,
  OptimizeResponse,
  PortfolioRequest,
  PortfolioResponse,
  TechnicalsRequest,
  TechnicalsResponse,
} from "@/types/portfolio";
import {
  ImportResult,
  TickerBarsResponse,
  TickerTechnicalsResponse,
  UniverseResponse,
  WatchlistDetail,
  WatchlistRefreshResponse,
  WatchlistSummary,
} from "@/types/sprint2";
import {
  AlertEvent,
  AlertEventStatus,
  AlertRule,
  EmailConfig,
  EvaluateResult,
  JobRunRecord,
  OpsDigest,
  OpsStatus,
  PortfolioAnalytics,
  PortfolioDetail,
  PortfolioOptimizeResult,
  PortfolioSummary,
  RuleMetadata,
} from "@/types/sprint3";
import {
  CandidateRefreshResponse,
  EnrichedUniverseTicker,
  PortfolioIndicatorConfig,
} from "@/types/sprint4";
import { PortfolioValidationResult, PortfolioForecastResult } from "@/types/sprint6";
import type { PortfolioHealthResult, ScenarioResult, ScenarioRequest, RebalanceResult, ExtendedTechnicalsResponse } from "@/types/sprint7";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload } from "./utils";

// ── Portfolio & analytics ─────────────────────────────────────────────────────

export const fetchPortfolioMetrics = (req: PortfolioRequest): Promise<PortfolioResponse> =>
  apiPost<PortfolioResponse>("/api/portfolio/metrics", req);

export const fetchOptimize = (req: OptimizeRequest): Promise<OptimizeResponse> =>
  apiPost<OptimizeResponse>("/api/optimize", req);

export const fetchTechnicals = (req: TechnicalsRequest): Promise<TechnicalsResponse> =>
  apiPost<TechnicalsResponse>("/api/technicals", req);

export const fetchAlertCheck = (req: AlertRequest): Promise<AlertResponse> =>
  apiPost<AlertResponse>("/api/alerts/check", req);

// ── Universe ──────────────────────────────────────────────────────────────────

export const fetchUniverse = (query?: string, active?: boolean): Promise<UniverseResponse> =>
  apiGet<UniverseResponse>("/api/universe", { query, active });

export const importUniverseCSV = (file: File): Promise<ImportResult> => {
  const fd = new FormData();
  fd.append("file", file);
  return apiUpload<ImportResult>("/api/universe/import_csv", fd);
};

export const addUniverseTicker = (ticker: string, name?: string): Promise<{ ticker: string; name: string | null; active: boolean }> =>
  apiPost("/api/universe", { ticker, name: name || null });

export const patchUniverseTicker = (ticker: string, active: boolean): Promise<{ ticker: string; active: boolean }> =>
  apiPatch(`/api/universe/${ticker}`, { active });

export const fetchUniverseTicker = (ticker: string): Promise<EnrichedUniverseTicker> =>
  apiGet<EnrichedUniverseTicker>(`/api/universe/${ticker}`);

export const enrichUniverseTicker = (ticker: string): Promise<EnrichedUniverseTicker> =>
  apiPost<EnrichedUniverseTicker>(`/api/universe/${ticker}/enrich`, {});

// ── Watchlists ────────────────────────────────────────────────────────────────

export const fetchWatchlists = (): Promise<{ watchlists: WatchlistSummary[] }> =>
  apiGet("/api/watchlists");

export const fetchWatchlist = (id: string): Promise<WatchlistDetail> =>
  apiGet(`/api/watchlists/${id}`);

export const createWatchlist = (name: string): Promise<WatchlistSummary> =>
  apiPost("/api/watchlists", { name });

export const renameWatchlist = (id: string, name: string): Promise<{ id: string; name: string }> =>
  apiPut(`/api/watchlists/${id}`, { name });

export const deleteWatchlist = (id: string): Promise<void> =>
  apiDelete(`/api/watchlists/${id}`);

export const addWatchlistItem = (id: string, ticker: string): Promise<{ watchlist_id: string; ticker: string }> =>
  apiPost(`/api/watchlists/${id}/items`, { ticker });

export const removeWatchlistItem = (id: string, ticker: string): Promise<void> =>
  apiDelete(`/api/watchlists/${id}/items/${ticker}`);

export const refreshWatchlist = (id: string): Promise<WatchlistRefreshResponse> =>
  apiPost(`/api/watchlists/${id}/refresh`, {});

// ── Ticker ────────────────────────────────────────────────────────────────────

export const fetchTickerBars = (ticker: string, start?: string, end?: string): Promise<TickerBarsResponse> =>
  apiGet<TickerBarsResponse>(`/api/ticker/${ticker}/bars`, { start, end });

export const fetchTickerTechnicals = (
  ticker: string,
  start?: string,
  end?: string,
  signals = true,
  include?: string,
): Promise<ExtendedTechnicalsResponse> =>
  apiGet<ExtendedTechnicalsResponse>(`/api/ticker/${ticker}/technicals`, {
    start,
    end,
    signals: signals ? 1 : 0,
    ...(include ? { include } : {}),
  });

// ── Portfolios ────────────────────────────────────────────────────────────────

export const fetchPortfolios = (): Promise<{ portfolios: PortfolioSummary[] }> =>
  apiGet("/api/portfolios");

export const fetchPortfolioDetail = (id: string): Promise<PortfolioDetail> =>
  apiGet(`/api/portfolios/${id}`);

export const createPortfolio = (name: string): Promise<PortfolioSummary> =>
  apiPost("/api/portfolios", { name });

export const renamePortfolio = (id: string, name: string): Promise<{ id: string; name: string }> =>
  apiPut(`/api/portfolios/${id}`, { name });

export const deletePortfolio = (id: string): Promise<void> =>
  apiDelete(`/api/portfolios/${id}`);

export const addPosition = (
  portfolioId: string,
  ticker: string,
  weight: number | null,
): Promise<{ ticker: string; weight: number | null }> =>
  apiPost(`/api/portfolios/${portfolioId}/positions`, { ticker, weight });

export const updatePosition = (
  portfolioId: string,
  ticker: string,
  weight: number | null,
): Promise<{ ticker: string; weight: number | null }> =>
  apiPut(`/api/portfolios/${portfolioId}/positions/${ticker}`, { ticker, weight });

export const removePosition = (portfolioId: string, ticker: string): Promise<void> =>
  apiDelete(`/api/portfolios/${portfolioId}/positions/${ticker}`);

export const fetchPortfolioAnalytics = (
  id: string,
  start?: string,
  end?: string,
): Promise<PortfolioAnalytics> =>
  apiGet<PortfolioAnalytics>(`/api/portfolios/${id}/analytics`, { start, end });

export const optimizePortfolio = (
  id: string,
  mode: string,
  maxWeight: number,
  start?: string,
  end?: string,
  volTarget?: number,
  allowShort?: boolean,
): Promise<PortfolioOptimizeResult> =>
  apiPost<PortfolioOptimizeResult>(`/api/portfolios/${id}/optimize`, {
    mode,
    max_weight: maxWeight,
    start,
    end,
    ...(volTarget !== undefined ? { vol_target: volTarget } : {}),
    ...(allowShort !== undefined ? { allow_short: allowShort } : {}),
  });

export const validatePortfolio = (id: string, quick = true): Promise<PortfolioValidationResult> =>
  apiPost<PortfolioValidationResult>(`/api/portfolios/${id}/validate`, { quick });

export const forecastPortfolio = (
  id: string,
  method: string,
  horizonDays: number,
): Promise<PortfolioForecastResult> =>
  apiPost<PortfolioForecastResult>(`/api/portfolios/${id}/forecast`, {
    method,
    horizon_days: horizonDays,
  });

// ── Portfolio Health & Scenarios ──────────────────────────────────────────────

export const fetchPortfolioHealth = (
  id: string,
  benchmark = "SPY",
  lookback = 252,
): Promise<PortfolioHealthResult> =>
  apiGet<PortfolioHealthResult>(`/api/portfolios/${id}/health`, { benchmark, lookback });

export const runScenario = (id: string, body: ScenarioRequest): Promise<ScenarioResult> =>
  apiPost<ScenarioResult>(`/api/portfolios/${id}/scenarios/run`, body);

export const fetchRebalance = (
  id: string,
  targetWeights: Record<string, number>,
): Promise<RebalanceResult> =>
  apiPost<RebalanceResult>(`/api/portfolios/${id}/rebalance`, { target_weights: targetWeights });

// ── Candidates ────────────────────────────────────────────────────────────────

export const fetchCandidates = (portfolioId: string): Promise<CandidateRefreshResponse> =>
  apiGet<CandidateRefreshResponse>(`/api/portfolios/${portfolioId}/candidates`);

export const addCandidate = (portfolioId: string, ticker: string): Promise<{ portfolio_id: string; ticker: string }> =>
  apiPost(`/api/portfolios/${portfolioId}/candidates`, { ticker });

export const removeCandidate = (portfolioId: string, ticker: string): Promise<void> =>
  apiDelete(`/api/portfolios/${portfolioId}/candidates/${ticker}`);

export const refreshCandidates = (portfolioId: string): Promise<CandidateRefreshResponse> =>
  apiPost<CandidateRefreshResponse>(`/api/portfolios/${portfolioId}/candidates/refresh`, {});

// ── Indicator Configs ─────────────────────────────────────────────────────────

export const fetchIndicatorConfigs = (portfolioId: string): Promise<{ configs: PortfolioIndicatorConfig[] }> =>
  apiGet(`/api/portfolios/${portfolioId}/indicator_configs`);

export const upsertIndicatorConfig = (
  portfolioId: string,
  body: { ticker: string; indicator_type: string; params_json?: Record<string, unknown> | null; enabled: boolean },
): Promise<PortfolioIndicatorConfig> =>
  apiPost<PortfolioIndicatorConfig>(`/api/portfolios/${portfolioId}/indicator_configs`, body);

export const deleteIndicatorConfig = (portfolioId: string, ticker: string, indicator: string): Promise<void> =>
  apiDelete(`/api/portfolios/${portfolioId}/indicator_configs/${ticker}/${indicator}`);

// ── Alert Rules ────────────────────────────────────────────────────────────────

export const fetchAlertRules = (): Promise<{ rules: AlertRule[] }> =>
  apiGet("/api/alert_rules");

export const createAlertRule = (body: Omit<AlertRule, "id" | "created_at">): Promise<AlertRule> =>
  apiPost("/api/alert_rules", body);

export const updateAlertRule = (
  id: string,
  patch: Partial<Pick<AlertRule, "enabled" | "params_json" | "cooldown_days" | "rule_type">>,
): Promise<AlertRule> => apiPut(`/api/alert_rules/${id}`, patch);

export const deleteAlertRule = (id: string): Promise<void> =>
  apiDelete(`/api/alert_rules/${id}`);

export const evaluateNow = (): Promise<EvaluateResult> =>
  apiPost<EvaluateResult>("/api/alert_rules/evaluate_now", {});

export const fetchAlertEvents = (
  limit = 50,
  filters?: { status?: string; ticker?: string },
): Promise<{ events: AlertEvent[] }> =>
  apiGet("/api/alert_rules/events", { limit, ...filters });

export const updateAlertEventStatus = (
  id: string,
  status: AlertEventStatus,
): Promise<AlertEvent> =>
  apiPatch<AlertEvent>(`/api/alert_rules/events/${id}`, { status });

export const fetchRuleMetadata = (): Promise<{ metadata: RuleMetadata[] }> =>
  apiGet("/api/alert_rules/rule_metadata");

// ── Ops ───────────────────────────────────────────────────────────────────────

export const fetchOpsStatus = (): Promise<OpsStatus> =>
  apiGet<OpsStatus>("/api/ops/status");

export const fetchOpsDigest = (params?: {
  portfolio_id?: string;
  watchlist_id?: string;
  asof?: string;
}): Promise<OpsDigest> =>
  apiGet<OpsDigest>("/api/ops/digest", params ?? {});

export const fetchJobRuns = (limit = 10): Promise<{ job_runs: JobRunRecord[] }> =>
  apiGet("/api/ops/job_runs", { limit });

export const testEmail = (): Promise<{ sent: boolean; reason?: string }> =>
  apiPost("/api/ops/email/test", {});

export const fetchEmailConfig = (): Promise<EmailConfig> =>
  apiGet<EmailConfig>("/api/ops/email/config");

export const saveEmailConfig = (body: {
  smtp_host?: string | null;
  smtp_port?: number;
  smtp_user?: string | null;
  smtp_pass?: string;
  email_from?: string | null;
  recipients?: string | null;
}): Promise<EmailConfig> => apiPut<EmailConfig>("/api/ops/email/config", body);

export const emailDigest = (params?: {
  portfolio_id?: string;
  watchlist_id?: string;
  asof?: string;
}): Promise<{ sent: boolean; as_of_date?: string; reason?: string }> => {
  const qs = params
    ? "?" + new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]).toString()
    : "";
  return apiPost(`/api/ops/digest/email${qs}`, {});
};
