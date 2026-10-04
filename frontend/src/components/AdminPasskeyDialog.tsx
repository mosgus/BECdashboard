import { useEffect, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import { isAdminPasskey } from '../lib/admin'

export function AdminPasskeyDialog({
  onCancel,
  onUnlock,
}: {
  onCancel: () => void
  onUnlock: () => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const [failed, setFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (isAdminPasskey(value)) {
      onUnlock()
      return
    }
    setFailed(true)
    setValue('')
    inputRef.current?.focus()
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
        aria-labelledby="admin-passkey-heading"
        className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] w-full max-w-sm shadow-xl p-5"
      >
        <h2 id="admin-passkey-heading" className="font-heading font-bold text-lg text-foreground mb-4">
          Admin access
        </h2>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <input
            ref={inputRef}
            type="password"
            autoFocus
            aria-label="Passkey"
            placeholder="Passkey"
            autoComplete="off"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setFailed(false)
            }}
            className="text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground"
          />
          {failed && <p className="text-xs text-brand-negative">Incorrect passkey.</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={value === ''}
              className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
