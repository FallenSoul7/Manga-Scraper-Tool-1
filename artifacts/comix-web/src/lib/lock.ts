import { getAccessToken } from "@/lib/auth-cache";
import { apiUrl } from "@/lib/api-url";

// ── localStorage keys (namespaced, unique to this feature) ──────────────
const PIN_KEY = "comihub-lock-pin-v1";
const ATTEMPTS_KEY = "comihub-lock-attempts-v1";
const LOCKED_UNTIL_KEY = "comihub-lock-locked-until-v1";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15000;

// Module-level flag — NOT persisted, so any reload re-locks the app.
let unlockedThisSession = false;

export const LOCK_DISCORD_URL = "https://discord.gg/ChdA4sxkX";

export function setUnlocked(v: boolean) {
  unlockedThisSession = v;
}
export function isUnlockedThisSession() {
  return unlockedThisSession;
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Local device hash — SHA-256 with a random per-device salt. Never stores plaintext. */
async function makeLocalHash(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(8));
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
  const hash = await sha256(`${saltHex}:${pin}`);
  return `sha256$${saltHex}$${hash}`;
}

async function localHashMatches(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(PIN_KEY);
  if (!stored) return false;
  const [scheme, saltHex, hash] = stored.split("$");
  if (scheme !== "sha256" || !saltHex || !hash) return false;
  const calc = await sha256(`${saltHex}:${pin}`);
  return calc === hash;
}

export function hasAnyPin(): boolean {
  try {
    return !!localStorage.getItem(PIN_KEY);
  } catch {
    return false;
  }
}

// ── Lockout --------------------------------------------------------------
export function getLockedUntil(): number {
  try {
    return Number(localStorage.getItem(LOCKED_UNTIL_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

export function isLockedOut(): boolean {
  return Date.now() < getLockedUntil();
}

export function lockoutRemainingMs(): number {
  return Math.max(0, getLockedUntil() - Date.now());
}

function registerFail() {
  let attempts = 0;
  try {
    attempts = Number(localStorage.getItem(ATTEMPTS_KEY) || 0) + 1;
  } catch {
    attempts = 1;
  }
  if (attempts >= MAX_ATTEMPTS) {
    try {
      localStorage.setItem(LOCKED_UNTIL_KEY, String(Date.now() + LOCKOUT_MS));
      localStorage.setItem(ATTEMPTS_KEY, "0");
    } catch { /* storage unavailable */ }
  } else {
    try {
      localStorage.setItem(ATTEMPTS_KEY, String(attempts));
    } catch { /* storage unavailable */ }
  }
}

export function getRemainingAttempts(): number {
  try {
    return Math.max(0, MAX_ATTEMPTS - (Number(localStorage.getItem(ATTEMPTS_KEY) || 0)));
  } catch {
    return MAX_ATTEMPTS;
  }
}

// ── Verify ---------------------------------------------------------------
/** Verify a PIN against the local device hash, then the server (logged-in fresh device). */
export async function verifyPin(pin: string): Promise<boolean> {
  if (isLockedOut()) return false;

  if (await localHashMatches(pin)) {
    unlockedThisSession = true;
    try { localStorage.setItem(ATTEMPTS_KEY, "0"); } catch { /* */ }
    return true;
  }

  const token = getAccessToken();
  if (token) {
    try {
      const res = await fetch(apiUrl("/api/auth/lock-pin-verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (data?.ok) {
        // Cache a local hash so the lock keeps working offline on this device.
        try { localStorage.setItem(PIN_KEY, await makeLocalHash(pin)); localStorage.setItem(ATTEMPTS_KEY, "0"); } catch { /* */ }
        unlockedThisSession = true;
        return true;
      }
    } catch {
      // offline — fall through to failure below
    }
  }

  registerFail();
  return false;
}

// ── Set / clear ----------------------------------------------------------
/** Set a PIN (twice-confirmed handled by the UI). Returns null on success, else an error message. */
export async function setPin(pin: string): Promise<string | null> {
  if (!/^\d{6}$/.test(pin)) return "PIN must be exactly 6 digits";
  try {
    localStorage.setItem(PIN_KEY, await makeLocalHash(pin));
    localStorage.setItem(ATTEMPTS_KEY, "0");
  } catch {
    return "Could not save PIN on this device.";
  }
  unlockedThisSession = true;

  const token = getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(apiUrl("/api/auth/lock-pin"), {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) return "Saved on this device, but could not sync to your account.";
    return null;
  } catch {
    return "Saved on this device, but could not sync to your account (offline).";
  }
}

/** Remove the PIN. Returns null on success, else an error message. */
export async function clearPin(): Promise<string | null> {
  try {
    localStorage.removeItem(PIN_KEY);
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(LOCKED_UNTIL_KEY);
  } catch { /* */ }
  unlockedThisSession = true;

  const token = getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(apiUrl("/api/auth/lock-pin"), { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    return res.ok ? null : "Removed on this device, but could not sync to your account.";
  } catch {
    return "Removed on this device, but could not sync to your account (offline).";
  }
}

// ── Server status --------------------------------------------------------
/** Returns true if a PIN should gate the app (local device hash, or server-side for logged-in users). */
export async function refreshServerLock(): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return hasAnyPin();
  try {
    const res = await fetch(apiUrl("/api/auth/lock-pin-status"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data?.hasPin) return true;
    return hasAnyPin();
  } catch {
    return hasAnyPin();
  }
}

// ── Forgot / email reset -------------------------------------------------
export async function requestEmailReset(email?: string): Promise<{ ok: boolean; message: string }> {
  const token = getAccessToken();
  try {
    const res = await fetch(apiUrl("/api/auth/lock-reset-email"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: email || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || "Could not send reset email." };
    return { ok: true, message: data.message || "Check your email." };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

export async function verifyEmailCode(email: string, code: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(apiUrl("/api/auth/lock-verify-email"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token: code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || "Invalid or expired code." };
    // On success clear the local device PIN too, so a new one can be set.
    try {
      localStorage.removeItem(PIN_KEY);
      localStorage.removeItem(ATTEMPTS_KEY);
      localStorage.removeItem(LOCKED_UNTIL_KEY);
    } catch { /* */ }
    return { ok: true, message: data.message || "Code verified." };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}
