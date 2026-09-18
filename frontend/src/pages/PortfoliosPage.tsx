import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { getUniverse } from '../api/client'
import type { UniverseEntry } from '../api/client'
import { AddPositionForm } from '../components/AddPositionForm'
import { NewPortfolioDialog } from '../components/NewPortfolioDialog'
import { PositionsTable } from '../components/PositionsTable'
import { Tooltip } from '../components/Tooltip'
import { valuePortfolio } from '../lib/portfolio'
import type { Portfolio, Position } from '../lib/portfolio'
import { deletePortfolio, listPortfolios, savePortfolio } from '../lib/portfolioStore'

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-5'

type UniverseState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: UniverseEntry[] }

export function PortfoliosPage(): JSX.Element {
  const [portfolios, setPortfolios] = useState<Portfolio[]>(() => listPortfolios())
  const [selectedId, setSelectedId] = useState<string | null>(() => listPortfolios()[0]?.id ?? null)
  const [universeState, setUniverseState] = useState<UniverseState>({ status: 'loading' })
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [cashText, setCashText] = useState('')

  useEffect(() => {
    getUniverse()
      .then((entries) => setUniverseState({ status: 'ready', entries }))
      .catch(() => setUniverseState({ status: 'error' }))
  }, [])

  const selected = portfolios.find((portfolio) => portfolio.id === selectedId) ?? null
  const universeEntries = universeState.status === 'ready' ? universeState.entries : []
  const byTicker = new Map(universeEntries.map((entry) => [entry.ticker, entry]))
  const valued = selected ? valuePortfolio(selected, byTicker) : null

  // Fix 2 (0049 audit): re-seeds only when the *selection* changes, not on every keystroke —
  // the input owns its own text between keystrokes the same way AddPositionForm's shares field
  // does, so an intermediate value like "1234." (which a controlled type="number" bound
  // directly to a number cannot hold — the DOM reports "" there) survives being typed.
  useEffect(() => {
    setCashText(selected !== null ? String(selected.cash) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  function persist(next: Portfolio): void {
    savePortfolio(next)
    setPortfolios((prev) => {
      const index = prev.findIndex((portfolio) => portfolio.id === next.id)
      // Fix 1 (0049 audit): replace in place, never append — persist() runs on every rename
      // keystroke and every cash edit, so appending walked whatever portfolio was being typed
      // in to the bottom of the sidebar list.
      return index === -1 ? [...prev, next] : prev.map((portfolio, i) => (i === index ? next : portfolio))
    })
  }

  function handleCreatePortfolio(portfolio: Portfolio): void {
    persist(portfolio)
    setSelectedId(portfolio.id)
    setComposerOpen(false)
  }

  function handleRename(name: string): void {
    if (selected === null) return
    persist({ ...selected, name })
  }

  function handleCashTextChange(text: string): void {
    setCashText(text)
    if (selected === null) return
    const parsed = text.trim() === '' ? null : Number(text)
    if (parsed !== null && Number.isFinite(parsed)) {
      persist({ ...selected, cash: parsed })
    }
  }

  function handleAddPosition(position: Position): void {
    if (selected === null) return
    persist({ ...selected, positions: [...selected.positions, position] })
  }

  function handleRemovePosition(ticker: string): void {
    if (selected === null) return
    persist({ ...selected, positions: selected.positions.filter((position) => position.ticker !== ticker) })
  }

  function handleDeletePortfolio(): void {
    if (selected === null) return
    deletePortfolio(selected.id)
    // Fix 3 (0049 audit): select a survivor when one exists — null only when none remain.
    // Unconditionally nulling left the sidebar listing the survivors while the right pane
    // rendered nothing and explained nothing.
    const remaining = portfolios.filter((portfolio) => portfolio.id !== selected.id)
    setPortfolios(remaining)
    setSelectedId(remaining[0]?.id ?? null)
    setConfirmDeleteOpen(false)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <div className="flex items-end justify-between gap-6 flex-wrap mb-7">
          <div>
            <h1 className="text-[1.875rem] font-bold tracking-tight text-brand-primary">Portfolios</h1>
            <p className="text-[0.9375rem] font-light text-[var(--color-muted)] mt-1.5">
              Kept in this browser only — add positions from your Universe and track their value.
            </p>
          </div>
          <Tooltip label="Create a portfolio">
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text whitespace-nowrap hover:opacity-90"
            >
              New portfolio
            </button>
          </Tooltip>
        </div>

        {portfolios.length === 0 && (
          <div className={`${CARD} p-16 text-center`}>
            <p className="text-sm text-[var(--color-muted)] mb-4">No portfolios yet.</p>
            <Tooltip label="Create a portfolio">
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text hover:opacity-90"
              >
                New portfolio
              </button>
            </Tooltip>
          </div>
        )}

        {portfolios.length > 0 && (
          <div className="flex flex-col lg:flex-row gap-6">
            <div className={`${CARD} lg:w-64 flex-shrink-0 h-fit`}>
              <h2 className="text-[17px] font-semibold text-foreground mb-3">Your portfolios</h2>
              <ul className="flex flex-col gap-1">
                {portfolios.map((portfolio) => (
                  <li key={portfolio.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(portfolio.id)}
                      className={`w-full text-left text-sm px-3 py-2 rounded-[var(--radius-btn)] truncate ${
                        portfolio.id === selectedId
                          ? 'bg-btn-selected/10 text-btn-selected-text font-semibold'
                          : 'text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'
                      }`}
                    >
                      {portfolio.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {selected && valued && (
              <div className="flex-1 flex flex-col gap-4 min-w-0">
                <div className={CARD}>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <Tooltip label="Rename this portfolio">
                      <input
                        type="text"
                        value={selected.name}
                        onChange={(event) => handleRename(event.target.value)}
                        className="text-lg font-semibold bg-transparent border-b border-transparent hover:border-brand-border focus:border-brand-primary focus:outline-none text-foreground min-w-0"
                      />
                    </Tooltip>
                    <Tooltip label="Permanently delete this portfolio — it is stored only in this browser">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteOpen(true)}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-btn)] border border-brand-border text-[var(--color-muted)] hover:bg-btn-danger hover:text-btn-danger-text whitespace-nowrap"
                      >
                        Delete portfolio
                      </button>
                    </Tooltip>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    <span className="text-sm text-[var(--color-muted)]">Cash</span>
                    <Tooltip label="Uninvested cash, counted in the total and in weights">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={cashText}
                        onChange={(event) => handleCashTextChange(event.target.value)}
                        className="text-sm px-3 py-1.5 w-32 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground"
                      />
                    </Tooltip>
                  </div>

                  {universeState.status === 'ready' && (
                    <AddPositionForm
                      universe={universeState.entries}
                      existing={selected.positions}
                      onAdd={handleAddPosition}
                    />
                  )}
                  {universeState.status === 'loading' && (
                    <p className="text-sm text-[var(--color-muted)]">Loading Universe…</p>
                  )}
                  {universeState.status === 'error' && (
                    <p className="text-sm text-[var(--color-muted)]">
                      Adding positions needs the Universe, which could not be reached.
                    </p>
                  )}
                </div>

                {/* Positions live in browser storage and need no network — this must not become
                    a blank page just because the Universe is unreachable. Only the priced
                    columns degrade: PositionsTable still renders every position and its share
                    count, with price/value/weight as "—" (pricingUnavailable below suppresses
                    the unrelated "no longer in Universe" styling, which means something
                    different — a permanent delete, not a fetch failure). */}
                {universeState.status === 'error' && (
                  <p className="text-sm text-brand-negative">
                    Prices are unavailable — the Universe could not be reached. Share counts are still accurate.
                  </p>
                )}

                <PositionsTable
                  valued={valued}
                  onRemove={handleRemovePosition}
                  pricingUnavailable={universeState.status !== 'ready'}
                />
              </div>
            )}
          </div>
        )}

        {confirmDeleteOpen && selected && (
          <div
            className="fixed inset-0 bg-overlay flex items-center justify-center px-4 z-[110]"
            onClick={(event) => {
              if (event.target === event.currentTarget) setConfirmDeleteOpen(false)
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-portfolio-heading"
              className={`${CARD} w-full max-w-sm shadow-xl`}
            >
              <h2 id="delete-portfolio-heading" className="font-heading font-bold text-lg text-foreground mb-2">
                Delete {selected.name}?
              </h2>
              <p className="text-sm text-[var(--color-muted)] leading-relaxed mb-4">
                Permanently delete <strong className="text-foreground">{selected.name}</strong>? It is stored
                only in this browser and cannot be recovered.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setConfirmDeleteOpen(false)}
                  className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeletePortfolio}
                  className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-danger text-btn-danger-text hover:opacity-90"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {composerOpen && (
          <NewPortfolioDialog
            universe={universeEntries}
            onCancel={() => setComposerOpen(false)}
            onCreate={handleCreatePortfolio}
          />
        )}
      </main>
    </div>
  )
}
