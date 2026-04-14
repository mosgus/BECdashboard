"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useResearch } from "@/components/research/ResearchContext";
import {
  fetchCompositeScore,
  fetchDecisionMemos,
  fetchPortfolioAnalytics,
  fetchPortfolioHealth,
} from "@/lib/api";
import { fmtPct, fmtNum } from "@/lib/utils";
import TearsheetPDF from "@/components/research/TearsheetPDF";
import { actor } from "@/lib/auth";

// ── Score gauge ─────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "text-green-600 border-green-300 bg-green-50"
      : score >= 45
        ? "text-amber-600 border-amber-300 bg-amber-50"
        : "text-red-600 border-red-300 bg-red-50";

  return (
    <div
      className={`flex h-28 w-28 items-center justify-center rounded-full border-4 ${color}`}
    >
      <div className="text-center">
        <p className="text-2xl font-black">{score.toFixed(0)}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
          / 100
        </p>
      </div>
    </div>
  );
}

// ── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <p className="text-xs font-medium text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 text-lg font-bold text-[var(--color-text)]">{value}</p>
      {detail && (
        <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{detail}</p>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const { portfolioId } = useResearch();

  const { data: score, isLoading: scoreLoading } = useQuery({
    queryKey: ["research-composite", portfolioId],
    queryFn: () => fetchCompositeScore(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 60_000,
  });

  const { data: analytics } = useQuery({
    queryKey: ["portfolio-analytics", portfolioId],
    queryFn: () => fetchPortfolioAnalytics(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 60_000,
  });

  const { data: health } = useQuery({
    queryKey: ["portfolio-health", portfolioId],
    queryFn: () => fetchPortfolioHealth(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 60_000,
  });

  const { data: memosData } = useQuery({
    queryKey: ["decision-memos", portfolioId],
    queryFn: () => fetchDecisionMemos(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 30_000,
  });

  if (!portfolioId) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
        Select a portfolio above to begin research.
      </div>
    );
  }

  const memos = memosData?.memos ?? [];
  const latestMemo = memos[0];

  // Key risks auto-detection
  const risks: string[] = [];
  if (health?.concentration?.hhi && health.concentration.hhi > 0.2)
    risks.push(`High concentration (HHI = ${health.concentration.hhi.toFixed(3)})`);
  if (score?.categories?.validation?.score !== undefined && score.categories.validation.score < 0.572)
    risks.push(`Weak validation (${score.categories.validation.detail})`);
  if (analytics?.metrics?.sharpe !== undefined && analytics.metrics.sharpe < 0)
    risks.push(`Negative Sharpe ratio (${analytics.metrics.sharpe.toFixed(2)})`);
  if (analytics?.metrics?.max_dd !== undefined && analytics.metrics.max_dd < -0.3)
    risks.push(`Deep drawdown (${fmtPct(analytics.metrics.max_dd)})`);

  return (
    <div className="space-y-6">
      {/* Export row */}
      <div className="flex items-center justify-end">
        <TearsheetPDF portfolioId={portfolioId} createdBy={actor.get()} />
      </div>

      {/* Composite Score + Recommendation */}
      <div className="flex flex-wrap items-start gap-6">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
          <p className="mb-3 text-xs font-semibold text-[var(--color-muted)]">
            Composite Research Score
          </p>
          {scoreLoading ? (
            <div className="flex h-28 w-28 items-center justify-center text-xs text-[var(--color-muted)]">
              Computing...
            </div>
          ) : score ? (
            <ScoreGauge score={score.total} />
          ) : (
            <p className="text-sm text-[var(--color-muted)]">Unable to compute</p>
          )}
        </div>

        <div className="flex-1 space-y-3">
          {/* Recommendation badge */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <p className="text-xs font-semibold text-[var(--color-muted)]">
              Latest Recommendation
            </p>
            {latestMemo ? (
              <div className="mt-2 flex items-center gap-3">
                <span
                  className={`rounded px-3 py-1 text-sm font-black ${
                    latestMemo.recommendation === "GO"
                      ? "bg-green-100 text-green-700"
                      : latestMemo.recommendation === "NO-GO"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {latestMemo.recommendation ?? "PENDING"}
                </span>
                <span className="text-xs text-[var(--color-muted)]">
                  {latestMemo.created_at
                    ? new Date(latestMemo.created_at).toLocaleDateString()
                    : ""}
                  {latestMemo.created_by ? ` by ${latestMemo.created_by}` : ""}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                No decision memos yet. Visit the Decision Memo tab to create one.
              </p>
            )}
          </div>

          {/* Score breakdown */}
          {score && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <p className="mb-2 text-xs font-semibold text-[var(--color-muted)]">
                Score Breakdown
              </p>
              <div className="space-y-1.5">
                {Object.entries(score.categories).map(([key, cat]) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <div className="w-24 font-medium capitalize text-[var(--color-text)]">
                      {key}
                    </div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-[var(--color-border)]">
                        <div
                          className={`h-2 rounded-full ${
                            cat.score >= 0.7
                              ? "bg-green-500"
                              : cat.score >= 0.45
                                ? "bg-amber-500"
                                : "bg-red-500"
                          }`}
                          style={{ width: `${cat.score * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-12 text-right font-mono text-[var(--color-muted)]">
                      {(cat.score * 100).toFixed(0)}
                    </div>
                    <div className="w-40 text-[var(--color-muted)]">{cat.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Sharpe"
          value={fmtNum(analytics?.metrics?.sharpe)}
          detail="Historical annualised"
        />
        <StatCard
          label="Volatility"
          value={fmtPct(analytics?.metrics?.vol)}
          detail="Annualised"
        />
        <StatCard
          label="Max Drawdown"
          value={fmtPct(analytics?.metrics?.max_dd)}
          detail="Peak to trough"
        />
        <StatCard
          label="HHI"
          value={fmtNum(health?.concentration?.hhi, 3)}
          detail={`N_eff = ${fmtNum(health?.concentration?.n_eff, 1)}`}
        />
        <StatCard
          label="Validation"
          value={score?.categories?.validation?.detail ?? "—"}
          detail="Statistical tests"
        />
        <StatCard
          label="Beta"
          value={fmtNum(health?.beta)}
          detail="vs SPY"
        />
      </div>

      {/* Key Risks */}
      {risks.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold text-amber-700">
            Key Risks Identified
          </p>
          <div className="space-y-1">
            {risks.map((r, i) => (
              <p key={i} className="text-xs text-amber-700">
                &bull; {r}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Recent Decision Memos */}
      {memos.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <p className="mb-3 text-xs font-semibold text-[var(--color-muted)]">
            Decision History
          </p>
          <div className="space-y-2">
            {memos.slice(0, 5).map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded border border-[var(--color-border)] px-3 py-2 text-xs"
              >
                <span
                  className={`rounded px-2 py-0.5 font-bold ${
                    m.recommendation === "GO"
                      ? "bg-green-100 text-green-700"
                      : m.recommendation === "NO-GO"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {m.recommendation ?? "DRAFT"}
                </span>
                <span className="text-[var(--color-muted)]">
                  Score: {m.composite_score?.toFixed(0) ?? "—"}
                </span>
                <span className="flex-1 truncate text-[var(--color-muted)]">
                  {m.rationale ?? "No rationale"}
                </span>
                <span className="text-[var(--color-muted)]">
                  {m.created_at
                    ? new Date(m.created_at).toLocaleDateString()
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
