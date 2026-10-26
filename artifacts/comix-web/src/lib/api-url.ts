// In dev the API is proxied by the Express server on the same origin.
// In production (Vercel frontend + Render backend) we need the absolute URL.
// Strip any trailing slash so apiUrl("/api/foo") always produces a clean URL.
const raw: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
export const API_BASE: string = raw.replace(/\/+$/, "");

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  // Ensure path starts with /
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}

/**
 * Resolve an API path for native shells whose document origin is local
 * (Capacitor Android/iOS use https://localhost). Browser builds keep relative
 * paths so Vercel can route them through its same-origin API proxy.
 */
export function appApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") return cleanPath;

  const { protocol, hostname } = window.location;
  const isNativeShell =
    protocol === "capacitor:" ||
    protocol === "ionic:" ||
    protocol === "tauri:" ||
    hostname === "localhost" ||
    hostname === "tauri.localhost";

  return isNativeShell && API_BASE ? `${API_BASE}${cleanPath}` : cleanPath;
}
