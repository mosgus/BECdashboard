"use client";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  addCandidate,
  addPosition,
  deleteIndicatorConfig,
  fetchCandidates,
  fetchIndicatorConfigs,
  fetchPortfolioDetail,
  fetchTickerTechnicals,
  refreshCandidates,
  removeCandidate,
  upsertIndicatorConfig,
} from "@/lib/api";
import { fmtNum } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import InfoTooltip from "@/components/InfoTooltip";
import UniverseTickerPicker from "@/components/UniverseTickerPicker";
import TechnicalsChart from "@/components/TechnicalsChart";
import TechnicalsGuide from "@/components/TechnicalsGuide";
import type { CandidateRefreshResponse, IndicatorType, PortfolioIndicatorConfig } from "@/types/sprint4";
import type { ExtendedTechnicalsResponse } from "@/types/sprint7";

const SIGNAL_KEYS = ["sma_cross", "rsi_threshold", "macd_cross"] as const;
const SIGNAL_LABELS = ["SMA 20/50", "RSI 14", "MACD"];

const INDICATOR_DEFS: { type: IndicatorType; label: string; defaultParams: Record<string, number> }[] = [
  { type: "sma",        label: "SMA 20/50",          defaultParams: { fast: 20, slow: 50 } },
  { type: "rsi",        label: "RSI 14",             defaultParams: { window: 14, oversold: 30, overbought: 70 } },
  { type: "macd",       label: "MACD 12/26/9",       defaultParams: { fast: 12, slow: 26, signal_period: 9 } },
  { type: "atr",        label: "ATR 14",             defaultParams: { window: 14 } },
  { type: "ema",        label: "EMA 20/50",          defaultParams: { fast: 20, slow: 50 } },
  { type: "bollinger",  label: "Bollinger (20, 2σ)", defaultParams: { window: 20, num_std: 2 } },
  { type: "adx",        label: "ADX 14",             defaultParams: { window: 14 } },
  { type: "donchian",   label: "Donchian (20)",      defaultParams: { window: 20 } },
  { type: "stochastic", label: "Stochastic (14,3)",  defaultParams: { k: 14, d: 3, smooth_k: 3 } },
  { type: "obv",        label: "OBV",                defaultParams: {} },
];

type MonitorSection = "candidates" | "technicals";

export default function MonitorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: portfolioId } = use(params);
  const { checked } = useAuth();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["portfolio", portfolioId],
    queryFn: () => fetchPortfolioDetail(portfolioId),
    enabled: checked,
  });

  const [section, setSection] = useState<MonitorSection>("candidates");

  const positions = data?.positions ?? [];
  const holdingTickers = positions.map((p) => p.ticker);

  const { data: candidateData } = useQuery({
    queryKey: ["candidates", portfolioId],
    queryFn: () => fetchCandidates(portfolioId),
    enabled: checked,
  });
  const candidateTickers = (candidateData?.rows ?? []).map((r) => r.ticker);

  if (!checked) return null;
  if (isLoading)
    return (
      <p className="text-sm text-[var(--color-muted)] p-4">Loading…</p>
    );

  return (
    <div className="space-y-4">
      {/* Section switcher */}
      <div className="flex gap-2">
        {(["candidates", "technicals"] as MonitorSection[]).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`rounded-[var(--radius-btn)] px-4 py-2 text-sm font-medium transition-colors ${
              section === s
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {s === "candidates" ? "Candidates" : "Technicals Drilldown"}
          </button>
        ))}
      </div>

      {section === "candidates" && (
        <CandidatesSection
          portfolioId={portfolioId}
          holdingTickers={holdingTickers}
          onAddToHoldings={() => router.push(`/portfolios/${portfolioId}/holdings`)}
        />
      )}
      {section === "technicals" && (
        <TechnicalsSection
          portfolioId={portfolioId}
          holdingTickers={holdingTickers}
          candidateTickers={candidateTickers}
        />
      )}
    </div>
  );
}

// ── Candidates section ─────────────────────────────────────────────────────────

function CandidatesSection({
  portfolioId,
  holdingTickers,
  onAddToHoldings,
}: {
  portfolioId: string;
  holdingTickers: string[];
  onAddToHoldings: () => void;
}) {
  const qc = useQueryClient();
  const [newTicker, setNewTicker] = useState("");
  const [refreshData, setRefreshData] = useState<CandidateRefreshResponse | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["candidates", portfolioId],
    queryFn: () => fetchCandidates(portfolioId),
  });

  const displayData = refreshData ?? data;

  const addMut = useMutation({
    mutationFn: () => addCandidate(portfolioId, newTicker.trim().toUpperCase()),
    onSuccess: () => {
      setNewTicker("");
      qc.invalidateQueries({ queryKey: ["candidates", portfolioId] });
    },
  });

  const removeMut = useMutation({
    mutationFn: (ticker: string) => removeCandidate(portfolioId, ticker),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["candidates", portfolioId] }),
  });

  const refreshMut = useMutation({
    mutationFn: () => refreshCandidates(portfolioId),
    onSuccess: (result) => setRefreshData(result),
  });

  const addToHoldingsMut = useMutation({
    mutationFn: (ticker: string) => addPosition(portfolioId, ticker, 0),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio", portfolioId] });
      onAddToHoldings();
    },
  });

  const rows = displayData?.rows ?? [];

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          Add Candidate
          <InfoTooltip text="Add tickers from the Universe that you are considering for this portfolio. Refresh signals to see the latest SMA, RSI, and MACD state." />
        </h3>
        <div className="flex flex-wrap gap-3">
          <UniverseTickerPicker
            value={newTicker}
            onChange={setNewTicker}
            placeholder="Ticker (e.g. AAPL)"
            className="w-44"
          />
          <button
            onClick={() => addMut.mutate()}
            disabled={!newTicker.trim() || addMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {addMut.isPending ? "Adding…" : "Add"}
          </button>
          <button
            onClick={() => refreshMut.mutate()}
            disabled={refreshMut.isPending || rows.length === 0}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-muted)] hover:bg-[var(--color-border)] disabled:opacity-40 transition-colors"
          >
            {refreshMut.isPending ? "Refreshing…" : "Refresh Signals"}
          </button>
        </div>
        {addMut.error && (
          <p className="mt-2 text-xs text-[var(--color-negative)]">{(addMut.error as Error).message}</p>
        )}
      </div>

      {/* Candidates table */}
      {isLoading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          No candidates yet. Add tickers from the Universe to build your watchlist.
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-x-auto">
          {displayData?.as_of_date && (
            <p className="px-4 py-2 text-xs text-[var(--color-muted)] border-b border-[var(--color-border)]">
              Signals as of {displayData.as_of_date} · {displayData.data_source}
            </p>
          )}
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted)]">Ticker</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted)]">Last Close</th>
                {SIGNAL_LABELS.map((l) => (
                  <th key={l} className="px-4 py-3 text-center text-xs font-medium text-[var(--color-muted)]">{l}</th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-medium text-[var(--color-muted)]">→ Holdings</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((row) => {
                const sigMap = Object.fromEntries(row.signals.map((s) => [s.signal, s]));
                const alreadyHeld = holdingTickers.includes(row.ticker);
                return (
                  <tr key={row.ticker} className="hover:bg-[var(--color-bg)] transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-[var(--color-primary)]">
                      <Link href={`/ticker/${row.ticker}?from=/portfolios/${portfolioId}`} className="hover:underline">{row.ticker}</Link>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-muted)]">
                      {row.last_close != null ? `$${fmtNum(row.last_close, 2)}` : "—"}
                    </td>
                    {SIGNAL_KEYS.map((key) => (
                      <td key={key} className="px-4 py-3 text-center">
                        {sigMap[key] ? (
                          <SignalBadge state={sigMap[key].state} lastDate={sigMap[key].last_trigger_date} small />
                        ) : (
                          <span className="text-xs text-[var(--color-muted)]">—</span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center">
                      {alreadyHeld ? (
                        <span className="text-xs text-green-600 font-medium">In portfolio</span>
                      ) : (
                        <button
                          onClick={() => addToHoldingsMut.mutate(row.ticker)}
                          disabled={addToHoldingsMut.isPending}
                          className="rounded-[var(--radius-btn)] bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          + Add
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => removeMut.mutate(row.ticker)}
                        disabled={removeMut.isPending}
                        className="text-[var(--color-muted)] hover:text-[var(--color-negative)] transition-colors"
                        title="Remove candidate"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Technicals section ─────────────────────────────────────────────────────────

function TechnicalsSection({
  portfolioId,
  holdingTickers,
  candidateTickers,
}: {
  portfolioId: string;
  holdingTickers: string[];
  candidateTickers: string[];
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const allTickers = Array.from(new Set([...holdingTickers, ...candidateTickers])).sort();

  const today = new Date().toISOString().slice(0, 10);
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86400_000).toISOString().slice(0, 10);

  const [chartTicker, setChartTicker] = useState(allTickers[0] ?? "");
  const [start, setStart] = useState(twoYearsAgo);
  const [end, setEnd] = useState(today);
  const [chartParams, setChartParams] = useState<{ ticker: string; start: string; end: string } | null>(null);
  const [visibleIndicators, setVisibleIndicators] = useState<Set<string>>(new Set());
  const [showGuide, setShowGuide] = useState(false);
  const includeParam = Array.from(visibleIndicators).join(",");

  function toggleIndicator(key: string) {
    setVisibleIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const { data: chartData, isLoading: chartLoading } = useQuery<ExtendedTechnicalsResponse>({
    queryKey: ["ticker-technicals-tab", chartParams, includeParam],
    queryFn: () => fetchTickerTechnicals(chartParams!.ticker, chartParams!.start, chartParams!.end, true, includeParam || undefined),
    enabled: !!chartParams,
  });

  const { data: configData } = useQuery({
    queryKey: ["indicator_configs", portfolioId],
    queryFn: () => fetchIndicatorConfigs(portfolioId),
  });

  const upsertMut = useMutation({
    mutationFn: (body: { ticker: string; indicator_type: string; params_json: Record<string, unknown> | null; enabled: boolean }) =>
      upsertIndicatorConfig(portfolioId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicator_configs", portfolioId] }),
  });

  const deleteMut = useMutation({
    mutationFn: ({ ticker, indicator }: { ticker: string; indicator: string }) =>
      deleteIndicatorConfig(portfolioId, ticker, indicator),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicator_configs", portfolioId] }),
  });

  const configs: PortfolioIndicatorConfig[] = configData?.configs ?? [];
  const configMap = Object.fromEntries(
    configs.filter((c) => c.ticker === chartTicker).map((c) => [c.indicator_type, c])
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left — chart */}
        <div className="flex-[3] min-w-0 space-y-4">
          {/* Controls */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Ticker</label>
                <select
                  value={chartTicker}
                  onChange={(e) => setChartTicker(e.target.value)}
                  className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  {allTickers.length === 0 && <option value="">—</option>}
                  {allTickers.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Start</label>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                  className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">End</label>
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                  className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
              <button
                onClick={() => setChartParams({ ticker: chartTicker, start, end })}
                disabled={!chartTicker || chartLoading}
                className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {chartLoading ? "Loading…" : "Load Chart"}
              </button>
            </div>
          </div>

          {/* Indicator toggles */}
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-sm">
            <span className="text-xs font-semibold text-[var(--color-muted)]">Indicators:</span>
            {[
              { key: "ema",        label: "EMA 20/50" },
              { key: "bollinger",  label: "Bollinger (20, 2σ)" },
              { key: "donchian",   label: "Donchian (20)" },
              { key: "adx",        label: "ADX 14" },
              { key: "stochastic", label: "Stochastic (14,3)" },
              { key: "obv",        label: "OBV" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={visibleIndicators.has(key)}
                  onChange={() => toggleIndicator(key)}
                  className="accent-[var(--color-primary)]"
                />
                {label}
              </label>
            ))}
            <button
              onClick={() => setShowGuide(true)}
              className="ml-auto flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
            >
              <BookOpen size={13} />
              Technicals Guide
            </button>
          </div>
          {showGuide && <TechnicalsGuide onClose={() => setShowGuide(false)} />}

          {/* Chart */}
          {chartData && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
              <TechnicalsChart data={chartData} visibleIndicators={visibleIndicators} />
            </div>
          )}
          {!chartData && !chartLoading && (
            <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center text-sm text-[var(--color-muted)]">
              Select a ticker and click Load Chart.
            </div>
          )}
        </div>

        {/* Right — indicator config */}
        <div className="flex-[2] min-w-0">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Indicator Config
              {chartTicker && <span className="ml-1 font-mono text-[var(--color-primary)]">— {chartTicker}</span>}
            </h3>

            {!chartTicker ? (
              <p className="text-xs text-[var(--color-muted)]">Select a ticker above to configure indicators.</p>
            ) : (
              INDICATOR_DEFS.map(({ type, label, defaultParams }) => {
                const existing = configMap[type];
                const isEnabled = existing?.enabled ?? false;
                return (
                  <div key={type} className="rounded-[var(--radius-btn)] border border-[var(--color-border)] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--color-text)]">{label}</span>
                      <div className="flex items-center gap-2">
                        {existing && (
                          <button
                            onClick={() => deleteMut.mutate({ ticker: chartTicker, indicator: type })}
                            disabled={deleteMut.isPending}
                            className="text-[var(--color-muted)] hover:text-[var(--color-negative)] transition-colors"
                            title="Remove config"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                        <button
                          onClick={() =>
                            upsertMut.mutate({
                              ticker: chartTicker,
                              indicator_type: type,
                              params_json: existing?.params_json ?? defaultParams,
                              enabled: !isEnabled,
                            })
                          }
                          disabled={upsertMut.isPending}
                          className={`rounded-full px-3 py-0.5 text-xs font-semibold transition-colors ${
                            isEnabled
                              ? "bg-green-100 text-green-700 hover:bg-green-200"
                              : "bg-[var(--color-border)] text-[var(--color-muted)] hover:bg-gray-300"
                          }`}
                        >
                          {isEnabled ? "Enabled" : "Disabled"}
                        </button>
                      </div>
                    </div>
                    {existing && (
                      <p className="mt-1 text-xs text-[var(--color-muted)]">
                        Params: {JSON.stringify(existing.params_json ?? defaultParams)}
                      </p>
                    )}
                  </div>
                );
              })
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
