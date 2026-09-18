import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { EntryCard } from '../components/EntryCard'
import { NewsSection } from '../components/NewsSection'
import { getUniverse } from '../api/client'

const ENTRY_CARDS = [
  {
    title: 'Portfolio',
    description: 'Build a portfolio by entering positions manually or importing a CSV.',
  },
  {
    title: 'Optimize',
    description: 'Mean-variance, risk parity, and target-volatility allocation.',
  },
  {
    title: 'Risk',
    description: 'Volatility, drawdown, correlation, and exposure analysis.',
  },
  {
    title: 'Outlook',
    description: 'Forward-looking projections and scenario analysis.',
  },
]

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
            Loading universe…
          </div>
        ) : (
          <NewsSection />
        )}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-14">
          {ENTRY_CARDS.map((card) => (
            <EntryCard key={card.title} title={card.title} description={card.description} />
          ))}
        </section>
      </main>
    </div>
  )
}
