import { useState } from 'react'
import type { JSX } from 'react'
import { Tooltip } from '../../components/Tooltip'
import { CapmSection } from './outlook/CapmSection'
import { MonteCarloSection } from './outlook/MonteCarloSection'
import { ForecastSection } from './outlook/ForecastSection'

const TABS = [
  ['capm', 'CAPM Allocation', 'Allocate using CAPM expected returns and your views'],
  ['montecarlo', 'Monte Carlo', 'Simulate many possible paths for this portfolio'],
  ['forecast', 'Forecast', 'Project this portfolio with volatility forecasting models'],
] as const

export function OutlookPage(): JSX.Element {
  const [tab, setTab] = useState<'capm' | 'montecarlo' | 'forecast'>('capm')

  return (
    <div>
      <div role="tablist" aria-label="Forward Models sections" className="flex gap-1 border-b border-brand-border mb-5">
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
      {tab === 'capm' ? <CapmSection /> : tab === 'montecarlo' ? <MonteCarloSection /> : <ForecastSection />}
    </div>
  )
}
