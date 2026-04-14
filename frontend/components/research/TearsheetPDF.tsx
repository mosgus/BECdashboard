"use client";
import { useRef, useState } from "react";
import { FileDown } from "lucide-react";
import { fetchTearsheetData } from "@/lib/api";
import type { TearsheetData } from "@/types/research";
import { fmtPct, fmtNum, fmtDollar } from "@/lib/utils";

interface Props {
  portfolioId: string;
  createdBy?: string | null;
}

/**
 * One-click PDF tear sheet generator.
 * Renders a hidden styled div off-screen, captures it with html2canvas,
 * paginates across pages in jsPDF.
 */
export default function TearsheetPDF({ portfolioId, createdBy }: Props) {
  const hiddenRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<TearsheetData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      // 1. Fetch data
      const td = await fetchTearsheetData(portfolioId, 252);
      setData(td);

      // Wait a tick for React to render the hidden layout
      await new Promise((r) => setTimeout(r, 50));
      if (!hiddenRef.current) throw new Error("Layout not mounted");

      // 2. Dynamic-import PDF libs to keep initial bundle small
      const { default: jsPDF } = await import("jspdf");
      const { default: html2canvas } = await import("html2canvas");

      // 3. Capture the hidden layout
      const canvas = await html2canvas(hiddenRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
      });

      // 4. Paginate across A4 pages
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();   // 210mm
      const pageHeight = pdf.internal.pageSize.getHeight(); // 297mm

      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;
      const imgData = canvas.toDataURL("image/png");

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const safeName = td.portfolio.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const fname = `${safeName}_tearsheet_${td.as_of_date}.pdf`;
      pdf.save(fname);
    } catch (err) {
      console.error(err);
      setError((err as Error).message || "Failed to generate PDF");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={generate}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        <FileDown size={14} />
        {busy ? "Generating PDF…" : "Download Tear Sheet (PDF)"}
      </button>
      {error && <p className="mt-2 text-xs text-[var(--color-negative)]">{error}</p>}

      {/* Hidden off-screen render target */}
      {data && (
        <div
          style={{
            position: "fixed",
            left: "-10000px",
            top: 0,
            width: "794px", // A4 width at 96dpi
            backgroundColor: "white",
            padding: "40px",
            fontFamily: "Arial, sans-serif",
            color: "#111",
          }}
          ref={hiddenRef}
        >
          <TearsheetLayout data={data} createdBy={createdBy} />
        </div>
      )}
    </>
  );
}

// ── Hidden layout ───────────────────────────────────────────────────────────

function TearsheetLayout({ data, createdBy }: { data: TearsheetData; createdBy?: string | null }) {
  const cs = data.composite_score;
  const scoreColor = cs.total >= 70 ? "#16a34a" : cs.total >= 45 ? "#f59e0b" : "#dc2626";
  const recColor =
    data.latest_memo?.recommendation === "GO" ? "#16a34a" :
    data.latest_memo?.recommendation === "NO-GO" ? "#dc2626" :
    "#6b7280";

  const ff = data.attribution;
  const contribs = ff.factor_contributions;

  return (
    <div>
      {/* ── PAGE 1 — HEADER + SCORE ─────────────────────────────────── */}
      <div style={{ borderBottom: "3px solid #1e40af", paddingBottom: "12px", marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#1e40af", margin: 0 }}>
              Blue Eagle Capital
            </h1>
            <p style={{ fontSize: "10px", color: "#6b7280", letterSpacing: "2px", textTransform: "uppercase", margin: "2px 0 0 0" }}>
              Institutional Research Tear Sheet
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: "11px", color: "#6b7280" }}>
            <p style={{ margin: 0 }}>As of: <strong>{data.as_of_date}</strong></p>
            <p style={{ margin: "2px 0 0 0" }}>Lookback: {data.lookback_days} days</p>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 700, margin: "0 0 4px 0" }}>{data.portfolio.name}</h2>
        <p style={{ fontSize: "11px", color: "#6b7280", margin: 0 }}>
          {data.portfolio.n_holdings} holdings
          {data.portfolio.notional_value != null && <> · {fmtDollar(data.portfolio.notional_value)}</>}
        </p>
      </div>

      {/* Composite Score + Recommendation */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
        <div style={{
          flex: 1,
          border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px",
          textAlign: "center",
        }}>
          <p style={{ fontSize: "10px", color: "#6b7280", margin: "0 0 6px 0", textTransform: "uppercase" }}>
            Composite Research Score
          </p>
          <p style={{ fontSize: "48px", fontWeight: 900, color: scoreColor, margin: 0, lineHeight: 1 }}>
            {cs.total.toFixed(0)}
          </p>
          <p style={{ fontSize: "10px", color: "#6b7280", margin: "2px 0 0 0" }}>/ 100</p>
        </div>
        <div style={{
          flex: 1,
          border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px",
          textAlign: "center",
        }}>
          <p style={{ fontSize: "10px", color: "#6b7280", margin: "0 0 6px 0", textTransform: "uppercase" }}>
            Recommendation
          </p>
          <p style={{ fontSize: "28px", fontWeight: 900, color: recColor, margin: 0, lineHeight: 1 }}>
            {data.latest_memo?.recommendation ?? "PENDING"}
          </p>
          <p style={{ fontSize: "10px", color: "#6b7280", margin: "4px 0 0 0" }}>
            {data.latest_memo?.created_at ? new Date(data.latest_memo.created_at).toLocaleDateString() : "No memo yet"}
          </p>
        </div>
      </div>

      {/* Score breakdown bars */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px", marginBottom: "20px" }}>
        <p style={{ fontSize: "11px", fontWeight: 700, margin: "0 0 10px 0" }}>Score Breakdown</p>
        {Object.entries(cs.categories).map(([key, cat]) => {
          const color = cat.score >= 0.7 ? "#16a34a" : cat.score >= 0.45 ? "#f59e0b" : "#dc2626";
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", fontSize: "10px" }}>
              <div style={{ width: "100px", textTransform: "capitalize", fontWeight: 600 }}>{key}</div>
              <div style={{ flex: 1, height: "10px", backgroundColor: "#e5e7eb", borderRadius: "4px", overflow: "hidden" }}>
                <div style={{ width: `${cat.score * 100}%`, height: "100%", backgroundColor: color }} />
              </div>
              <div style={{ width: "36px", textAlign: "right", fontFamily: "monospace" }}>{(cat.score * 100).toFixed(0)}</div>
              <div style={{ width: "180px", color: "#6b7280", fontSize: "9px" }}>{cat.detail}</div>
            </div>
          );
        })}
      </div>

      {/* Metrics grid */}
      <div style={{ marginBottom: "20px" }}>
        <p style={{ fontSize: "11px", fontWeight: 700, margin: "0 0 8px 0" }}>Key Metrics</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
          {[
            { label: "CAGR", value: fmtPct(data.metrics.cagr) },
            { label: "Volatility", value: fmtPct(data.metrics.vol) },
            { label: "Sharpe", value: fmtNum(data.metrics.sharpe) },
            { label: "Max Drawdown", value: fmtPct(data.metrics.max_dd) },
            { label: "Beta (SPY)", value: fmtNum(data.health.beta) },
            { label: "HHI", value: fmtNum(data.health.hhi, 3) },
          ].map((m) => (
            <div key={m.label} style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "8px" }}>
              <p style={{ fontSize: "9px", color: "#6b7280", margin: "0 0 2px 0", textTransform: "uppercase" }}>{m.label}</p>
              <p style={{ fontSize: "14px", fontWeight: 700, margin: 0 }}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Page break marker */}
      <div style={{ pageBreakBefore: "always", height: "20px" }} />

      {/* ── PAGE 2 — ATTRIBUTION + HOLDINGS ──────────────────────────── */}
      {contribs && (
        <div style={{ marginBottom: "20px" }}>
          <p style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 8px 0", color: "#1e40af" }}>
            Return Attribution (FF3)
          </p>
          <p style={{ fontSize: "10px", color: "#6b7280", margin: "0 0 10px 0" }}>
            Period return <strong>{fmtPct(ff.period_return_pct)}</strong> decomposed via Fama-French 3-factor regression. R² = {fmtNum(ff.r_squared)}.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "4px", marginBottom: "12px" }}>
            {[
              { label: "Alpha",    value: contribs.alpha_pct,    color: "#8b5cf6" },
              { label: "Market",   value: contribs.market_pct,   color: "#3b82f6" },
              { label: "SMB",      value: contribs.smb_pct,      color: "#10b981" },
              { label: "HML",      value: contribs.hml_pct,      color: "#f59e0b" },
              { label: "Rf",       value: contribs.rf_pct,       color: "#6b7280" },
              { label: "Residual", value: contribs.residual_pct, color: "#d1d5db" },
            ].map((s) => (
              <div key={s.label} style={{
                border: `2px solid ${s.color}`, borderRadius: "6px", padding: "6px",
                textAlign: "center",
              }}>
                <p style={{ fontSize: "8px", color: "#6b7280", margin: "0 0 2px 0", textTransform: "uppercase" }}>{s.label}</p>
                <p style={{ fontSize: "11px", fontWeight: 700, margin: 0, color: s.color }}>{fmtPct(s.value)}</p>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", fontSize: "10px" }}>
            <div><strong>β<sub>Market</sub>:</strong> {fmtNum(ff.beta_mkt)} (t = {fmtNum(ff.t_stats?.mkt, 2)})</div>
            <div><strong>β<sub>SMB</sub>:</strong> {fmtNum(ff.beta_smb)} (t = {fmtNum(ff.t_stats?.smb, 2)})</div>
            <div><strong>β<sub>HML</sub>:</strong> {fmtNum(ff.beta_hml)} (t = {fmtNum(ff.t_stats?.hml, 2)})</div>
          </div>
        </div>
      )}

      {/* Holdings table */}
      <div style={{ marginBottom: "20px" }}>
        <p style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 8px 0", color: "#1e40af" }}>Top Holdings</p>
        <table style={{ width: "100%", fontSize: "10px", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #1e40af", textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Ticker</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Weight</th>
            </tr>
          </thead>
          <tbody>
            {data.top_holdings.map((h) => (
              <tr key={h.ticker} style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: "5px 8px", fontWeight: 600 }}>{h.ticker}</td>
                <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{h.weight_pct.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Page break */}
      <div style={{ pageBreakBefore: "always", height: "20px" }} />

      {/* ── PAGE 3 — RISK + DECISION ─────────────────────────────────── */}
      <div style={{ marginBottom: "16px" }}>
        <p style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 8px 0", color: "#1e40af" }}>Concentration & Risk</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", fontSize: "10px" }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "8px" }}>
            <p style={{ fontSize: "9px", color: "#6b7280", margin: "0 0 2px 0", textTransform: "uppercase" }}>HHI</p>
            <p style={{ fontSize: "14px", fontWeight: 700, margin: 0 }}>{fmtNum(data.health.hhi, 3)}</p>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "8px" }}>
            <p style={{ fontSize: "9px", color: "#6b7280", margin: "0 0 2px 0", textTransform: "uppercase" }}>Effective N</p>
            <p style={{ fontSize: "14px", fontWeight: 700, margin: 0 }}>{fmtNum(data.health.n_eff, 1)}</p>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "8px" }}>
            <p style={{ fontSize: "9px", color: "#6b7280", margin: "0 0 2px 0", textTransform: "uppercase" }}>Top 5</p>
            <p style={{ fontSize: "14px", fontWeight: 700, margin: 0 }}>{fmtPct(data.health.top5)}</p>
          </div>
        </div>
      </div>

      {/* Decision memo */}
      {data.latest_memo && (
        <div style={{ marginBottom: "16px" }}>
          <p style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 8px 0", color: "#1e40af" }}>Decision Memo</p>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "12px" }}>
            <div style={{ marginBottom: "10px" }}>
              <span style={{
                backgroundColor: recColor, color: "white", padding: "2px 10px", borderRadius: "4px",
                fontSize: "12px", fontWeight: 700,
              }}>
                {data.latest_memo.recommendation ?? "DRAFT"}
              </span>
              <span style={{ marginLeft: "10px", fontSize: "10px", color: "#6b7280" }}>
                {data.latest_memo.created_by && <>by {data.latest_memo.created_by}</>}
                {data.latest_memo.created_at && <> · {new Date(data.latest_memo.created_at).toLocaleDateString()}</>}
              </span>
            </div>
            {data.latest_memo.rationale && (
              <div style={{ marginBottom: "8px" }}>
                <p style={{ fontSize: "9px", color: "#6b7280", margin: "0 0 3px 0", textTransform: "uppercase", fontWeight: 700 }}>Rationale</p>
                <p style={{ fontSize: "10px", lineHeight: 1.5, margin: 0 }}>{data.latest_memo.rationale}</p>
              </div>
            )}
            {data.latest_memo.red_flags && data.latest_memo.red_flags.length > 0 && (
              <div style={{ marginBottom: "8px" }}>
                <p style={{ fontSize: "9px", color: "#6b7280", margin: "0 0 3px 0", textTransform: "uppercase", fontWeight: 700 }}>Red Flags</p>
                {data.latest_memo.red_flags.map((rf, i) => (
                  <p key={i} style={{ fontSize: "10px", margin: "2px 0", color: "#dc2626" }}>
                    [{rf.severity.toUpperCase()}] {rf.flag} — {rf.detail}
                  </p>
                ))}
              </div>
            )}
            {data.latest_memo.monitoring_plan && (
              <div>
                <p style={{ fontSize: "9px", color: "#6b7280", margin: "0 0 3px 0", textTransform: "uppercase", fontWeight: 700 }}>Monitoring Plan</p>
                <p style={{ fontSize: "10px", lineHeight: 1.5, margin: 0 }}>{data.latest_memo.monitoring_plan}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "10px", marginTop: "20px", fontSize: "9px", color: "#6b7280" }}>
        <p style={{ margin: 0 }}>
          Generated by Blue Eagle Capital · {data.as_of_date}
          {createdBy && <> · Prepared by {createdBy}</>}
        </p>
        <p style={{ margin: "2px 0 0 0" }}>
          This document is for research and educational purposes only. Not investment advice.
        </p>
      </div>
    </div>
  );
}
