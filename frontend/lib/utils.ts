export const fmtPct = (v: number | undefined | null, decimals = 2): string => {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
};

export const fmtNum = (v: number | undefined | null, decimals = 2): string => {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(decimals);
};

export const fmtDollar = (v: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);

export const colorForValue = (v: number, neutral = 0): string => {
  if (v > neutral) return "text-[var(--color-positive)]";
  if (v < neutral) return "text-[var(--color-negative)]";
  return "text-[var(--color-muted)]";
};

/**
 * Typed POST wrapper. Attaches X-Actor-Name header from localStorage.
 * If NEXT_PUBLIC_CLASS_WRITE_KEY is set, also sends X-Class-Key header.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const actorName =
    typeof window !== "undefined"
      ? (localStorage.getItem("be_actor") ?? "unknown")
      : "unknown";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Actor-Name": actorName,
  };

  const writeKey = process.env.NEXT_PUBLIC_CLASS_WRITE_KEY;
  if (writeKey) headers["X-Class-Key"] = writeKey;

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

/** Downsample a time-series to at most maxPoints for chart performance. */
export function downsample<T>(data: T[], maxPoints = 500): T[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  return data.filter((_, i) => i % step === 0 || i === data.length - 1);
}
