import { describe, expect, it } from 'vitest'
import { FORECAST_MODELS } from './forecast'
import { FORECAST_GUIDE, FORECAST_SETTING_TERMS } from './forecastGuide'
import { HORIZON_OPTIONS } from './monteCarlo'

describe('forecast guide', () => {
  it('lists settings in their displayed order', () =>
    expect(
      FORECAST_GUIDE.find((section) => section.heading === 'Settings')?.entries.map((entry) => entry.term),
    ).toEqual([...FORECAST_SETTING_TERMS]))
  it('has complete explanatory copy', () => {
    for (const section of FORECAST_GUIDE) {
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
    const horizon = FORECAST_GUIDE.find((section) => section.heading === 'Settings')?.entries.find(
      (entry) => entry.term === 'Horizon',
    )
    for (const option of HORIZON_OPTIONS) expect(horizon?.text).toContain(String(option.days))
  })
  it('keeps sections in their displayed order', () =>
    expect(FORECAST_GUIDE.map((section) => section.heading)).toEqual([
      'What this does',
      'The models',
      'Settings',
      'Short history',
      'Reading the results',
      'Limits of the models',
    ]))
  it('keeps model terms aligned with the picker', () =>
    expect(
      FORECAST_GUIDE.find((section) => section.heading === 'The models')?.entries.map((entry) => entry.term),
    ).toEqual(FORECAST_MODELS.map((model) => model.label)))
})
