import type { JSX } from 'react'
import { GuidePanel } from '../../../components/GuidePanel'
import { FORECAST_GUIDE } from '../../../lib/forecastGuide'
export function ForecastGuide({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <GuidePanel title="Forecast guide" onClose={onClose}>
      {FORECAST_GUIDE.map((section) => (
        <section key={section.heading}>
          <h3 className="text-xs font-bold">{section.heading}</h3>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-1 text-xs text-[var(--color-muted)] leading-relaxed">
              {paragraph}
            </p>
          ))}
          {section.entries.map((entry) => (
            <div key={entry.term}>
              <dt className="text-xs font-semibold">{entry.term}</dt>
              <dd className="text-xs text-[var(--color-muted)]">{entry.text}</dd>
            </div>
          ))}
        </section>
      ))}
    </GuidePanel>
  )
}
