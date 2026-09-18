import { useState } from 'react'
import type { JSX } from 'react'
import { Link } from 'react-router-dom'
import type { UniverseEntry } from '../api/client'
import type { Position } from '../lib/portfolio'
import { Tooltip } from './Tooltip'

interface AddPositionFormProps {
  universe: UniverseEntry[]
  existing: Position[]
  cashWeight: number
  onAdd: (position: Position) => void
}

const FIELD = 'text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground'

export function AddPositionForm({ universe, existing, cashWeight, onAdd }: AddPositionFormProps): JSX.Element {
  const [ticker, setTicker] = useState('')
  const [weight, setWeight] = useState('')
  const [shares, setShares] = useState('')

  if (universe.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        No tickers available — add one to your <Link to="/universe" className="underline hover:text-foreground">Universe</Link> first.
      </p>
    )
  }

  const heldTickers = new Set(existing.map((position) => position.ticker))
  const available = universe.filter((entry) => !heldTickers.has(entry.ticker))

  if (available.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        Every <Link to="/universe" className="underline hover:text-foreground">Universe</Link> ticker is already held in this portfolio.
      </p>
    )
  }

  const weightNumber = Number(weight)
  const sharesNumber = Number(shares)
  const sharesValid = shares.trim() === '' || (Number.isFinite(sharesNumber) && sharesNumber > 0)
  const disabled =
    ticker === '' ||
    weight.trim() === '' ||
    !Number.isFinite(weightNumber) ||
    weightNumber <= 0 ||
    weightNumber > cashWeight ||
    !sharesValid

  function handleAdd(): void {
    if (disabled) return
    const position: Position = { ticker, weight: weightNumber }
    if (shares.trim() !== '') position.shares = sharesNumber
    onAdd(position)
    setTicker('')
    setWeight('')
    setShares('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip label="Type a ticker and choose a matching security from your Universe">
        <div>
          <input
            type="text"
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            placeholder="Ticker"
            list="available-position-tickers"
            autoComplete="off"
            className={`${FIELD} w-44`}
          />
          <datalist id="available-position-tickers">
            {available.map((entry) => (
              <option key={entry.ticker} value={entry.ticker} label={entry.short_name ?? entry.ticker} />
            ))}
          </datalist>
        </div>
      </Tooltip>
      <Tooltip label="Percentage of the portfolio allocated to this security.">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          placeholder="Weight %"
          className={`${FIELD} w-24`}
        />
      </Tooltip>
      <Tooltip label="Optional share count for reference; it does not change the saved allocation.">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={shares}
          onChange={(event) => setShares(event.target.value)}
          placeholder="Shares"
          className={`${FIELD} w-28`}
        />
      </Tooltip>
      <Tooltip label="Add this allocation using available cash weight.">
        <button
          type="button"
          disabled={disabled}
          onClick={handleAdd}
          className={`text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text whitespace-nowrap hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${disabled ? 'pointer-events-none' : ''}`}
        >
          Add
        </button>
      </Tooltip>
    </div>
  )
}
