// In dev the API is proxied by the Express server on the same origin.
// In production (Vercel frontend + Render backend) we need the absolute URL.
// Strip any trailing slash so apiUrl("/api/foo") always produces a clean URL.
const raw: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
export const API_BASE: string = raw.replace(/\/+$/, "");

export function apiUrl(path: string): string {
  // Ensure path starts with /
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}
