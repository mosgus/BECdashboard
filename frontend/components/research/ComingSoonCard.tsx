"use client";

interface ComingSoonCardProps {
  title: string;
  description: string;
  features: string[];
}

export default function ComingSoonCard({ title, description, features }: ComingSoonCardProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
      <div className="mx-auto max-w-md space-y-4">
        <span className="inline-block rounded-full bg-[var(--color-border)] px-3 py-1 text-xs font-semibold text-[var(--color-muted)]">
          Phase 2
        </span>
        <h2 className="text-lg font-bold text-[var(--color-text)]">{title}</h2>
        <p className="text-sm text-[var(--color-muted)]">{description}</p>
        <div className="space-y-1.5 text-left">
          <p className="text-xs font-semibold text-[var(--color-text)]">Planned features:</p>
          {features.map((f) => (
            <p key={f} className="text-xs text-[var(--color-muted)]">
              &bull; {f}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
