import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Tooltip } from './Tooltip'
import { applyTheme, readStoredPreference, resolveTheme, storePreference } from '../lib/theme'
import type { ThemePreference } from '../lib/theme'

const OPTIONS: { pref: ThemePreference; label: string; tooltip: string }[] = [
  { pref: 'light', label: 'Light', tooltip: 'Always light' },
  { pref: 'system', label: 'System', tooltip: 'Follow your system setting' },
  { pref: 'dark', label: 'Dark', tooltip: 'Always dark' },
]

function prefersDarkNow(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeSelector(): JSX.Element {
  const [preference, setPreference] = useState<ThemePreference>(readStoredPreference)

  // Keeps "System" following the OS live. Without this, resolveTheme only re-runs when a
  // button is pressed or the page reloads, so flipping macOS's appearance with the page
  // already open would do nothing until the next reload.
  useEffect(() => {
    if (preference !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    function handleChange(): void {
      applyTheme(resolveTheme('system', media.matches))
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [preference])

  function select(pref: ThemePreference): void {
    setPreference(pref)
    storePreference(pref)
    applyTheme(resolveTheme(pref, prefersDarkNow()))
  }

  return (
    <div className="inline-flex rounded-[var(--radius-btn)] border border-brand-border overflow-hidden">
      {OPTIONS.map(({ pref, label, tooltip }, index) => {
        const active = preference === pref
        return (
          <Tooltip key={pref} label={tooltip}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => select(pref)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                index > 0 ? 'border-l border-brand-border' : ''
              } ${
                active
                  ? 'bg-btn-selected/10 text-btn-selected-text font-semibold'
                  : 'text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'
              }`}
            >
              {label}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
