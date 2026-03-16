"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNbaPredictions } from "@/lib/api";
import NBAMetricsBar from "@/components/NBAMetricsBar";
import type { NBARow } from "@/types/nba";

// ── Category helpers ──────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  HOMERUN:     "bg-red-500 text-white",
  UNDERVALUED: "bg-green-600 text-white",
  UNDERDOG:    "bg-blue-500 text-white",
  SHARP:       "bg-yellow-600 text-white",
  FADE:        "bg-[var(--color-muted)] text-white",
  "LOW EDGE":  "bg-[var(--color-muted)] text-white",
};

const TOP_CATEGORIES = new Set(["HOMERUN", "UNDERVALUED", "UNDERDOG"]);

function CategoryBadge({ cat }: { cat: string }) {
  const cls = CATEGORY_COLOR[cat] ?? "bg-gray-500 text-white";
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{cat}</span>
  );
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function ev(v: number) {
  const s = v >= 0 ? "+" : "";
  return `${s}$${v.toFixed(2)}`;
}

// ── Market table (per game, per tab) ─────────────────────────────────────────

function MarketTable({ rows }: { rows: NBARow[] }) {
  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-[var(--color-muted)]">No markets.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-muted)]">
            <th className="py-2 pr-3">Contract</th>
            <th className="py-2 pr-3">Kalshi%</th>
            <th className="py-2 pr-3">Odds</th>
            <th className="py-2 pr-3">Model%</th>
            <th className="py-2 pr-3">Edge</th>
            <th className="py-2 pr-3">EV($100)</th>
            <th className="py-2 pr-3">Kelly%</th>
            <th className="py-2">Category</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.ticker}
              className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-border)]/30"
            >
              <td className="py-2 pr-3 max-w-[220px] truncate text-[var(--color-text)]" title={r.title}>
                {r.title}
              </td>
              <td className="py-2 pr-3 text-[var(--color-muted)]">{pct(r.kalshi_prob)}</td>
              <td className="py-2 pr-3 font-mono text-[var(--color-text)]">{r.american_odds}</td>
              <td className="py-2 pr-3 text-[var(--color-text)]">{pct(r.model_prob)}</td>
              <td
                className={`py-2 pr-3 font-semibold ${
                  r.edge > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"
                }`}
              >
                {pct(r.edge)}
              </td>
              <td
                className={`py-2 pr-3 font-semibold ${
                  r.ev > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"
                }`}
              >
                {ev(r.ev)}
              </td>
              <td className="py-2 pr-3 text-[var(--color-muted)]">{r.kelly.toFixed(1)}%</td>
              <td className="py-2">
                <CategoryBadge cat={r.category} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Per-game collapsible card ─────────────────────────────────────────────────

const MARKET_TABS = ["moneyline", "spread", "total"] as const;

function GameCard({ gameLabel, rows }: { gameLabel: string; rows: NBARow[] }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<(typeof MARKET_TABS)[number]>("moneyline");

  const tabRows = rows.filter((r) => r.market_type === tab);

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-semibold text-[var(--color-text)]">{gameLabel}</span>
        <span className="text-[var(--color-muted)]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] px-4 pb-4">
          {/* Tabs */}
          <div className="flex gap-1 pt-3 pb-2">
            {MARKET_TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  tab === t
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <MarketTable rows={tabRows} />
        </div>
      )}
    </div>
  );
}

// ── Top Picks card ────────────────────────────────────────────────────────────

function TopPickCard({ row }: { row: NBARow }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <CategoryBadge cat={row.category} />
        <span className="text-sm font-semibold text-[var(--color-text)]">{row.game_label}</span>
      </div>
      <p className="text-xs text-[var(--color-muted)] truncate">{row.title}</p>
      <div className="flex gap-4 text-sm">
        <div>
          <span className="text-xs text-[var(--color-muted)]">Edge </span>
          <span className={`font-semibold ${row.edge > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
            {pct(row.edge)}
          </span>
        </div>
        <div>
          <span className="text-xs text-[var(--color-muted)]">EV </span>
          <span className={`font-semibold ${row.ev > 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
            {ev(row.ev)}
          </span>
        </div>
        <div>
          <span className="text-xs text-[var(--color-muted)]">Kelly </span>
          <span className="font-semibold text-[var(--color-text)]">{row.kelly.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Low Edge collapsible ──────────────────────────────────────────────────────

function LowEdgeSection({ rows }: { rows: NBARow[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-semibold text-[var(--color-muted)]">
          Low Edge / Fade ({rows.length})
        </span>
        <span className="text-[var(--color-muted)]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--color-border)] px-4 pb-4">
          <MarketTable rows={rows} />
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NBAPage() {
  const [wXgb, setWXgb] = useState(1.0);

  const { data, isLoading, error } = useQuery({
    queryKey: ["nba_predictions", wXgb],
    queryFn: () => fetchNbaPredictions(wXgb),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]" style={{ fontFamily: "var(--font-heading)" }}>
          NBA Betting Intelligence
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          XGBoost predictions vs Kalshi market prices · auto-refreshes every 60 s
        </p>
      </div>

      {/* XGBoost weight slider */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label className="mb-2 flex items-center justify-between text-sm font-medium text-[var(--color-text)]">
          <span>XGBoost Weight</span>
          <span className="font-mono text-[var(--color-primary)]">{wXgb.toFixed(2)}</span>
        </label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={wXgb}
          onChange={(e) => setWXgb(parseFloat(e.target.value))}
          className="w-full accent-[var(--color-primary)]"
        />
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          1.0 = full model strength · 0.0 = rely on Kalshi market prices · above 1.0 extrapolates
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <p className="text-center text-sm text-[var(--color-muted)]">Loading markets…</p>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-[var(--radius-card)] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load predictions: {(error as Error).message}
        </div>
      )}

      {data && (
        <>
          {/* Stats unavailable warning */}
          {!data.stats_loaded && (
            <div className="rounded-[var(--radius-card)] border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
              NBA stats unavailable — predictions use 50/50 baseline. Model edge may be unreliable.
            </div>
          )}

          {/* Metrics bar */}
          <NBAMetricsBar data={data} />

          {/* No games */}
          {data.games_count === 0 && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6 text-center text-sm text-[var(--color-muted)]">
              No NBA games today.
            </div>
          )}

          {data.games_count > 0 && (() => {
            const topRows = data.rows
              .filter((r) => TOP_CATEGORIES.has(r.category))
              .sort((a, b) => b.ev - a.ev)
              .slice(0, 3);

            const byGame = new Map<number, NBARow[]>();
            for (const r of data.rows) {
              if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
              byGame.get(r.game_id)!.push(r);
            }

            const gameLabels = new Map<number, string>();
            for (const r of data.rows) {
              if (!gameLabels.has(r.game_id)) gameLabels.set(r.game_id, r.game_label);
            }

            const mainRows = data.rows.filter(
              (r) => r.category !== "FADE" && r.category !== "LOW EDGE",
            );
            const lowEdgeRows = data.rows.filter(
              (r) => r.category === "FADE" || r.category === "LOW EDGE",
            );

            return (
              <>
                {/* Top Picks */}
                {topRows.length > 0 && (
                  <section className="flex flex-col gap-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                      Top Picks
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {topRows.map((r) => (
                        <TopPickCard key={r.ticker} row={r} />
                      ))}
                    </div>
                  </section>
                )}

                {/* All Games */}
                <section className="flex flex-col gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                    All Games
                  </h2>
                  {Array.from(byGame.entries()).map(([gameId, rows]) => (
                    <GameCard
                      key={gameId}
                      gameLabel={gameLabels.get(gameId) ?? String(gameId)}
                      rows={rows}
                    />
                  ))}
                </section>

                {/* Low Edge */}
                <LowEdgeSection rows={lowEdgeRows} />
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
