import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, PointerEvent } from 'react'
import type { ChartMetric, ChartRegion } from '../api/client'
import {
  DAY_MS,
  formatChartDate,
  formatMetric,
  formatTick,
  lowerBound,
  nearest,
  niceTicks,
  spreadLabels,
  xTicks,
} from '../lib/macroScorecard'

/** A metric with its series times converted from days to epoch milliseconds. */
interface Metric extends Omit<ChartMetric, 'series'> {
  series: Record<string, { t: number[]; v: number[] }>
}

/** Shared crosshair: the time under the pointer, and which panel the pointer is in (only that
 * panel shows the tooltip; every panel shows the line and dots). */
interface Cross {
  t: number
  src: string
}

const YEAR_OPTIONS: { label: string; years: number | null }[] = [
  { label: '1Y', years: 1 },
  { label: '3Y', years: 3 },
  { label: '5Y', years: 5 },
  { label: '10Y', years: 10 },
  { label: 'Max', years: null },
]
const H = 270
const M = { l: 46, r: 128, t: 10, b: 26 }
const MAX_GAP_MS = 45 * DAY_MS

interface Props {
  groupLabel: string
  regions: ChartRegion[]
  metrics: ChartMetric[]
}

/** Six time-series panels per market group with a date range, a chart / table switch and a
 * clickable legend. Port of charts.py's charts_body + CHARTS_JS. */
export function MacroFundamentals({ groupLabel, regions, metrics: rawMetrics }: Props): JSX.Element {
  const [years, setYears] = useState<number | null>(1)
  const [view, setView] = useState<'charts' | 'table'>('charts')
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [cross, setCross] = useState<Cross | null>(null)

  const metrics = useMemo<Metric[]>(
    () =>
      rawMetrics.map((m) => ({
        ...m,
        series: Object.fromEntries(
          Object.entries(m.series).map(([name, s]) => [name, { t: s.t.map((d) => d * DAY_MS), v: s.v }]),
        ),
      })),
    [rawMetrics],
  )
  const [tMin, tMax] = useMemo(() => {
    const all = metrics.flatMap((m) => Object.values(m.series))
    return [Math.min(...all.map((s) => s.t[0])), Math.max(...all.map((s) => s.t[s.t.length - 1]))]
  }, [metrics])
  const start = years == null ? tMin : Math.max(tMin, tMax - years * 365.25 * DAY_MS)
  const shown = useMemo(() => regions.filter((r) => !off.has(r.name)), [regions, off])

  function toggle(name: string): void {
    const next = new Set(off)
    if (next.has(name)) next.delete(name)
    else if (next.size < regions.length - 1) next.add(name) // keep at least one market on
    setOff(next)
  }

  return (
    <div>
      <div className="sect">
        <h2>Regional fundamentals: {groupLabel}</h2>
      </div>
      <div className="filters">
        <div className="seg" role="group" aria-label="Date range">
          {YEAR_OPTIONS.map((o) => (
            <button key={o.label} type="button" aria-pressed={years === o.years} onClick={() => setYears(o.years)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'charts'} onClick={() => setView('charts')}>
            Charts
          </button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
            Table
          </button>
        </div>
        <div className="legend" role="group" aria-label="Legend: click a market to show or hide it">
          {regions.map((r) => (
            <button key={r.name} type="button" aria-pressed={!off.has(r.name)} onClick={() => toggle(r.name)}>
              <i style={{ background: `var(--${r.cls})` }} />
              {r.name}
            </button>
          ))}
          <span className="hint">click to show / hide</span>
        </div>
      </div>
      {view === 'charts' ? (
        <section className="cgrid" aria-label="Time-series charts">
          {metrics.map((m) => (
            <article key={m.id} className="card panel">
              <h3>{m.title}</h3>
              <p className="psub">{m.sub}</p>
              <MetricPlot metric={m} shown={shown} t0={start} t1={tMax} cross={cross} onCross={setCross} />
            </article>
          ))}
        </section>
      ) : (
        <section className="card tablecard">
          <div className="tscroll">
            <MetricTable metrics={metrics} regions={regions} shown={shown} start={start} />
          </div>
        </section>
      )}
    </div>
  )
}

interface PlotProps {
  metric: Metric
  shown: ChartRegion[]
  t0: number
  t1: number
  cross: Cross | null
  onCross: (cross: Cross | null) => void
}

function MetricPlot({ metric: m, shown, t0, t1, cross, onCross }: PlotProps): JSX.Element {
  const plotRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    const observer = new ResizeObserver(() => setWidth(plot.clientWidth))
    observer.observe(plot)
    return () => observer.disconnect()
  }, [])

  const geo = useMemo(() => {
    if (!width) return null
    const W = Math.max(300, width)
    const iw = W - M.l - M.r
    const ih = H - M.t - M.b
    const vis = shown
      .filter((r) => m.series[r.name])
      .map((r) => {
        const s = m.series[r.name]
        const i0 = lowerBound(s.t, t0)
        const t = s.t.slice(i0)
        const raw = s.v.slice(i0)
        const base = m.rebase ? raw[0] : 1
        return { r, t, raw, y: raw.map((v) => (v / base) * (m.rebase ? 100 : 1)) }
      })
      .filter((s) => s.t.length)
    if (!vis.length) return null
    let lo = Infinity
    let hi = -Infinity
    vis.forEach((s) =>
      s.y.forEach((v) => {
        if (v < lo) lo = v
        if (v > hi) hi = v
      }),
    )
    if (m.baseline != null) {
      lo = Math.min(lo, m.baseline)
      hi = Math.max(hi, m.baseline)
    }
    const pad = (hi - lo) * 0.07 || 1
    lo -= pad
    hi += pad
    const X = (t: number): number => M.l + ((t - t0) / (t1 - t0)) * iw
    const Y = (v: number): number => M.t + (1 - (v - lo) / (hi - lo)) * ih
    const endYs = vis.map((s) => Y(s.y[s.y.length - 1]))
    const labelYs = spreadLabels(endYs, 17, M.t + ih + 6)
    const xl = M.l + iw + 20
    const layer = (
      <>
        {niceTicks(lo, hi, 5).map((v) => (
          <g key={v}>
            <line className="gl" x1={M.l} x2={M.l + iw} y1={Y(v)} y2={Y(v)} />
            <text className="tk" x={M.l - 8} y={Y(v) + 4} textAnchor="end">
              {formatTick(m, v)}
            </text>
          </g>
        ))}
        {m.baseline != null && <line className="base" x1={M.l} x2={M.l + iw} y1={Y(m.baseline)} y2={Y(m.baseline)} />}
        {xTicks(t0, t1).map((tk) => (
          <text key={tk.t} className="tk" x={X(tk.t)} y={H - 6} textAnchor="middle">
            {tk.label}
          </text>
        ))}
        {vis.map((s) => (
          <path
            key={s.r.name}
            className={`ln ${s.r.cls}`}
            d={s.t.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(s.y[i]).toFixed(1)}`).join('')}
          />
        ))}
        {vis.map((s, k) => {
          const xe = X(s.t[s.t.length - 1])
          return (
            <g key={s.r.name}>
              <polyline className={`lead ${s.r.cls}`} points={`${xe + 5},${endYs[k]} ${xl - 5},${labelYs[k]}`} />
              <circle className={`dot ${s.r.cls}`} cx={xe} cy={endYs[k]} r={4} />
              <text className="lab" x={xl} y={labelYs[k] + 4}>
                {`${s.r.name}  ${formatMetric(m, s.y[s.y.length - 1])}`}
              </text>
            </g>
          )
        })}
      </>
    )
    return { W, iw, ih, vis, X, Y, layer }
  }, [width, shown, m, t0, t1])

  // Crosshair position for the shared time, snapped to this panel's first visible series.
  const at = useMemo(() => {
    if (!geo || !cross) return null
    const ref = geo.vis[0]
    const ri = nearest(ref.t, cross.t)
    if (Math.abs(ref.t[ri] - cross.t) > MAX_GAP_MS) return null
    const tRef = ref.t[ri]
    return {
      index: ri,
      t: tRef,
      x: geo.X(tRef),
      points: geo.vis.map((s) => {
        const i = nearest(s.t, tRef)
        return { s, i, cx: geo.X(s.t[i]), cy: geo.Y(s.y[i]) }
      }),
    }
  }, [geo, cross])
  const showTip = at !== null && cross?.src === m.id

  useLayoutEffect(() => {
    const tip = tipRef.current
    const plot = plotRef.current
    if (!at || !tip || !plot) return
    const tw = tip.offsetWidth
    const left = at.x + 14 + tw > plot.clientWidth ? at.x - tw - 14 : at.x + 14
    tip.style.left = `${Math.max(0, left)}px`
    tip.style.top = `${M.t + 4}px`
  }, [at, showTip])

  function onPointerMove(ev: PointerEvent<SVGRectElement>): void {
    const svg = ev.currentTarget.ownerSVGElement
    if (!geo || !svg) return
    const b = svg.getBoundingClientRect()
    onCross({ t: t0 + (((ev.clientX - b.left) * (geo.W / b.width) - M.l) / geo.iw) * (t1 - t0), src: m.id })
  }

  function onKeyDown(ev: KeyboardEvent<SVGSVGElement>): void {
    if (!geo || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return
    ev.preventDefault()
    const ref = geo.vis[0]
    const i = at ? at.index : ref.t.length - 1
    const j = Math.min(ref.t.length - 1, Math.max(0, i + (ev.key === 'ArrowLeft' ? -1 : 1)))
    onCross({ t: ref.t[j], src: m.id })
  }

  return (
    <div className="plot" ref={plotRef}>
      {geo && (
        <svg
          viewBox={`0 0 ${geo.W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`${m.title} for ${shown.map((r) => r.name).join(', ')}. Use the table view for exact values.`}
          onKeyDown={onKeyDown}
          onBlur={() => onCross(null)}
        >
          {geo.layer}
          {at && (
            <g>
              <line className="xh" x1={at.x} x2={at.x} y1={M.t} y2={M.t + geo.ih} />
              {at.points.map((p) => (
                <circle key={p.s.r.name} className={`dot ${p.s.r.cls}`} r={4.5} cx={p.cx} cy={p.cy} />
              ))}
            </g>
          )}
          <rect
            x={M.l}
            y={M.t}
            width={geo.iw}
            height={geo.ih}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerLeave={() => onCross(null)}
          />
        </svg>
      )}
      {showTip && at && (
        <div className="tip" ref={tipRef} aria-hidden="true">
          <div className="d">{formatChartDate(at.t, m.monthly)}</div>
          {at.points.map((p) => (
            <div key={p.s.r.name} className={`r ${p.s.r.cls}`}>
              <span className="k" />
              <span className="v">{formatMetric(m, p.s.y[p.i])}</span>
              <span className="n">{p.s.r.name}</span>
              {m.rebase && <span className="x">{p.s.raw[p.i].toFixed(2)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface TableProps {
  metrics: Metric[]
  regions: ChartRegion[]
  shown: ChartRegion[]
  start: number
}

/** Every metric for every shown market, newest first, on the first metric's dates. */
function MetricTable({ metrics, regions, shown, start }: TableProps): JSX.Element {
  const rows = useMemo(() => {
    const first = metrics[0]
    const refRegion = shown.find((r) => first.series[r.name]) ?? regions.find((r) => first.series[r.name])
    if (!refRegion) return []
    const ref = first.series[refRegion.name].t
    const i0 = lowerBound(ref, start)
    const out: { t: number; cells: string[] }[] = []
    for (let i = ref.length - 1; i >= i0; i--) {
      const cells: string[] = []
      metrics.forEach((m) =>
        shown.forEach((r) => {
          const s = m.series[r.name]
          if (!s) {
            cells.push('—')
            return
          }
          // PMI: the latest monthly release as of the row date
          const j = m.monthly ? lowerBound(s.t, ref[i] + 1) - 1 : nearest(s.t, ref[i])
          const ok = j >= 0 && (m.monthly || Math.abs(s.t[j] - ref[i]) < MAX_GAP_MS)
          cells.push(ok ? formatMetric(m.rebase ? { ...m, decimals: 2 } : m, s.v[j]) : '—')
        }),
      )
      out.push({ t: ref[i], cells })
    }
    return out
  }, [metrics, regions, shown, start])

  return (
    <table className="dt">
      <thead>
        <tr className="h1">
          <th>Date</th>
          {metrics.map((m) => (
            <th key={m.id} className="g" colSpan={shown.length}>
              {m.title + (m.rebase ? ' (per share, USD)' : '')}
            </th>
          ))}
        </tr>
        <tr className="h2">
          <th />
          {metrics.map((m) =>
            shown.map((r, k) => (
              <th key={`${m.id}-${r.name}`} className={k === 0 ? 'g' : undefined}>
                {r.name}
              </th>
            )),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.t}>
            <td>{formatChartDate(row.t, false)}</td>
            {row.cells.map((cell, c) => (
              <td key={c} className={c % shown.length === 0 ? 'g' : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
