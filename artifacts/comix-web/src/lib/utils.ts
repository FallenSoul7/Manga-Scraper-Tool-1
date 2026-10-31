import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { Capacitor } from "@capacitor/core"
import { appApiUrl } from "./api-url"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const PROXIED_MEDIA_SOURCES = new Set([
  "all.webtoons", "all.atsu", "en.novelfull", "all.mangadex", "en.asurascans", "all.thunderscans", "en.animegg", "en.resetscans",
]);
const NATIVE_DIRECT_MEDIA_SOURCES = new Set([
  "all.atsu", "all.danbooru", "all.pawchive", "all.webtoons", "all.mangadex", "en.asurascans", "all.thunderscans",
]);

const INFERRED_MEDIA_HOSTS: Array<{ source: string; hosts: string[] }> = [
  { source: "all.pawchive", hosts: ["img.pawchive.pw", "file.pawchive.pw"] },
  { source: "all.webtoons", hosts: ["webtoon-phinf.pstatic.net", "swebtoon-phinf.pstatic.net"] },
  { source: "all.atsu", hosts: ["cdn.atsu.moe"] },
  { source: "all.mangadex", hosts: ["uploads.mangadex.org", "mangadex.network"] },
  { source: "en.asurascans", hosts: ["asurascans.com"] },
  { source: "all.thunderscans", hosts: ["en-thunderscans.com", "thunderscans.com"] },
  { source: "en.novelfull", hosts: ["novelfull.com"] },
  { source: "en.animegg", hosts: ["vidcache.net", "animegg.org"] },
  { source: "en.resetscans", hosts: ["resetscans.net"] },
];

function inferApprovedMediaSource(url: string): string | undefined {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:") return undefined;
    const host = target.hostname.toLowerCase();
    return INFERRED_MEDIA_HOSTS.find(({ hosts }) => hosts.some(domain =>
      host === domain || host.endsWith(`.${domain}`),
    ))?.source;
  } catch {
    return undefined;
  }
}

export function mediaImage(url: string | undefined, source?: string): string {
  if (!url) return '';
  const resolvedSource = source || inferApprovedMediaSource(url);
  // Keep image-proxy requests on the app origin so the service worker can cache
  // successful responses instead of seeing opaque cross-origin image requests.
  if (url.startsWith('/api/')) return appApiUrl(url);
  // These are bundled frontend assets; keep them on the fast app/CDN origin.
  if (url.startsWith('/public/')) return url;
  // Native WebViews can load cross-origin media through the device network
  // stack; don't send these client-first sources' images through Render.
  // Ordinary browsers retain the proxy as a temporary migration fallback.
  if (Capacitor.isNativePlatform() && resolvedSource && NATIVE_DIRECT_MEDIA_SOURCES.has(resolvedSource)) {
    return url;
  }
  const sourceMediaPath = (sourceId: string) =>
    appApiUrl(`/api/source-media?source=${encodeURIComponent(sourceId)}&url=${encodeURIComponent(url)}`);
  if (
    resolvedSource === "all.pawchive" &&
    /^https:\/\/(?:img|file)\.pawchive\.pw\//i.test(url) &&
    !/\.(mp4|webm|mov|mkv|avi|m4v)(?:[?#&]|$)/i.test(url)
  ) {
    return sourceMediaPath(resolvedSource);
  }
  if (resolvedSource && PROXIED_MEDIA_SOURCES.has(resolvedSource) && /^https:\/\//i.test(url)) {
    return sourceMediaPath(resolvedSource);
  }
  return url;
}

/** Start a non-blocking fetch so the service worker/browser cache can warm a saved cover. */
export function warmMediaImage(url: string | undefined, source?: string): void {
  const src = mediaImage(url, source);
  if (!src || typeof Image === "undefined") return;
  const image = new Image();
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.src = src;
  void image.decode().catch(() => {});
}

export function shouldProxySourceMedia(source?: string | null): boolean {
  return !!source && PROXIED_MEDIA_SOURCES.has(source);
}

export function mediaVideo(url: string | undefined, source?: string): string {
  if (!url) return "";
  const apiOrigin = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL ?? "").replace(/\/+$/, "");
  if (Capacitor.isNativePlatform() && source === "all.pawchive" && /^https:\/\//i.test(url)) {
    return url;
  }
  if (source === "all.pawchive" && /^https:\/\//i.test(url)) {
    return `${apiOrigin}/api/source-video?source=${encodeURIComponent(source)}&url=${encodeURIComponent(url)}`;
  }
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
