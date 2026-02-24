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

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  password: string;
  display_name: string;
}

export interface LoginResponse {
  token: string;
  actor: string;
  expires_in: number;
}

export const login = (req: LoginRequest): Promise<LoginResponse> => {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  return fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? res.statusText);
    }
    return res.json() as Promise<LoginResponse>;
  });
};

// ── Portfolio & analytics (all require auth via apiPost) ──────────────────────

export const fetchPortfolioMetrics = (req: PortfolioRequest): Promise<PortfolioResponse> =>
  apiPost<PortfolioResponse>("/api/portfolio/metrics", req);

export const fetchOptimize = (req: OptimizeRequest): Promise<OptimizeResponse> =>
  apiPost<OptimizeResponse>("/api/optimize", req);

export const fetchTechnicals = (req: TechnicalsRequest): Promise<TechnicalsResponse> =>
  apiPost<TechnicalsResponse>("/api/technicals", req);

export const fetchAlertCheck = (req: AlertRequest): Promise<AlertResponse> =>
  apiPost<AlertResponse>("/api/alerts/check", req);
