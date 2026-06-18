// In dev the API is proxied by the Express server on the same origin.
// In production (Vercel frontend + Render backend) we need the absolute URL.
export const API_BASE: string = (import.meta.env.VITE_API_URL as string) ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
