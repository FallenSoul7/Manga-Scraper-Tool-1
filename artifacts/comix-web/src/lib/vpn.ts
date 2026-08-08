import { apiUrl } from "@/lib/api-url";

export function getProxiedImageUrl(originalUrl: string, sourceId: string): string {
  if (!originalUrl) return "";

  // Source adapters may already return a local proxy URL. Keep it local in
  // development, but point it at Render in production.
  if (originalUrl.startsWith("/api/") || originalUrl.startsWith("/public/")) {
    return apiUrl(originalUrl);
  }

  // Direct CDN URLs are unreliable in production because several sources
  // require a Referer. Always use the shared backend image proxy. This also
  // makes the built-in VPN switch an optional extra rather than a prerequisite
  // for normal reading.
  const referers: Record<string, string> = {
    "all.mangadex": "https://mangadex.org/",
    "all.webtoons": "https://www.webtoons.com/",
    "en.comix": "https://comix.to/",
    "en.comickfan": "https://comickfan.com/",
    "en.utoon": "https://utoon.net/",
    "en.elftoon": "https://elftoon.com/",
  };
  const referer = referers[sourceId] ?? "";
  const encodedUrl = encodeURIComponent(originalUrl);
  const encodedReferer = referer ? `&referer=${encodeURIComponent(referer)}` : "";
  return apiUrl(`/api/image-proxy?url=${encodedUrl}${encodedReferer}`);
}
