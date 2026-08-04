import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function proxyImage(url: string | undefined, source?: string): string {
  if (!url) return '';
  // Use the deployed API server origin in production; falls back to ""
  // (same-origin) in dev where VITE_API_URL is not set.
  const apiOrigin = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL ?? "")
    .replace(/\/+$/, "");
  // Already a local API or public path — just prepend the API origin so it
  // resolves to Render in production instead of staying on Vercel's domain.
  if (url.startsWith('/api/') || url.startsWith('/public/')) return `${apiOrigin}${url}`;
  const sourceParam = source ? `&source=${encodeURIComponent(source)}` : '';
  return `${apiOrigin}/api/image?url=${encodeURIComponent(url)}${sourceParam}`;
}
