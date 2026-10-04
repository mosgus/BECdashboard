import { useEffect, useState } from 'react'
import type { ChangeEvent, JSX } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getPresets, type Preset, type PresetInput, type UniverseEntry } from '../api/client'
import { formatPercent } from '../lib/format'
import { buildDraftPortfolio, summariseDraft, switchEntryMode } from '../lib/portfolio'
import type { DraftRow, EntryMode, ModeSwitch, Portfolio } from '../lib/portfolio'
import { parsePortfolioCsv, portfolioNameFromFilename as nameFromFilename, serializePortfolioCsv } from '../lib/portfolioCsv'
import type { DraftSeed, DroppedRow, TargetAdjustment } from '../lib/portfolioCsv'
import { isHoldableType } from '../lib/tickerType'
import { Tooltip } from './Tooltip'

interface NewPortfolioDialogProps {
  universe: UniverseEntry[]
  onCancel: () => void
  onCreate?: (portfolio: Portfolio) => void
  presetEdit?: {
    initial: Preset | null
    onSave: (input: PresetInput) => Promise<void>
    onDelete: (() => Promise<void>) | null
  }
}

const FIELD = 'text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground'
const FIELD_READONLY = 'text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-border/40 text-[var(--color-muted)] cursor-not-allowed'

function emptyRow(): DraftRow {
  return { id: crypto.randomUUID(), ticker: '', shares: '', weight: '' }
}

export function NewPortfolioDialog({ universe, onCancel, onCreate, presetEdit }: NewPortfolioDialogProps): JSX.Element {
  const [initialLoad] = useState(() =>
    presetEdit?.initial
      ? parsePortfolioCsv(presetEdit.initial.csv, new Set(universe.filter((entry) => isHoldableType(entry.quote_type)).map((entry) => entry.ticker)))
      : null,
  )
  const [name, setName] = useState(() => initialLoad?.ok ? presetEdit!.initial!.name : '')
  const [description, setDescription] = useState(() => presetEdit?.initial?.description ?? '')
  const [mode, setMode] = useState<EntryMode>(() => initialLoad?.ok ? initialLoad.seed.mode : 'weight')
  const [lastSwitch, setLastSwitch] = useState<ModeSwitch | null>(null)
  const [cashText, setCashText] = useState(() => initialLoad?.ok ? initialLoad.seed.cash : '')
  const [rows, setRows] = useState<DraftRow[]>(() => initialLoad?.ok ? initialLoad.seed.rows.map((row) => ({ ...row, id: crypto.randomUUID() })) : [])
  const [importError, setImportError] = useState<string | null>(() => initialLoad !== null && !initialLoad.ok ? `This preset could not be read: ${initialLoad.error}` : null)
  const [droppedRows, setDroppedRows] = useState<DroppedRow[]>(() => initialLoad?.ok ? initialLoad.dropped : [])
  const [adjustment, setAdjustment] = useState<TargetAdjustment | null>(() => initialLoad?.ok ? initialLoad.adjustment ?? null : null)
  const [zeroTargets, setZeroTargets] = useState<string[]>(() => initialLoad?.ok ? initialLoad.zeroTargets ?? [] : [])
  const [presets, setPresets] = useState<Preset[]>([])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  useEffect(() => {
    let cancelled = false
    getPresets()
      .then((response) => {
        if (!cancelled) setPresets(response.presets)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const holdable = universe.filter((entry) => isHoldableType(entry.quote_type))
  const byTicker = new Map(holdable.map((entry) => [entry.ticker, entry]))
  const summary = summariseDraft({ name, mode, cash: cashText, rows }, byTicker)
  const pristine = cashText === '' && rows.length === 0
  const tickerOnlyDrop = mode === 'weight' && droppedRows.every((row) => row.weightPct === null)
  const loadFailed = initialLoad !== null && !initialLoad.ok
  const blockedTickers = initialLoad?.ok ? initialLoad.dropped.map((row) => row.ticker) : []

  /** Apply a parsed CSV (or a future catalog selection) to the dialog's draft state. The only path
   *  by which a DraftSeed becomes an editable draft. */
  function applySeed(seed: DraftSeed): void {
    setLastSwitch(null)
    setName(seed.name)
    setMode(seed.mode)
    setCashText(seed.cash)
    setRows(seed.rows.map((row) => ({ ...row, id: crypto.randomUUID() })))
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.target
    const file = input.files?.[0]
    if (file === undefined) return

    try {
      const result = parsePortfolioCsv(await file.text(), new Set(holdable.map((entry) => entry.ticker)))
      setImportError(null)
      setDroppedRows([])
      setAdjustment(null)
      setZeroTargets([])
      if (!result.ok) {
        setImportError(`${result.error}${result.line === null ? '' : ` (line ${result.line})`}`)
        return
      }
      applySeed({ ...result.seed, name: result.seed.name || nameFromFilename(file.name) })
      setDroppedRows(result.dropped)
      setAdjustment(result.adjustment ?? null)
      setZeroTargets(result.zeroTargets ?? [])
    } catch {
      setImportError('Could not read the selected CSV file.')
      setDroppedRows([])
      setAdjustment(null)
      setZeroTargets([])
    } finally {
      input.value = ''
    }
  }

  function handlePresetSelection(event: ChangeEvent<HTMLSelectElement>): void {
    const preset = presets.find((candidate) => candidate.id === event.target.value)
    if (preset === undefined) return

    const result = parsePortfolioCsv(preset.csv, new Set(holdable.map((entry) => entry.ticker)))
    setImportError(null)
    setDroppedRows([])
    setAdjustment(null)
    setZeroTargets([])
    event.target.value = ''
    if (!result.ok) {
      setImportError(`Preset "${preset.name}" could not be loaded: ${result.error}`)
      return
    }
    applySeed({ ...result.seed, name: preset.name })
    setDroppedRows(result.dropped)
    setAdjustment(result.adjustment ?? null)
    setZeroTargets(result.zeroTargets ?? [])
  }

  function availableTickersFor(rowId: string): UniverseEntry[] {
    const chosenElsewhere = new Set(rows.filter((row) => row.id !== rowId && row.ticker !== '').map((row) => row.ticker))
    return holdable.filter((entry) => !chosenElsewhere.has(entry.ticker))
  }

  function handleModeChange(nextMode: EntryMode): void {
    if (nextMode === mode) return
    const result = switchEntryMode({ mode, cash: cashText, rows }, nextMode, summary, lastSwitch, byTicker)
    setCashText(result.fields.cash)
    setRows(result.fields.rows)
    setLastSwitch(result.lastSwitch)
    setMode(nextMode)
  }

  function addRow(): void {
    setRows((previous) => [...previous, emptyRow()])
  }

  function removeRow(id: string): void {
    setRows((previous) => previous.filter((row) => row.id !== id))
  }

  function updateRow(id: string, field: 'ticker' | 'shares' | 'weight', value: string): void {
    setRows((previous) =>
      previous.map((row) =>
        row.id === id
          ? field === 'ticker' && mode === 'weight'
            ? { ...row, ticker: value, shares: '' }
            : { ...row, [field]: value }
          : row,
      ),
    )
  }

  function handleCreate(): void {
    const portfolio = buildDraftPortfolio(name, mode, summary, byTicker, crypto.randomUUID(), new Date().toISOString())
    if (portfolio !== null) onCreate?.(portfolio)
  }

  async function handleSave(): Promise<void> {
    if (presetEdit === undefined) return
    const portfolio = buildDraftPortfolio(name, mode, summary, byTicker, presetEdit.initial?.id ?? 'new', new Date().toISOString())
    if (portfolio === null) return
    setBusy(true)
    setActionError(null)
    try {
      await presetEdit.onSave({ name: name.trim(), description: description.trim(), csv: serializePortfolioCsv(portfolio) })
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'Could not save the preset.')
      setBusy(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (presetEdit?.onDelete === null || presetEdit === undefined) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await presetEdit.onDelete()
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'Could not delete the preset.')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-overlay flex items-center justify-center px-4 z-[110]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-portfolio-heading"
        className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl p-5"
      >
        <h2 id="new-portfolio-heading" className="font-heading font-bold text-lg text-foreground mb-4">
          {presetEdit === undefined ? 'New portfolio' : presetEdit.initial === null ? 'New preset' : 'Edit preset'}
        </h2>

        <div className="flex flex-col gap-4">
          {pristine ? (
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip label="Fill this form from a CSV — you still review and create the portfolio yourself">
                <label className="text-sm font-medium px-3 py-1.5 rounded-[var(--radius-btn)] border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground cursor-pointer">
                  Import CSV
                  <input type="file" accept=".csv,text/csv" onChange={handleImport} className="sr-only" />
                </label>
              </Tooltip>
              {presets.length > 0 && (
                <Tooltip label="Fill this form from a saved allocation — you still review and create the portfolio yourself">
                  <select
                    defaultValue=""
                    onChange={handlePresetSelection}
                    className={`${FIELD} w-80 max-w-full`}
                    aria-label="Select a preset portfolio"
                  >
                    <option value="" disabled>Select a preset</option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.name} — {preset.description}</option>
                    ))}
                  </select>
                </Tooltip>
              )}
            </div>
          ) : presetEdit === undefined ? (
            <p className="text-xs text-[var(--color-muted)]">Reopen this dialog to import a CSV.</p>
          ) : null}

          {importError !== null && <p className="text-xs text-brand-negative">{importError}</p>}

          {droppedRows.length > 0 && (
            <div className="text-xs text-[var(--color-muted)]">
              <p>
                Skipped {droppedRows.length} {droppedRows.length === 1 ? 'ticker' : 'tickers'} not in your Universe or not holdable (e.g. an index):{' '}
                {droppedRows.map((row) => row.weightPct === null ? row.ticker : `${row.ticker} (${formatPercent(row.weightPct)})`).join(', ')}.
              </p>
              {tickerOnlyDrop ? (
                <p>The rest were equal-weighted.</p>
              ) : mode === 'weight' ? (
                <p>Their {formatPercent(droppedRows.reduce((sum, row) => sum + (row.weightPct ?? 0), 0))} was added to cash.</p>
              ) : null}
            </div>
          )}

          {zeroTargets.length > 0 && (
            <p className="text-xs text-[var(--color-muted)]">{`Left out ${zeroTargets.length} ${zeroTargets.length === 1 ? 'ticker' : 'tickers'} with a 0% target: ${zeroTargets.join(', ')}.`}</p>
          )}

          {adjustment !== null && (
            <p className="text-xs text-[var(--color-muted)]">Target weights in the file add up to {formatPercent(adjustment.fileTotalPct)} because the export rounds them. {adjustment.ticker} was reduced from {formatPercent(adjustment.fromPct)} to {formatPercent(adjustment.toPct)} so the portfolio totals 100%.</p>
          )}

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

          {presetEdit !== undefined && (
            <Tooltip label="One line shown beside the preset name">
              <input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Description (optional)"
                maxLength={200}
                className={`${FIELD} w-full`}
              />
            </Tooltip>
          )}

          {blockedTickers.length > 0 && (
            <p className="text-xs text-brand-negative">This preset holds tickers that are not in your Universe ({blockedTickers.join(', ')}). Add them to the Universe before editing, or delete the preset.</p>
          )}

          <div className="inline-flex self-start rounded-[var(--radius-btn)] border border-brand-border overflow-hidden">
            <Tooltip label="Enter each asset's allocation percentage; no portfolio dollar value is required.">
              <button
                type="button"
                aria-pressed={mode === 'weight'}
                onClick={() => handleModeChange('weight')}
                className={`px-4 py-2 text-sm font-medium ${mode === 'weight' ? 'bg-btn-selected/10 text-btn-selected-text font-semibold' : 'text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'}`}
              >
                By weight
              </button>
            </Tooltip>
            <Tooltip label="Enter shares held; last closing prices calculate the initial allocation once.">
              <button
                type="button"
                aria-pressed={mode === 'shares'}
                onClick={() => handleModeChange('shares')}
                className={`px-4 py-2 text-sm font-medium border-l border-brand-border ${mode === 'shares' ? 'bg-btn-selected/10 text-btn-selected-text font-semibold' : 'text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'}`}
              >
                By shares
              </button>
            </Tooltip>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--color-muted)] w-12">Cash</span>
            {mode === 'weight' ? (
              <Tooltip label="Share of this allocation kept in cash.">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="any"
                  value={cashText}
                  onChange={(event) => setCashText(event.target.value)}
                  placeholder="Cash %"
                  className={`${FIELD} w-24 no-spinners`}
                />
              </Tooltip>
            ) : (
              <Tooltip label="Cash used only to calculate this portfolio's initial allocation.">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={cashText}
                  onChange={(event) => setCashText(event.target.value)}
                  placeholder="Cash $"
                  className={`${FIELD} w-32 no-spinners`}
                />
              </Tooltip>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {rows.map((row) => {
              const summaryRow = summary.rows.find((candidate) => candidate.id === row.id)
              const available = availableTickersFor(row.id)
              return (
                <div key={row.id} className="flex flex-wrap items-center gap-2">
                  <Tooltip label="Type a ticker and choose a matching security from your Universe">
                    <div>
                      <input
                        type="text"
                        value={row.ticker}
                        onChange={(event) => updateRow(row.id, 'ticker', event.target.value.toUpperCase())}
                        placeholder="Ticker"
                        list={`portfolio-tickers-${row.id}`}
                        autoComplete="off"
                        className={`${FIELD} w-44`}
                      />
                      <datalist id={`portfolio-tickers-${row.id}`}>
                        {available.map((option) => (
                          <option key={option.ticker} value={option.ticker} label={option.short_name ?? option.ticker} />
                        ))}
                      </datalist>
                    </div>
                  </Tooltip>

                  {mode === 'weight' ? (
                    <Tooltip label="Percentage of the portfolio allocated to this security.">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={row.weight}
                        onChange={(event) => updateRow(row.id, 'weight', event.target.value)}
                        placeholder="Weight %"
                        className={`${FIELD} w-24 no-spinners`}
                      />
                    </Tooltip>
                  ) : (
                    <>
                      <Tooltip label="Number of shares held — fractions allowed">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={row.shares}
                          onChange={(event) => updateRow(row.id, 'shares', event.target.value)}
                          placeholder="Shares"
                          className={`${FIELD} w-28`}
                        />
                      </Tooltip>
                      <input
                        type="text"
                        readOnly
                        aria-label="Derived weight"
                        value={summaryRow?.weight !== null && summaryRow?.weight !== undefined ? formatPercent(summaryRow.weight) : '—'}
                        className={`${FIELD_READONLY} w-24`}
                      />
                    </>
                  )}

                  <Tooltip label="Remove this asset from the draft">
                    <button type="button" onClick={() => removeRow(row.id)} className="text-xs font-medium px-2 py-1 rounded-[var(--radius-btn)] text-[var(--color-muted)] hover:text-brand-negative hover:bg-brand-border">
                      Remove
                    </button>
                  </Tooltip>
                </div>
              )
            })}
          </div>

          {holdable.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              Add tickers to your <Link to="/universe" className="underline hover:text-foreground">Universe</Link> to add assets to this portfolio.
            </p>
          ) : (
            <Tooltip label="Add another asset to this portfolio">
              <button type="button" onClick={addRow} className="self-start text-sm font-medium px-3 py-1.5 rounded-[var(--radius-btn)] border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground">
                + Add asset
              </button>
            </Tooltip>
          )}

          {mode === 'weight' && rows.some((row) => row.ticker !== '' && row.shares.trim() !== '') && (
            <p className="text-sm text-[var(--color-muted)]">
              Share counts from the file are saved with these positions. Weights above are what the portfolio uses.
            </p>
          )}

          {mode === 'weight' && summary.remainderPercent !== null && (
            <p className="text-xs text-[var(--color-muted)]">
              {summary.remainderPercent > 0.01 ? `${formatPercent(summary.remainderPercent)} unallocated` : summary.remainderPercent < -0.01 ? `Over-allocated by ${formatPercent(Math.abs(summary.remainderPercent))}` : 'Fully allocated'}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-brand-border">
            <div className="flex items-center gap-3">
              {presetEdit !== undefined && presetEdit.onDelete !== null && (
                <button type="button" disabled={busy} onClick={handleDelete} className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-brand-negative hover:bg-brand-border hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed">
                  {confirmingDelete ? 'Confirm delete' : 'Delete'}
                </button>
              )}
              <p className="text-xs text-brand-negative">{actionError ?? summary.problem}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Tooltip label="Discard this portfolio without creating it">
                <button type="button" onClick={onCancel} className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground">
                  Cancel
                </button>
              </Tooltip>
              {presetEdit === undefined ? (
                <Tooltip label="Create this portfolio with the assets above">
                  <button type="button" disabled={!summary.canCreate} onClick={handleCreate} className={`text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${!summary.canCreate ? 'pointer-events-none' : ''}`}>
                    Create portfolio
                  </button>
                </Tooltip>
              ) : (
                <>
                  <button type="button" disabled={!summary.canCreate || loadFailed || blockedTickers.length > 0 || busy} onClick={handleSave} className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
                    Save
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
