import type { JSX } from 'react'
import { NavLink } from 'react-router-dom'
import { SettingsIcon } from './SettingsIcon'

interface NavItemProps {
  label: string
  icon?: boolean
  title?: string
  to?: string
}

export function NavItem({ label, icon, title, to }: NavItemProps): JSX.Element {
  const padding = icon ? 'p-1.5' : 'px-0.5 py-1.5 sm:px-2 md:px-3'
  const size = icon ? '' : 'text-xs sm:text-sm'
  const base = `${size} font-medium rounded-[var(--radius-btn)] ${padding} transition-colors whitespace-nowrap hover:bg-brand-border hover:text-foreground`
  const content = icon ? <SettingsIcon /> : label

  if (to) {
    return (
      <NavLink
        to={to}
        title={title}
        className={({ isActive }) =>
          `${base} ${
            isActive ? 'text-brand-primary bg-brand-border font-semibold' : 'text-[var(--color-muted)]'
          }`
        }
      >
        {content}
      </NavLink>
    )
  }

  return (
    <span title={title} className={`${base} text-[var(--color-muted)] cursor-default`}>
      {content}
    </span>
  )
}
