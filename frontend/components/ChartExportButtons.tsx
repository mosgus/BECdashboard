"use client";
import { Download, FileText } from "lucide-react";
import type { RefObject } from "react";

interface Props {
  chartRef: RefObject<HTMLDivElement | null>;
  csvData: Record<string, unknown>[];
  filename: string;
}

/**
 * Reusable PNG + CSV export buttons for Recharts charts.
 * Wrap the <ResponsiveContainer> in a ref-tagged <div> and pass the ref here.
 */
export default function ChartExportButtons({ chartRef, csvData, filename }: Props) {
  const exportPNG = async () => {
    if (!chartRef.current) return;
    try {
      // Dynamic import keeps initial bundle small (~80KB)
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(chartRef.current, {
        cacheBust: true,
        backgroundColor: "#ffffff",
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = `${filename}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("PNG export failed:", err);
    }
  };

  const exportCSV = () => {
    if (!csvData.length) return;
    try {
      const headers = Object.keys(csvData[0]);
      const esc = (v: unknown): string => {
        if (v == null) return "";
        const s = String(v);
        // Quote if contains comma, quote, or newline
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const rows = csvData.map((r) => headers.map((h) => esc(r[h])).join(","));
      const csv = [headers.join(","), ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `${filename}.csv`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV export failed:", err);
    }
  };

  return (
    <div className="flex gap-1">
      <button
        onClick={exportPNG}
        title="Download chart as PNG"
        className="flex items-center gap-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-2 py-1 text-[10px] font-medium text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
      >
        <Download size={11} /> PNG
      </button>
      <button
        onClick={exportCSV}
        title="Download data as CSV"
        className="flex items-center gap-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-2 py-1 text-[10px] font-medium text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
      >
        <FileText size={11} /> CSV
      </button>
    </div>
  );
}
