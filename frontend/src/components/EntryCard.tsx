import type { JSX } from 'react'

interface EntryCardProps {
  title: string
  description: string
}

export function EntryCard({ title, description }: EntryCardProps): JSX.Element {
  return (
    <article className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-6 min-h-44 flex flex-col gap-2 cursor-default">
      <h2 className="text-[17px] font-semibold text-foreground">{title}</h2>
      <p className="text-sm leading-relaxed text-[var(--color-muted)] flex-1">{description}</p>
      <span className="self-start bg-brand-accent text-foreground text-[11px] font-medium px-2.5 py-1 rounded-full">
        Coming soon
      </span>
    </article>
  )
}
