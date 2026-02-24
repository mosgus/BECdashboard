export const fmtPct = (v: number | undefined | null, decimals = 2): string => {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
};

export const fmtNum = (v: number | undefined | null, decimals = 2): string => {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(decimals);
};

export const fmtDollar = (v: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

export const colorForValue = (v: number, neutral = 0): string => {
  if (v > neutral) return "text-green-600";
  if (v < neutral) return "text-red-500";
  return "text-gray-500";
};

/** Thin wrapper around fetch that posts JSON and returns parsed JSON. */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Slice time-series data to the most recent N points for performance. */
export function downsample<T>(data: T[], maxPoints = 500): T[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  return data.filter((_, i) => i % step === 0 || i === data.length - 1);
}
