import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { customLookbackError, MAX_LOOKBACK_DAYS, MIN_LOOKBACK_DAYS, presetLookbackDate } from '../lib/optimize'
import type { LookbackPreset } from '../lib/optimize'
import { Tooltip } from './Tooltip'

export function LookbackDialog({
  initialDate,
  onConfirm,
  onCancel,
}: {
  initialDate: string | null
  onConfirm: (date: string) => void
  onCancel: () => void
}): JSX.Element {
  const today = new Date()
  const [value, setValue] = useState(initialDate ?? presetLookbackDate('6M', today))
  const [activePreset, setActivePreset] = useState<LookbackPreset | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const priorRef = useRef<HTMLElement | null>(null)
  const onCancelRef = useRef(onCancel)
  const error = customLookbackError(value, today)
  useEffect(() => {
    priorRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancelRef.current()
        priorRef.current?.focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  const close = () => {
    onCancel()
    priorRef.current?.focus()
  }
  const max = (() => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - MIN_LOOKBACK_DAYS)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const oldest = (() => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - MAX_LOOKBACK_DAYS)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  return (
    <div
      className="fixed inset-0 bg-overlay flex items-center justify-center p-4 z-[100]"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-lookback-heading"
        tabIndex={-1}
        className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] w-full max-w-sm shadow-xl p-5"
      >
        <div className="flex justify-between">
          <h2 id="custom-lookback-heading" className="text-[1.0625rem] font-semibold">
            Custom lookback
          </h2>
          <Tooltip label="Close without changing the lookback">
            <button type="button" aria-label="Close" onClick={close} className="text-lg">
              ×
            </button>
          </Tooltip>
        </div>
        <label className="mt-4 block text-xs font-medium text-[var(--color-muted)]">
          Start date
          <input
            type="date"
            min={oldest}
            max={max}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setActivePreset(null)
            }}
            className="mt-1 w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 bg-brand-surface text-foreground"
          />
        </label>
        <div className="grid grid-cols-4 gap-2 mt-3">
          {([['1M', '1 Mo'], ['3M', '3 Mo'], ['6M', '6 Mo'], ['YTD', 'YTD']] as const).map(([preset, label]) => {
            const disabled = preset === 'YTD' && customLookbackError(presetLookbackDate(preset, today), today) !== null
            return (
              <button
                key={preset}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setValue(presetLookbackDate(preset, today))
                  setActivePreset(preset)
                }}
                className={`w-full px-3 py-2 text-sm font-medium border rounded-[var(--radius-btn)] disabled:opacity-50 ${activePreset === preset ? 'bg-btn-action text-btn-action-text border-btn-action' : 'border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'}`}
              >
                {label}
              </button>
            )
          })}
        </div>
        {error && <p className="text-xs text-brand-negative mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Tooltip label="Close without changing the lookback">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 text-sm border border-brand-border rounded-[var(--radius-btn)]"
            >
              Cancel
            </button>
          </Tooltip>
          <Tooltip label="Use this start date for the next run">
            <button
              type="button"
              disabled={error !== null}
              onClick={() => onConfirm(value)}
              className="px-4 py-2 text-sm rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text disabled:opacity-50"
            >
              Confirm
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
