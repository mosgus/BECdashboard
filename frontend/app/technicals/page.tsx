"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { fetchTechnicals } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import TechnicalsChart from "@/components/TechnicalsChart";

const TODAY = new Date().toISOString().slice(0, 10);

export default function TechnicalsPage() {
  const { checked } = useAuth();

  const [ticker, setTicker] = useState("NVDA");
  const [start, setStart] = useState("2022-01-01");
  const [end, setEnd] = useState(TODAY);

  const mutation = useMutation({
    mutationFn: () => fetchTechnicals({ ticker: ticker.toUpperCase(), start, end }),
  });

  if (!checked) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-[var(--color-text)]">Technical Analysis</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Ticker</label>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="w-32 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Start Date</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">End Date</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {mutation.isPending ? "Loading…" : "Load Chart"}
          </button>
        </div>
        {mutation.error && (
          <p className="mt-2 text-sm text-[var(--color-negative)]">
            {(mutation.error as Error).message}
          </p>
        )}
      </div>

      {mutation.data && <TechnicalsChart data={mutation.data} />}

      {!mutation.data && !mutation.isPending && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-12 text-center text-[var(--color-muted)]">
          <p className="text-sm">
            Enter a ticker and click <strong>Load Chart</strong> to see SMA, RSI, and MACD.
          </p>
        </div>
      )}
    </div>
  );
}
