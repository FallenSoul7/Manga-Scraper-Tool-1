import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function proxyImage(url: string | undefined, source?: string): string {
  if (!url) return '';
  // Already a local path served by the API or public folder — skip double-proxying.
  // Relative /api/ and /public/ URLs are served by the same origin; wrapping them
  // in /api/image would make the URL validator reject them (no http:// scheme).
  if (url.startsWith('/api/') || url.startsWith('/public/')) return url;
  // Use the deployed API server origin in production; fall back to the
  // Vite dev-server base path when VITE_API_URL is not set (local dev).
  const apiOrigin = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL ?? "")
    .replace(/\/+$/, "");
  const sourceParam = source ? `&source=${encodeURIComponent(source)}` : '';
  return `${apiOrigin}/api/image?url=${encodeURIComponent(url)}${sourceParam}`;
}
