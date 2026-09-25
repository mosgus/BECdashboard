import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { NewsSection } from '../components/NewsSection'
import { getUniverse } from '../api/client'

export function LaunchPage(): JSX.Element {
  const [universeLoading, setUniverseLoading] = useState(true)

  useEffect(() => {
    getUniverse()
      .then(() => setUniverseLoading(false))
      .catch(() => setUniverseLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-16 pb-20">
        <section>
          <h1 className="text-[2.5rem] font-bold tracking-tight text-brand-primary leading-[1.1]">
            Blue Eagle Capital
          </h1>
          <p className="text-lg font-light text-(--color-muted) max-w-xl mt-3.5">
            Portfolio construction, optimization, and risk analytics.
          </p>
        </section>
        {universeLoading ? (
          <div className="mt-14 text-center text-sm text-[var(--color-muted)]">
            Loading data…
          </div>
        ) : (
          <NewsSection />
        )}
      </main>
    </div>
  )
}
