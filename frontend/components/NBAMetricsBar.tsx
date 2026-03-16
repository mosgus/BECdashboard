"use client";
import type { NBAPredictionsResponse } from "@/types/nba";

interface Props {
  data: NBAPredictionsResponse;
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </span>
      <span className="text-2xl font-bold text-[var(--color-text)]">{value}</span>
    </div>
  );
}

export default function NBAMetricsBar({ data }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Games Today"    value={data.games_count}   />
      <Tile label="Kalshi Markets" value={data.markets_count} />
      <Tile label="Positive Edge"  value={data.positive_edge} />
      <Tile label="+EV Bets"       value={data.positive_ev}   />
    </div>
  );
}
