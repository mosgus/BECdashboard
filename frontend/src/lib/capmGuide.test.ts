import { describe, expect, it } from 'vitest'
import { CAPM_GUIDE, CAPM_SETTING_TERMS } from './capmGuide'

describe('CAPM guide', () => {
  it('lists settings in their displayed order', () => {
    const settings = CAPM_GUIDE.find((section) => section.heading === 'Settings')
    expect(settings?.entries.map((entry) => entry.term)).toEqual([...CAPM_SETTING_TERMS])
  })

  it('has complete explanatory copy', () => {
    for (const section of CAPM_GUIDE) {
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
})
