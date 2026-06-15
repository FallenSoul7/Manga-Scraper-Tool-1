import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function proxyImage(url: string | undefined, source?: string): string {
  if (!url) return '';
  // Use the deployed API server origin in production; fall back to the
  // Vite dev-server base path when VITE_API_URL is not set (local dev).
  const apiOrigin = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL ?? "")
    .replace(/\/+$/, "");
  const sourceParam = source ? `&source=${encodeURIComponent(source)}` : '';
  return `${apiOrigin}/api/image?url=${encodeURIComponent(url)}${sourceParam}`;
}
