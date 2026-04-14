/**
 * Actor-name + password helpers — all localStorage access is guarded for SSR safety.
 * Keys: be_actor (display name), be_auth (password verified flag)
 */

const ACTOR_KEY = "be_actor";
const AUTH_KEY = "be_auth";

const isBrowser = (): boolean => typeof window !== "undefined";

export const SITE_PASSWORD =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SITE_PASSWORD) || "blueeagle2026";

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

export const auth = {
  setVerified(): void {
    if (isBrowser()) localStorage.setItem(AUTH_KEY, "true");
  },

  isVerified(): boolean {
    return isBrowser() ? localStorage.getItem(AUTH_KEY) === "true" : false;
  },

  clear(): void {
    if (isBrowser()) localStorage.removeItem(AUTH_KEY);
  },
};
