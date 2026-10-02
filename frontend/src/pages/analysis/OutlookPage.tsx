import { useState } from 'react'
import type { JSX } from 'react'
import { Tooltip } from '../../components/Tooltip'
import { CapmSection } from './outlook/CapmSection'
import { MonteCarloSection } from './outlook/MonteCarloSection'

const TABS = [
  ['capm', 'CAPM Optimizer', 'Optimize weights on CAPM expected returns and your views'],
  ['montecarlo', 'Monte Carlo', 'Simulate many possible paths for this portfolio'],
  ['forecast', 'Forecast', 'Project this portfolio with statistical forecasting models (not built yet)'],
] as const

export function OutlookPage(): JSX.Element {
  const [tab, setTab] = useState<'capm' | 'montecarlo' | 'forecast'>('capm')
  const placeholder = tab === 'montecarlo' ? 'Monte Carlo' : 'Forecast'

  return (
    <div>
      <div role="tablist" aria-label="Outlook sections" className="flex gap-1 border-b border-brand-border mb-5">
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
      {tab === 'capm' ? <CapmSection /> : tab === 'montecarlo' ? <MonteCarloSection /> : (
        <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-16 text-center">
          <h2 className="text-lg font-semibold text-foreground mb-2">{placeholder}</h2>
          <p className="text-sm text-[var(--color-muted)]">{placeholder} — not built yet.</p>
        </div>
      )}
    </div>
  )
}
