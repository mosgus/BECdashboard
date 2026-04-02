"use client";
import type { CompositeScoreResult } from "@/types/research";

const LABELS: Record<string, string> = {
  validation: "Statistical Validation",
  concentration: "Concentration Risk",
  performance: "Performance Quality",
  drawdown: "Drawdown Resilience",
};

export default function DecisionScorecard({
  score,
}: {
  score: CompositeScoreResult;
}) {
  const colorForScore = (s: number) =>
    s >= 0.7
      ? "bg-green-500"
      : s >= 0.45
        ? "bg-amber-500"
        : "bg-red-500";

  const badgeColor = (s: number) =>
    s >= 0.7
      ? "text-green-700 bg-green-100"
      : s >= 0.45
        ? "text-amber-700 bg-amber-100"
        : "text-red-700 bg-red-100";

  return (
    <div className="space-y-4">
      {/* Overall */}
      <div className="flex items-center gap-4">
        <div
          className={`rounded-lg px-4 py-2 text-lg font-black ${badgeColor(
            score.total / 100,
          )}`}
        >
          {score.total.toFixed(0)} / 100
        </div>
        <div
          className={`rounded px-3 py-1 text-sm font-bold ${
            score.go_decision
              ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
          }`}
        >
          {score.go_decision ? "GO" : "NO-GO"}
        </div>
      </div>

      {/* Category bars */}
      <div className="space-y-2.5">
        {Object.entries(score.categories).map(([key, cat]) => (
          <div key={key} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[var(--color-text)]">
                {LABELS[key] ?? key} ({(cat.weight * 100).toFixed(0)}%)
              </span>
              <span className="font-mono text-[var(--color-muted)]">
                {(cat.score * 100).toFixed(0)}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-[var(--color-border)]">
              <div
                className={`h-2.5 rounded-full transition-all ${colorForScore(
                  cat.score,
                )}`}
                style={{ width: `${cat.score * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-[var(--color-muted)]">{cat.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
