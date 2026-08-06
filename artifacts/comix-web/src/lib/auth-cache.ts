const KEY = "comihub-user-v1";
const TOKEN_KEY = "comihub-access-token-v1";
const REFRESH_TOKEN_KEY = "comihub-refresh-token-v1";
const AUTH_EVENT = "comihub-auth-changed";

/** Decode a JWT and return its expiry unix timestamp (seconds), or null on failure. */
export function getTokenExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch {
    return null;
  }
}

/** Returns true if the stored access token expires within `bufferSeconds` seconds. */
export function isTokenExpiringSoon(bufferSeconds = 300): boolean {
  const token = getAccessToken();
  if (!token) return false;
  const exp = getTokenExpiry(token);
  if (!exp) return false;
  return exp - bufferSeconds < Math.floor(Date.now() / 1000);
}

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
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    window.dispatchEvent(new Event(AUTH_EVENT));
  } catch { /* */ }
}

export function setRefreshToken(token: string) {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch { /* */ }
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
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
