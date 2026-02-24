/**
 * Token helpers — all localStorage access is guarded for SSR safety.
 * Keys: be_token (JWT), be_actor (display_name)
 */

const TOKEN_KEY = "be_token";
const ACTOR_KEY = "be_actor";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export const auth = {
  setSession(token: string, actor: string): void {
    if (!isBrowser()) return;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ACTOR_KEY, actor);
  },

  getToken(): string | null {
    if (!isBrowser()) return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  getActor(): string | null {
    if (!isBrowser()) return null;
    return localStorage.getItem(ACTOR_KEY);
  },

  clear(): void {
    if (!isBrowser()) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACTOR_KEY);
  },

  isLoggedIn(): boolean {
    if (!isBrowser()) return false;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return false;
      const payload = JSON.parse(atob(parts[1]));
      return typeof payload.exp === "number" && payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  },
};
