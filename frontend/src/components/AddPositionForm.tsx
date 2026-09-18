import { useState } from 'react'
import type { JSX } from 'react'
import { Link } from 'react-router-dom'
import type { UniverseEntry } from '../api/client'
import type { Position } from '../lib/portfolio'
import { Tooltip } from './Tooltip'

interface AddPositionFormProps {
  universe: UniverseEntry[]
  existing: Position[]
  onAdd: (position: Position) => void
}

export function AddPositionForm({ universe, existing, onAdd }: AddPositionFormProps): JSX.Element {
  const [ticker, setTicker] = useState('')
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

  const sharesNumber = Number(shares)
  const disabled = ticker === '' || shares.trim() === '' || !Number.isFinite(sharesNumber) || sharesNumber <= 0

  function handleAdd(): void {
    if (disabled) return
    onAdd({ ticker, shares: sharesNumber })
    setTicker('')
    setShares('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip label="Choose a security from your Universe">
        <select
          value={ticker}
          onChange={(event) => setTicker(event.target.value)}
          className="text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground"
        >
          <option value="">Select a ticker…</option>
          {available.map((entry) => (
            <option key={entry.ticker} value={entry.ticker}>
              {entry.ticker} — {entry.short_name ?? entry.ticker}
            </option>
          ))}
        </select>
      </Tooltip>
      <Tooltip label="Number of shares held — fractions allowed">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={shares}
          onChange={(event) => setShares(event.target.value)}
          placeholder="Shares"
          className="text-sm px-3 py-2 w-28 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground placeholder:text-[var(--color-muted)]"
        />
      </Tooltip>
      <Tooltip label="Add this position to the portfolio">
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
