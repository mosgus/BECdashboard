import { describe, expect, it } from 'vitest'
import { MONTE_CARLO_GUIDE, MONTE_CARLO_SETTING_TERMS } from './monteCarloGuide'
import { HORIZON_OPTIONS } from './monteCarlo'

describe('Monte Carlo guide', () => {
  it('lists settings in their displayed order', () => {
    const settings = MONTE_CARLO_GUIDE.find((section) => section.heading === 'Settings')
    expect(settings?.entries.map((entry) => entry.term)).toEqual([...MONTE_CARLO_SETTING_TERMS])
  })

  it('has complete explanatory copy', () => {
    for (const section of MONTE_CARLO_GUIDE) {
      expect(section.heading).not.toBe('')
      expect(section.paragraphs.length + section.entries.length).toBeGreaterThan(0)
      for (const paragraph of section.paragraphs) {
        expect(paragraph).not.toBe('')
        expect(paragraph.endsWith('.')).toBe(true)
      }
      for (const entry of section.entries) {
        expect(entry.text).not.toBe('')
        expect(entry.text.endsWith('.')).toBe(true)
      }
    }
  })

  it('keeps horizon copy aligned with the available options', () => {
    const horizon = MONTE_CARLO_GUIDE.find((section) => section.heading === 'Settings')?.entries.find((entry) => entry.term === 'Horizon')
    for (const option of HORIZON_OPTIONS) expect(horizon?.text).toContain(String(option.days))
  })

  it('keeps sections in their displayed order', () => {
    expect(MONTE_CARLO_GUIDE.map((section) => section.heading)).toEqual([
      'What this does', 'How a path is built', 'Settings', 'Short history', 'Reading the results', 'Limits of the model',
    ])
  })
})
