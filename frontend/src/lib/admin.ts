// Client-side gate only: this value is visible in the bundle, so a real check must happen on the server.
export const ADMIN_PASSKEY = 'london'
export const ADMIN_UNLOCKED_KEY = 'blue-eagle.admin-unlocked'

/** Trims surrounding whitespace; otherwise an exact, case-sensitive match. */
export function isAdminPasskey(input: string): boolean {
  return input.trim() === ADMIN_PASSKEY
}

/** True only when sessionStorage holds the unlocked flag. */
export function readAdminUnlocked(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_UNLOCKED_KEY) === '1'
  } catch {
    return false
  }
}

/** Persists the unlocked flag for this browser tab, when session storage is available. */
export function storeAdminUnlocked(unlocked: boolean): void {
  try {
    if (unlocked) sessionStorage.setItem(ADMIN_UNLOCKED_KEY, '1')
    else sessionStorage.removeItem(ADMIN_UNLOCKED_KEY)
  } catch {
    // Storage unavailable — the current component state still controls this session.
  }
}
