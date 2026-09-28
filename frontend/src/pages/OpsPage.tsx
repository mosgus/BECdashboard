import { useState } from 'react'
import type { JSX } from 'react'
import { JobRunsCard } from '../components/JobRunsCard'
import { SystemHealthCard } from '../components/SystemHealthCard'
import { ThemeSelector } from '../components/ThemeSelector'

const CARD = 'bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-5'

export function OpsPage(): JSX.Element {
  const [jobRunsVersion, setJobRunsVersion] = useState(0)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <div className="mb-7">
          <h1 className="text-[1.875rem] font-bold tracking-tight text-brand-primary">Operations</h1>
          <p className="text-[0.9375rem] font-light text-[var(--color-muted)] mt-1.5">
            System health, job history and display preferences.
          </p>
        </div>

        {/* Operational facts first, preferences last — the two cards below own their own card
            chrome so they can render their own header rows (a title plus, on System Health, a
            Refresh button), which a shared CARD wrapper here would not allow. */}
        <div className="flex flex-col gap-6">
          <SystemHealthCard onSweepFinished={() => setJobRunsVersion((version) => version + 1)} />

          <div className={CARD}>
            <h2 className="text-[17px] font-semibold text-foreground mb-4">Theme</h2>
            <ThemeSelector />
          </div>

          <JobRunsCard key={jobRunsVersion} />
        </div>
      </main>
    </div>
  )
}
