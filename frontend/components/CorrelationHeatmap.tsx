"use client";

interface Props {
  data: Record<string, Record<string, number>>;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function corrToColor(v: number): string {
  // -1 → red, 0 → white, +1 → blue
  const t = (v + 1) / 2; // 0..1
  if (t >= 0.5) {
    const s = (t - 0.5) * 2;
    const r = Math.round(lerp(255, 59, s));
    const g = Math.round(lerp(255, 130, s));
    const b = Math.round(lerp(255, 246, s));
    return `rgb(${r},${g},${b})`;
  } else {
    const s = t * 2;
    const r = Math.round(lerp(239, 255, s));
    const g = Math.round(lerp(68, 255, s));
    const b = Math.round(lerp(68, 255, s));
    return `rgb(${r},${g},${b})`;
  }
}

export default function CorrelationHeatmap({ data }: Props) {
  const tickers = Object.keys(data);
  if (!tickers.length) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm overflow-auto">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">Correlation Matrix</h3>
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="p-1.5 text-gray-400"></th>
            {tickers.map((t) => (
              <th key={t} className="p-1.5 font-semibold text-gray-600 text-center">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickers.map((row) => (
            <tr key={row}>
              <td className="p-1.5 font-semibold text-gray-600 pr-3">{row}</td>
              {tickers.map((col) => {
                const v = data[row]?.[col] ?? 0;
                return (
                  <td
                    key={col}
                    title={`${row} × ${col}: ${v.toFixed(3)}`}
                    style={{ backgroundColor: corrToColor(v) }}
                    className="p-2 text-center font-mono tabular-nums rounded-sm"
                  >
                    {v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
