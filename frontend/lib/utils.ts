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

function _sharedHeaders(): Record<string, string> {
  const actorName =
    typeof window !== "undefined"
      ? (localStorage.getItem("be_actor") ?? "unknown")
      : "unknown";
  const headers: Record<string, string> = { "X-Actor-Name": actorName };
  const writeKey = process.env.NEXT_PUBLIC_CLASS_WRITE_KEY;
  if (writeKey) headers["X-Class-Key"] = writeKey;
  return headers;
}

/** Typed GET wrapper with X-Actor-Name header and optional query params. */
export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  let url = `${base}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method: "GET",
    headers: _sharedHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Typed multipart upload wrapper (POST with FormData). */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  // Do NOT set Content-Type manually — browser sets multipart boundary automatically
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: _sharedHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Typed DELETE wrapper. */
export async function apiDelete(path: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const res = await fetch(`${base}${path}`, {
    method: "DELETE",
    headers: _sharedHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
}

/** Typed PATCH wrapper. */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const headers = { ..._sharedHeaders(), "Content-Type": "application/json" };
  const res = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Typed PUT wrapper. */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const headers = { ..._sharedHeaders(), "Content-Type": "application/json" };
  const res = await fetch(`${base}${path}`, {
    method: "PUT",
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
