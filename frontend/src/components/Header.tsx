import type { JSX } from 'react'
import { Link } from 'react-router-dom'
import { BackendStatus } from './BackendStatus'
import { NavItem } from './NavItem'

export function Header(): JSX.Element {
  return (
    <header className="sticky top-0 z-50 h-14 bg-brand-surface/95 backdrop-blur-sm border-b border-brand-border">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between">
        <Link to="/" className="flex items-center gap-1 sm:gap-2.5 min-w-0 flex-shrink-0 hover:opacity-80 transition-opacity">
          <img src="/logo-nav.png" alt="Blue Eagle Capital" width={32} height={32} className="rounded-full" />
          <span className="font-bold tracking-tight text-brand-primary text-[0.9375rem] whitespace-nowrap">
            Blue Eagle Capital
          </span>
          <span className="hidden md:inline text-xs text-[var(--color-muted)] whitespace-nowrap">
            Portfolio Analytics
          </span>
        </Link>
        <div className="flex items-center flex-shrink-0">
          <nav className="flex items-center gap-0 sm:gap-1">
            <NavItem label="Universe" to="/universe" />
            <NavItem label="Portfolios" />
            <NavItem label="Research" />
            <NavItem label="Settings & Ops" icon title="Settings & Ops" />
          </nav>
          <BackendStatus />
        </div>
      </div>
    </header>
  )
}
