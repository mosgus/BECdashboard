"use client";
import { use, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { validatePortfolio } from "@/lib/api";
import InfoTooltip from "@/components/InfoTooltip";
import ValidationGuide from "@/components/ValidationGuide";
import type { PortfolioValidationResult } from "@/types/sprint6";

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

  if (!checked) return null;

  return (
    <div className="space-y-4">
      {/* Research Suite link */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-4 py-2.5 text-xs text-[var(--color-text)]">
        For the full institutional research suite with optimizer comparison, walk-forward testing, and decision memos:{" "}
        <a href="/research" className="font-semibold text-[var(--color-primary)] hover:underline">
          Open Research Suite &rarr;
        </a>
      </div>

      {/* Disclaimer */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
        Statistical results are for research purposes only. Past performance and model outputs do not guarantee future results.
        Forecasting tools have moved to the <strong>Outlook</strong> tab.
      </div>

      <ValidationSection portfolioId={portfolioId} />
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

