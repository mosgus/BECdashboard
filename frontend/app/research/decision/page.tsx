"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useResearch } from "@/components/research/ResearchContext";
import DecisionScorecard from "@/components/research/DecisionScorecard";
import { fetchCompositeScore, fetchPortfolioHealth, saveDecisionMemo } from "@/lib/api";
import type { CompositeScoreResult } from "@/types/research";

// ── Auto-generated red flags ────────────────────────────────────────────────

function deriveRedFlags(
  score: CompositeScoreResult | undefined,
  health: { concentration?: { hhi: number; n_eff: number } } | undefined,
): { flag: string; severity: string; detail: string }[] {
  const flags: { flag: string; severity: string; detail: string }[] = [];
  if (!score) return flags;

  if (score.categories.validation.score < 4 / 7)
    flags.push({
      flag: "Weak statistical evidence",
      severity: "high",
      detail: score.categories.validation.detail,
    });

  if (score.categories.concentration.score < 0.4)
    flags.push({
      flag: "High concentration risk",
      severity: "high",
      detail: `HHI = ${health?.concentration?.hhi?.toFixed(3) ?? "?"}`,
    });

  if (score.categories.performance.score < 0.3)
    flags.push({
      flag: "Poor risk-adjusted performance",
      severity: "high",
      detail: score.categories.performance.detail,
    });

  if (score.categories.drawdown.score < 0.3)
    flags.push({
      flag: "Severe historical drawdown",
      severity: "medium",
      detail: score.categories.drawdown.detail,
    });

  if (score.total < 45)
    flags.push({
      flag: "Composite score below institutional threshold",
      severity: "high",
      detail: `Score: ${score.total.toFixed(0)} / 100`,
    });

  return flags;
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function DecisionMemoPage() {
  const { portfolioId } = useResearch();
  const queryClient = useQueryClient();

  // Scorecard data
  const { data: score, isLoading: scoreLoading } = useQuery({
    queryKey: ["research-composite", portfolioId],
    queryFn: () => fetchCompositeScore(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 60_000,
  });

  const { data: health } = useQuery({
    queryKey: ["research-health", portfolioId],
    queryFn: () => fetchPortfolioHealth(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 60_000,
  });

  // Form state
  const [recommendation, setRecommendation] = useState<string>("CONDITIONAL");
  const [rationale, setRationale] = useState("");
  const [monitoringPlan, setMonitoringPlan] = useState("");
  const [redFlags, setRedFlags] = useState<
    { flag: string; severity: string; detail: string }[]
  >([]);
  const [saved, setSaved] = useState(false);

  // Auto-populate red flags when score loads
  useEffect(() => {
    if (score) {
      setRedFlags(deriveRedFlags(score, health));
    }
  }, [score, health]);

  // Save mutation
  const saveMut = useMutation({
    mutationFn: () =>
      saveDecisionMemo({
        portfolio_id: portfolioId!,
        status: recommendation === "GO" ? "approved" : recommendation === "NO-GO" ? "rejected" : "draft",
        composite_score: score?.total ?? null,
        recommendation,
        rationale: rationale || null,
        red_flags: redFlags.length > 0 ? redFlags : null,
        scorecard_json: score
          ? {
              total: score.total,
              categories: score.categories,
              go_decision: score.go_decision,
            }
          : null,
        monitoring_plan: monitoringPlan || null,
        created_by:
          typeof window !== "undefined"
            ? localStorage.getItem("be_actor") ?? undefined
            : undefined,
      }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["decision-memos", portfolioId] });
      setTimeout(() => setSaved(false), 3000);
    },
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
      {/* Disclaimer */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
        This decision memo is for research and educational purposes. It does not
        constitute investment advice. All scores are computed from historical
        data and model assumptions.
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Scorecard */}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
            Auto-generated Scorecard
          </h3>
          {scoreLoading ? (
            <p className="text-xs text-[var(--color-muted)]">Computing...</p>
          ) : score ? (
            <DecisionScorecard score={score} />
          ) : (
            <p className="text-xs text-[var(--color-muted)]">
              Unable to compute composite score.
            </p>
          )}
        </div>

        {/* Right: Form */}
        <div className="space-y-5">
          {/* Recommendation */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
              Recommendation
            </h3>
            <div className="flex gap-3">
              {["GO", "CONDITIONAL", "NO-GO"].map((opt) => (
                <button
                  key={opt}
                  onClick={() => setRecommendation(opt)}
                  className={`rounded-[var(--radius-btn)] px-4 py-2 text-sm font-bold transition-colors ${
                    recommendation === opt
                      ? opt === "GO"
                        ? "bg-green-600 text-white"
                        : opt === "NO-GO"
                          ? "bg-red-600 text-white"
                          : "bg-amber-500 text-white"
                      : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:bg-[var(--color-border)]"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Rationale */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
              Rationale
            </h3>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={4}
              placeholder="Explain the reasoning behind your recommendation..."
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-primary)] focus:outline-none"
            />
          </div>

          {/* Red Flags */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
              Red Flags
            </h3>
            {redFlags.length === 0 ? (
              <p className="text-xs text-green-600">
                No red flags detected.
              </p>
            ) : (
              <div className="space-y-2">
                {redFlags.map((rf, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded border border-red-100 bg-red-50 px-3 py-2"
                  >
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        rf.severity === "high"
                          ? "bg-red-200 text-red-800"
                          : "bg-amber-200 text-amber-800"
                      }`}
                    >
                      {rf.severity}
                    </span>
                    <div className="text-xs">
                      <p className="font-medium text-red-700">{rf.flag}</p>
                      <p className="text-red-600/70">{rf.detail}</p>
                    </div>
                    <button
                      onClick={() =>
                        setRedFlags((prev) =>
                          prev.filter((_, idx) => idx !== i),
                        )
                      }
                      className="ml-auto text-xs text-red-400 hover:text-red-600"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Monitoring Plan */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
              Monitoring Plan
            </h3>
            <textarea
              value={monitoringPlan}
              onChange={(e) => setMonitoringPlan(e.target.value)}
              rows={3}
              placeholder="What should be monitored post-implementation? (e.g., drift thresholds, rebalance triggers, key risk metrics)"
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-primary)] focus:outline-none"
            />
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saveMut.isPending ? "Saving..." : "Save Decision Memo"}
            </button>
            {saved && (
              <span className="text-xs font-semibold text-green-600">
                Saved successfully
              </span>
            )}
            {saveMut.isError && (
              <span className="text-xs text-[var(--color-negative)]">
                {(saveMut.error as Error).message}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
