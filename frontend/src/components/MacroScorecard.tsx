import type { JSX } from 'react'
import type { Scorecard } from '../api/client'

interface Props {
  scorecard: Scorecard
  /** The economic grid: wider label column, a "No data" legend chip, a rule above LEI Average. */
  econ?: boolean
}

/** One colored scorecard grid (equity or economic), as scorecard.py's render_html /
 * render_econ_html draw it. Hover a cell for its values and cut-offs (native title tooltip). */
export function MacroScorecard({ scorecard, econ = false }: Props): JSX.Element {
  const labelWidth = econ ? 170 : 120
  const columns = scorecard.headers.length
  const gridStyle = {
    gridTemplateColumns: `${labelWidth}px repeat(${columns}, minmax(96px, 1fr))`,
    minWidth: econ ? labelWidth + columns * 102 : 720,
  }

  return (
    <div className="sc">
      <div className="top">
        <h2>{scorecard.title}</h2>
        <div className="sub">{scorecard.subtitle}</div>
      </div>
      <div className="scroll">
        <div className={econ ? 'grid econ' : 'grid'} style={gridStyle}>
          <div />
          {scorecard.headers.map((header) => (
            <div key={header} className="hd">
              {header}
            </div>
          ))}
          {scorecard.rows.map((row) => [
            <div key={row.label} className={row.composite ? 'lb cp' : 'lb'}>
              {row.label}
            </div>,
            ...row.cells.map((cell, i) => {
              const composite = econ ? row.composite : i === 0
              return (
                <div key={`${row.label}-${i}`} className={`c ${cell.color}${composite ? ' cp' : ''}`} title={cell.tip}>
                  {cell.text}
                </div>
              )
            }),
          ])}
        </div>
      </div>
      <div className="lg">
        <b>Legend</b>
        <span className="g">Favorable</span>
        <span className="y">Neutral</span>
        <span className="r">Unfavorable</span>
        {econ && <span className="na">No data</span>}
      </div>
      <div className="foot">{scorecard.note}</div>
    </div>
  )
}
