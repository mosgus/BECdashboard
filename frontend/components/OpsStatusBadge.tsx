"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchOpsStatus } from "@/lib/api";
import type { OpsStatus } from "@/types/sprint3";

type BadgeColor = "green" | "amber" | "red";

function getBadgeColor(status: OpsStatus): BadgeColor {
  const run = status.last_job_run;
  if (!run) return "red";
  if (run.status === "failure") return "red";

  const asof = new Date(run.asof_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = (today.getTime() - asof.getTime()) / 86_400_000;

  if (run.status === "partial" || diffDays > 2) return "amber";
  return "green";
}

const DOT: Record<BadgeColor, string> = {
  green: "bg-green-500",
  amber: "bg-amber-400",
  red:   "bg-red-500",
};

const DOT_LABEL: Record<BadgeColor, string> = {
  green: "System healthy",
  amber: "Attention needed",
  red:   "System alert",
};

export default function OpsStatusBadge() {
  const { data } = useQuery({
    queryKey: ["ops-status"],
    queryFn: fetchOpsStatus,
    staleTime: 5 * 60 * 1000,   // 5 minutes
    refetchInterval: 5 * 60 * 1000,
  });

  if (!data) return null;

  const color = getBadgeColor(data);
  const run = data.last_job_run;

  let tooltip = "Never run";
  if (run) {
    const dur = run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—";
    tooltip = `Last run: ${run.asof_date} · ${run.status} · ${dur}`;
  }

  return (
    <span
      title={`${DOT_LABEL[color]} — ${tooltip}`}
      className="relative flex h-2.5 w-2.5 items-center justify-center"
    >
      {color === "green" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-50" />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${DOT[color]}`} />
    </span>
  );
}
