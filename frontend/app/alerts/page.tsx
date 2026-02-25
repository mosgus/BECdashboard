"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import AlertPanel from "@/components/AlertPanel";
import InfoTooltip from "@/components/InfoTooltip";
import {
  createAlertRule,
  deleteAlertRule,
  evaluateNow,
  fetchAlertEvents,
  fetchAlertRules,
  fetchPortfolios,
  fetchWatchlists,
  updateAlertRule,
} from "@/lib/api";
import { AlertRule, AlertRuleType, EvaluateResult } from "@/types/sprint3";
import UniverseTickerPicker from "@/components/UniverseTickerPicker";

type Tab = "rules" | "inbox" | "quick";

const RULE_TYPE_OPTIONS: { value: AlertRuleType; label: string; hint: string }[] = [
  { value: "sma_cross_up", label: "SMA Cross Up", hint: "Fast SMA crosses above slow SMA (bullish entry)" },
  { value: "sma_cross_down", label: "SMA Cross Down", hint: "Fast SMA crosses below slow SMA (bearish exit)" },
  { value: "rsi_rebound", label: "RSI Rebound", hint: "RSI enters oversold zone (< threshold)" },
  { value: "rsi_fade", label: "RSI Fade", hint: "RSI enters overbought zone (> threshold)" },
  { value: "macd_cross_up", label: "MACD Cross Up", hint: "MACD histogram turns positive (bullish)" },
  { value: "macd_cross_down", label: "MACD Cross Down", hint: "MACD histogram turns negative (bearish)" },
  { value: "price_cross_above", label: "Price Above Threshold", hint: "Price exceeds a fixed level" },
  { value: "price_cross_below", label: "Price Below Threshold", hint: "Price drops below a fixed level" },
];

const DEFAULT_PARAMS: Record<AlertRuleType, Record<string, number>> = {
  sma_cross_up:      { fast: 20, slow: 50 },
  sma_cross_down:    { fast: 20, slow: 50 },
  rsi_rebound:       { window: 14, oversold: 30 },
  rsi_fade:          { window: 14, overbought: 70 },
  macd_cross_up:     { fast: 12, slow: 26, signal_period: 9 },
  macd_cross_down:   { fast: 12, slow: 26, signal_period: 9 },
  price_cross_above: { threshold: 0 },
  price_cross_below: { threshold: 0 },
};

// ── Rule form ─────────────────────────────────────────────────────────────────

function RuleForm({ onCreated }: { onCreated: () => void }) {
  const [scope, setScope] = useState<"watchlist" | "portfolio" | "ticker">("ticker");
  const [scopeId, setScopeId] = useState("");
  const [ticker, setTicker] = useState("");
  const [ruleType, setRuleType] = useState<AlertRuleType>("sma_cross_up");
  const [params, setParams] = useState<Record<string, number>>(DEFAULT_PARAMS.sma_cross_up);
  const [cooldown, setCooldown] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const { data: portfoliosData } = useQuery({ queryKey: ["portfolios"], queryFn: fetchPortfolios });
  const { data: watchlistsData } = useQuery({ queryKey: ["watchlists"], queryFn: fetchWatchlists });

  const createMut = useMutation({
    mutationFn: () =>
      createAlertRule({
        scope,
        scope_id: scopeId || null,
        ticker: scope === "ticker" ? ticker.trim().toUpperCase() || null : null,
        rule_type: ruleType,
        params_json: params,
        enabled: true,
        cooldown_days: cooldown,
      }),
    onSuccess: () => { onCreated(); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const handleRuleTypeChange = (rt: AlertRuleType) => {
    setRuleType(rt);
    setParams({ ...DEFAULT_PARAMS[rt] });
  };

  const ruleHint = RULE_TYPE_OPTIONS.find((o) => o.value === ruleType)?.hint;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm space-y-4">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        New Alert Rule
        <InfoTooltip text="Rules are evaluated when you click Evaluate Now. Each rule checks its target tickers against the last completed bar." />
      </h3>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Scope */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-[var(--color-muted)]">
            Scope
            <InfoTooltip text="Ticker: evaluates one symbol. Watchlist / Portfolio: evaluates every holding in the list on each sweep." />
          </label>
          <select
            value={scope}
            onChange={(e) => { setScope(e.target.value as typeof scope); setScopeId(""); }}
            className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          >
            <option value="ticker">Single Ticker</option>
            <option value="watchlist">Watchlist (all tickers)</option>
            <option value="portfolio">Portfolio (all holdings)</option>
          </select>
        </div>

        {/* Scope target */}
        {scope === "ticker" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Ticker</label>
            <UniverseTickerPicker
              value={ticker}
              onChange={setTicker}
              placeholder="Ticker (from Universe)"
            />
          </div>
        )}

        {scope === "watchlist" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Watchlist</label>
            <select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              <option value="">Select watchlist…</option>
              {watchlistsData?.watchlists.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}

        {scope === "portfolio" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Portfolio</label>
            <select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              <option value="">Select portfolio…</option>
              {portfoliosData?.portfolios.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Rule type */}
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Signal Type</label>
          <select
            value={ruleType}
            onChange={(e) => handleRuleTypeChange(e.target.value as AlertRuleType)}
            className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          >
            {RULE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {ruleHint && <p className="mt-1 text-xs text-[var(--color-muted)]">{ruleHint}</p>}
        </div>

        {/* Cooldown */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-[var(--color-muted)]">
            Cooldown (days)
            <InfoTooltip text="Minimum days between repeated triggers for the same rule + ticker combination. Prevents alert storms after a single sharp move." />
          </label>
          <input
            type="number" min={0} max={30} value={cooldown}
            onChange={(e) => setCooldown(+e.target.value)}
            className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
        </div>
      </div>

      {/* Params */}
      <div>
        <p className="mb-2 text-xs font-medium text-[var(--color-muted)]">Parameters</p>
        <div className="flex flex-wrap gap-3">
          {Object.entries(params).map(([key, val]) => (
            <div key={key}>
              <label className="mb-1 block text-xs text-[var(--color-muted)]">{key}</label>
              <input
                type="number" value={val} step={key === "threshold" ? 0.01 : 1}
                onChange={(e) => setParams((p) => ({ ...p, [key]: +e.target.value }))}
                className="w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {createMut.isPending ? "Saving…" : "Add Rule"}
        </button>
        {error && <p className="text-xs text-[var(--color-negative)]">{error}</p>}
      </div>
    </div>
  );
}

// ── Rules list ────────────────────────────────────────────────────────────────

function RulesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [evalResult, setEvalResult] = useState<EvaluateResult | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["alert-rules"], queryFn: fetchAlertRules });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateAlertRule(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAlertRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });

  const evalMut = useMutation({
    mutationFn: evaluateNow,
    onSuccess: (data) => {
      setEvalResult(data);
      qc.invalidateQueries({ queryKey: ["alert-events"] });
    },
  });

  const rules: AlertRule[] = data?.rules ?? [];

  return (
    <div className="space-y-4">
      {/* Evaluate Now banner */}
      <div className="flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <button
          onClick={() => evalMut.mutate()}
          disabled={evalMut.isPending || rules.filter((r) => r.enabled).length === 0}
          className="rounded-[var(--radius-btn)] bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {evalMut.isPending ? "Evaluating…" : "Evaluate Now"}
        </button>
        {evalResult && (
          <p className="text-sm text-[var(--color-text)]">
            ✓ Evaluated {evalResult.evaluated} rule-ticker pairs — <strong>{evalResult.triggered} triggered</strong>, {evalResult.skipped} skipped (cooldown / no data)
          </p>
        )}
        {evalMut.isError && (
          <p className="text-sm text-[var(--color-negative)]">{(evalMut.error as Error).message}</p>
        )}
      </div>

      {/* Create form toggle */}
      <button
        onClick={() => setShowForm((v) => !v)}
        className="text-sm font-medium text-[var(--color-primary)] hover:underline"
      >
        {showForm ? "▲ Hide form" : "＋ Add alert rule"}
      </button>

      {showForm && (
        <RuleForm
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["alert-rules"] });
            setShowForm(false);
          }}
        />
      )}

      {/* Rules list */}
      {isLoading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading rules…</p>
      ) : rules.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          No alert rules yet. Add one above.
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-gray-50">
              <tr>
                {["Enabled", "Scope", "Target", "Signal", "Params", "Cooldown", ""].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-[var(--color-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleMut.mutate({ id: r.id, enabled: !r.enabled })}
                      className={`h-5 w-9 rounded-full transition-colors ${r.enabled ? "bg-green-500" : "bg-gray-300"}`}
                    >
                      <span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform mx-0.5 ${r.enabled ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs capitalize text-[var(--color-muted)]">{r.scope}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.ticker ?? (r.scope_id ? r.scope_id.slice(0, 8) + "…" : "—")}</td>
                  <td className="px-4 py-3 text-xs">{r.rule_type.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                    {r.params_json ? Object.entries(r.params_json).map(([k, v]) => `${k}=${v}`).join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-muted)]">{r.cooldown_days}d</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteMut.mutate(r.id)}
                      disabled={deleteMut.isPending}
                      className="text-xs text-[var(--color-muted)] hover:text-[var(--color-negative)] transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Inbox tab ─────────────────────────────────────────────────────────────────

function InboxTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["alert-events"],
    queryFn: () => fetchAlertEvents(100),
  });

  const events = data?.events ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Alert Events (most recent first)</h3>
        <button onClick={() => refetch()} className="text-xs text-[var(--color-primary)] hover:underline">Refresh</button>
      </div>

      {isLoading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading events…</p>
      ) : events.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          No alert events yet. Click "Evaluate Now" in the Rules tab.
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((e) => {
            const p = e.payload_json ?? {};
            const ticker = p.ticker as string | undefined;
            const ruleType = p.rule_type as string | undefined;
            const state = p.state as string | undefined;
            return (
              <div key={e.id} className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {ticker && (
                        <span className="font-mono text-sm font-bold text-[var(--color-text)]">{ticker}</span>
                      )}
                      {ruleType && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {ruleType.replace(/_/g, " ")}
                        </span>
                      )}
                      {state && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          state === "BULLISH" ? "bg-green-100 text-green-700" :
                          state === "BEARISH" ? "bg-red-100 text-red-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>{state}</span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-muted)]">
                      as-of {e.as_of_date} · triggered {new Date(e.triggered_at).toLocaleString()}
                    </p>
                    {/* Evidence */}
                    <div className="text-xs text-[var(--color-muted)] font-mono">
                      {Object.entries(p)
                        .filter(([k]) => !["ticker", "rule_type", "scope", "state", "label", "signal", "params"].includes(k))
                        .map(([k, v]) => (
                          <span key={k} className="mr-3">{k}: {typeof v === "number" ? v.toFixed(4) : String(v)}</span>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);
const DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "VT", "SPY"];

export default function AlertsPage() {
  const { checked } = useAuth();
  const [tab, setTab] = useState<Tab>("rules");
  const [rawTickers, setRawTickers] = useState(DEFAULT_TICKERS.join(", "));
  const [start, setStart] = useState("2023-01-01");
  const [end, setEnd] = useState(TODAY);

  const tickers = rawTickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);

  if (!checked) return null;

  const TABS: { key: Tab; label: string }[] = [
    { key: "rules", label: "Rules" },
    { key: "inbox", label: "Inbox" },
    { key: "quick", label: "Quick Check" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text)]">Alerts</h1>
        <p className="mt-0.5 text-xs text-[var(--color-muted)]">
          Define alert rules, evaluate them on-demand, and view triggered events.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === key
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "rules" && <RulesTab />}
      {tab === "inbox" && <InboxTab />}
      {tab === "quick" && (
        <div className="space-y-4">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-[var(--color-text)]">Quick Alert Check</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Tickers</label>
                <input value={rawTickers} onChange={(e) => setRawTickers(e.target.value)}
                  className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Start</label>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                  className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">End</label>
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
        </div>
      )}
    </div>
  );
}
