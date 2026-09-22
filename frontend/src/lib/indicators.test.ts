import { describe, expect, it } from 'vitest'
import { GLOSSARY, INDICATOR_GROUPS } from './indicators'

describe('GLOSSARY / INDICATOR_GROUPS parity', () => {
  it('gives every INDICATOR_GROUPS key exactly one GLOSSARY entry carrying that indicatorKey', () => {
    for (const group of INDICATOR_GROUPS) {
      const matches = GLOSSARY.filter((entry) => entry.indicatorKey === group.key)
      expect(matches.length).toBe(1)
    }
  })

  it('has no two entries sharing a term', () => {
    const terms = GLOSSARY.map((entry) => entry.term)
    expect(new Set(terms).size).toBe(terms.length)
  })

  it('has a non-empty term and definition on every entry', () => {
    for (const entry of GLOSSARY) {
      expect(entry.term.trim().length).toBeGreaterThan(0)
      expect(entry.definition.trim().length).toBeGreaterThan(0)
    }
  })

  it('only sets indicatorKey to a real INDICATOR_GROUPS key', () => {
    const validKeys = new Set<string>(INDICATOR_GROUPS.map((group) => group.key))
    for (const entry of GLOSSARY) {
      if (entry.indicatorKey !== undefined) {
        expect(validKeys.has(entry.indicatorKey)).toBe(true)
      }
    }
  })
})
