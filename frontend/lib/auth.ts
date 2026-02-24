/**
 * Actor-name helpers — all localStorage access is guarded for SSR safety.
 * Key: be_actor (display name entered at /login)
 */

const ACTOR_KEY = "be_actor";

const isBrowser = (): boolean => typeof window !== "undefined";

export const actor = {
  set(name: string): void {
    if (isBrowser()) localStorage.setItem(ACTOR_KEY, name.trim());
  },

  get(): string | null {
    return isBrowser() ? localStorage.getItem(ACTOR_KEY) : null;
  },

  clear(): void {
    if (isBrowser()) localStorage.removeItem(ACTOR_KEY);
  },

  hasActor(): boolean {
    return !!actor.get();
  },
};
