import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX, ReactNode } from 'react'
import { Tooltip } from './Tooltip'

interface ExpandableChartProps {
  /** Dialog heading, dialog aria-label, and the pane name in the Expand button's aria-label. */
  title: string
  /** Optional inline heading. When given, it shares a row with the Expand button. */
  header?: ReactNode
  /** Put the expand button on its own row above the inline heading. */
  expandButtonAboveHeader?: boolean
  /** Rendered once inline (expanded = false) and again inside the open dialog (expanded = true). */
  children: (expanded: boolean) => ReactNode
}

export function ExpandableChart({ title, header, expandButtonAboveHeader = false, children }: ExpandableChartProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  function close(): void {
    setOpen(false)
    expandButtonRef.current?.focus()
  }

  const expandButton = (
    <button
      ref={expandButtonRef}
      type="button"
      aria-label={`Expand ${title}`}
      onClick={() => setOpen(true)}
      className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-btn)] text-sm text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
    >
      ⤢
    </button>
  )

  return (
    <div>
      {expandButtonAboveHeader && header !== undefined ? (
        <div className="mb-2">
          <div className="flex justify-end">{expandButton}</div>
          <div className="flex items-center justify-between gap-2">{header}</div>
        </div>
      ) : (
        <div className={header === undefined ? 'flex justify-end' : 'mb-2 flex flex-wrap items-center justify-between gap-2'}>
          {header}
          {expandButton}
        </div>
      )}
      {children(false)}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 bg-overlay flex items-center justify-center px-4 py-8 z-[100]"
            onClick={(event) => {
              if (event.target === event.currentTarget) close()
            }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              tabIndex={-1}
              className="w-[min(96vw,110rem)] max-h-[92vh] flex flex-col bg-brand-surface border border-brand-border rounded-[var(--radius-card)] shadow-xl"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border">
                <h2 className="text-[1.0625rem] font-semibold">{title}</h2>
                <Tooltip label="Close the larger view">
                  <button
                    type="button"
                    aria-label="Close larger view"
                    onClick={close}
                    className="w-[1.15rem] h-[1.15rem] flex items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
                  >
                    ×
                  </button>
                </Tooltip>
              </div>
              <div className="px-5 pt-4 pb-5 overflow-y-auto">{children(true)}</div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
