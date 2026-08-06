import { useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api-url";
import {
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
  isTokenExpiringSoon,
  clearCachedUser,
} from "@/lib/auth-cache";

const CHECK_INTERVAL_MS = 60 * 1000; // check every 60 seconds
const EXPIRY_BUFFER_SECONDS = 5 * 60; // refresh when < 5 minutes left

let refreshing = false; // module-level guard — prevents concurrent refreshes

async function attemptRefresh(): Promise<void> {
  if (refreshing) return;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return;
  if (!isTokenExpiringSoon(EXPIRY_BUFFER_SECONDS)) return;

  refreshing = true;
  try {
    const res = await fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      // Refresh token is invalid / revoked — log the user out silently
      if (res.status === 401) clearCachedUser();
      return;
    }

    const data = await res.json();
    if (data.accessToken) setAccessToken(data.accessToken);
    if (data.refreshToken) setRefreshToken(data.refreshToken);
  } catch {
    // Network error — don't clear the user, just retry next interval
  } finally {
    refreshing = false;
  }
}

/**
 * Drop this hook into any always-mounted component (e.g. AppContent).
 * It silently refreshes the Supabase access token before it expires so
 * background syncs never break due to a stale token.
 */
export function useTokenRefresh() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Skip entirely if there's no access token (user not logged in)
    if (!getAccessToken()) return;

    // Run once immediately in case the app was closed and re-opened near expiry
    attemptRefresh();

    intervalRef.current = setInterval(attemptRefresh, CHECK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
