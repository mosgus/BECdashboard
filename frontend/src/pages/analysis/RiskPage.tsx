import { useState } from 'react'
import type { JSX } from 'react'
import { Tooltip } from '../../components/Tooltip'
import { RiskSection } from './risk/RiskSection'
import { StressSection } from './risk/StressSection'

const TABS = [
  ['breakdown', 'Breakdown', 'Volatility, beta and where the risk in this portfolio comes from'],
  ['stress', 'Stress test', "Replay a past market sell-off on today's holdings"],
] as const

export function RiskPage(): JSX.Element {
  const [tab, setTab] = useState<'breakdown' | 'stress'>('breakdown')
  return <div><div role="tablist" aria-label="Risk sections" className="flex gap-1 border-b border-brand-border mb-5">{TABS.map(([value, label, tooltip]) => <Tooltip key={value} label={tooltip}><button type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === value ? 'border-brand-primary text-brand-primary' : 'border-transparent text-[var(--color-muted)] hover:text-foreground'}`}>{label}</button></Tooltip>)}</div>{tab === 'breakdown' ? <RiskSection /> : <StressSection />}</div>
}
