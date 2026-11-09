/** Pure helpers for the Macro tab, ported from the scorecard project's page script (charts.py's
 * CHARTS_JS) and its quadrant layout (charts.py's _separate / _place_labels). Kept free of the DOM
 * so the layout arithmetic can be tested against the positions the Python build produced. */

export const DAY_MS = 864e5

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** First index i with a[i] >= x (a sorted ascending). */
export function lowerBound(a: readonly number[], x: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Index of the element of sorted `a` closest to x; ties go to the earlier one. */
export function nearest(a: readonly number[], x: number): number {
  const i = lowerBound(a, x)
  if (i === 0) return 0
  if (i >= a.length) return a.length - 1
  return x - a[i - 1] <= a[i] - x ? i - 1 : i
}

export function niceTicks(lo: number, hi: number, n: number): number[] {
  const raw = (hi - lo) / n
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}

/** Month-aligned x ticks; the step widens with the range (2 months up to 3 years). */
export function xTicks(t0: number, t1: number): { t: number; label: string }[] {
  const yrs = (t1 - t0) / DAY_MS / 365.25
  const step = yrs <= 1.3 ? 2 : yrs <= 3.5 ? 6 : yrs <= 7 ? 12 : yrs <= 12 ? 24 : 36
  const out: { t: number; label: string }[] = []
  const d = new Date(t0)
  let y = d.getUTCFullYear()
  let mo = d.getUTCMonth()
  for (let guard = 0; guard < 400; guard++) {
    const t = Date.UTC(y, mo, 1)
    const aligned = step >= 12 ? mo === 0 && y % (step / 12) === 0 : mo % step === 0
    if (t > t1) break
    if (t >= t0 && aligned) out.push({ t, label: step >= 12 ? String(y) : `${MONTHS[mo]} '${String(y).slice(2)}` })
    mo++
    if (mo > 11) {
      mo = 0
      y++
    }
  }
  return out
}

export interface NumberFormat {
  signed: boolean
  decimals: number
  suffix: string
}

export function formatMetric(m: NumberFormat, v: number): string {
  return (m.signed && v > 0 ? '+' : '') + v.toFixed(m.decimals) + m.suffix
}

/** Y-axis tick label: signed metrics show '+', percentage metrics a '%'. */
export function formatTick(m: NumberFormat, v: number): string {
  if (m.signed && v > 0) return `+${v}%`
  return m.suffix === '%' ? `${v}%` : String(v)
}

export function formatChartDate(t: number, monthly: boolean): string {
  return new Date(t).toLocaleDateString(
    'en-GB',
    monthly
      ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
  )
}

/** End-of-line label positions: sorted top to bottom, pushed apart by `gap`, then pulled back up
 * from `bottom` so the lowest label stays inside the plot. Returns label y per input index. */
export function spreadLabels(ys: readonly number[], gap: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ i, y, ly: 0 })).sort((a, b) => a.y - b.y)
  order.forEach((l, k) => {
    l.ly = k ? Math.max(l.y, order[k - 1].ly + gap) : l.y
  })
  for (let k = order.length - 1; k >= 0; k--) {
    const lim = k === order.length - 1 ? bottom : order[k + 1].ly - gap
    if (order[k].ly > lim) order[k].ly = lim
  }
  const out = new Array<number>(ys.length)
  order.forEach((l) => {
    out[l.i] = l.ly
  })
  return out
}

// ── Macro vs. market quadrant ────────────────────────────────────────────────────────────────

export const QUAD_W = 1000
export const QUAD_H = 520
export const QUAD_M = { l: 56, r: 20, t: 16, b: 48 }
export const FLAG_R = 14

const QUAD_IW = QUAD_W - QUAD_M.l - QUAD_M.r
const QUAD_IH = QUAD_H - QUAD_M.t - QUAD_M.b

/** Score (0–1) to viewBox x / y. */
export const quadX = (v: number): number => QUAD_M.l + v * QUAD_IW
export const quadY = (v: number): number => QUAD_M.t + (1 - v) * QUAD_IH

export type Point = [number, number]
export type Segment = [number, number, number, number]
type Box = [number, number, number, number]

/** Nudge flags that would overlap apart (pairwise push) so each stays readable. */
export function separate(points: readonly Point[], minD: number, bounds: Box): Point[] {
  const xy = points.map(([x, y]) => [x, y] as Point)
  for (let pass = 0; pass < 80; pass++) {
    let moved = false
    for (let i = 0; i < xy.length; i++) {
      for (let j = i + 1; j < xy.length; j++) {
        const dx = xy[j][0] - xy[i][0]
        const dy = xy[j][1] - xy[i][1]
        const d = Math.hypot(dx, dy)
        if (d < minD) {
          const [ux, uy] = d > 1e-6 ? [dx / d, dy / d] : [1, 0]
          const push = (minD - d) / 2 + 0.1
          xy[i][0] -= ux * push
          xy[i][1] -= uy * push
          xy[j][0] += ux * push
          xy[j][1] += uy * push
          moved = true
        }
      }
    }
    for (const p of xy) {
      p[0] = Math.min(Math.max(p[0], bounds[0]), bounds[2])
      p[1] = Math.min(Math.max(p[1], bounds[1]), bounds[3])
    }
    if (!moved) break
  }
  return xy
}

export interface LabelPlacement {
  x: number
  y: number
  anchor: 'start' | 'end' | 'middle'
}

/** Label position per flag: right of it unless that collides with another flag, label or shift
 * arrow, then left / above / below. Text width is estimated at ~7px per character. */
export function placeLabels(names: readonly string[], xy: readonly Point[], segments: readonly Segment[]): LabelPlacement[] {
  const boxes: Box[] = xy.map(([x, y]) => [x - FLAG_R - 2, y - FLAG_R - 2, x + FLAG_R + 2, y + FLAG_R + 2])
  // arrows as chains of tiny boxes, sampled every ~6px
  for (const [x0, y0, x1, y1] of segments) {
    const n = Math.max(2, Math.trunc(Math.hypot(x1 - x0, y1 - y0) / 6))
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1)
      const x = x0 + (x1 - x0) * t
      const y = y0 + (y1 - y0) * t
      boxes.push([x - 1, y - 1, x + 1, y + 1])
    }
  }
  const loX = QUAD_M.l
  const hiX = QUAD_W - QUAD_M.r
  return names.map((name, i) => {
    const [x, y] = xy[i]
    const w = 7 * name.length + 4
    const h = 16
    const cands: [number, number, LabelPlacement['anchor'], Box][] = [
      [x + FLAG_R + 6, y + 4, 'start', [x + FLAG_R + 4, y - h / 2, x + FLAG_R + 6 + w, y + h / 2]],
      [x - FLAG_R - 6, y + 4, 'end', [x - FLAG_R - 6 - w, y - h / 2, x - FLAG_R - 4, y + h / 2]],
      [x, y - FLAG_R - 7, 'middle', [x - w / 2, y - FLAG_R - 6 - h, x + w / 2, y - FLAG_R - 4]],
      [x, y + FLAG_R + 16, 'middle', [x - w / 2, y + FLAG_R + 4, x + w / 2, y + FLAG_R + 4 + h]],
    ]
    const ok = (b: Box): boolean =>
      b[0] >= loX &&
      b[2] <= hiX &&
      !boxes.some((o, j) => j !== i && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])
    const pick = cands.find((c) => ok(c[3])) ?? (cands[0][3][2] <= hiX ? cands[0] : cands[1])
    boxes.push(pick[3])
    return { x: pick[0], y: pick[1], anchor: pick[2] }
  })
}

export interface QuadrantInput {
  name: string
  macro: number
  market: number
  prev: Record<string, { macro: number | null; market: number | null }>
}

export interface QuadrantShift {
  x0: number
  y0: number
  /** Arrow end, stopped short of the flag; null when the move is too short to draw an arrow. */
  arrow: { x: number; y: number } | null
}

export interface QuadrantLayout {
  flags: Point[]
  labels: LabelPlacement[]
  /** horizon -> one entry per point (null where that horizon has no value). */
  shifts: Record<string, (QuadrantShift | null)[]>
}

/** Everything the quadrant draws, in viewBox units. Mirrors charts.py's quadrant_svg. */
export function quadrantLayout(points: readonly QuadrantInput[]): QuadrantLayout {
  const flags = separate(
    points.map((p) => [quadX(p.market), quadY(p.macro)] as Point),
    2 * FLAG_R + 5,
    [quadX(0) + FLAG_R, quadY(1) + FLAG_R, quadX(1) - FLAG_R, quadY(0) - FLAG_R],
  )
  const segments: Segment[] = []
  const shifts: Record<string, (QuadrantShift | null)[]> = {}
  for (const h of Object.keys(points[0]?.prev ?? {})) {
    shifts[h] = points.map((p, i) => {
      const prev = p.prev[h]
      if (prev?.macro == null || prev.market == null) return null
      const [x1, y1] = flags[i]
      const x0 = quadX(prev.market)
      const y0 = quadY(prev.macro)
      segments.push([x0, y0, x1, y1])
      const d = Math.hypot(x1 - x0, y1 - y0)
      const arrow =
        d > FLAG_R + 10
          ? { x: x1 - ((x1 - x0) / d) * (FLAG_R + 4), y: y1 - ((y1 - y0) / d) * (FLAG_R + 4) }
          : null
      return { x0, y0, arrow }
    })
  }
  return { flags, labels: placeLabels(points.map((p) => p.name), flags, segments), shifts }
}
