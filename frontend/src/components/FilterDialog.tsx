import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { UniverseEntry } from '../api/client'
import type { FilterState } from '../lib/filters'
import { parseNumericInput, sectorOptions } from '../lib/filters'

interface FilterDialogProps {
  open: boolean
  rows: UniverseEntry[]
  filters: FilterState
  onChange: (next: FilterState) => void
  onClose: () => void
}

type NumericKey = 'price' | 'mcap' | 'pe' | 'yield'

interface NumericGroupSpec {
  key: NumericKey
  label: string
  hint?: string
}

const NUMERIC_GROUPS: NumericGroupSpec[] = [
  { key: 'price', label: 'Price' },
  {
    key: 'mcap',
    label: 'Market cap',
    hint: 'Accepts suffixes: 500M, 100B, 1T. Rows without a market cap are hidden while this is set.',
  },
  { key: 'pe', label: 'P/E' },
  { key: 'yield', label: 'Dividend yield %' },
]

const TYPE_OPTIONS = [
  { value: 'EQUITY', label: 'Equity' },
  { value: 'ETF', label: 'ETF' },
]

const CHIP_BASE = 'text-[0.8125rem] px-3 py-1.5 rounded-full border cursor-pointer select-none'
const CHIP_OFF = 'bg-brand-surface border-brand-border text-[var(--color-muted)]'
const CHIP_ON = 'bg-brand-primary border-brand-primary text-white'
const CLEAR_LINK = 'text-xs text-[var(--color-muted)] underline hover:text-brand-primary'
const GROUP = 'py-3.5 border-b border-brand-border last:border-b-0'
const GROUP_HEAD = 'flex items-center justify-between mb-2'
const GROUP_LABEL = 'text-xs font-semibold tracking-wide uppercase text-[var(--color-muted)]'
const RANGE_INPUT =
  'w-full text-[0.8125rem] px-2.5 py-1.5 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground'

function emptyRangeText(): Record<string, string> {
  return {
    priceMin: '',
    priceMax: '',
    mcapMin: '',
    mcapMax: '',
    peMin: '',
    peMax: '',
    yieldMin: '',
    yieldMax: '',
  }
}

function rangeTextFromFilters(filters: FilterState): Record<string, string> {
  return {
    priceMin: filters.price[0] === null ? '' : String(filters.price[0]),
    priceMax: filters.price[1] === null ? '' : String(filters.price[1]),
    mcapMin: filters.mcap[0] === null ? '' : String(filters.mcap[0]),
    mcapMax: filters.mcap[1] === null ? '' : String(filters.mcap[1]),
    peMin: filters.pe[0] === null ? '' : String(filters.pe[0]),
    peMax: filters.pe[1] === null ? '' : String(filters.pe[1]),
    yieldMin: filters.yield[0] === null ? '' : String(filters.yield[0]),
    yieldMax: filters.yield[1] === null ? '' : String(filters.yield[1]),
  }
}

export function FilterDialog({ open, rows, filters, onChange, onClose }: FilterDialogProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [rangeText, setRangeText] = useState<Record<string, string>>(emptyRangeText)

  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    setRangeText(rangeTextFromFilters(filters))

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // Re-seeding rangeText should only happen when the dialog transitions open, not on every
    // filters change — the inputs own their own text between keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleClose(): void {
    onClose()
    previousFocusRef.current?.focus()
  }

  if (!open) return null

  const sectors = sectorOptions(rows)

  function updateRange(key: NumericKey, index: 0 | 1, textKey: string, raw: string): void {
    setRangeText((prev) => ({ ...prev, [textKey]: raw }))
    const parsed = parseNumericInput(raw)
    const next: [number | null, number | null] = [...filters[key]] as [number | null, number | null]
    next[index] = parsed
    onChange({ ...filters, [key]: next })
  }

  function clearTypeOrSector(key: 'types' | 'sectors'): void {
    onChange({ ...filters, [key]: [] })
  }

  function clearRange(key: NumericKey): void {
    setRangeText((prev) => ({ ...prev, [`${key}Min`]: '', [`${key}Max`]: '' }))
    onChange({ ...filters, [key]: [null, null] })
  }

  function clearAllGroups(): void {
    setRangeText(emptyRangeText())
    onChange({
      ...filters,
      types: [],
      sectors: [],
      price: [null, null],
      mcap: [null, null],
      pe: [null, null],
      yield: [null, null],
    })
  }

  return (
    <div
      className="fixed inset-0 bg-foreground/35 flex items-start justify-center pt-16 px-4 z-[100]"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        tabIndex={-1}
        className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] w-full max-w-[34rem] max-h-[80vh] flex flex-col shadow-xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border">
          <h2 className="text-[1.0625rem] font-semibold">Filters</h2>
          <button
            type="button"
            onClick={handleClose}
            title="Close"
            className="w-[1.15rem] h-[1.15rem] flex items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
          >
            ×
          </button>
        </div>

        <div className="px-5 pt-2 pb-4 overflow-y-auto">
          <div className={GROUP}>
            <div className={GROUP_HEAD}>
              <span className={GROUP_LABEL}>Type</span>
              <button type="button" className={CLEAR_LINK} onClick={() => clearTypeOrSector('types')}>
                clear
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TYPE_OPTIONS.map((option) => {
                const isOn = filters.types.includes(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`${CHIP_BASE} ${isOn ? CHIP_ON : CHIP_OFF}`}
                    onClick={() =>
                      onChange({
                        ...filters,
                        types: isOn ? filters.types.filter((v) => v !== option.value) : [...filters.types, option.value],
                      })
                    }
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className={GROUP}>
            <div className={GROUP_HEAD}>
              <span className={GROUP_LABEL}>Sector</span>
              <button type="button" className={CLEAR_LINK} onClick={() => clearTypeOrSector('sectors')}>
                clear
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sectors.map((sector) => {
                const isOn = filters.sectors.includes(sector)
                return (
                  <button
                    key={sector ?? '__not_reported__'}
                    type="button"
                    className={`${CHIP_BASE} ${isOn ? CHIP_ON : CHIP_OFF}`}
                    onClick={() =>
                      onChange({
                        ...filters,
                        sectors: isOn ? filters.sectors.filter((v) => v !== sector) : [...filters.sectors, sector],
                      })
                    }
                  >
                    {sector === null ? <span className="italic opacity-70">Not reported</span> : sector}
                  </button>
                )
              })}
            </div>
          </div>

          {NUMERIC_GROUPS.map((group) => {
            const minKey = `${group.key}Min`
            const maxKey = `${group.key}Max`
            return (
              <div className={GROUP} key={group.key}>
                <div className={GROUP_HEAD}>
                  <span className={GROUP_LABEL}>{group.label}</span>
                  <button type="button" className={CLEAR_LINK} onClick={() => clearRange(group.key)}>
                    clear
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Min"
                    value={rangeText[minKey]}
                    onChange={(event) => updateRange(group.key, 0, minKey, event.target.value)}
                    className={RANGE_INPUT}
                  />
                  <span className="text-xs text-[var(--color-muted)]">to</span>
                  <input
                    type="text"
                    placeholder="Max"
                    value={rangeText[maxKey]}
                    onChange={(event) => updateRange(group.key, 1, maxKey, event.target.value)}
                    className={RANGE_INPUT}
                  />
                </div>
                {group.hint && <p className="text-[0.6875rem] text-[var(--color-muted)] mt-1.5">{group.hint}</p>}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-brand-border">
          <button
            type="button"
            onClick={clearAllGroups}
            className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-primary text-white hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
