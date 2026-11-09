import { describe, it, expect } from 'vitest'
import { SCORE_GUIDE } from './scoreGuide'

describe('scoreGuide', () => {
  it('has six sections with correct headings', () => {
    expect(SCORE_GUIDE).toHaveLength(6)
    const headings = SCORE_GUIDE.map((s) => s.heading)
    expect(headings).toEqual([
      'How the score works',
      'Diversification (35 points)',
      'Risk concentration (25 points)',
      'Volatility vs market (20 points)',
      'Holdout robustness (20 points)',
      'What is not scored',
    ])
  })

  it('every section has at least one paragraph, all non-empty and ending with period', () => {
    for (const section of SCORE_GUIDE) {
      expect(section.paragraphs.length).toBeGreaterThan(0)
      for (const paragraph of section.paragraphs) {
        expect(paragraph).toBeTruthy()
        expect(paragraph).toMatch(/\.$/)
      }
    }
  })

  it('risk concentration section contains required phrases', () => {
    const riskSection = SCORE_GUIDE.find((s) => s.heading.includes('Risk concentration'))
    expect(riskSection).toBeDefined()
    const joined = riskSection!.paragraphs.join(' ')
    expect(joined).toContain('10% or less')
    expect(joined).toContain('50% or more')
    expect(joined).toContain('30% scores 12.5')
  })

  it('no paragraphs contain arrow symbol', () => {
    for (const section of SCORE_GUIDE) {
      for (const paragraph of section.paragraphs) {
        expect(paragraph).not.toContain('→')
      }
    }
  })
})
