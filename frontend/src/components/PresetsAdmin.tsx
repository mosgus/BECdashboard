import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { createPreset, deletePreset, getPresets, getUniverse, updatePreset } from '../api/client'
import type { Preset, UniverseEntry } from '../api/client'
import { presetPreview } from '../lib/presetPreview'
import { NewPortfolioDialog } from './NewPortfolioDialog'
import { Tooltip } from './Tooltip'

const BUTTON =
  'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'
type LoadState<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: T }
type Editing = null | { kind: 'new' } | { kind: 'edit'; preset: Preset }

export function PresetsAdmin(): JSX.Element {
  const [presetsState, setPresetsState] = useState<LoadState<Preset[]>>({ kind: 'loading' })
  const [universeState, setUniverseState] = useState<LoadState<UniverseEntry[]>>({ kind: 'loading' })
  const [editing, setEditing] = useState<Editing>(null)

  useEffect(() => {
    let cancelled = false
    getPresets()
      .then((response) => {
        if (!cancelled) setPresetsState({ kind: 'ready', data: response.presets })
      })
      .catch(() => {
        if (!cancelled) setPresetsState({ kind: 'error' })
      })
    getUniverse()
      .then((response) => {
        if (!cancelled) setUniverseState({ kind: 'ready', data: response })
      })
      .catch(() => {
        if (!cancelled) setUniverseState({ kind: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  function reloadPresets(): void {
    getPresets()
      .then((response) => {
        setPresetsState({ kind: 'ready', data: response.presets })
      })
      .catch(() => {
        setPresetsState({ kind: 'error' })
      })
  }

  const universe = universeState.kind === 'ready' ? universeState.data : []
  const universeReady = universeState.kind === 'ready'

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Presets</h3>
        <Tooltip label="Make a new preset from scratch or from a CSV">
          <button
            type="button"
            disabled={!universeReady}
            onClick={() => setEditing({ kind: 'new' })}
            className={BUTTON}
          >
            Create preset
          </button>
        </Tooltip>
      </div>

      <div className="mt-3">
        {presetsState.kind === 'loading' && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}
        {presetsState.kind === 'error' && <p className="text-sm text-[var(--color-muted)]">Could not load presets.</p>}
        {presetsState.kind === 'ready' && presetsState.data.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">No presets yet.</p>
        )}
        {universeState.kind === 'error' && (
          <p className="text-sm text-[var(--color-muted)]">Could not load the Universe, so presets cannot be edited.</p>
        )}
        {presetsState.kind === 'ready' && presetsState.data.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {presetsState.data.map((preset) => {
              const preview = presetPreview(preset.csv)
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!universeReady}
                  onClick={() => setEditing({ kind: 'edit', preset })}
                  className="text-left border border-brand-border rounded-[var(--radius-card)] p-4 hover:bg-brand-border/40 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <p className="text-sm font-semibold text-foreground">{preset.name}</p>
                  {preset.description !== '' && (
                    <p className="text-xs text-[var(--color-muted)] mt-0.5">{preset.description}</p>
                  )}
                  {preview.ok ? (
                    <ul className="list-disc pl-5 mt-2 text-xs text-foreground">
                      {preview.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                      {preview.more > 0 && <li className="list-none">…</li>}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--color-muted)] mt-2">Unreadable CSV</p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {editing !== null && (
        <NewPortfolioDialog
          key={editing.kind === 'new' ? 'new' : editing.preset.id}
          universe={universe}
          onCancel={() => setEditing(null)}
          presetEdit={
            editing.kind === 'new'
              ? {
                  initial: null,
                  onSave: async (input) => {
                    await createPreset(input)
                    setEditing(null)
                    reloadPresets()
                  },
                  onDelete: null,
                }
              : {
                  initial: editing.preset,
                  onSave: async (input) => {
                    await updatePreset(editing.preset.id, input)
                    setEditing(null)
                    reloadPresets()
                  },
                  onDelete: async () => {
                    await deletePreset(editing.preset.id)
                    setEditing(null)
                    reloadPresets()
                  },
                }
          }
        />
      )}
    </section>
  )
}
