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
  AlertRule,
  EvaluateResult,
  PortfolioAnalytics,
  PortfolioDetail,
  PortfolioOptimizeResult,
  PortfolioSummary,
} from "@/types/sprint3";
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

export const patchUniverseTicker = (ticker: string, active: boolean): Promise<{ ticker: string; active: boolean }> =>
  apiPatch(`/api/universe/${ticker}`, { active });

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
): Promise<TickerTechnicalsResponse> =>
  apiGet<TickerTechnicalsResponse>(`/api/ticker/${ticker}/technicals`, {
    start,
    end,
    signals: signals ? 1 : 0,
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
  mode: "min_variance" | "max_sharpe",
  maxWeight: number,
  start?: string,
  end?: string,
): Promise<PortfolioOptimizeResult> =>
  apiPost<PortfolioOptimizeResult>(`/api/portfolios/${id}/optimize`, {
    mode,
    max_weight: maxWeight,
    start,
    end,
  });

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

export const fetchAlertEvents = (limit = 50): Promise<{ events: AlertEvent[] }> =>
  apiGet("/api/alert_rules/events", { limit });
