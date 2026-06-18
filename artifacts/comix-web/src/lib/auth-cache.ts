const KEY = "comihub-user-v1";

export interface CachedUser {
  id: string;
  displayName: string;
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
  } catch { /* */ }
}

export function clearCachedUser() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* */ }
}
