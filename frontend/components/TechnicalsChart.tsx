"use client";
import { TechnicalsResponse } from "@/types/portfolio";
import { downsample } from "@/lib/utils";
import {
  ComposedChart,
  Line,
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
  data: TechnicalsResponse;
}

export default function TechnicalsChart({ data }: Props) {
  const priceSMA = downsample(data.price_sma, 400);
  const rsi = downsample(data.rsi, 400);
  const macd = downsample(data.macd, 400);

  const fmtDate = (d: string) => d.slice(0, 7);

  return (
    <div className="flex flex-col gap-4">
      {/* Price + SMA */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          {data.ticker} — Price & Moving Averages
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={priceSMA} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} minTickGap={60} />
            <YAxis tick={{ fontSize: 11 }} width={60} domain={["auto", "auto"]} />
            <Tooltip labelFormatter={(l) => `Date: ${l}`} />
            <Legend />
            <Line type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Price" />
            <Line type="monotone" dataKey="sma20" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="SMA 20" strokeDasharray="4 2" />
            <Line type="monotone" dataKey="sma50" stroke="#ef4444" strokeWidth={1.5} dot={false} name="SMA 50" strokeDasharray="6 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* RSI */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">RSI (14)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={rsi} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
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
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">MACD (12, 26, 9)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={macd} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} minTickGap={60} />
              <YAxis tick={{ fontSize: 11 }} width={48} domain={["auto", "auto"]} />
              <Tooltip labelFormatter={(l) => `Date: ${l}`} />
              <ReferenceLine y={0} stroke="#6b7280" />
              <Bar
                dataKey="histogram"
                name="Histogram"
                fill="#94a3b8"
                radius={[1, 1, 0, 0]}
              />
              <Line type="monotone" dataKey="macd" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="MACD" />
              <Line type="monotone" dataKey="signal" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Signal" strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
