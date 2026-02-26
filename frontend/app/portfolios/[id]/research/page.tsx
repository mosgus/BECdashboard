"use client";
import { use, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { forecastPortfolio, validatePortfolio } from "@/lib/api";
import InfoTooltip from "@/components/InfoTooltip";
import ValidationGuide from "@/components/ValidationGuide";
import ForecastGuide from "@/components/ForecastGuide";
import FanChart from "@/components/FanChart";
import type { PortfolioValidationResult, PortfolioForecastResult } from "@/types/sprint6";

type ResearchSection = "validation" | "forecast";

const TEST_INTERPRETATIONS: Record<string, string> = {
  sharpe_ttest:       "Is the Sharpe ratio statistically different from zero? (Lo 2002 autocorrelation correction)",
  block_permutation:  "Does return timing add value vs shuffled 4-week blocks?",
  block_bootstrap_ci: "Bootstrap 95% CI for annualised Sharpe — does it exclude zero?",
  stationarity_adf:   "Are returns stationary? (Augmented Dickey-Fuller — rejection = stationary)",
  autocorrelation_lb: "Are returns serially independent? (Ljung-Box lag 10 — fail = autocorrelation present)",
  normality_jb:       "Do returns have fat tails? (Jarque-Bera — rejection is expected for real returns)",
  drawdown_bootstrap: "Is max drawdown consistent with random timing? (block-bootstrap null)",
};

export default function ResearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: portfolioId } = use(params);
  const { checked } = useAuth();
  const [section, setSection] = useState<ResearchSection>("validation");

  if (!checked) return null;

  return (
    <div className="space-y-4">
      {/* Disclaimer */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
        Statistical results are for research purposes only. Past performance and model outputs do not guarantee future results.
      </div>

      {/* Section switcher */}
      <div className="flex gap-2">
        {(["validation", "forecast"] as ResearchSection[]).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`rounded-[var(--radius-btn)] px-4 py-2 text-sm font-medium transition-colors ${
              section === s
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {s === "validation" ? "Validation" : "Forecast"}
          </button>
        ))}
      </div>

      {section === "validation" && <ValidationSection portfolioId={portfolioId} />}
      {section === "forecast"   && <ForecastSection   portfolioId={portfolioId} />}
    </div>
  );
}

// ── Validation section ─────────────────────────────────────────────────────────

function ValidationSection({ portfolioId }: { portfolioId: string }) {
  const [result, setResult] = useState<PortfolioValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const valMut = useMutation({
    mutationFn: () => validatePortfolio(portfolioId, true),
    onSuccess: (data) => { setResult(data); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-5">
      {showGuide && <ValidationGuide onClose={() => setShowGuide(false)} />}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Statistical Validation Suite</h3>
          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
          >
            <BookOpen size={13} />
            Validation Guide →
          </button>
        </div>
        <p className="mb-4 text-xs text-[var(--color-muted)]">
          Runs 7 statistical tests on the portfolio's simulated daily returns. Quick mode: 500 permutations / 1,000 bootstrap samples (~20–30 s).
        </p>
        <button
          onClick={() => valMut.mutate()}
          disabled={valMut.isPending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {valMut.isPending ? "Running 7 tests…" : "Run Validation"}
        </button>
        {error && <p className="mt-3 text-xs text-[var(--color-negative)]">{error}</p>}
      </div>

      {result && (
        <>
          {result.warnings?.length > 0 && (
            <div className="space-y-1">
              {result.warnings.map((w, i) => (
                <p key={i} className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-700 border border-amber-200">{w}</p>
              ))}
            </div>
          )}

          {/* GO / NO-GO badge */}
          <div className={`flex items-center gap-4 rounded-[var(--radius-card)] border p-5 shadow-sm ${result.go_decision ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <span className={`text-3xl font-black ${result.go_decision ? "text-green-600" : "text-red-600"}`}>
              {result.go_decision ? "GO" : "NO-GO"}
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {result.n_passing}/{result.n_total} tests passed
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                {result.returns_used} trading days · {result.quick_mode ? "Quick mode" : "Full mode"}
              </p>
            </div>
          </div>

          {/* 7 test cards */}
          <div className="grid gap-3 sm:grid-cols-2">
            {result.tests.map((t) => (
              <div
                key={t.test}
                className={`rounded-[var(--radius-card)] border p-4 shadow-sm ${t.passed ? "border-green-100 bg-green-50" : "border-red-100 bg-red-50"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-xs font-semibold ${t.passed ? "text-green-700" : "text-red-700"}`}>{t.label}</p>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${t.passed ? "bg-green-200 text-green-800" : "bg-red-200 text-red-800"}`}>
                    {t.passed ? "PASS" : "FAIL"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted)]">{TEST_INTERPRETATIONS[t.test] ?? ""}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--color-text)]">
                  {t.statistic != null && <span>stat: <strong>{t.statistic.toFixed(3)}</strong></span>}
                  {t.p_value   != null && <span>p: <strong>{t.p_value.toFixed(3)}</strong></span>}
                  {t.details?.ci_lower != null && (
                    <span>95% CI: [<strong>{String(t.details.ci_lower)}</strong>, <strong>{String(t.details.ci_upper)}</strong>]</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Forecast section ───────────────────────────────────────────────────────────

function ForecastSection({ portfolioId }: { portfolioId: string }) {
  const [method, setMethod] = useState("ensemble");
  const [horizon, setHorizon] = useState(30);
  const [result, setResult] = useState<PortfolioForecastResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const fcMut = useMutation({
    mutationFn: () => forecastPortfolio(portfolioId, method, horizon),
    onSuccess: (data) => { setResult(data); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-5">
      {showGuide && <ForecastGuide onClose={() => setShowGuide(false)} />}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Forecast Settings
            <InfoTooltip text="Forecasts the simulated portfolio equity curve and rolling volatility using the selected method. Prophet may take 30–60 s." />
          </h3>
          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
          >
            <BookOpen size={13} />
            Forecast Guide →
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              <option value="ewma">EWMA + Random Walk</option>
              <option value="arima">ARIMA (1,1,0)</option>
              <option value="prophet">Prophet</option>
              <option value="ensemble">Ensemble (Average)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Horizon</label>
            <div className="flex gap-1">
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setHorizon(d)}
                  className={`rounded-[var(--radius-btn)] px-3 py-2 text-sm font-medium transition-colors ${horizon === d ? "bg-[var(--color-primary)] text-white" : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-border)]"}`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => fcMut.mutate()}
            disabled={fcMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {fcMut.isPending ? "Forecasting…" : "Run Forecast"}
          </button>
        </div>
        {error && <p className="mt-3 text-xs text-[var(--color-negative)]">{error}</p>}
      </div>

      {result && (
        <>
          {result.warnings?.length > 0 && (
            <div className="space-y-1">
              {result.warnings.map((w, i) => (
                <p key={i} className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-700 border border-amber-200">{w}</p>
              ))}
            </div>
          )}

          {/* Fan charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <FanChart
              data={result.price_series}
              title={`Price Forecast — ${result.method} (${result.horizon_days}d)`}
              yLabel="Portfolio equity (start = 1.0)"
            />
            <FanChart
              data={result.vol_series}
              title="Volatility Forecast (annualised)"
              yLabel="Annualised vol"
            />
          </div>

          {/* Calibration + model info */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
                Calibration (last 30-day hold-out)
                <InfoTooltip text="Model was fit on data up to 30 days ago, then forecast forward. Metrics compare P50 vs actual." />
              </h3>
              <dl className="grid grid-cols-3 gap-3 text-xs">
                {[
                  ["RMSE",      result.calibration.rmse                != null ? result.calibration.rmse.toFixed(4)                              : "—"],
                  ["MAE",       result.calibration.mae                 != null ? result.calibration.mae.toFixed(4)                               : "—"],
                  ["Dir. Acc.", result.calibration.directional_accuracy != null ? `${(result.calibration.directional_accuracy * 100).toFixed(1)}%` : "—"],
                ].map(([l, v]) => (
                  <div key={l}>
                    <dt className="text-[var(--color-muted)]">{l}</dt>
                    <dd className="font-semibold text-[var(--color-text)]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Model Info</h3>
              <dl className="space-y-1 text-xs">
                <div>
                  <dt className="text-[var(--color-muted)]">Method</dt>
                  <dd className="font-medium text-[var(--color-text)]">{result.method}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-muted)]">Horizon</dt>
                  <dd className="font-medium text-[var(--color-text)]">{result.horizon_days} trading days</dd>
                </div>
                {Object.entries(result.model_info).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[var(--color-muted)]">{k.replace(/_/g, " ")}</dt>
                    <dd className="font-medium text-[var(--color-text)]">
                      {Array.isArray(v) ? v.join(", ") : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
