import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://hentaifox.com";
const SOURCE_ID = "all.hentaifox";

function absoluteUrl(value: string, reference: string): string {
  if (!value) return "";
  try {
    return new URL(value, reference).toString();
  } catch {
    return value;
  }
}

function galleryId(value: string): string {
  const id = String(value).replace(/^gallery:/, "").match(/^\d+$/)?.[0];
  if (!id) throw new Error(`HentaiFox: invalid gallery ID ${value}`);
  return id;
}

async function fetchDocument(path: string): Promise<{ document: Document; html: string; url: string }> {
  const url = new URL(path, BASE).toString();
  try {
    const response = await clientFetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    return { document: new DOMParser().parseFromString(html, "text/html"), html, url };
  } catch {
    throw new Error("HentaiFox is temporarily unavailable or blocking requests. Please check your connection and try again later.");
  }
}

function imageSource(image: Element | null): string {
  if (!image) return "";
  return image.getAttribute("data-src") || image.getAttribute("src") || "";
}

function summaryFromElement(element: Element, pageUrl: string): ClientListResponse["items"][number] | null {
  const anchor = element.querySelector("a");
  const href = anchor?.getAttribute("href") || "";
  const match = href.match(/\/gallery\/(\d+)/);
  if (!match) return null;
  const id = match[1];
  const title = element.querySelector(".caption h2, .caption h3, .inner h2")?.textContent?.trim()
    || anchor?.getAttribute("title")?.trim()
    || `Gallery ${id}`;
  const thumbnail = absoluteUrl(imageSource(element.querySelector("img")), pageUrl);
  return { id, title: /^\d+$/.test(title) ? `Gallery ${id}` : title, thumbnail, type: "Doujinshi", isNsfw: true };
}

function parseList(document: Document, pageUrl: string, search = false): ClientListResponse["items"] {
  const items: ClientListResponse["items"] = [];
  const seen = new Set<string>();
  const selector = search
    ? ".col-6, .gallery, .g-wrap, .search-results .item"
    : ".col-6, .gallery, .g-wrap, .item";
  document.querySelectorAll(selector).forEach(element => {
    const item = summaryFromElement(element, pageUrl);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  });
  return items;
}

async function list(kind: "popular" | "latest" | "search", page: number, query = ""): Promise<ClientListResponse> {
  const path = kind === "search"
    ? `/search/?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page) }).toString()}`
    : page === 1 ? "/" : `/pag/${encodeURIComponent(String(page))}/`;
  const { document, url } = await fetchDocument(path);
  return {
    items: parseList(document, url, kind === "search"),
    page,
    hasNextPage: kind === "search"
      ? Boolean(document.querySelector("a.next, .next a, [rel='next']"))
      : Boolean(document.querySelector(".pagination .next, .pagination [rel='next']"))
        || Array.from(document.querySelectorAll(".pagination a")).some(anchor => /next/i.test(anchor.textContent || "")),
  };
}

function extractJsonFromScript(html: string, variable: string): unknown {
  const startAt = html.indexOf(variable);
  if (startAt < 0) return null;
  const objectStart = html.indexOf("{", startAt);
  const arrayStart = html.indexOf("[", startAt);
  const start = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart) ? arrayStart : objectStart;
  if (start < 0) return null;
  const opening = html[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  for (let index = start; index < html.length; index += 1) {
    if (html[index] === opening) depth += 1;
    else if (html[index] === closing && --depth === 0) {
      try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
}

async function fetchGallery(id: string): Promise<{ document: Document; html: string; url: string }> {
  return fetchDocument(`/gallery/${encodeURIComponent(galleryId(id))}/`);
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page) { return list("popular", page); },
  latest(page) { return list("latest", page); },
  search(query, page) { return list("search", page, query); },

  async details(id, options): Promise<ClientMangaDetail> {
    const safeId = galleryId(id);
    const { document, url } = await fetchGallery(safeId);
    const title = document.querySelector("h1, .info h1, .caption h1")?.textContent?.trim()
      || document.querySelector("title")?.textContent?.replace(/\s*[-|].*$/, "").trim()
      || `Gallery ${safeId}`;
    const thumbnail = absoluteUrl(imageSource(document.querySelector(".cover img, .preview_thumb img")), url);
    const genres = Array.from(document.querySelectorAll("a[href*='/tag/'], a[href*='/category/']"))
      .map(element => element.textContent?.trim().replace(/\s*\d+$/, "").trim() || "")
      .filter(Boolean);
    const pageText = document.querySelector(".pages, .info li")?.textContent || "";
    const pageCount = /pages/i.test(pageText) ? Number.parseInt(pageText.replace(/\D/g, ""), 10) || 0 : 0;
    return {
      id: safeId,
      title,
      author: document.querySelector("a[href*='/artist/']")?.textContent?.trim() || "",
      artist: "",
      synopsis: `${pageCount > 0 ? `${pageCount} pages. ` : ""}${genres.slice(0, 8).join(", ")}`,
      altTitles: [], status: "Completed", type: "Doujinshi", isNsfw: true, rating: 0,
      thumbnail, genres, score: "", scorePosition: options?.scorePosition ?? "none",
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const safeId = galleryId(id);
    const { document } = await fetchGallery(safeId);
    const title = document.querySelector("h1, .info h1")?.textContent?.trim() || `Gallery ${safeId}`;
    return { items: [{ id: safeId, number: 1, title, scanlator: "HentaiFox", date: Math.floor(Date.now() / 1000) }] };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const safeId = galleryId(String(chapterId));
    const galleryUrl = `${BASE}/gallery/${safeId}/`;
    try {
      const response = await clientFetch(`${BASE}/api/gallery/${encodeURIComponent(safeId)}`, {
        method: "GET", credentials: "omit", cache: "no-store",
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      });
      if (response.ok) {
        const data = await response.json() as { images?: unknown };
        if (Array.isArray(data.images)) {
          const pages = data.images.map(String).filter(Boolean).map((url, index) => ({ index, url: absoluteUrl(url, galleryUrl) }));
          if (pages.length) return { chapterId: safeId, pages };
        }
      }
    } catch { /* Fall back to the gallery HTML. */ }

    const { document, html, url } = await fetchGallery(safeId);
    for (const variable of ["pages", "rff_imageList", "gallery", "images"]) {
      const data = extractJsonFromScript(html, variable);
      if (Array.isArray(data)) {
        const pages = data.map(item => typeof item === "string" ? item : (item as { url?: string; src?: string })?.url || (item as { src?: string })?.src || "")
          .filter(Boolean).map((value, index) => ({ index, url: absoluteUrl(value, url) }));
        if (pages.length) return { chapterId: safeId, pages };
      }
    }

    const matches = [...html.matchAll(/https?:\/\/[^"'\\\s]*hentaifox\.com\/[^"'\\\s]*\.(?:jpg|png|webp)/gi)].map(match => match[0]);
    if (matches.length) return { chapterId: safeId, pages: matches.map((value, index) => ({ index, url: value })) };

    const cover = imageSource(document.querySelector(".cover img"));
    const countText = document.querySelector(".pages, .info li")?.textContent || "";
    const count = /pages/i.test(countText) ? Number.parseInt(countText.replace(/\D/g, ""), 10) || 0 : 0;
    if (cover && count) {
      const coverBase = absoluteUrl(cover, url).replace(/\/cover\.jpg$/, "");
      return { chapterId: safeId, pages: Array.from({ length: count }, (_, index) => ({ index, url: `${coverBase}/${index + 1}.jpg` })) };
    }
    return { chapterId: safeId, pages: [] };
  },
};

export default adapter;
