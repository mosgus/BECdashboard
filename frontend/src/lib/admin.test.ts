import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_PASSKEY, ADMIN_UNLOCKED_KEY, isAdminPasskey, readAdminUnlocked, storeAdminUnlocked } from './admin'

afterEach(() => vi.unstubAllGlobals())

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
}

describe('admin gate', () => {
  it('accepts the passkey with surrounding whitespace', () => {
    expect(isAdminPasskey(ADMIN_PASSKEY)).toBe(true)
    expect(isAdminPasskey(`  ${ADMIN_PASSKEY}  `)).toBe(true)
  })

  it('rejects case and content mismatches', () => {
    expect(isAdminPasskey('London')).toBe(false)
    expect(isAdminPasskey('')).toBe(false)
    expect(isAdminPasskey(`${ADMIN_PASSKEY}x`)).toBe(false)
  })

  it('stores the unlock only for the current session', () => {
    vi.stubGlobal('sessionStorage', storage())
    expect(readAdminUnlocked()).toBe(false)
    storeAdminUnlocked(true)
    expect(readAdminUnlocked()).toBe(true)
    storeAdminUnlocked(false)
    expect(readAdminUnlocked()).toBe(false)
  })

  it('handles unavailable storage', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readAdminUnlocked()).toBe(false)
    expect(() => storeAdminUnlocked(true)).not.toThrow()
    expect(ADMIN_UNLOCKED_KEY).toBe('blue-eagle.admin-unlocked')
  })
})
