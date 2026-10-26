import { useState } from 'react'
import type { JSX } from 'react'
import { Tooltip } from '../../components/Tooltip'
import { PortfolioSection } from './research/PortfolioSection'

const TABS: ReadonlyArray<readonly ['portfolio', string, string]> = [
  ['portfolio', 'Compare Optimizers', 'Compare all eight optimizers on this portfolio, tested on a year they never saw'],
]

export function ResearchPage(): JSX.Element {
  const [tab, setTab] = useState<'portfolio'>('portfolio')
  return (
    <div>
      <div role="tablist" aria-label="Research sections" className="flex gap-1 border-b border-brand-border mb-5">
        {TABS.map(([value, label, tooltip]) => (
          <Tooltip key={value} label={tooltip}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === value ? 'border-brand-primary text-brand-primary' : 'border-transparent text-[var(--color-muted)] hover:text-foreground'}`}
            >
              {label}
            </button>
          </Tooltip>
        ))}
      </div>
      {tab === 'portfolio' && <PortfolioSection />}
    </div>
  )
}
