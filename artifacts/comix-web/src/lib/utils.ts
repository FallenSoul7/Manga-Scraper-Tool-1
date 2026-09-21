import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function mediaImage(url: string | undefined, _source?: string): string {
  if (!url) return '';
  // Resolve only local application assets against the deployed API origin.
  // External source media remains direct; ComiHub does not relay or rewrite it.
  const apiOrigin = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL ?? "")
    .replace(/\/+$/, "");
  if (url.startsWith('/api/') || url.startsWith('/public/')) return `${apiOrigin}${url}`;
  return url;
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
