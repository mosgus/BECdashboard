import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { UniverseEntry } from '../api/client'
import { formatPercent, formatShares } from '../lib/format'
import { formatMoney } from '../lib/optimize'
import { positionPrice, sellPositionWeight, sellSliderMax, SELL_STEP } from '../lib/portfolio'
import type { Portfolio } from '../lib/portfolio'

interface SellPositionDialogProps {
  portfolio: Portfolio
  ticker: string
  byTicker: Map<string, UniverseEntry>
  onConfirm: (next: Portfolio) => void
  onCancel: () => void
}

export function SellPositionDialog({ portfolio, ticker, byTicker, onConfirm, onCancel }: SellPositionDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCancelRef = useRef(onCancel)
  const [full] = useState(() => sellPositionWeight(portfolio, ticker, Number.POSITIVE_INFINITY, byTicker))
  const max = full.ok ? sellSliderMax(full.holdingWeight) : SELL_STEP
  const [sellWeight, setSellWeight] = useState(max)
  const [holdingPercentText, setHoldingPercentText] = useState('100')
  const sale = sellPositionWeight(portfolio, ticker, sellWeight, byTicker)

  function handleClose(): void {
    onCancel()
    previousFocusRef.current?.focus()
  }

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onCancelRef.current()
        previousFocusRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const held = portfolio.positions.find((position) => position.ticker === ticker)
  const price = positionPrice(byTicker.get(ticker))

  function handleSliderChange(value: number): void {
    setSellWeight(value)
    if (full.ok) {
      const percent = Math.min(100, value / full.holdingWeight * 100)
      setHoldingPercentText(percent.toFixed(2))
    }
  }

  function handleHoldingPercentChange(raw: string): void {
    if (raw === '') {
      setHoldingPercentText(raw)
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    const percent = Math.min(100, Math.max(0.01, parsed))
    setHoldingPercentText(percent === parsed ? raw : String(percent))
    if (!full.ok) return
    if (percent === 100) {
      setSellWeight(max)
      return
    }
    const requestedWeight = full.holdingWeight * percent / 100
    const snappedWeight = Math.round(requestedWeight / SELL_STEP) * SELL_STEP
    const largestPartialStep = Math.floor((full.holdingWeight - 1e-9) / SELL_STEP) * SELL_STEP
    setSellWeight(Math.min(max, Math.max(SELL_STEP, Math.min(snappedWeight, largestPartialStep))))
  }

  return (
    <div
      className="fixed inset-0 bg-overlay flex items-center justify-center p-4 z-[100]"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Sell ${ticker}`}
        tabIndex={-1}
        className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] w-full max-w-[28rem] shadow-xl"
      >
        <div className="px-5 py-4">
          <h2 className="text-[1.0625rem] font-semibold">Sell {ticker}</h2>
          {!full.ok ? (
            <>
              <p className="text-sm text-[var(--color-muted)] mt-3">Closing prices are needed to sell {ticker}.</p>
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" onClick={handleClose} className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] border border-brand-border text-foreground hover:bg-brand-border">
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--color-muted)] mb-3 mt-3">
                {`${ticker} is ${formatPercent(full.holdingWeight)} of this portfolio: ${formatShares(held!.shares!)} shares at ${formatMoney(price!)}.`}
              </p>
              <div className="mb-3">
                <label htmlFor="holding-percent-to-sell" className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                  Percent of holding to sell
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="holding-percent-to-sell"
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={holdingPercentText}
                    onChange={(event) => handleHoldingPercentChange(event.target.value)}
                    className="w-24 text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground no-spinners"
                    aria-label="Percent of holding to sell"
                  />
                  <span className="text-sm text-[var(--color-muted)]">%</span>
                </div>
              </div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                {sale.ok && sale.soldAll
                  ? `Sell all (${formatPercent(full.holdingWeight)} of portfolio weight)`
                  : `Sell ${formatPercent(sellWeight)} of portfolio weight`}
              </label>
              <input
                type="range"
                min={SELL_STEP}
                max={max}
                step={SELL_STEP}
                value={sellWeight}
                onChange={(event) => handleSliderChange(Number(event.target.value))}
                className="w-full accent-[var(--color-primary)]"
                aria-label="Portfolio weight to sell"
              />
              <p className="text-sm mt-3">
                {!sale.ok
                  ? 'Prices changed while this was open; close and try again.'
                  : sale.soldAll
                    ? `Sells all ${formatShares(sale.sharesSold)} shares for ${formatMoney(sale.proceeds)}; ${ticker} leaves the portfolio.`
                    : `Sells ${formatShares(sale.sharesSold)} shares for ${formatMoney(sale.proceeds)}; ${formatPercent(full.holdingWeight - sellWeight)} of ${ticker} remains.`}
              </p>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] border border-brand-border text-foreground hover:bg-brand-border"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!sale.ok}
                  onClick={() => sale.ok && onConfirm(sale.portfolio)}
                  className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text whitespace-nowrap hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm sale
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
