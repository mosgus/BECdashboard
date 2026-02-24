"use client";
import { AssetRow } from "@/types/portfolio";
import { fmtNum, fmtPct } from "@/lib/utils";

interface Props {
  assets: AssetRow[];
  portfolioMetrics?: { cagr: number; vol: number; sharpe: number; max_dd: number };
  benchMetrics?: { cagr: number; vol: number; sharpe: number; max_dd: number };
  benchmark?: string;
}

export default function PerformanceTable({ assets, portfolioMetrics, benchMetrics, benchmark }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-auto">
      <h3 className="px-4 pt-4 pb-2 text-sm font-semibold text-gray-700">Performance Summary</h3>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {["Ticker", "Weight", "CAGR", "Vol", "Sharpe", "Max DD"].map((h) => (
              <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {assets.map((a) => (
            <tr key={a.ticker} className="hover:bg-gray-50">
              <td className="px-4 py-2 font-mono font-medium text-gray-800">{a.ticker}</td>
              <td className="px-4 py-2 text-gray-600">{fmtPct(a.weight)}</td>
              <td className={`px-4 py-2 ${a.cagr >= 0 ? "text-green-600" : "text-red-500"}`}>{fmtPct(a.cagr)}</td>
              <td className="px-4 py-2 text-gray-600">{fmtPct(a.vol)}</td>
              <td className="px-4 py-2 text-gray-800">{fmtNum(a.sharpe)}</td>
              <td className="px-4 py-2 text-red-500">{fmtPct(a.max_dd)}</td>
            </tr>
          ))}
          {portfolioMetrics && (
            <tr className="bg-blue-50 font-semibold border-t-2 border-blue-200">
              <td className="px-4 py-2 text-blue-700">PORTFOLIO</td>
              <td className="px-4 py-2 text-blue-600">100%</td>
              <td className={`px-4 py-2 ${portfolioMetrics.cagr >= 0 ? "text-green-700" : "text-red-600"}`}>{fmtPct(portfolioMetrics.cagr)}</td>
              <td className="px-4 py-2 text-blue-600">{fmtPct(portfolioMetrics.vol)}</td>
              <td className="px-4 py-2 text-blue-700">{fmtNum(portfolioMetrics.sharpe)}</td>
              <td className="px-4 py-2 text-red-600">{fmtPct(portfolioMetrics.max_dd)}</td>
            </tr>
          )}
          {benchMetrics && (
            <tr className="bg-amber-50 border-t border-amber-200">
              <td className="px-4 py-2 text-amber-700 font-medium">{benchmark ?? "Benchmark"}</td>
              <td className="px-4 py-2 text-gray-400">—</td>
              <td className={`px-4 py-2 ${benchMetrics.cagr >= 0 ? "text-green-600" : "text-red-500"}`}>{fmtPct(benchMetrics.cagr)}</td>
              <td className="px-4 py-2 text-gray-600">{fmtPct(benchMetrics.vol)}</td>
              <td className="px-4 py-2 text-gray-700">{fmtNum(benchMetrics.sharpe)}</td>
              <td className="px-4 py-2 text-red-500">{fmtPct(benchMetrics.max_dd)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
