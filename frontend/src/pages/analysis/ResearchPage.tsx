import { useState } from 'react'
import type { JSX } from 'react'
import { Tooltip } from '../../components/Tooltip'
import { MemoSection } from './research/MemoSection'
import { OverviewSection } from './research/OverviewSection'
import { PortfolioSection } from './research/PortfolioSection'

type ResearchTab = 'overview' | 'portfolio' | 'memo'

const TABS: ReadonlyArray<readonly [ResearchTab, string, string]> = [
  ['overview', 'Overview', 'A 0–100 summary of how this portfolio is built, plus its latest decision memo'],
  [
    'portfolio',
    'Compare Optimizers',
    'Compare all eight optimizers on this portfolio, tested on a year they never saw',
  ],
  ['memo', 'Decision Memo', 'Record a go / no-go decision for this portfolio, with the evidence behind it'],
]

export function ResearchPage(): JSX.Element {
  const [tab, setTab] = useState<ResearchTab>('overview')
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
      {tab === 'overview' && <OverviewSection onOpenMemo={() => setTab('memo')} />}
      {tab === 'portfolio' && <PortfolioSection />}
      {tab === 'memo' && <MemoSection />}
    </div>
  )
}
