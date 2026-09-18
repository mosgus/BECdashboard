import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Link } from 'react-router-dom'
import type { UniverseEntry } from '../api/client'
import { formatPercent, formatPrice, formatShares } from '../lib/format'
import { positionPrice, summariseDraft, toFieldText } from '../lib/portfolio'
import type { DraftRow, EntryMode, Portfolio, Position } from '../lib/portfolio'
import { Tooltip } from './Tooltip'

interface NewPortfolioDialogProps {
  universe: UniverseEntry[]
  onCancel: () => void
  onCreate: (portfolio: Portfolio) => void
}

const FIELD = 'text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground'
const FIELD_READONLY = 'text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-border/40 text-[var(--color-muted)] cursor-not-allowed'

function emptyRow(): DraftRow {
  return { id: crypto.randomUUID(), ticker: '', shares: '', weight: '' }
}

export function NewPortfolioDialog({ universe, onCancel, onCreate }: NewPortfolioDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<EntryMode>('shares')
  const [totalValueText, setTotalValueText] = useState('')
  const [cashText, setCashText] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])

  useEffect(() => {
    // Deliberately does not move focus to the container here (contract 0053, defect 1) —
    // React applies the name input's autoFocus during commit, but this effect runs after
    // paint; the two raced and the container always won, so typing on open did nothing. The
    // Escape listener lives on document and needs no focus inside the dialog, so it is
    // unaffected by the removal.
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  const byTicker = new Map(universe.map((entry) => [entry.ticker, entry]))
  const summary = summariseDraft({ name, mode, totalValue: totalValueText, cash: cashText, rows }, byTicker)

  function availableTickersFor(rowId: string): UniverseEntry[] {
    const chosenElsewhere = new Set(rows.filter((row) => row.id !== rowId && row.ticker !== '').map((row) => row.ticker))
    return universe.filter((entry) => !chosenElsewhere.has(entry.ticker))
  }

  function handleModeChange(nextMode: EntryMode): void {
    if (nextMode === mode || universe.length === 0) return

    if (nextMode === 'weight') {
      // Prefill from what shares mode has already computed. Anything that could not be
      // computed (no price, nothing typed) is left empty — never 0, never NaN. Every prefill
      // goes through toFieldText (contract 0053, defect 3) rather than the raw coercion that
      // used to write floats like "33.33333333333333" into these same fields.
      setTotalValueText(summary.totalValue > 0 ? toFieldText(summary.totalValue, 2) : '')
      setCashText(summary.cashWeight !== null ? toFieldText(summary.cashWeight, 2) : '')
      setRows((prev) =>
        prev.map((row) => {
          const derived = summary.rows.find((candidate) => candidate.id === row.id)
          return { ...row, weight: derived && derived.weight !== null ? toFieldText(derived.weight, 4) : '' }
        }),
      )
    } else {
      // totalValue's own fallback-to-0 inside summariseDraft is a computation convenience, not
      // a real value — check the typed text directly so an unset total doesn't write a
      // spurious "0" into the cash field it's about to become authoritative for.
      const totalWasValid = totalValueText.trim() !== '' && Number.isFinite(Number(totalValueText)) && Number(totalValueText) > 0
      setCashText(totalWasValid ? toFieldText(summary.cash, 2) : '')
      setRows((prev) =>
        prev.map((row) => {
          const derived = summary.rows.find((candidate) => candidate.id === row.id)
          return { ...row, shares: derived && derived.shares !== null ? toFieldText(derived.shares, 6) : '' }
        }),
      )
    }

    setMode(nextMode)
  }

  function addRow(): void {
    setRows((prev) => [...prev, emptyRow()])
  }

  function removeRow(id: string): void {
    setRows((prev) => prev.filter((row) => row.id !== id))
  }

  function updateRowTicker(id: string, ticker: string): void {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ticker } : row)))
  }

  function updateRowShares(id: string, shares: string): void {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, shares } : row)))
  }

  function updateRowWeight(id: string, weight: string): void {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, weight } : row)))
  }

  function handleCreate(): void {
    if (!summary.canCreate) return

    const positions: Position[] = summary.rows
      .filter((row) => row.ticker !== '' && row.shares !== null && row.shares > 0)
      .map((row) => ({ ticker: row.ticker, shares: row.shares as number }))

    onCreate({
      id: crypto.randomUUID(),
      name: name.trim(),
      cash: summary.cash,
      positions,
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <div
      className="fixed inset-0 bg-overlay flex items-center justify-center px-4 z-[110]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-portfolio-heading"
        tabIndex={-1}
        className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl p-5"
      >
        <h2 id="new-portfolio-heading" className="font-heading font-bold text-lg text-foreground mb-4">
          New portfolio
        </h2>

        <div className="flex flex-col gap-4">
          <Tooltip label="Name this portfolio">
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Portfolio name"
              className={`${FIELD} w-full`}
            />
          </Tooltip>

          {universe.length > 0 && (
            <div className="inline-flex self-start rounded-[var(--radius-btn)] border border-brand-border overflow-hidden">
              <Tooltip label="Enter how many shares you hold">
                <button
                  type="button"
                  aria-pressed={mode === 'shares'}
                  onClick={() => handleModeChange('shares')}
                  className={`px-4 py-2 text-sm font-medium ${
                    mode === 'shares'
                      ? 'bg-btn-selected/10 text-btn-selected-text font-semibold'
                      : 'text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'
                  }`}
                >
                  By shares
                </button>
              </Tooltip>
              <Tooltip label="Enter target weights against a total portfolio value">
                <button
                  type="button"
                  aria-pressed={mode === 'weight'}
                  onClick={() => handleModeChange('weight')}
                  className={`px-4 py-2 text-sm font-medium border-l border-brand-border ${
                    mode === 'weight'
                      ? 'bg-btn-selected/10 text-btn-selected-text font-semibold'
                      : 'text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'
                  }`}
                >
                  By weight
                </button>
              </Tooltip>
            </div>
          )}

          {mode === 'weight' && (
            <Tooltip label="The total this portfolio's weights are measured against">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={totalValueText}
                onChange={(event) => setTotalValueText(event.target.value)}
                placeholder="Total portfolio value"
                className={`${FIELD} w-full sm:w-64`}
              />
            </Tooltip>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--color-muted)] w-12">Cash</span>
            {mode === 'shares' ? (
              <>
                <Tooltip label="Uninvested cash, counted in the total and in weights">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={cashText}
                    onChange={(event) => setCashText(event.target.value)}
                    placeholder="Cash $"
                    className={`${FIELD} w-32`}
                  />
                </Tooltip>
                <span className="text-xs text-[var(--color-muted)]">{formatPercent(summary.cashWeight)} of total</span>
              </>
            ) : (
              <>
                <Tooltip label="Share of the portfolio held in cash">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={cashText}
                    onChange={(event) => setCashText(event.target.value)}
                    placeholder="Cash %"
                    className={`${FIELD} w-24`}
                  />
                </Tooltip>
                <span className="text-xs text-[var(--color-muted)]">{formatPrice(summary.cash)}</span>
              </>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {rows.map((row) => {
              const summaryRow = summary.rows.find((candidate) => candidate.id === row.id)
              const derivedShares = summaryRow?.shares ?? null
              const derivedWeight = summaryRow?.weight ?? null
              const available = availableTickersFor(row.id)

              return (
                <div key={row.id} className="flex flex-wrap items-center gap-2">
                  <Tooltip label="Choose a security from your Universe">
                    <select
                      value={row.ticker}
                      onChange={(event) => updateRowTicker(row.id, event.target.value)}
                      className={FIELD}
                    >
                      <option value="">Select a ticker…</option>
                      {available.map((option) => {
                        const optionPrice = positionPrice(option)
                        const disabledOption = mode === 'weight' && optionPrice === null
                        return (
                          <option key={option.ticker} value={option.ticker} disabled={disabledOption}>
                            {disabledOption
                              ? `${option.ticker} — no price available`
                              : `${option.ticker} — ${option.short_name ?? option.ticker}`}
                          </option>
                        )
                      })}
                    </select>
                  </Tooltip>

                  {mode === 'shares' ? (
                    <Tooltip label="Number of shares held — fractions allowed">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={row.shares}
                        onChange={(event) => updateRowShares(row.id, event.target.value)}
                        placeholder="Shares"
                        className={`${FIELD} w-28`}
                      />
                    </Tooltip>
                  ) : (
                    <input
                      type="text"
                      readOnly
                      aria-label="Derived shares"
                      value={derivedShares !== null ? formatShares(derivedShares) : '—'}
                      className={`${FIELD_READONLY} w-28`}
                    />
                  )}

                  {mode === 'weight' ? (
                    <Tooltip label="Target share of the portfolio">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={row.weight}
                        onChange={(event) => updateRowWeight(row.id, event.target.value)}
                        placeholder="Weight %"
                        className={`${FIELD} w-24`}
                      />
                    </Tooltip>
                  ) : (
                    <input
                      type="text"
                      readOnly
                      aria-label="Derived weight"
                      value={derivedWeight !== null ? formatPercent(derivedWeight) : '—'}
                      className={`${FIELD_READONLY} w-24`}
                    />
                  )}

                  <Tooltip label="Remove this asset from the draft">
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="text-xs font-medium px-2 py-1 rounded-[var(--radius-btn)] text-[var(--color-muted)] hover:text-brand-negative hover:bg-brand-border"
                    >
                      Remove
                    </button>
                  </Tooltip>
                </div>
              )
            })}
          </div>

          {universe.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              Add tickers to your{' '}
              <Link to="/universe" className="underline hover:text-foreground">
                Universe
              </Link>{' '}
              to add assets to this portfolio.
            </p>
          ) : (
            <Tooltip label="Add another asset to this portfolio">
              <button
                type="button"
                onClick={addRow}
                className="self-start text-sm font-medium px-3 py-1.5 rounded-[var(--radius-btn)] border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
              >
                + Add asset
              </button>
            </Tooltip>
          )}

          {mode === 'weight' && summary.remainderPercent !== null && (
            <p className="text-xs text-[var(--color-muted)]">
              {summary.remainderPercent > 0.01
                ? `${formatPercent(summary.remainderPercent)} unallocated`
                : summary.remainderPercent < -0.01
                  ? `Over-allocated by ${formatPercent(Math.abs(summary.remainderPercent))}`
                  : 'Fully allocated'}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-brand-border">
            <p className="text-xs text-brand-negative">{summary.problem}</p>
            <div className="flex gap-2 flex-shrink-0">
              <Tooltip label="Discard this portfolio without creating it">
                <button
                  type="button"
                  onClick={onCancel}
                  className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
                >
                  Cancel
                </button>
              </Tooltip>
              <Tooltip label="Create this portfolio with the assets above">
                <button
                  type="button"
                  disabled={!summary.canCreate}
                  onClick={handleCreate}
                  className={`text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${!summary.canCreate ? 'pointer-events-none' : ''}`}
                >
                  Create portfolio
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
