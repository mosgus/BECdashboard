import { useState } from 'react'
import type { JSX } from 'react'
import { Link } from 'react-router-dom'
import type { UniverseEntry } from '../api/client'
import { formatPercent } from '../lib/format'
import { impliedPortfolioValue, positionPrice, weightFromShares } from '../lib/portfolio'
import type { Portfolio, Position } from '../lib/portfolio'
import { isHoldableType } from '../lib/tickerType'
import { Tooltip } from './Tooltip'

interface AddPositionFormProps {
  universe: UniverseEntry[]
  portfolio: Portfolio
  onAdd: (position: Position) => void
}

const FIELD = 'text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground'
const FIELD_READONLY = 'text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-border/40 text-[var(--color-muted)] cursor-not-allowed'

export function AddPositionForm({ universe, portfolio, onAdd }: AddPositionFormProps): JSX.Element {
  const [ticker, setTicker] = useState('')
  const [weight, setWeight] = useState('')
  const [shares, setShares] = useState('')

  const holdable = universe.filter((entry) => isHoldableType(entry.quote_type))

  if (holdable.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        No tickers available — add one to your <Link to="/universe" className="underline hover:text-foreground">Universe</Link> first.
      </p>
    )
  }

  const heldTickers = new Set(portfolio.positions.map((position) => position.ticker))
  const available = holdable.filter((entry) => !heldTickers.has(entry.ticker))

  if (available.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        Every <Link to="/universe" className="underline hover:text-foreground">Universe</Link> ticker is already held in this portfolio.
      </p>
    )
  }

  const byTicker = new Map(holdable.map((entry) => [entry.ticker, entry]))
  const impliedValue = impliedPortfolioValue(portfolio, byTicker)
  const weightNumber = Number(weight)
  const sharesNumber = Number(shares)
  const sharesValid = shares.trim() === '' || (Number.isFinite(sharesNumber) && sharesNumber > 0)
  const selectedPrice = positionPrice(byTicker.get(ticker))
  const hasUsableSelectedPrice = selectedPrice !== null && Number.isFinite(selectedPrice) && selectedPrice > 0
  const derivedWeight = weight.trim() === '' && shares.trim() !== '' && impliedValue !== null && hasUsableSelectedPrice
    ? weightFromShares(sharesNumber, selectedPrice, impliedValue)
    : null
  const effectiveWeight = weight.trim() === '' ? derivedWeight : weightNumber
  const showingDerivedWeight = weight.trim() === '' && shares.trim() !== ''
  const disabled =
    ticker === '' ||
    !available.some((entry) => entry.ticker === ticker) ||
    !(effectiveWeight !== null && Number.isFinite(effectiveWeight) && effectiveWeight > 0 && effectiveWeight < 100) ||
    !sharesValid

  function handleAdd(): void {
    if (disabled) return
    if (effectiveWeight === null) return
    const position: Position = { ticker, weight: effectiveWeight }
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
          className={`${FIELD} w-24 no-spinners`}
        />
      </Tooltip>
      <Tooltip label="Number of shares to add — sets this position's weight when the weight field is empty">
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
      {showingDerivedWeight && (
        <Tooltip label="Weight derived from the share count and current prices">
          <input
            type="text"
            readOnly
            aria-label="Derived weight"
            value={formatPercent(derivedWeight)}
            className={`${FIELD_READONLY} w-24`}
          />
        </Tooltip>
      )}
      <Tooltip label="Add this allocation, scaling existing positions if there is not enough cash">
        <button
          type="button"
          disabled={disabled}
          onClick={handleAdd}
          className={`text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text whitespace-nowrap hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${disabled ? 'pointer-events-none' : ''}`}
        >
          Add
        </button>
      </Tooltip>
      {showingDerivedWeight && impliedValue === null && (
        <p className="basis-full text-xs text-[var(--color-muted)]">
          Add by shares needs a share count and a price on every existing position.
        </p>
      )}
      {showingDerivedWeight && impliedValue !== null && !hasUsableSelectedPrice && (
        <p className="basis-full text-xs text-[var(--color-muted)]">
          Add by shares needs a usable current price for the selected ticker.
        </p>
      )}
      {effectiveWeight !== null && Number.isFinite(effectiveWeight) && effectiveWeight > portfolio.cashWeight && (
        <p className="basis-full text-xs text-[var(--color-muted)]">
          Funding {formatPercent(effectiveWeight)} will scale existing positions to make room.
        </p>
      )}
    </div>
  )
}
