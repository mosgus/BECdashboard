import type { JSX } from 'react'
import { SettingsIcon } from './SettingsIcon'

interface NavItemProps {
  label: string
  icon?: boolean
  title?: string
}

export function NavItem({ label, icon, title }: NavItemProps): JSX.Element {
  const padding = icon ? 'p-1.5' : 'px-0.5 py-1.5 sm:px-2 md:px-3'
  const size = icon ? '' : 'text-xs sm:text-sm'

  return (
    <span
      title={title}
      className={`${size} font-medium text-[var(--color-muted)] rounded-[var(--radius-btn)] ${padding} hover:bg-brand-border hover:text-foreground transition-colors cursor-default whitespace-nowrap`}
    >
      {icon ? <SettingsIcon /> : label}
    </span>
  )
}
