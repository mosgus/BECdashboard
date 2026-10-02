import { useState } from 'react'
import type { JSX } from 'react'
import { customLookbackDays, DEFAULT_LOOKBACK_FLOOR, LOOKBACK_OPTIONS } from '../lib/optimize'
import type { LookbackFloor } from '../lib/optimize'
import { Tooltip } from './Tooltip'
import { LookbackDialog } from './LookbackDialog'
export function LookbackPicker({
  lookbackDays,
  onChange,
  optionTooltip,
  customTooltip,
  floor = DEFAULT_LOOKBACK_FLOOR,
}: {
  lookbackDays: number
  onChange: (days: number) => void
  optionTooltip: (option: { label: string; days: number }) => string
  customTooltip: string
  floor?: LookbackFloor
}): JSX.Element {
  const [customDate, setCustomDate] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const button = (selected: boolean) =>
    `w-full py-2 text-xs font-medium rounded-[var(--radius-btn)] ${selected ? 'bg-btn-action text-btn-action-text' : 'border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'}`
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Lookback</label>
      <div className="grid grid-cols-4 gap-2">
        <Tooltip block label={customTooltip}>
          <button type="button" onClick={() => setOpen(true)} className={button(customDate !== null)}>
            {customDate ?? 'Custom'}
          </button>
        </Tooltip>
        {LOOKBACK_OPTIONS.map((option) => (
          <Tooltip block key={option.days} label={optionTooltip(option)}>
            <button
              type="button"
              onClick={() => {
                onChange(option.days)
                setCustomDate(null)
              }}
              className={button(customDate === null && lookbackDays === option.days)}
            >
              {option.label}
            </button>
          </Tooltip>
        ))}
      </div>
      {open && (
        <LookbackDialog
          initialDate={customDate}
          floor={floor}
          onCancel={() => setOpen(false)}
          onConfirm={(date) => {
            onChange(customLookbackDays(date, new Date()))
            setCustomDate(date)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
