"use client";
import { useState } from "react";
import AlertPanel from "@/components/AlertPanel";

const DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "VT", "SPY"];
const TODAY = new Date().toISOString().slice(0, 10);

export default function AlertsPage() {
  const [rawTickers, setRawTickers] = useState(DEFAULT_TICKERS.join(", "));
  const [start, setStart] = useState("2023-01-01");
  const [end, setEnd] = useState(TODAY);

  const tickers = rawTickers
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-800">Alert System</h2>
        <p className="mb-4 text-xs text-gray-500">
          Alerts are evaluated on the most recent bar of the selected date range.
          Email stubs can be wired to SendGrid, Resend, or AWS SES.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tickers (for dropdown)</label>
            <input value={rawTickers} onChange={(e) => setRawTickers(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {tickers.length > 0 ? (
        <AlertPanel tickers={tickers} start={start} end={end} />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-400 text-sm">
          Add at least one ticker above.
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Scheduled Alerts — GitHub Actions</h3>
        <p className="text-xs text-gray-500 mb-3">
          To run alerts automatically at market close (4pm ET, Mon–Fri), add this workflow to your repo:
        </p>
        <pre className="text-xs bg-gray-900 text-gray-100 rounded-lg p-4 overflow-auto">{`# .github/workflows/alerts.yml
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
