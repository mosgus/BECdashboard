import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { getUniverse } from '../api/client'
import type { UniverseEntry } from '../api/client'
import { AddPositionForm } from '../components/AddPositionForm'
import { NewPortfolioDialog } from '../components/NewPortfolioDialog'
import { PositionsTable } from '../components/PositionsTable'
import { Tooltip } from '../components/Tooltip'
import { addPositionDiluting, cashFromPositions, migrateLegacyPortfolio, removePositionToCash, valuePortfolio } from '../lib/portfolio'
import type { Portfolio, Position, StoredPortfolio } from '../lib/portfolio'
import { downloadTextFile } from '../lib/download'
import { portfolioCsvFilename, serializePortfolioCsv } from '../lib/portfolioCsv'
import { deletePortfolio, isLegacyPortfolio, listPortfolios, replacePortfolios, savePortfolio } from '../lib/portfolioStore'

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-5'

type UniverseState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: UniverseEntry[] }

function isCurrentPortfolio(value: StoredPortfolio | null): value is Portfolio {
  return value !== null && !isLegacyPortfolio(value)
}

export function PortfoliosPage(): JSX.Element {
  const [portfolios, setPortfolios] = useState<StoredPortfolio[]>(() => listPortfolios())
  const [selectedId, setSelectedId] = useState<string | null>(() => listPortfolios()[0]?.id ?? null)
  const [universeState, setUniverseState] = useState<UniverseState>({ status: 'loading' })
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [cashText, setCashText] = useState('')
  const [cashProblem, setCashProblem] = useState<string | null>(null)

  useEffect(() => {
    getUniverse()
      .then((entries) => {
        const stored = listPortfolios()
        let changed = false
        const byTicker = new Map(entries.map((entry) => [entry.ticker, entry]))
        const migrated = stored.map((portfolio): StoredPortfolio => {
          if (!isLegacyPortfolio(portfolio)) return portfolio
          const next = migrateLegacyPortfolio(portfolio, byTicker)
          if (next === null) return portfolio
          changed = true
          return next
        })
        if (changed) replacePortfolios(migrated)
        setPortfolios(migrated)
        setUniverseState({ status: 'ready', entries })
      })
      .catch(() => setUniverseState({ status: 'error' }))
  }, [])

  useEffect(() => {
    if (selectedId !== null && portfolios.some((portfolio) => portfolio.id === selectedId)) return
    setSelectedId(portfolios[0]?.id ?? null)
  }, [portfolios, selectedId])

  const selected = portfolios.find((portfolio) => portfolio.id === selectedId) ?? null
  const current = isCurrentPortfolio(selected) ? selected : null
  const universeEntries = universeState.status === 'ready' ? universeState.entries : []
  const actualByTicker = new Map(universeEntries.map((entry) => [entry.ticker, entry]))
  const displayByTicker = universeState.status === 'ready'
    ? actualByTicker
    : new Map((current?.positions ?? []).map((position) => [position.ticker, {} as UniverseEntry]))
  const valued = current === null ? null : valuePortfolio(current, displayByTicker)

  useEffect(() => {
    setCashText(current === null ? '' : String(current.cashWeight))
    setCashProblem(null)
    // The editor owns its text between keystrokes; reseed only when the selected portfolio changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  function persist(next: Portfolio): void {
    savePortfolio(next)
    setPortfolios((previous) => {
      const index = previous.findIndex((portfolio) => portfolio.id === next.id)
      return index === -1 ? [...previous, next] : previous.map((portfolio, i) => (i === index ? next : portfolio))
    })
  }

  function handleCreatePortfolio(portfolio: Portfolio): void {
    persist(portfolio)
    setSelectedId(portfolio.id)
    setComposerOpen(false)
  }

  function handleRename(name: string): void {
    if (current === null) return
    persist({ ...current, name })
  }

  function handleCashTextChange(text: string): void {
    setCashText(text)
    if (current === null) return

    const parsed = text.trim() === '' ? null : Number(text)
    if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setCashProblem('Cash must be a percentage from 0 to 100.')
      return
    }

    if (current.positions.length === 0) {
      if (parsed !== 100) {
        setCashProblem('A portfolio with no assets must keep 100% in cash.')
        return
      }
      setCashProblem(null)
      persist({ ...current, cashWeight: 100, positions: [] })
      return
    }

    if (parsed >= 100) {
      setCashProblem('Keep some allocation in assets while this portfolio has positions.')
      return
    }

    const assetWeight = current.positions.reduce((sum, position) => sum + position.weight, 0)
    if (!(assetWeight > 0) || !Number.isFinite(assetWeight)) {
      setCashProblem('The saved asset weights cannot be rescaled.')
      return
    }

    const targetAssetWeight = 100 - parsed
    const positions = current.positions.map((position) => ({
      ...position,
      weight: (position.weight / assetWeight) * targetAssetWeight,
    }))
    const cashWeight = cashFromPositions(positions)
    if (cashWeight === null) {
      setCashProblem('The saved asset weights cannot be rescaled.')
      return
    }
    setCashProblem(null)
    persist({ ...current, cashWeight, positions })
  }

  function handleAddPosition(position: Position): void {
    if (current === null) return
    const next = addPositionDiluting(current, position)
    if (next !== null) persist(next)
  }

  function handleRemovePosition(ticker: string): void {
    if (current === null) return
    const next = removePositionToCash(current, ticker)
    if (next !== null) persist(next)
  }

  function handleDeletePortfolio(): void {
    if (selected === null) return
    deletePortfolio(selected.id)
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
              Kept in this browser only — add positions from your Universe and track their allocations.
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
            <p className="text-sm text-[var(--color-muted)]">No portfolios yet.</p>
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

            {selected && (
              <div className="flex-1 flex flex-col gap-4 min-w-0">
                {isLegacyPortfolio(selected) ? (
                  <div className={CARD}>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <h2 className="text-lg font-semibold text-foreground">{selected.name}</h2>
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
                    <p className="text-sm text-brand-negative leading-relaxed">
                      This legacy portfolio needs current prices for every holding before its allocations can be migrated. Its saved data has not been changed.
                    </p>
                  </div>
                ) : valued && current ? (
                  <>
                    <div className={CARD}>
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <Tooltip label="Rename this portfolio">
                          <input
                            type="text"
                            value={current.name}
                            onChange={(event) => handleRename(event.target.value)}
                            className="text-lg font-semibold bg-transparent border-b border-transparent hover:border-brand-border focus:border-brand-primary focus:outline-none text-foreground min-w-0"
                          />
                        </Tooltip>
                        <div className="flex items-center gap-2">
                          <Tooltip label="Download this portfolio as a CSV you can re-import on another device">
                            <button
                              type="button"
                              onClick={() => downloadTextFile(
                                portfolioCsvFilename(current, new Date()),
                                serializePortfolioCsv(current),
                                'text/csv;charset=utf-8',
                              )}
                              className="text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-btn)] border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground whitespace-nowrap"
                            >
                              Export CSV
                            </button>
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
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-4">
                        <span className="text-sm text-[var(--color-muted)]">Cash</span>
                        <Tooltip label="Share of this allocation kept in cash.">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="100"
                            step="any"
                            value={cashText}
                            onChange={(event) => handleCashTextChange(event.target.value)}
                            className="text-sm px-3 py-1.5 w-32 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground no-spinners"
                          />
                        </Tooltip>
                        <span className="text-sm text-[var(--color-muted)]">%</span>
                        {cashProblem && <span className="text-sm text-brand-negative">{cashProblem}</span>}
                      </div>

                      {universeState.status === 'ready' && (
                        <AddPositionForm
                          universe={universeState.entries}
                          portfolio={current}
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

                    {universeState.status === 'error' && (
                      <p className="text-sm text-brand-negative">
                        The Universe could not be reached. Saved allocations and share counts are still shown.
                      </p>
                    )}

                    <PositionsTable valued={valued} onRemove={handleRemovePosition} />
                  </>
                ) : null}
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
            <div role="dialog" aria-modal="true" aria-labelledby="delete-portfolio-heading" className={`${CARD} w-full max-w-sm shadow-xl`}>
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
