import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { GLOSSARY } from '../lib/indicators'

function HelpIcon(): JSX.Element {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.9.75c0 1.75-2.4 2.25-2.4 3.75" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </svg>
  )
}

export default function HelpSidebar(): JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  function handleClose(): void {
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return

    panelRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      triggerRef.current?.focus()
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-btn)] border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
      >
        <HelpIcon />
        Help
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-overlay z-[100] flex justify-end"
          onClick={(event) => {
            if (event.target === event.currentTarget) handleClose()
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Help & Glossary"
            tabIndex={-1}
            className="relative h-full w-80 flex flex-col overflow-y-auto bg-brand-surface border-l border-brand-border shadow-xl"
          >
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-brand-border">
              <h2 className="text-sm font-semibold">Help &amp; Glossary</h2>
              <button
                type="button"
                onClick={handleClose}
                className="text-lg leading-none text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground px-1.5 py-1 rounded-[var(--radius-btn)]"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-4 p-4">
              {GLOSSARY.map((entry) => (
                <div key={entry.term}>
                  <p className="text-xs font-semibold">{entry.term}</p>
                  <p className="mt-1 text-xs text-[var(--color-muted)] leading-relaxed">{entry.definition}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
