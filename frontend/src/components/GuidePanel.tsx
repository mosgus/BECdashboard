import { useEffect, useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import { Tooltip } from './Tooltip'

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

export function GuidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): JSX.Element {
  const triggerRef = useRef<Element | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    triggerRef.current = document.activeElement
    panelRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="fixed inset-0 bg-overlay z-[100] flex justify-end"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative h-full w-96 flex flex-col overflow-y-auto bg-brand-surface border-l border-brand-border shadow-xl"
      >
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-brand-border">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Tooltip label="Close the guide">
            <button
              type="button"
              onClick={onClose}
              className="text-lg leading-none text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground px-1.5 py-1 rounded-[var(--radius-btn)]"
            >
              ×
            </button>
          </Tooltip>
        </div>
        <div className="flex flex-col gap-4 p-4">{children}</div>
      </div>
    </div>
  )
}

export function HelpButton({ tooltip, onClick }: { tooltip: string; onClick: () => void }): JSX.Element {
  return (
    <Tooltip label={tooltip}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-btn)] border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
      >
        <HelpIcon />
        Help
      </button>
    </Tooltip>
  )
}
