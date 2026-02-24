"use client";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import AlertPanel from "@/components/AlertPanel";

const DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "VT", "SPY"];
const TODAY = new Date().toISOString().slice(0, 10);

export default function AlertsPage() {
  const { checked } = useAuth();

  const [rawTickers, setRawTickers] = useState(DEFAULT_TICKERS.join(", "));
  const [start, setStart] = useState("2023-01-01");
  const [end, setEnd] = useState(TODAY);

  const tickers = rawTickers
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  if (!checked) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-[var(--color-text)]">Alert System</h2>
        <p className="mb-4 text-xs text-[var(--color-muted)]">
          Alerts are evaluated on the most recent bar of the selected date range.
          Email stubs can be wired to SendGrid, Resend, or AWS SES.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Tickers (for dropdown)</label>
            <input
              value={rawTickers}
              onChange={(e) => setRawTickers(e.target.value)}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Start Date</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">End Date</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {tickers.length > 0 ? (
        <AlertPanel tickers={tickers} start={start} end={end} />
      ) : (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          Add at least one ticker above.
        </div>
      )}

      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          Scheduled Alerts — GitHub Actions
        </h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          To run alerts automatically at market close (4pm ET, Mon–Fri), add this workflow to your repo:
        </p>
        <pre className="overflow-auto rounded-[var(--radius-btn)] bg-gray-900 p-4 text-xs text-gray-100">{`# .github/workflows/alerts.yml
name: Blue Eagle Alerts
on:
  schedule:
    - cron: '0 21 * * 1-5'  # 4pm ET Mon-Fri (UTC-5)
  workflow_dispatch:
jobs:
  run-alerts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -r backend/requirements.txt
      - run: python backend/scripts/run_alerts.py
        env:
          SENDGRID_API_KEY: \${{ secrets.SENDGRID_API_KEY }}
          ALERT_EMAIL: \${{ secrets.ALERT_EMAIL }}`}</pre>
      </div>
    </div>
  );
}
