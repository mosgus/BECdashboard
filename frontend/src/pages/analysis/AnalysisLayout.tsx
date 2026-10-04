import type { JSX } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { isLegacyPortfolio, listPortfolios } from '../../lib/portfolioStore'

const ANALYSIS_TABS = [
  { path: 'holdings', label: 'Holdings' },
  { path: 'optimize', label: 'Historical Optimize' },
  { path: 'outlook', label: 'Forward Models' },
  { path: 'risk', label: 'Risk' },
] as const

export function AnalysisLayout(): JSX.Element {
  const { portfolioId } = useParams()
  const portfolio = listPortfolios().find((candidate) => candidate.id === portfolioId)

  if (portfolio === undefined || isLegacyPortfolio(portfolio)) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
          <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-16 text-center">
            <p className="text-sm text-[var(--color-muted)]">That portfolio could not be found in this browser.</p>
            <p className="text-sm text-[var(--color-muted)] mt-2">Portfolios are stored in the browser that created them.</p>
            <Link
              to="/portfolios"
              className="inline-block text-sm font-medium text-btn-selected-text hover:text-foreground mt-4"
            >
              ← Portfolios
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <Link
          to="/portfolios"
          className="text-sm text-[var(--color-muted)] hover:text-foreground"
        >
          ← Portfolios
        </Link>
        <h1 className="text-[1.875rem] font-bold tracking-tight text-brand-primary mt-1 mb-6">
          {portfolio.name}
        </h1>

        <nav className="flex flex-wrap gap-1 mb-6" aria-label="Portfolio analysis">
          {ANALYSIS_TABS.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={false}
              className={({ isActive }) => (
                `text-sm px-3 py-2 rounded-[var(--radius-btn)] ${
                  isActive
                    ? 'bg-btn-selected/10 text-btn-selected-text font-semibold'
                    : 'text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'
                }`
              )}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <Outlet />
      </main>
    </div>
  )
}
