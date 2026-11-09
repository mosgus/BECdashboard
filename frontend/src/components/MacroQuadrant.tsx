import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX, SyntheticEvent } from 'react'
import type { QuadrantPoint } from '../api/client'
import { FLAG_R, QUAD_H, QUAD_W, quadrantLayout, quadX, quadY } from '../lib/macroScorecard'

type Horizon = '1M' | '3M' | 'off'

const HORIZON_LABEL: Record<string, string> = { '1M': '1 month ago', '3M': '3 months ago' }
const SHORT: Record<string, string> = {
  'Price Momentum': 'Momentum',
  'Price Breadth': 'Breadth',
  'Earnings Revisions Momentum': 'Revisions',
  'Earnings Breadth': 'Earnings breadth',
}
const GRID_STEPS = [0, 0.25, 0.5, 0.75, 1]
const CORNERS = [
  { vx: 0, vy: 1, anchor: 'start', dx: 10, dy: 18, label: 'Strong macro · weak market' },
  { vx: 1, vy: 1, anchor: 'end', dx: -10, dy: 18, label: 'Strong macro · strong market' },
  { vx: 0, vy: 0, anchor: 'start', dx: 10, dy: -10, label: 'Weak macro · weak market' },
  { vx: 1, vy: 0, anchor: 'end', dx: -10, dy: -10, label: 'Weak macro · strong market' },
] as const

const pct = (v: number): number => Math.round(v * 100)

interface Props {
  groupKey: string
  groupLabel: string
  points: QuadrantPoint[]
}

/** Macro Score against Market Score, one flag per market, with an optional arrow from where it
 * stood 1 or 3 months ago. Port of charts.py's quadrant_section / quadrant_svg / QUAD_JS. */
export function MacroQuadrant({ groupKey, groupLabel, points }: Props): JSX.Element {
  const [horizon, setHorizon] = useState<Horizon>('3M')
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const layout = useMemo(() => quadrantLayout(points), [points])
  const clipId = `qclip-${groupKey}`
  const arrowId = `qarrow-${groupKey}`

  function show(index: number, event: SyntheticEvent<SVGGElement>): void {
    const ring = event.currentTarget.querySelector('.qring')
    const plot = plotRef.current
    if (!ring || !plot) return
    const b = ring.getBoundingClientRect()
    const pb = plot.getBoundingClientRect()
    setHover({ index, x: b.left - pb.left + b.width / 2, y: b.top - pb.top + b.height / 2 })
  }

  // Placed after render because the side it opens on depends on its own measured width.
  useLayoutEffect(() => {
    const tip = tipRef.current
    const plot = plotRef.current
    if (!hover || !tip || !plot) return
    const pw = plot.clientWidth
    const ph = plot.clientHeight
    const tw = tip.offsetWidth
    const th = tip.offsetHeight
    const left = hover.x + 22 + tw > pw ? hover.x - tw - 22 : hover.x + 22
    tip.style.left = `${Math.max(0, Math.min(pw - tw, left))}px`
    tip.style.top = `${Math.max(0, Math.min(ph - th, hover.y - th / 2))}px`
  }, [hover, horizon])

  const hovered = hover ? points[hover.index] : null
  const shifts = horizon === 'off' ? null : layout.shifts[horizon]

  function tipRow(label: string, now: number, prev: number | null | undefined): JSX.Element {
    let change = ''
    if (horizon !== 'off' && prev != null) {
      const d = pct(now) - pct(prev)
      change = `${HORIZON_LABEL[horizon]} ${pct(prev)} (${d > 0 ? '+' : ''}${d})`
    }
    return (
      <div className="r">
        <span className="n">{label}</span>
        <span className="v">{pct(now)}</span>
        <span className="x">{change}</span>
      </div>
    )
  }

  return (
    <div>
      <div className="sect">
        <h2>Macro vs. market: {groupLabel}</h2>
        <p>
          Macro Score (LEI Average) against Market Score (average percentile of price momentum, price breadth,
          earnings revisions and earnings breadth). Both 0–100; 50 = middle of the range.
        </p>
      </div>
      <div className="filters">
        <span className="qctl">Compare with</span>
        <div className="seg" role="group" aria-label="Compare with">
          {(['1M', '3M', 'off'] as const).map((h) => (
            <button key={h} type="button" aria-pressed={horizon === h} onClick={() => setHorizon(h)}>
              {h === 'off' ? 'Off' : HORIZON_LABEL[h]}
            </button>
          ))}
        </div>
        <div className="legend qkey" aria-hidden="true">
          <span>
            <b className="know" />
            Now
          </span>
          {horizon !== 'off' && (
            <span>
              <b className="kprev" />
              {HORIZON_LABEL[horizon]}
            </span>
          )}
        </div>
      </div>
      <article className="card panel qpanel">
        <div className="plot" ref={plotRef}>
          <svg
            viewBox={`0 0 ${QUAD_W} ${QUAD_H}`}
            role="img"
            aria-label={`Macro score versus market score, ${points.map((p) => p.name).join(', ')}. Hover a flag for values.`}
          >
            <defs>
              <clipPath id={clipId} clipPathUnits="objectBoundingBox">
                <circle cx=".5" cy=".5" r=".5" />
              </clipPath>
              <marker
                id={arrowId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0 1 L9 5 L0 9" className="qarrowhead" />
              </marker>
            </defs>
            {GRID_STEPS.map((v) => {
              const cls = v === 0.5 ? 'base' : 'gl'
              return (
                <g key={v}>
                  <line className={cls} x1={quadX(0)} x2={quadX(1)} y1={quadY(v)} y2={quadY(v)} />
                  <line className={cls} x1={quadX(v)} x2={quadX(v)} y1={quadY(0)} y2={quadY(1)} />
                  <text className="tk" x={quadX(0) - 10} y={quadY(v) + 4} textAnchor="end">
                    {v * 100}
                  </text>
                  <text className="tk" x={quadX(v)} y={quadY(0) + 18} textAnchor="middle">
                    {v * 100}
                  </text>
                </g>
              )
            })}
            <text className="qaxis" x={quadX(0.5)} y={QUAD_H - 6} textAnchor="middle">
              Market score →
            </text>
            <text className="qaxis" transform={`translate(14 ${quadY(0.5)}) rotate(-90)`} textAnchor="middle">
              Macro score →
            </text>
            {CORNERS.map((c) => (
              <text key={c.label} className="qlab" x={quadX(c.vx) + c.dx} y={quadY(c.vy) + c.dy} textAnchor={c.anchor}>
                {c.label}
              </text>
            ))}
            {shifts?.map(
              (s, i) =>
                s && (
                  <g key={points[i].name}>
                    {s.arrow && (
                      <line
                        className="qtrail"
                        x1={s.x0}
                        y1={s.y0}
                        x2={s.arrow.x}
                        y2={s.arrow.y}
                        markerEnd={`url(#${arrowId})`}
                      />
                    )}
                    <circle className="qprev" cx={s.x0} cy={s.y0} r="4" />
                  </g>
                ),
            )}
            {points.map((p, i) => {
              const [x, y] = layout.flags[i]
              const label = layout.labels[i]
              return (
                <g
                  key={p.name}
                  className="qpt"
                  tabIndex={0}
                  aria-label={`${p.name}: macro ${pct(p.macro)}, market ${pct(p.market)}`}
                  onPointerEnter={(e) => show(i, e)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={(e) => show(i, e)}
                  onBlur={() => setHover(null)}
                >
                  <circle className="qhit" cx={x} cy={y} r={FLAG_R + 8} />
                  <circle className="qring" cx={x} cy={y} r={FLAG_R + 2} />
                  <image
                    href={`/flags/${p.flag}.svg`}
                    x={x - FLAG_R}
                    y={y - FLAG_R}
                    width={2 * FLAG_R}
                    height={2 * FLAG_R}
                    clipPath={`url(#${clipId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <circle className="qedge" cx={x} cy={y} r={FLAG_R} />
                  <text className="qname" x={label.x} y={label.y} textAnchor={label.anchor}>
                    {p.name}
                  </text>
                </g>
              )
            })}
          </svg>
          {hovered && (
            <div className="tip" ref={tipRef} aria-hidden="true">
              <div className="d">{hovered.name}</div>
              {tipRow('Macro', hovered.macro, hovered.prev[horizon]?.macro)}
              {tipRow('Market', hovered.market, hovered.prev[horizon]?.market)}
              <div className="sm">
                {Object.entries(hovered.pcts)
                  .map(([k, v]) => `${SHORT[k] ?? k} ${v == null ? 'n/a' : pct(v)}`)
                  .join(' · ')}
              </div>
            </div>
          )}
        </div>
      </article>
    </div>
  )
}
