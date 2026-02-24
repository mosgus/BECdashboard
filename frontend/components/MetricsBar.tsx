"use client";
import { AssetMetrics } from "@/types/portfolio";
import { fmtNum, fmtPct } from "@/lib/utils";

interface Props {
  metrics: AssetMetrics;
  benchMetrics?: AssetMetrics;
  rf?: number;
  label?: string;
}

function KPI({
  label,
  value,
  delta,
  positive,
}: {
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <span className="text-2xl font-bold text-gray-900">{value}</span>
      {delta && (
        <span
          className={`text-xs font-medium ${
            positive === undefined
              ? "text-gray-400"
              : positive
              ? "text-green-600"
              : "text-red-500"
          }`}
        >
          {delta} vs benchmark
        </span>
      )}
    </div>
  );
}

export default function MetricsBar({ metrics, benchMetrics }: Props) {
  const cagr = metrics.cagr ?? 0;
  const benchCagr = benchMetrics?.cagr ?? 0;
  const cagrDelta = cagr - benchCagr;

  const sharpe = metrics.sharpe ?? 0;
  const benchSharpe = benchMetrics?.sharpe ?? 0;
  const sharpeDelta = sharpe - benchSharpe;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KPI
        label="CAGR"
        value={fmtPct(cagr)}
        delta={benchMetrics ? `${cagrDelta >= 0 ? "+" : ""}${fmtPct(cagrDelta)}` : undefined}
        positive={cagrDelta >= 0}
      />
      <KPI label="Ann. Volatility" value={fmtPct(metrics.vol)} />
      <KPI
        label="Sharpe Ratio"
        value={fmtNum(sharpe)}
        delta={benchMetrics ? `${sharpeDelta >= 0 ? "+" : ""}${fmtNum(sharpeDelta)}` : undefined}
        positive={sharpeDelta >= 0}
      />
      <KPI label="Max Drawdown" value={fmtPct(metrics.max_dd)} />
    </div>
  );
}
