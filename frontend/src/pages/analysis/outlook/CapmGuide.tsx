import type { JSX } from 'react'
import { GuidePanel } from '../../../components/GuidePanel'
import { CAPM_GUIDE } from '../../../lib/capmGuide'

export function CapmGuide({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <GuidePanel title="CAPM guide" onClose={onClose}>
      {CAPM_GUIDE.map((section) => (
        <section key={section.heading}>
          <h3 className="text-xs font-bold">{section.heading}</h3>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-1 text-xs text-[var(--color-muted)] leading-relaxed">
              {paragraph}
            </p>
          ))}
          {section.entries.length > 0 && (
            <dl className="mt-2 flex flex-col gap-2">
              {section.entries.map((entry) => (
                <div key={entry.term}>
                  <dt className="text-xs font-semibold">{entry.term}</dt>
                  <dd className="mt-0.5 text-xs text-[var(--color-muted)] leading-relaxed">
                    {entry.text}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </GuidePanel>
  )
}
