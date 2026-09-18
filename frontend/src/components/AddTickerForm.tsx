import { useState } from 'react'
import type { FormEvent, JSX } from 'react'
import { addTicker } from '../api/client'
import { Tooltip } from './Tooltip'

interface AddTickerFormProps {
  onAdded: () => void
}

export function AddTickerForm({ onAdded }: AddTickerFormProps): JSX.Element {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = value.trim()
  const disabled = trimmed.length === 0 || submitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (disabled) return

    setSubmitting(true)
    setError(null)
    try {
      await addTicker(trimmed)
      setValue('')
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add ticker')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-1.5 items-stretch sm:items-end">
      <div className="flex gap-2 items-center">
        <Tooltip label="Enter a ticker symbol, for example AAPL">
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={10}
            spellCheck={false}
            placeholder="Add ticker"
            className="uppercase tracking-wide text-sm px-3 py-2 w-full sm:w-36 border border-brand-border rounded-[var(--radius-btn)] bg-brand-surface text-foreground placeholder:normal-case placeholder:tracking-normal placeholder:text-[var(--color-muted)] focus:outline-2 focus:outline-brand-primary focus:-outline-offset-1"
          />
        </Tooltip>
        <Tooltip label="Fetch 10 years of price history and current fundamentals">
          <button
            type="submit"
            disabled={disabled}
            className={`text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-primary text-white dark:text-foreground whitespace-nowrap hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${disabled ? 'pointer-events-none' : ''}`}
          >
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </Tooltip>
      </div>
      {error && <p className="text-xs text-brand-negative">{error}</p>}
    </form>
  )
}
