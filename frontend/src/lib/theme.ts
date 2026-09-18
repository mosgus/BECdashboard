export type ThemePreference = 'light' | 'system' | 'dark'

export const THEME_STORAGE_KEY = 'bec-theme'

/** Validates an unknown stored value. Anything unrecognised, including null, is 'light'. */
export function parsePreference(raw: string | null): ThemePreference {
  if (raw === 'system' || raw === 'dark') return raw
  return 'light'
}

/** Pure: which theme actually applies. `prefersDark` is passed in, never read from the OS
 * media-query API here — a function that reads the environment itself cannot be reasoned
 * about or tested. That subscription belongs in the component. */
export function resolveTheme(pref: ThemePreference, prefersDark: boolean): 'light' | 'dark' {
  if (pref === 'dark') return 'dark'
  if (pref === 'system') return prefersDark ? 'dark' : 'light'
  return 'light'
}

/** Sets data-theme on <html>. 'light' removes the attribute rather than setting it — light
 * mode is the true default, and globals.css has no [data-theme="light"] block to need one. */
export function applyTheme(theme: 'light' | 'dark'): void {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

/** Reads the stored preference, guarded. `localStorage` access throws outright in some
 * privacy modes — unguarded in a useState initialiser that crashes the page during render,
 * which is the same failure index.html's inline script already catches. */
export function readStoredPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'light'
  }
}

/** Persists the preference, guarded for the same reason. A browser that refuses to store it
 * still themes correctly for this session; it just will not remember across reloads. */
export function storePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // Storage unavailable — the theme still applies, it just does not persist.
  }
}
