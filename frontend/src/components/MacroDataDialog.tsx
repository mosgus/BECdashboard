import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, JSX } from 'react'
import {
  ApiError,
  getMacroData,
  MacroUploadError,
  macroTemplateUrl,
  macroTemplatesZipUrl,
  revertMacroSlot,
  uploadMacroSlot,
} from '../api/client'
import type { MacroDataStatus, MacroSlot } from '../api/client'
import {
  buildStatusText,
  dataThroughText,
  formatBytes,
  formatDateTime,
  formatShortDate,
  gateText,
  revertText,
  signoffText,
} from '../lib/macroData'
import { DownloadIcon } from './DownloadIcon'
import { Tooltip } from './Tooltip'

interface MacroDataDialogProps {
  open: boolean
  onClose: () => void
  /** snapshot_built_at changed while the dialog was open. */
  onSnapshotChanged: () => void
}

const NAME_KEY = 'blue-eagle.macro-signoff-name'
const POLL_MS = 15_000
const SAVED_NOTICE_MS = 4000
const NAME_REQUIRED = 'Enter your name above first.'

const FIELD =
  'text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground'
const LINK_BUTTON =
  'inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'
const SMALL_BUTTON =
  'text-xs font-medium px-3 py-1.5 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed'

const GROUPS: { heading: string; includes: (slot: MacroSlot) => boolean }[] = [
  { heading: 'Earnings estimates · FactSet', includes: (slot) => slot.id === 'cy1' || slot.id === 'cy2' },
  { heading: 'Macro series · Bloomberg, S&P Global', includes: (slot) => slot.id === 'macro' || slot.id === 'pmis' },
  { heading: 'ETF holdings · FactSet', includes: (slot) => slot.id.startsWith('cons_') },
]

interface RowState {
  busy: 'upload' | 'revert' | null
  message: { kind: 'error' | 'saved'; text: string } | null
}

const IDLE: RowState = { busy: null, message: null }

function readSavedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name)
  } catch {
    // Storage can be unavailable (private mode); the name just isn't remembered.
  }
}

// lucide-react "upload" icon (ISC licensed), the counterpart of DownloadIcon. Kept here because only this dialog uses it.
function UploadIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function Spinner(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent opacity-70 motion-safe:animate-spin"
    />
  )
}

export function MacroDataDialog({ open, onClose, onSnapshotChanged }: MacroDataDialogProps): JSX.Element | null {
  if (!open) return null
  return <DialogBody onClose={onClose} onSnapshotChanged={onSnapshotChanged} />
}

// Mounted only while open, so every open starts fresh: a new fetch, a new poll, no stale row messages.
function DialogBody({ onClose, onSnapshotChanged }: Omit<MacroDataDialogProps, 'open'>): JSX.Element {
  const [data, setData] = useState<MacroDataStatus | null>(null)
  const [loadError, setLoadError] = useState<{ unavailable: boolean; message: string } | null>(null)
  const [name, setName] = useState(readSavedName)
  const [rows, setRows] = useState<Record<string, RowState>>({})

  const onSnapshotChangedRef = useRef(onSnapshotChanged)
  const seenBuiltAt = useRef<string | null | undefined>(undefined)
  const requestSeq = useRef(0)
  const appliedSeq = useRef(0)
  const mounted = useRef(true)
  const savedTimers = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    onSnapshotChangedRef.current = onSnapshotChanged
  }, [onSnapshotChanged])

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++requestSeq.current
    try {
      const next = await getMacroData()
      // A slower, older response must not overwrite a newer one.
      if (!mounted.current || seq < appliedSeq.current) return
      appliedSeq.current = seq
      setData(next)
      setLoadError(null)
      if (seenBuiltAt.current === undefined) {
        seenBuiltAt.current = next.snapshot_built_at
      } else if (seenBuiltAt.current !== next.snapshot_built_at) {
        seenBuiltAt.current = next.snapshot_built_at
        onSnapshotChangedRef.current()
      }
    } catch (err: unknown) {
      if (!mounted.current) return
      setLoadError({
        unavailable: err instanceof ApiError && err.status === 503,
        message: err instanceof Error ? err.message : 'Failed to load the upload status.',
      })
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    const timers = savedTimers.current
    // The first fetch runs from a timer, not in the effect body, so no state is set while the effect runs.
    const first = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => void refresh(), POLL_MS)
    return () => {
      mounted.current = false
      window.clearTimeout(first)
      window.clearInterval(interval)
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }
  }, [refresh])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function setRow(slotId: string, state: RowState): void {
    setRows((previous) => ({ ...previous, [slotId]: state }))
  }

  function showSaved(slotId: string): void {
    setRow(slotId, { busy: null, message: { kind: 'saved', text: 'Uploaded' } })
    const timers = savedTimers.current
    window.clearTimeout(timers.get(slotId))
    timers.set(
      slotId,
      window.setTimeout(() => {
        timers.delete(slotId)
        setRows((previous) => {
          const current = previous[slotId]
          return current?.message?.kind === 'saved' ? { ...previous, [slotId]: IDLE } : previous
        })
      }, SAVED_NOTICE_MS),
    )
  }

  function handleName(value: string): void {
    setName(value)
    saveName(value)
  }

  async function handleUpload(slot: MacroSlot, files: File[]): Promise<void> {
    const signer = name.trim()
    if (signer === '') return setRow(slot.id, { busy: null, message: { kind: 'error', text: NAME_REQUIRED } })
    if (files.length !== 1) return setRow(slot.id, { busy: null, message: { kind: 'error', text: 'Drop one file.' } })
    const file = files[0]
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      return setRow(slot.id, { busy: null, message: { kind: 'error', text: 'Choose an .xlsx file.' } })
    }
    setRow(slot.id, { busy: 'upload', message: null })
    try {
      await uploadMacroSlot(slot.id, file, signer)
    } catch (err: unknown) {
      if (!mounted.current) return
      let text = 'The upload failed.'
      if (err instanceof MacroUploadError) {
        text = err.unlocksAt !== null ? `Locked until ${formatDateTime(err.unlocksAt)}` : err.message
      } else if (err instanceof Error) {
        text = err.message
      }
      setRow(slot.id, { busy: null, message: { kind: 'error', text } })
      if (err instanceof MacroUploadError && err.status === 429) void refresh()
      return
    }
    if (!mounted.current) return
    showSaved(slot.id)
    await refresh()
  }

  async function handleRevert(slot: MacroSlot): Promise<void> {
    const signer = name.trim()
    if (signer === '') return setRow(slot.id, { busy: null, message: { kind: 'error', text: NAME_REQUIRED } })
    setRow(slot.id, { busy: 'revert', message: null })
    try {
      await revertMacroSlot(slot.id, signer)
    } catch (err: unknown) {
      if (!mounted.current) return
      const text = err instanceof Error ? err.message : 'The revert failed.'
      setRow(slot.id, { busy: null, message: { kind: 'error', text } })
      void refresh()
      return
    }
    if (!mounted.current) return
    setRow(slot.id, IDLE)
    await refresh()
  }

  const prices = data?.prices
  const pricesText =
    prices === undefined
      ? null
      : prices.tickers > 0 && prices.newest_fetched_at !== null
        ? `${prices.tickers} constituent prices, last fetched ${formatShortDate(prices.newest_fetched_at)}`
        : 'No constituent prices yet'

  return (
    // No onClick on the backdrop. A file dragged onto this dialog and released just outside it would
    // otherwise close it and discard the typed name and any row messages. Escape and × close it.
    // Drag events are swallowed here so a file dropped off target is not opened by the browser.
    <div
      className="fixed inset-0 bg-overlay flex items-center justify-center px-4 z-[110]"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="macro-data-heading"
        className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] w-full max-w-3xl max-h-[85vh] overflow-y-auto shadow-xl p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 id="macro-data-heading" className="font-heading font-bold text-lg text-foreground">
            Macro data
          </h2>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-xl leading-none px-2 py-0.5 rounded-[var(--radius-btn)] text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
            >
              ×
            </button>
          </Tooltip>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <p className="text-xs text-[var(--color-muted)] max-w-md">
            Templates with the real layout and made-up numbers. Fill them from your FactSet, Bloomberg and S&P Global
            exports.
          </p>
          <Tooltip label="Download templates for all 15 files: the real layout with made-up numbers">
            <a href={macroTemplatesZipUrl()} download className={LINK_BUTTON}>
              <DownloadIcon />
              <span>Sample data</span>
            </a>
          </Tooltip>
        </div>

        <div className="flex flex-col gap-1 mb-4">
          <label htmlFor="macro-signoff-name" className="text-sm text-[var(--color-muted)]">
            Your name
          </label>
          <Tooltip label="Your name is shown next to every upload and revert you make" block>
            <input
              id="macro-signoff-name"
              type="text"
              value={name}
              maxLength={60}
              onChange={(event) => handleName(event.target.value)}
              className={`${FIELD} w-full sm:w-72`}
            />
          </Tooltip>
        </div>

        {data === null && loadError === null && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}

        {data === null && loadError !== null && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-brand-negative">
              {loadError.unavailable ? 'Uploads are unavailable: the server has no database.' : loadError.message}
            </p>
            {!loadError.unavailable && (
              <Tooltip label="Try loading the upload status again">
                <button type="button" onClick={() => void refresh()} className={SMALL_BUTTON}>
                  Retry
                </button>
              </Tooltip>
            )}
          </div>
        )}

        {data !== null && (
          <>
            <div className="mb-4 text-sm">
              <p className={data.last_build?.status === 'failure' ? 'text-brand-negative' : 'text-foreground'}>
                {buildStatusText(data)}
              </p>
              {pricesText !== null && <p className="text-xs text-[var(--color-muted)] mt-0.5">{pricesText}</p>}
            </div>

            {GROUPS.map((group) => {
              const slots = data.slots.filter(group.includes)
              if (slots.length === 0) return null
              return (
                <section key={group.heading} className="mb-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-1">
                    {group.heading}
                  </h3>
                  <div className="flex flex-col divide-y divide-brand-border border-y border-brand-border">
                    {slots.map((slot) => (
                      <SlotRow
                        key={slot.id}
                        slot={slot}
                        state={rows[slot.id] ?? IDLE}
                        onFiles={(files) => void handleUpload(slot, files)}
                        onRevert={() => void handleRevert(slot)}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

interface SlotRowProps {
  slot: MacroSlot
  state: RowState
  onFiles: (files: File[]) => void
  onRevert: () => void
}

function SlotRow({ slot, state, onFiles, onRevert }: SlotRowProps): JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // The live version the first click was made against, so a change to the row cancels the confirmation.
  const [confirmingFor, setConfirmingFor] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const live = slot.versions.find((version) => version.live) ?? null
  const uploading = state.busy === 'upload'
  const locked = !slot.gate.allowed
  const disabled = uploading || locked
  const confirming = live !== null && confirmingFor === live.id
  const dataThrough = live === null ? null : dataThroughText(live.data_through)
  const inWindow = slot.gate.allowed && !slot.gate.opens_window

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setDragOver(false)
    if (disabled) return
    onFiles(Array.from(event.dataTransfer.files))
  }

  function handleRevertClick(): void {
    if (live === null) return
    if (!confirming) {
      setConfirmingFor(live.id)
      return
    }
    setConfirmingFor(null)
    onRevert()
  }

  const dropZone = (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={`Upload ${slot.label}`}
      onClick={() => {
        if (!disabled) input.current?.click()
      }}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          input.current?.click()
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`flex-1 flex items-center justify-center gap-2 text-center text-xs px-3 py-3 rounded-[var(--radius-btn)] border border-dashed ${
        disabled
          ? 'border-brand-border text-[var(--color-muted)] opacity-60 cursor-not-allowed'
          : dragOver
            ? 'border-brand-primary bg-brand-border text-foreground cursor-pointer'
            : 'border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground cursor-pointer'
      }`}
    >
      {!locked && <UploadIcon />}
      <span>{locked ? 'Locked' : 'Drop .xlsx here'}</span>
      <input
        ref={input}
        type="file"
        accept=".xlsx"
        tabIndex={-1}
        className="sr-only"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          onFiles(files)
        }}
      />
    </div>
  )

  const revertButton = (
    <button
      type="button"
      disabled={!slot.can_revert || state.busy !== null}
      onClick={handleRevertClick}
      onBlur={() => setConfirmingFor(null)}
      className={`${SMALL_BUTTON} ${confirming ? 'text-brand-negative' : ''}`}
    >
      {confirming ? 'Confirm revert' : 'Revert'}
    </button>
  )

  return (
    <div className="py-3">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-foreground">
            {slot.label} <span className="text-xs text-[var(--color-muted)]">{slot.source}</span>
          </p>
          {live === null ? (
            <p className="text-xs text-[var(--color-muted)]">Not uploaded yet</p>
          ) : (
            <p className="text-xs text-[var(--color-muted)]">
              {[signoffText(live), dataThrough, live.filename, formatBytes(live.size_bytes)]
                .filter((part) => part !== null)
                .join(' · ')}
            </p>
          )}
          <p className={`text-xs ${inWindow ? 'text-amber-600' : 'text-[var(--color-muted)]'}`}>
            {gateText(slot.gate)}
          </p>
        </div>

        <div className="flex items-center gap-2 md:w-80 flex-shrink-0">
          {locked ? (
            <Tooltip label="This file was updated recently. New uploads open again at the time shown" block>
              {dropZone}
            </Tooltip>
          ) : (
            <Tooltip label="Upload a new version of this file. The page rebuilds once all 15 files are in" block>
              {dropZone}
            </Tooltip>
          )}
          <Tooltip label="Download a template for this file only">
            <a
              href={macroTemplateUrl(slot.id)}
              download
              className="text-xs font-medium underline text-[var(--color-muted)] hover:text-foreground"
            >
              Template
            </a>
          </Tooltip>
        </div>
      </div>

      {uploading && (
        <p role="status" className="flex items-center gap-2 text-xs text-[var(--color-muted)] mt-2">
          <Spinner />
          Uploading… large workbooks take up to a minute
        </p>
      )}
      {state.message !== null && (
        <p
          role={state.message.kind === 'error' ? 'alert' : 'status'}
          className={`text-xs mt-2 ${state.message.kind === 'error' ? 'text-brand-negative' : 'text-[var(--color-muted)]'}`}
        >
          {state.message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-2">
        {confirming ? (
          <Tooltip label="Click again to put the previous version back">{revertButton}</Tooltip>
        ) : (
          <Tooltip label="Put the previous version back. You can do this at any time">{revertButton}</Tooltip>
        )}
        <Tooltip label="Show every stored version of this file">
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
            className={SMALL_BUTTON}
          >
            History ({slot.versions.length})
          </button>
        </Tooltip>
      </div>

      {historyOpen && (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-[var(--color-muted)]">
          {slot.versions.map((version) => (
            <li key={version.id}>
              {[signoffText(version), revertText(version), version.filename]
                .filter((part) => part !== null)
                .join(' · ')}
              {version.live && <span className="ml-2 font-semibold text-foreground">live</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
