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

/** Build a reader URL that remains one route segment even when an extension
 * uses a path/query string as its chapter ID (notably Webtoons). */
export function readerUrl(
  chapterId: string | number,
  mangaId: string,
  sourceId?: string | null,
  offline = false,
): string {
  const params = new URLSearchParams();
  params.set("mangaId", String(mangaId));
  if (sourceId) params.set("sourceId", sourceId);
  if (offline) params.set("offline", "1");
  return `/reader/${encodeURIComponent(String(chapterId))}?${params.toString()}`;
}
