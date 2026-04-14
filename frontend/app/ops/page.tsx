"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchJobRuns,
  fetchOpsStatus,
  refreshPrices,
} from "@/lib/api";
import type { JobRunRecord, OpsStatus } from "@/types/sprint3";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-green-100 text-green-700",
    failure: "bg-red-100 text-red-700",
    partial: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

// ── System Health ─────────────────────────────────────────────────────────────

function SystemHealthSection() {
  const { data, isLoading, refetch } = useQuery<OpsStatus>({
    queryKey: ["ops-status"],
    queryFn: fetchOpsStatus,
    refetchInterval: 60_000,
  });

  if (isLoading) return <p className="text-sm text-[var(--color-muted)]">Loading…</p>;
  if (!data) return null;

  const run = data.last_job_run;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">System Health</h2>
        <button onClick={() => refetch()} className="text-xs text-[var(--color-primary)] hover:underline">Refresh</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--color-muted)]">Last Job Run</p>
          {run ? (
            <>
              <div className="flex items-center gap-2">
                <StatusPill status={run.status} />
                <span className="text-xs text-[var(--color-muted)]">{fmtDuration(run.duration_ms)}</span>
              </div>
              <p className="text-xs text-[var(--color-muted)]">{run.asof_date}</p>
              {run.finished_at && (
                <p className="text-xs text-[var(--color-muted)]">{new Date(run.finished_at).toLocaleString()}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">Never run</p>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--color-muted)]">Data Source</p>
          <p className="text-sm text-[var(--color-text)]">{data.data_source ?? "yfinance"}</p>
        </div>
      </div>
    </div>
  );
}

// ── Price Data Refresh ────────────────────────────────────────────────────────

function PriceDataSection() {
  const qc = useQueryClient();
  const [result, setResult] = useState<{
    status: string;
    tickers_processed: number;
    batches: number;
    rows_upserted: number;
    elapsed_s: number;
    errors: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const incrementalMut = useMutation({
    mutationFn: () => refreshPrices({}),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      qc.invalidateQueries({ queryKey: ["job-runs"] });
      qc.invalidateQueries({ queryKey: ["ops-status"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const backfillMut = useMutation({
    mutationFn: () => refreshPrices({ backfill_years: 10 }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      qc.invalidateQueries({ queryKey: ["job-runs"] });
      qc.invalidateQueries({ queryKey: ["ops-status"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const pending = incrementalMut.isPending || backfillMut.isPending;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-[var(--color-text)]">Price Data Refresh</h2>
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        Fetches daily OHLCV from yfinance and upserts into the <code className="rounded bg-gray-100 px-1">price_history</code> table.
        Incremental refresh is gap-aware — if the nightly cron missed several days (e.g. laptop was off), it fills all of them in one run.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => incrementalMut.mutate()}
          disabled={pending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {incrementalMut.isPending ? "Refreshing..." : "Refresh Now"}
        </button>
        <button
          onClick={() => {
            if (confirm("Force 10-year backfill for every active ticker? This takes longer and overwrites existing rows.")) {
              backfillMut.mutate();
            }
          }}
          disabled={pending}
          className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-5 py-2 text-sm font-medium text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 transition-colors"
        >
          {backfillMut.isPending ? "Backfilling..." : "10yr Backfill"}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-xs text-[var(--color-negative)]">{error}</p>
      )}

      {result && (
        <div className="mt-3 rounded border border-[var(--color-border)] bg-gray-50 px-3 py-2 text-xs">
          <div className="flex items-center gap-3">
            <StatusPill status={result.status} />
            <span className="text-[var(--color-text)]">
              <strong>{result.rows_upserted.toLocaleString()}</strong> rows upserted
            </span>
            <span className="text-[var(--color-muted)]">
              {result.tickers_processed} tickers · {result.batches} batches · {result.elapsed_s}s
            </span>
          </div>
          {result.errors.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {result.errors.map((e, i) => (
                <p key={i} className="text-[var(--color-negative)]">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Recent Job Runs ───────────────────────────────────────────────────────────

function JobRunsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["job-runs"],
    queryFn: () => fetchJobRuns(10),
  });

  const runs: JobRunRecord[] = data?.job_runs ?? [];

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--color-border)]">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Recent Job Runs</h2>
      </div>
      {isLoading ? (
        <p className="p-5 text-sm text-[var(--color-muted)]">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="p-5 text-sm text-[var(--color-muted)]">No job runs recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-[var(--color-border)]">
            <tr>
              {["Job", "As-of Date", "Status", "Duration", "Finished At"].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-[var(--color-muted)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {runs.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs">{r.job_name}</td>
                <td className="px-4 py-2 text-xs">{r.asof_date}</td>
                <td className="px-4 py-2"><StatusPill status={r.status} /></td>
                <td className="px-4 py-2 text-xs text-[var(--color-muted)]">{fmtDuration(r.duration_ms)}</td>
                <td className="px-4 py-2 text-xs text-[var(--color-muted)]">
                  {r.finished_at ? new Date(r.finished_at).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OpsPage() {
  const { checked } = useAuth();
  if (!checked) return null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text)]">Operations</h1>
        <p className="mt-0.5 text-xs text-[var(--color-muted)]">
          System health, price data management, and job run history.
        </p>
      </div>

      <SystemHealthSection />
      <PriceDataSection />
      <JobRunsSection />
    </div>
  );
}
