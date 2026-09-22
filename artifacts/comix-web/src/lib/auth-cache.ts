const KEY = "comihub-user-v1";
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
  } catch {
    // The server-side session remains authoritative when storage is unavailable.
  }
}

export function clearCachedUser() {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(AUTH_EVENT));
  } catch {
    // Ignore restricted browser storage.
  }
}

export function onAuthChanged(cb: () => void): () => void {
  window.addEventListener(AUTH_EVENT, cb);
  return () => window.removeEventListener(AUTH_EVENT, cb);
}
