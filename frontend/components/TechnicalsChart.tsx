"use client";
import { TechnicalsResponse } from "@/types/portfolio";
import type { ExtendedTechnicalsResponse } from "@/types/sprint7";
import { downsample } from "@/lib/utils";
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface Props {
  data: TechnicalsResponse | ExtendedTechnicalsResponse;
  visibleIndicators?: Set<string>;
}

export default function TechnicalsChart({ data, visibleIndicators = new Set() }: Props) {
  const ext = data as ExtendedTechnicalsResponse;
  const priceSMA = downsample(data.price_sma, 400);
  const rsi = downsample(data.rsi, 400);
  const macd = downsample(data.macd, 400);

  // Merge overlay data (ema, bollinger, donchian) into the price series by date
  const priceMap = new Map(priceSMA.map((r: { date: string }) => [r.date, { ...r }]));

  if (visibleIndicators.has("ema") && ext.ema) {
    for (const pt of downsample(ext.ema, 400)) {
      const row = priceMap.get(pt.date);
      if (row) Object.assign(row, { ema20: pt.ema20, ema50: pt.ema50 });
    }
  }
  if (visibleIndicators.has("bollinger") && ext.bollinger) {
    for (const pt of downsample(ext.bollinger, 400)) {
      const row = priceMap.get(pt.date);
      if (row) Object.assign(row, { bb_upper: pt.upper, bb_mid: pt.mid, bb_lower: pt.lower });
    }
  }
  if (visibleIndicators.has("donchian") && ext.donchian) {
    for (const pt of downsample(ext.donchian, 400)) {
      const row = priceMap.get(pt.date);
      if (row) Object.assign(row, { dc_upper: pt.upper, dc_mid: pt.mid, dc_lower: pt.lower });
    }
  }

  const enrichedPrice = Array.from(priceMap.values());

  const fmtDate = (d: string) => d.slice(0, 7);

  const panelCls = "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm";
  const titleCls = "mb-3 text-sm font-semibold text-[var(--color-text)]";

  return (
    <div className="flex flex-col gap-4">
      {/* Price + SMA (+ optional EMA / Bollinger / Donchian overlays) */}
      <div className={panelCls}>
        <h3 className={titleCls}>
          {data.ticker} — Price & Moving Averages
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={enrichedPrice} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} minTickGap={60} />
            <YAxis tick={{ fontSize: 11 }} width={60} domain={["auto", "auto"]} />
            <Tooltip labelFormatter={(l) => `Date: ${l}`} />
            <Legend />

            {/* Bollinger bands — upper fills down to axis, lower masks with white → band fill between the two lines */}
            {visibleIndicators.has("bollinger") && (
              <>
                <Area type="monotone" dataKey="bb_upper" stroke="#a78bfa" strokeWidth={1} fill="#a78bfa" fillOpacity={0.12} dot={false} name="BB Upper" strokeDasharray="3 2" legendType="none" />
                <Area type="monotone" dataKey="bb_lower" stroke="#a78bfa" strokeWidth={1} fill="white" fillOpacity={1} dot={false} name="BB Lower" strokeDasharray="3 2" legendType="none" />
              </>
            )}

            {/* Donchian channel */}
            {visibleIndicators.has("donchian") && (
              <>
                <Line type="monotone" dataKey="dc_upper" stroke="#06b6d4" strokeWidth={1} dot={false} name="DC Upper" strokeDasharray="4 2" />
                <Line type="monotone" dataKey="dc_lower" stroke="#06b6d4" strokeWidth={1} dot={false} name="DC Lower" strokeDasharray="4 2" />
                <Line type="monotone" dataKey="dc_mid" stroke="#0891b2" strokeWidth={1} dot={false} name="DC Mid" strokeDasharray="2 2" />
              </>
            )}

            <Line type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Price" />
            <Line type="monotone" dataKey="sma20" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="SMA 20" strokeDasharray="4 2" />
            <Line type="monotone" dataKey="sma50" stroke="#ef4444" strokeWidth={1.5} dot={false} name="SMA 50" strokeDasharray="6 3" />

            {/* EMA overlays */}
            {visibleIndicators.has("ema") && (
              <>
                <Line type="monotone" dataKey="ema20" stroke="#d97706" strokeWidth={1.5} dot={false} name="EMA 20" strokeDasharray="4 2" />
                <Line type="monotone" dataKey="ema50" stroke="#92400e" strokeWidth={1.5} dot={false} name="EMA 50" strokeDasharray="6 3" />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* RSI */}
        <div className={panelCls}>
          <h3 className={titleCls}>RSI (14)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={rsi} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} minTickGap={60} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
              <Tooltip labelFormatter={(l) => `Date: ${l}`} />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "OB 70", fontSize: 10 }} />
              <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "OS 30", fontSize: 10 }} />
              <Line type="monotone" dataKey="rsi" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="RSI" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* MACD */}
        <div className={panelCls}>
          <h3 className={titleCls}>MACD (12, 26, 9)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={macd} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} minTickGap={60} />
              <YAxis tick={{ fontSize: 11 }} width={48} domain={["auto", "auto"]} />
              <Tooltip labelFormatter={(l) => `Date: ${l}`} />
              <ReferenceLine y={0} stroke="#6b7280" />
              <Bar dataKey="histogram" name="Histogram" fill="#94a3b8" radius={[1, 1, 0, 0]} />
              <Line type="monotone" dataKey="macd" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="MACD" />
              <Line type="monotone" dataKey="signal" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Signal" strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Extra indicator panels ────────────────────────────────────────────── */}

      {visibleIndicators.has("adx") && ext.adx && (
        <div className={panelCls}>
          <h3 className={titleCls}>ADX (14) — Trend Strength</h3>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={downsample(ext.adx, 400)} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} minTickGap={60} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
              <Tooltip labelFormatter={(l) => `Date: ${l}`} />
              <ReferenceLine y={25} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "Trending 25", fontSize: 10 }} />
              <Line type="monotone" dataKey="adx" stroke="#10b981" strokeWidth={1.5} dot={false} name="ADX" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {visibleIndicators.has("stochastic") && ext.stochastic && (
        <div className={panelCls}>
          <h3 className={titleCls}>Stochastic (14, 3, 3)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={downsample(ext.stochastic, 400)} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} minTickGap={60} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
              <Tooltip labelFormatter={(l) => `Date: ${l}`} />
              <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "OB 80", fontSize: 10 }} />
              <ReferenceLine y={20} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "OS 20", fontSize: 10 }} />
              <Line type="monotone" dataKey="k" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="%K" />
              <Line type="monotone" dataKey="d" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="%D" strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {visibleIndicators.has("obv") && ext.obv && (
        <div className={panelCls}>
          <h3 className={titleCls}>On-Balance Volume (OBV)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={downsample(ext.obv, 400)} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} minTickGap={60} />
              <YAxis tick={{ fontSize: 11 }} width={72} domain={["auto", "auto"]} tickFormatter={(v: number) => (v / 1_000_000).toFixed(1) + "M"} />
              <Tooltip labelFormatter={(l) => `Date: ${l}`} />
              <Line type="monotone" dataKey="obv" stroke="#6366f1" strokeWidth={1.5} dot={false} name="OBV" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
