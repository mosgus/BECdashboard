import { useState } from 'react'
import type { JSX } from 'react'
import { Tooltip } from '../../components/Tooltip'
import { AttributionSection } from './risk/AttributionSection'
import { HealthSection } from './risk/HealthSection'
import { ScenariosSection } from './risk/ScenariosSection'
import { PerformanceSection } from './risk/PerformanceSection'

const TABS = [
  ['performance', 'Performance', 'Return, volatility, drawdown and alpha against SPY, plus exit signals'],
  ['health', 'Health', 'Volatility, beta and where the risk in this portfolio comes from'],
  ['scenarios', 'Scenarios', "Replay a past market sell-off on today's holdings"],
  [
    'attribution',
    'Attribution',
    'What drove the return: market, size and value exposure, alpha and T-bills (Fama-French 3)',
  ],
] as const

export function RiskPage(): JSX.Element {
  const [tab, setTab] = useState<'performance' | 'health' | 'scenarios' | 'attribution'>('performance')
  return (
    <div>
      <div role="tablist" aria-label="Risk sections" className="flex gap-1 border-b border-brand-border mb-5">
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
      {tab === 'performance' ? (
        <PerformanceSection />
      ) : tab === 'health' ? (
        <HealthSection />
      ) : tab === 'scenarios' ? (
        <ScenariosSection />
      ) : (
        <AttributionSection />
      )}
    </div>
  )
}
