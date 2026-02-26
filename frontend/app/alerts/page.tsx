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
  fetchRuleMetadata,
  fetchWatchlists,
  updateAlertEventStatus,
  updateAlertRule,
} from "@/lib/api";
import { AlertEvent, AlertEventStatus, AlertRule, AlertRuleType, EvaluateResult, RuleMetadata } from "@/types/sprint3";
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

// ── Inbox helpers ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<AlertEventStatus, string> = {
  new:      "bg-blue-100 text-blue-700",
  ack:      "bg-amber-100 text-amber-700",
  snoozed:  "bg-gray-100 text-gray-600",
  resolved: "bg-green-100 text-green-700",
};

const STATUS_LABEL: Record<AlertEventStatus, string> = {
  new:      "New",
  ack:      "Acknowledged",
  snoozed:  "Snoozed",
  resolved: "Resolved",
};

type StatusFilter = "all" | AlertEventStatus;

// ── Evidence Drawer ────────────────────────────────────────────────────────────

function EvidenceDrawer({
  event,
  metadata,
  onClose,
}: {
  event: AlertEvent;
  metadata: RuleMetadata[];
  onClose: () => void;
}) {
  const p = event.payload_json ?? {};
  const ruleType = (event.payload_json?.rule_type ?? "") as string;
  const meta = metadata.find((m) => m.rule_type === ruleType);

  const SKIP_KEYS = new Set(["ticker", "rule_type", "scope", "state", "label", "signal", "params"]);
  const evidence = Object.entries(p).filter(([k]) => !SKIP_KEYS.has(k));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-md flex-col bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Event Detail</h3>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)] text-lg leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Header */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-base font-bold text-[var(--color-text)]">
                {event.ticker ?? (p.ticker as string) ?? "—"}
              </span>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                {ruleType.replace(/_/g, " ")}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[event.status]}`}>
                {STATUS_LABEL[event.status]}
              </span>
            </div>
            <p className="text-xs text-[var(--color-muted)]">
              as-of {event.as_of_date} · triggered {new Date(event.triggered_at).toLocaleString()}
            </p>
          </div>

          {/* Rule description */}
          {meta && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-gray-50 p-3 space-y-1">
              <p className="text-xs font-semibold text-[var(--color-text)]">{meta.label}</p>
              <p className="text-xs text-[var(--color-muted)]">{meta.description}</p>
              <p className="text-xs text-[var(--color-muted)]">
                Direction: <span className={meta.direction === "bullish" ? "text-green-600" : "text-red-600"}>{meta.direction}</span>
                {" · "}Indicators: {meta.required_indicators.join(", ")}
              </p>
            </div>
          )}

          {/* Evidence values */}
          {evidence.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide">Evidence</p>
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] overflow-hidden">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-gray-100">
                    {evidence.map(([k, v]) => (
                      <tr key={k} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-[var(--color-muted)] font-mono">{k}</td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--color-text)]">
                          {typeof v === "number" ? v.toFixed(4) : String(v)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Raw payload */}
          <details className="text-xs text-[var(--color-muted)]">
            <summary className="cursor-pointer font-medium hover:text-[var(--color-text)]">Raw payload JSON</summary>
            <pre className="mt-2 overflow-x-auto rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-gray-50 p-3 text-xs">
              {JSON.stringify(p, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

// ── Inbox tab ─────────────────────────────────────────────────────────────────

function InboxTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<AlertEvent | null>(null);

  const { data: metaData } = useQuery({
    queryKey: ["rule-metadata"],
    queryFn: fetchRuleMetadata,
    staleTime: Infinity,
  });
  const metadata = metaData?.metadata ?? [];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["alert-events", statusFilter],
    queryFn: () =>
      fetchAlertEvents(100, statusFilter !== "all" ? { status: statusFilter } : undefined),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AlertEventStatus }) =>
      updateAlertEventStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alert-events"] });
      qc.invalidateQueries({ queryKey: ["ops-status"] });
      // Update selected drawer if open
      setSelected((prev) =>
        prev ? { ...prev, status: patchMut.variables?.status ?? prev.status } : null
      );
    },
  });

  const events = data?.events ?? [];

  const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
    { key: "all",      label: "All" },
    { key: "new",      label: "New" },
    { key: "ack",      label: "Acknowledged" },
    { key: "snoozed",  label: "Snoozed" },
    { key: "resolved", label: "Resolved" },
  ];

  return (
    <div className="space-y-4">
      {selected && (
        <EvidenceDrawer
          event={selected}
          metadata={metadata}
          onClose={() => setSelected(null)}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Alert Events (most recent first)</h3>
        <button onClick={() => refetch()} className="text-xs text-[var(--color-primary)] hover:underline">Refresh</button>
      </div>

      {/* Status filter */}
      <div className="flex gap-1 flex-wrap">
        {STATUS_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === key
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading events…</p>
      ) : events.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          {statusFilter === "all"
            ? 'No alert events yet. Click "Evaluate Now" in the Rules tab.'
            : `No ${statusFilter} events.`}
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((e) => {
            const p = e.payload_json ?? {};
            const ticker = e.ticker ?? (p.ticker as string | undefined);
            const ruleType = (p.rule_type as string | undefined) ?? "";
            const state = p.state as string | undefined;
            const meta = metadata.find((m) => m.rule_type === ruleType);
            const isPending = patchMut.isPending && patchMut.variables?.id === e.id;

            return (
              <div
                key={e.id}
                className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    {/* Title row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {ticker && (
                        <span className="font-mono text-sm font-bold text-[var(--color-text)]">{ticker}</span>
                      )}
                      {ruleType && (
                        <span
                          className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 cursor-help"
                          title={meta?.description ?? ruleType}
                        >
                          {meta?.label ?? ruleType.replace(/_/g, " ")}
                        </span>
                      )}
                      {state && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          state === "BULLISH" ? "bg-green-100 text-green-700" :
                          state === "BEARISH" ? "bg-red-100 text-red-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>{state}</span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[e.status]}`}>
                        {STATUS_LABEL[e.status]}
                      </span>
                    </div>

                    {/* Timestamp */}
                    <p className="text-xs text-[var(--color-muted)]">
                      as-of {e.as_of_date} · triggered {new Date(e.triggered_at).toLocaleString()}
                    </p>

                    {/* Evidence summary (compact) */}
                    <div className="text-xs text-[var(--color-muted)] font-mono truncate">
                      {Object.entries(p)
                        .filter(([k]) => !["ticker", "rule_type", "scope", "state", "label", "signal", "params"].includes(k))
                        .slice(0, 4)
                        .map(([k, v]) => (
                          <span key={k} className="mr-3">
                            {k}: {typeof v === "number" ? v.toFixed(4) : String(v)}
                          </span>
                        ))}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <button
                      onClick={() => setSelected(e)}
                      className="text-xs text-[var(--color-primary)] hover:underline"
                    >
                      Details
                    </button>
                    <div className="flex gap-1.5">
                      {e.status !== "ack" && e.status !== "resolved" && (
                        <button
                          onClick={() => patchMut.mutate({ id: e.id, status: "ack" })}
                          disabled={isPending}
                          className="rounded px-2 py-1 text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                        >
                          Ack
                        </button>
                      )}
                      {e.status !== "snoozed" && e.status !== "resolved" && (
                        <button
                          onClick={() => patchMut.mutate({ id: e.id, status: "snoozed" })}
                          disabled={isPending}
                          className="rounded px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 transition-colors"
                        >
                          Snooze
                        </button>
                      )}
                      {e.status !== "resolved" && (
                        <button
                          onClick={() => patchMut.mutate({ id: e.id, status: "resolved" })}
                          disabled={isPending}
                          className="rounded px-2 py-1 text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
                        >
                          Resolve
                        </button>
                      )}
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
