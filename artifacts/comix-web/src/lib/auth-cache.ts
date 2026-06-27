const KEY = "comihub-user-v1";
const TOKEN_KEY = "comihub-access-token-v1";
const AUTH_EVENT = "comihub-auth-changed";

export interface CachedUser {
  id: string;
  displayName: string;
  username: string;
  email: string;
  photo: string;
}

export function getCachedUser(): CachedUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedUser;
  } catch {
    return null;
  }
}

export function setCachedUser(user: CachedUser) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
    window.dispatchEvent(new Event(AUTH_EVENT));
  } catch { /* */ }
}

export function clearCachedUser() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event(AUTH_EVENT));
  } catch { /* */ }
}

export function setAccessToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch { /* */ }
}

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearAccessToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* */ }
}

export function onAuthChanged(cb: () => void): () => void {
  window.addEventListener(AUTH_EVENT, cb);
  return () => window.removeEventListener(AUTH_EVENT, cb);
}
