import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { Tooltip } from './Tooltip'

interface ModeCopy {
  name: string
  tagline: string
  whenToUse: string
  caveat: string
}

// Copied verbatim from `git show main:frontend/components/OptimizerGuide.tsx`, except the
// Risk Parity caveat (0107) and the omission of the CAPM entry, which arrives in 0110.
const MODES: ModeCopy[] = [
  {
    name: 'Equal Weight (1/N)',
    tagline: 'Simplest baseline — equal allocation across all holdings.',
    whenToUse:
      'Use when you have no conviction on returns or risk estimates and want a transparent, naive starting point. Useful as a benchmark to beat with more sophisticated methods.',
    caveat: 'Ignores all return and risk information — will underweight diversifiers and overweight volatile assets equally.',
  },
  {
    name: 'Min Variance',
    tagline: 'Minimise portfolio volatility — no return assumption required.',
    whenToUse:
      'Best in uncertain or bearish markets where you want to reduce drawdowns. Relies only on the covariance matrix, so it is more robust when expected-return forecasts are unreliable.',
    caveat: 'Tends to concentrate in low-volatility assets and may sacrifice significant return potential.',
  },
  {
    name: 'Max Sharpe (Historical)',
    tagline: 'Best historical risk-adjusted return using past returns as the forecast.',
    whenToUse:
      'Use when you believe historical return patterns will persist. Balances return and risk explicitly, producing the portfolio on the efficient frontier with the highest Sharpe ratio.',
    caveat: 'Highly sensitive to mean-return estimates — small changes in recent history can flip weights dramatically.',
  },
  {
    name: 'Risk Parity',
    tagline: 'Equal risk contribution — each asset contributes the same amount of portfolio volatility.',
    whenToUse:
      'Use when you want diversification by risk rather than by dollar. Naturally overweights low-volatility assets. No return forecast needed — a pure risk-based approach.',
    caveat: 'Results in significant low-vol tilts and may underperform in trending bull markets; every holding gets a positive weight.',
  },
  {
    name: 'Max Sortino',
    tagline: 'Maximise return per unit of downside risk only.',
    whenToUse:
      'Best for portfolios where drawdown protection matters. Unlike Sharpe, Sortino penalises only negative returns, so it tolerates upside volatility while minimising downside vol.',
    caveat: 'Requires sufficient negative-return days in the lookback to estimate downside vol reliably; noisy with short histories.',
  },
  {
    name: 'Min CVaR (95%)',
    tagline: 'Minimise the expected loss in the worst 5% of trading days.',
    whenToUse:
      'Tail-risk focused: directly minimises Expected Shortfall (ES) rather than variance. Preferred by risk managers who care about extreme scenarios, not just average volatility.',
    caveat: 'CVaR estimates from short samples are noisy. Requires at least several hundred days of data for meaningful tail estimation.',
  },
  {
    name: 'Max Diversification',
    tagline: 'Maximise the diversification ratio — weighted-avg vol / portfolio vol.',
    whenToUse:
      'Use when your goal is to extract maximum benefit from low asset correlation. Naturally allocates more to assets that are weakly correlated with the rest of the portfolio.',
    caveat: 'Can produce concentrated positions in a single low-correlated asset. Does not account for expected returns.',
  },
  {
    name: 'Target Volatility',
    tagline: 'Maximise expected return within a hard annual volatility ceiling you set.',
    whenToUse:
      'Use when you have an explicit risk budget (e.g. a 10% vol mandate). Finds the highest-return portfolio that stays at or below your target vol — essentially a constrained Max Return.',
    caveat: 'If all portfolios exceed vol_target, the optimizer may not converge. Set vol_target above the minimum-variance portfolio’s vol.',
  },
]

export function OptimizerGuide({ onClose }: { onClose: () => void }): JSX.Element {
  const triggerRef = useRef<Element | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    triggerRef.current = document.activeElement
    panelRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="fixed inset-0 bg-overlay z-[100] flex justify-end"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Optimizer guide"
        tabIndex={-1}
        className="relative h-full w-96 flex flex-col overflow-y-auto bg-brand-surface border-l border-brand-border shadow-xl"
      >
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-brand-border">
          <h2 className="text-sm font-semibold">Optimizer guide</h2>
          <Tooltip label="Close the guide">
            <button
              type="button"
              onClick={onClose}
              className="text-lg leading-none text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground px-1.5 py-1 rounded-[var(--radius-btn)]"
            >
              ×
            </button>
          </Tooltip>
        </div>
        <div className="flex flex-col gap-4 p-4">
          {MODES.map((mode) => (
            <div key={mode.name}>
              <p className="text-xs font-bold">{mode.name}</p>
              <p className="mt-1 text-xs">{mode.tagline}</p>
              <p className="mt-1 text-xs text-[var(--color-muted)] leading-relaxed">{mode.whenToUse}</p>
              <p className="mt-1 text-xs text-[var(--color-muted)] italic">⚠ {mode.caveat}</p>
            </div>
          ))}
          <p className="text-xs text-[var(--color-muted)]">
            Every mode picks constant-mix weights: proportions assumed to be held every day. The curves then score
            those weights as bought and held, or rebalanced on the schedule you choose.
          </p>
        </div>
      </div>
    </div>
  )
}
