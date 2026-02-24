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
import { apiPost } from "./utils";

export const fetchPortfolioMetrics = (req: PortfolioRequest): Promise<PortfolioResponse> =>
  apiPost<PortfolioResponse>("/api/portfolio/metrics", req);

export const fetchOptimize = (req: OptimizeRequest): Promise<OptimizeResponse> =>
  apiPost<OptimizeResponse>("/api/optimize", req);

export const fetchTechnicals = (req: TechnicalsRequest): Promise<TechnicalsResponse> =>
  apiPost<TechnicalsResponse>("/api/technicals", req);

export const fetchAlertCheck = (req: AlertRequest): Promise<AlertResponse> =>
  apiPost<AlertResponse>("/api/alerts/check", req);
