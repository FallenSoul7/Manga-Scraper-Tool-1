// In dev the API is proxied by the Express server on the same origin.
// In production (Vercel frontend + Render backend) we need the absolute URL.
// Strip any trailing slash so apiUrl("/api/foo") always produces a clean URL.
// Keep production requests pointed at Render if a Vercel environment is
// missing VITE_API_URL, rather than silently depending on a frontend rewrite.
const configured: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const raw: string = configured || (import.meta.env.PROD ? "https://comihub-backend.onrender.com" : "");
export const API_BASE: string = raw.replace(/\/+$/, "");

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  // Ensure path starts with /
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}
