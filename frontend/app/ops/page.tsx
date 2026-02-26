"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  emailDigest,
  fetchJobRuns,
  fetchOpsDigest,
  fetchOpsStatus,
  fetchPortfolios,
  fetchWatchlists,
  testEmail,
} from "@/lib/api";
import type { JobRunRecord, OpsDigest, OpsStatus } from "@/types/sprint3";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <p className="text-xs font-medium text-[var(--color-muted)]">Alert Rules</p>
          <p className="text-2xl font-bold text-[var(--color-text)]">{data.alert_rules_enabled}</p>
          <p className="text-xs text-[var(--color-muted)]">enabled</p>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--color-muted)]">Open Alerts</p>
          <p className={`text-2xl font-bold ${data.alert_events_new > 0 ? "text-blue-600" : "text-[var(--color-text)]"}`}>
            {data.alert_events_new}
          </p>
          <p className="text-xs text-[var(--color-muted)]">unacknowledged</p>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--color-muted)]">Email</p>
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
            data.email_configured ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}>
            {data.email_configured ? "Configured" : "Not configured"}
          </span>
          <p className="text-xs text-[var(--color-muted)]">Data: {data.data_source}</p>
        </div>
      </div>
    </div>
  );
}

// ── Overnight Digest ──────────────────────────────────────────────────────────

function DigestSection() {
  const [portfolioId, setPortfolioId] = useState("");
  const [watchlistId, setWatchlistId] = useState("");
  const [digest, setDigest] = useState<OpsDigest | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: portfoliosData } = useQuery({ queryKey: ["portfolios"], queryFn: fetchPortfolios });
  const { data: watchlistsData } = useQuery({ queryKey: ["watchlists"], queryFn: fetchWatchlists });

  const digestMut = useMutation({
    mutationFn: () =>
      fetchOpsDigest({
        ...(portfolioId ? { portfolio_id: portfolioId } : {}),
        ...(watchlistId ? { watchlist_id: watchlistId } : {}),
      }),
    onSuccess: (d) => setDigest(d),
  });

  const emailMut = useMutation({
    mutationFn: () =>
      emailDigest({
        ...(portfolioId ? { portfolio_id: portfolioId } : {}),
        ...(watchlistId ? { watchlist_id: watchlistId } : {}),
      }),
  });

  const handleCopy = () => {
    if (digest?.digest_text) {
      navigator.clipboard.writeText(digest.digest_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm space-y-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">Overnight Digest</h2>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Portfolio (optional)</label>
          <select
            value={portfolioId}
            onChange={(e) => setPortfolioId(e.target.value)}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          >
            <option value="">None</option>
            {portfoliosData?.portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Watchlist (optional)</label>
          <select
            value={watchlistId}
            onChange={(e) => setWatchlistId(e.target.value)}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          >
            <option value="">None</option>
            {watchlistsData?.watchlists.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => digestMut.mutate()}
          disabled={digestMut.isPending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {digestMut.isPending ? "Generating…" : "Generate Digest"}
        </button>
        {digest && (
          <>
            <button
              onClick={handleCopy}
              className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
            >
              {copied ? "Copied!" : "Copy as Text"}
            </button>
            <button
              onClick={() => emailMut.mutate()}
              disabled={emailMut.isPending}
              className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-border)] disabled:opacity-50 transition-colors"
            >
              {emailMut.isPending ? "Sending…" : "Email Digest"}
            </button>
          </>
        )}
      </div>

      {emailMut.data && (
        <p className={`text-sm ${emailMut.data.sent ? "text-green-600" : "text-[var(--color-muted)]"}`}>
          {emailMut.data.sent
            ? `✓ Digest emailed for ${emailMut.data.as_of_date}`
            : `Email not sent: ${emailMut.data.reason ?? "unknown"}`}
        </p>
      )}

      {digestMut.isError && (
        <p className="text-sm text-[var(--color-negative)]">{(digestMut.error as Error).message}</p>
      )}

      {digest && (
        <div className="space-y-4">
          {/* Summary row */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
              <p className="text-xs font-medium text-[var(--color-muted)]">As-of Date</p>
              <p className="mt-1 font-semibold text-[var(--color-text)]">{digest.as_of_date}</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
              <p className="text-xs font-medium text-[var(--color-muted)]">Alerts Today</p>
              <p className="mt-1 font-semibold text-[var(--color-text)]">
                {digest.alerts_triggered.entry} entry · {digest.alerts_triggered.exit} exit
              </p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
              <p className="text-xs font-medium text-[var(--color-muted)]">Open Alerts</p>
              <p className="mt-1 font-semibold text-[var(--color-text)]">{digest.new_alert_events.length}</p>
            </div>
          </div>

          {/* Portfolio movers */}
          {digest.portfolio_movers.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">Portfolio Top Movers</p>
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-[var(--color-border)]">
                    <tr>
                      {["Ticker", "1-Day Return", "Weight"].map((h) => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-[var(--color-muted)]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {digest.portfolio_movers.map((m) => (
                      <tr key={m.ticker} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono font-bold text-[var(--color-text)]">{m.ticker}</td>
                        <td className={`px-4 py-2 font-semibold ${m.daily_return >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {fmtPct(m.daily_return)}
                        </td>
                        <td className="px-4 py-2 text-[var(--color-muted)]">{(m.weight * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Watchlist movers */}
          {digest.watchlist_movers.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">Watchlist Top Movers</p>
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-[var(--color-border)]">
                    <tr>
                      {["Ticker", "1-Day Return"].map((h) => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-[var(--color-muted)]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {digest.watchlist_movers.map((m) => (
                      <tr key={m.ticker} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono font-bold text-[var(--color-text)]">{m.ticker}</td>
                        <td className={`px-4 py-2 font-semibold ${m.daily_return >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {fmtPct(m.daily_return)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Digest text */}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-text)]">
              Plaintext digest
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-gray-50 p-3 text-xs text-[var(--color-text)] whitespace-pre-wrap">
              {digest.digest_text}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

// ── Email Test ────────────────────────────────────────────────────────────────

function EmailTestSection() {
  const testMut = useMutation({ mutationFn: testEmail });

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm space-y-3">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">Email Test</h2>
      <p className="text-xs text-[var(--color-muted)]">
        Send a test email to ALERT_RECIPIENTS to verify SMTP configuration.
      </p>
      <div className="flex items-center gap-4">
        <button
          onClick={() => testMut.mutate()}
          disabled={testMut.isPending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {testMut.isPending ? "Sending…" : "Send Test Email"}
        </button>
        {testMut.data && (
          <p className={`text-sm ${testMut.data.sent ? "text-green-600" : "text-[var(--color-muted)]"}`}>
            {testMut.data.sent
              ? "✓ Test email sent successfully"
              : `Not sent: ${testMut.data.reason ?? "Email not configured"}`}
          </p>
        )}
        {testMut.isError && (
          <p className="text-sm text-[var(--color-negative)]">{(testMut.error as Error).message}</p>
        )}
      </div>
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
          System health, overnight digest, email testing, and job run history.
        </p>
      </div>

      <SystemHealthSection />
      <DigestSection />
      <EmailTestSection />
      <JobRunsSection />
    </div>
  );
}
