"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useResearch } from "@/components/research/ResearchContext";
import WalkForwardPanel from "@/components/research/WalkForwardPanel";
import { validatePortfolio, runScenario } from "@/lib/api";
import { fmtPct, fmtNum } from "@/lib/utils";
import type { PortfolioValidationResult } from "@/types/sprint6";
import type { ScenarioResult } from "@/types/sprint7";
import InfoTooltip from "@/components/InfoTooltip";

const TEST_INTERPRETATIONS: Record<string, string> = {
  sharpe_ttest: "Is the Sharpe ratio statistically different from zero? (Lo 2002 autocorrelation correction)",
  block_permutation: "Does return timing add value vs shuffled 4-week blocks?",
  block_bootstrap_ci: "Bootstrap 95% CI for annualised Sharpe — does it exclude zero?",
  stationarity_adf: "Are returns stationary? (Augmented Dickey-Fuller — rejection = stationary)",
  autocorrelation_lb: "Are returns serially independent? (Ljung-Box lag 10 — fail = autocorrelation present)",
  normality_jb: "Do returns have fat tails? (Jarque-Bera — rejection is expected for real returns)",
  drawdown_bootstrap: "Is max drawdown consistent with random timing? (block-bootstrap null)",
};

// ── Scenario panel ──────────────────────────────────────────────────────────

function ScenarioPanel({ portfolioId }: { portfolioId: string }) {
  const [scenarioType, setScenarioType] = useState("market_shock");
  const [shockPct, setShockPct] = useState(-20);
  const [volScale, setVolScale] = useState(2.0);
  const [startDate, setStartDate] = useState("2020-02-19");
  const [endDate, setEndDate] = useState("2020-03-23");
  const [results, setResults] = useState<ScenarioResult[]>([]);

  const scenMut = useMutation({
    mutationFn: () => {
      const body =
        scenarioType === "market_shock"
          ? { scenario_type: "market_shock" as const, shock_pct: shockPct / 100 }
          : scenarioType === "vol_shock"
            ? { scenario_type: "vol_shock" as const, vol_scale: volScale }
            : { scenario_type: "historical_replay" as const, start_date: startDate, end_date: endDate };
      return runScenario(portfolioId, body);
    },
    onSuccess: (data) => {
      setResults((prev) => [...prev, data]);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted)]">
            Scenario Type
          </label>
          <select
            value={scenarioType}
            onChange={(e) => setScenarioType(e.target.value)}
            className="mt-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          >
            <option value="market_shock">Market Shock</option>
            <option value="vol_shock">Vol Shock</option>
            <option value="historical_replay">Historical Replay</option>
          </select>
        </div>

        {scenarioType === "market_shock" && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-muted)]">
              Shock (%)
            </label>
            <input
              type="number"
              value={shockPct}
              onChange={(e) => setShockPct(Number(e.target.value))}
              className="mt-1 w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
            />
          </div>
        )}

        {scenarioType === "vol_shock" && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-muted)]">
              Vol Scale
            </label>
            <input
              type="number"
              step={0.5}
              value={volScale}
              onChange={(e) => setVolScale(Number(e.target.value))}
              className="mt-1 w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
            />
          </div>
        )}

        {scenarioType === "historical_replay" && (
          <>
            <div>
              <label className="block text-xs font-medium text-[var(--color-muted)]">
                Start
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-muted)]">
                End
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
              />
            </div>
          </>
        )}

        <button
          onClick={() => scenMut.mutate()}
          disabled={scenMut.isPending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {scenMut.isPending ? "Running..." : "Run Scenario"}
        </button>

        {results.length > 0 && (
          <button
            onClick={() => setResults([])}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)]"
          >
            Clear
          </button>
        )}
      </div>

      {scenMut.isError && (
        <p className="text-xs text-[var(--color-negative)]">
          {(scenMut.error as Error).message}
        </p>
      )}

      {/* Results table */}
      {results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                  #
                </th>
                <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                  Type
                </th>
                <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                  Impact
                </th>
                <th className="px-3 py-2 text-left font-semibold text-[var(--color-muted)]">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-[var(--color-border)]"
                >
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2 font-medium capitalize">
                    {r.scenario_type?.replace("_", " ") ?? "Unknown"}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {r.portfolio_impact != null
                      ? fmtPct(r.portfolio_impact)
                      : r.total_return != null
                        ? fmtPct(r.total_return)
                        : r.shocked_vol != null
                          ? `Vol: ${fmtPct(r.base_vol)} → ${fmtPct(r.shocked_vol)}`
                          : "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {r.max_dd != null && `Max DD: ${fmtPct(r.max_dd)}`}
                    {r.n_days != null && ` (${r.n_days} days)`}
                    {r.vol_scale != null && `Scale: ${r.vol_scale}x`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function StressPage() {
  const { portfolioId } = useResearch();

  // Validation
  const valMut = useMutation({
    mutationFn: () => validatePortfolio(portfolioId!, true),
  });

  if (!portfolioId) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
        Select a portfolio above to begin research.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Walk-Forward / OOS */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-[var(--color-text)]">
          Walk-Forward / Out-of-Sample Validation
        </h3>
        <p className="mb-4 text-xs text-[var(--color-muted)]">
          Train an optimizer on historical data, then test on unseen future
          periods. A degradation ratio near 1.0 indicates the strategy is
          robust; values near 0 suggest overfitting.
        </p>
        <WalkForwardPanel portfolioId={portfolioId} />
      </div>

      {/* Statistical Validation */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Statistical Validation Suite
            </h3>
            <p className="text-xs text-[var(--color-muted)]">
              7 statistical tests on the portfolio's simulated daily returns.
              Quick mode: 500 permutations / 1,000 bootstrap samples.
            </p>
          </div>
          <button
            onClick={() => valMut.mutate()}
            disabled={valMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {valMut.isPending ? "Running 7 tests..." : "Run Validation"}
          </button>
        </div>

        {valMut.isError && (
          <p className="text-xs text-[var(--color-negative)]">
            {(valMut.error as Error).message}
          </p>
        )}

        {valMut.data && (
          <div className="space-y-4">
            {/* GO/NO-GO badge */}
            <div
              className={`flex items-center gap-4 rounded-[var(--radius-card)] border p-4 ${
                valMut.data.go_decision
                  ? "border-green-200 bg-green-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <span
                className={`text-2xl font-black ${
                  valMut.data.go_decision
                    ? "text-green-600"
                    : "text-red-600"
                }`}
              >
                {valMut.data.go_decision ? "GO" : "NO-GO"}
              </span>
              <div className="text-xs">
                <p className="font-semibold text-[var(--color-text)]">
                  {valMut.data.n_passing}/{valMut.data.n_total} tests passed
                </p>
                <p className="text-[var(--color-muted)]">
                  {valMut.data.returns_used} trading days
                  {valMut.data.quick_mode ? " · Quick mode" : " · Full mode"}
                </p>
              </div>
            </div>

            {/* Test cards */}
            <div className="grid gap-3 sm:grid-cols-2">
              {valMut.data.tests.map(
                (t: {
                  test: string;
                  label: string;
                  passed: boolean;
                  statistic: number | null;
                  p_value: number | null;
                  details?: { ci_lower?: number; ci_upper?: number };
                }) => (
                  <div
                    key={t.test}
                    className={`rounded-[var(--radius-card)] border p-3 ${
                      t.passed
                        ? "border-green-100 bg-green-50"
                        : "border-red-100 bg-red-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-xs font-semibold ${
                          t.passed ? "text-green-700" : "text-red-700"
                        }`}
                      >
                        {t.label}
                      </p>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${
                          t.passed
                            ? "bg-green-200 text-green-800"
                            : "bg-red-200 text-red-800"
                        }`}
                      >
                        {t.passed ? "PASS" : "FAIL"}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--color-muted)]">
                      {TEST_INTERPRETATIONS[t.test] ?? ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-3 text-[10px] text-[var(--color-text)]">
                      {t.statistic != null && (
                        <span>
                          stat: <strong>{t.statistic.toFixed(3)}</strong>
                        </span>
                      )}
                      {t.p_value != null && (
                        <span>
                          p: <strong>{t.p_value.toFixed(3)}</strong>
                        </span>
                      )}
                      {t.details?.ci_lower != null && (
                        <span>
                          95% CI: [
                          <strong>{String(t.details.ci_lower)}</strong>,{" "}
                          <strong>{String(t.details.ci_upper)}</strong>]
                        </span>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </div>

      {/* Scenario Engine */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-[var(--color-text)]">
          Scenario Engine
        </h3>
        <p className="mb-4 text-xs text-[var(--color-muted)]">
          Run market shocks, volatility shocks, or replay historical crisis
          periods. Results accumulate — run multiple scenarios for comparative
          analysis.
        </p>
        <ScenarioPanel portfolioId={portfolioId} />
      </div>
    </div>
  );
}
