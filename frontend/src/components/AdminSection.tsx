import { useState } from 'react'
import type { JSX } from 'react'
import { readAdminUnlocked, storeAdminUnlocked } from '../lib/admin'
import { Tooltip } from './Tooltip'
import { AdminPasskeyDialog } from './AdminPasskeyDialog'

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-5'
const BUTTON =
  'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'

function LockIcon({ open = false }: { open?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.5">
      <rect x="3" y="7" width="10" height="7" rx="1" />
      {open ? <path d="M5 7V5a3 3 0 0 1 5.5-1.7" /> : <path d="M5 7V5a3 3 0 0 1 6 0v2" />}
    </svg>
  )
}

export function AdminSection(): JSX.Element {
  const [unlocked, setUnlocked] = useState(readAdminUnlocked)
  const [dialogOpen, setDialogOpen] = useState(false)

  function unlock(): void {
    storeAdminUnlocked(true)
    setUnlocked(true)
    setDialogOpen(false)
  }

  function lock(): void {
    storeAdminUnlocked(false)
    setUnlocked(false)
  }

  return (
    <div className={CARD}>
      <div className={`flex items-center justify-between gap-3${unlocked ? ' mb-4' : ''}`}>
        <h2 className="text-[17px] font-semibold text-foreground">Admin</h2>
        {unlocked ? (
          <Tooltip label="Hide admin tools until the passkey is entered again">
            <button type="button" onClick={lock} className={BUTTON}>
              <LockIcon open />
              Lock
            </button>
          </Tooltip>
        ) : (
          <Tooltip label="Enter the admin passkey to show admin tools">
            <button type="button" onClick={() => setDialogOpen(true)} className={BUTTON}>
              <LockIcon />
              Unlock admin
              <span aria-hidden="true" className="text-base leading-none">
                ›
              </span>
            </button>
          </Tooltip>
        )}
      </div>
      {unlocked && <p className="text-sm text-[var(--color-muted)]">No admin tools yet.</p>}
      {dialogOpen && <AdminPasskeyDialog onCancel={() => setDialogOpen(false)} onUnlock={unlock} />}
    </div>
  )
}
