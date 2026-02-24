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
 * Typed POST wrapper. Attaches Authorization header from localStorage
 * and redirects to /login on 401.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const token =
    typeof window !== "undefined" ? localStorage.getItem("be_token") : null;

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("be_token");
      localStorage.removeItem("be_actor");
      window.location.href = "/login";
    }
    throw new Error("Session expired. Please log in again.");
  }

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
