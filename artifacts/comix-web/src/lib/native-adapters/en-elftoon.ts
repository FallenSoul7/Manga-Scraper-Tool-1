import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://elftoon.net";
const SOURCE_ID = "en.elftoon";
const SOURCE_NAME = "Elf Toon";
const COVER_FALLBACK = "/public/source-icons/en.elftoon.png";

function absoluteUrl(value: string, reference = BASE): string {
  if (!value) return "";
  try {
    return new URL(value, reference).toString();
  } catch {
    return value;
  }
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sourcePath(value: string): string {
  try {
    const url = new URL(value, BASE);
    return url.pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return value.replace(BASE, "").replace(/^\/+|\/+$/g, "");
  }
}

function decodeNextImage(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, BASE);
    if (url.pathname === "/_next/image") {
      return decodeURIComponent(url.searchParams.get("url") || "");
    }
  } catch {
    // Fall through to the original value.
  }
  return value;
}

function imageValue(image: Element | null): string {
  if (!image) return "";
  const raw = image.getAttribute("src")
    || image.getAttribute("data-src")
    || image.getAttribute("srcset")
    || "";
  const candidates = raw.split(",")
    .map(value => value.trim().split(/\s+/)[0])
    .map(decodeNextImage)
    .filter(value => value && !/logo|placeholder|avatar/i.test(value));
  return candidates[0] || "";
}

function seriesSlug(href: string): string {
  const match = sourcePath(href).match(/^series\/comic\/([^/]+)$/i);
  return match?.[1] || "";
}

function isSeriesHref(href: string): boolean {
  return Boolean(seriesSlug(href));
}

function chapterNumber(text: string, href: string): number {
  const match = `${text} ${href}`.match(/chapter[\s/-]*(\d+(?:\.\d+)?)/i);
  return Number(match?.[1] || 0);
}

async function fetchDocument(path: string): Promise<{ document: Document; html: string; url: string }> {
  const url = new URL(path, BASE).toString();
  const response = await clientFetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  });
  if (!response.ok) throw new Error(`${SOURCE_NAME}: HTTP ${response.status}`);
  const html = await response.text();
  return { document: new DOMParser().parseFromString(html, "text/html"), html, url };
}

function findCover(document: Document, slug: string): string {
  const images = Array.from(document.querySelectorAll("img"));
  const matching = images.find(image => {
    const value = imageValue(image);
    return value.includes(`/uploads/series/${slug}/`) && /\/cover[^/]*\.(?:webp|jpg|jpeg|png)$/i.test(value);
  });
  return imageValue(matching ?? null) || COVER_FALLBACK;
}

function parseList(document: Document, page: number): ClientListResponse {
  const items: ClientListResponse["items"] = [];
  const seen = new Set<string>();
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href") || "";
    const slug = seriesSlug(href);
    if (!slug || seen.has(slug)) continue;
    const title = clean(anchor.getAttribute("title") || anchor.textContent || slug.replace(/-/g, " "));
    if (!title || /^(home|search|popular|latest)$/i.test(title)) continue;
    const root = anchor.closest("article, li, section, div") || anchor;
    const nearbyImage = root.querySelector("img") || document.querySelector(`img[src*="${slug}"]`);
    const thumbnail = imageValue(nearbyImage) || findCover(document, slug);
    seen.add(slug);
    items.push({
      id: encodeURIComponent(`series/comic/${slug}`),
      title,
      thumbnail: absoluteUrl(thumbnail),
      type: "Manhwa",
      isNsfw: false,
    });
  }
  return { items: items.slice(0, 50), page, hasNextPage: Boolean(document.querySelector("a[href*='page='], a[rel='next']")) };
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  async popular(page) {
    const suffix = page > 1 ? `&page=${page}` : "";
    return parseList((await fetchDocument(`/series?sort=popular${suffix}`)).document, page);
  },

  async latest(page) {
    const suffix = page > 1 ? `&page=${page}` : "";
    return parseList((await fetchDocument(`/series?sort=latest${suffix}`)).document, page);
  },

  async search(query, page) {
    const suffix = page > 1 ? `&page=${page}` : "";
    return parseList((await fetchDocument(`/search?q=${encodeURIComponent(query)}${suffix}`)).document, page);
  },

  async details(id, options): Promise<ClientMangaDetail> {
    const path = decodeURIComponent(id);
    const { document } = await fetchDocument(`/${path}`);
    const slug = path.split("/").pop() || "";
    const title = clean(document.querySelector("h1")?.textContent || document.title.replace(/\s*\|.*$/, "")) || slug;
    const metaDescription = document.querySelector("meta[name='description']")?.getAttribute("content") || "";
    const genres = Array.from(document.querySelectorAll("a[href*='/genre/'], a[href*='/genres/']"))
      .map(element => clean(element.textContent || ""))
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);
    return {
      id,
      title,
      author: "",
      artist: "",
      synopsis: clean(metaDescription),
      altTitles: [],
      status: "Unknown",
      type: "Manhwa",
      isNsfw: false,
      rating: 0,
      thumbnail: absoluteUrl(findCover(document, slug)),
      genres,
      score: "",
      scorePosition: options?.scorePosition ?? "none",
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const path = decodeURIComponent(id);
    const { document } = await fetchDocument(`/${path}`);
    const items: ClientChapterResponse["items"] = [];
    const seen = new Set<string>();
    for (const anchor of Array.from(document.querySelectorAll("a[href*='/chapter/']"))) {
      const href = anchor.getAttribute("href") || "";
      const chapterPath = sourcePath(href);
      if (!chapterPath || seen.has(chapterPath)) continue;
      const title = clean(anchor.textContent || chapterPath.split("/").pop() || "Chapter");
      seen.add(chapterPath);
      items.push({
        id: encodeURIComponent(chapterPath),
        number: chapterNumber(title, chapterPath),
        title,
        scanlator: SOURCE_NAME,
        date: 0,
      });
    }
    return { items };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const chapterPath = decodeURIComponent(chapterId);
    const { document } = await fetchDocument(`/${chapterPath}`);
    const pages: ClientPageResponse["pages"] = [];
    for (const image of Array.from(document.querySelectorAll("img[src*='/uploads/series/']"))) {
      const url = absoluteUrl(imageValue(image));
      if (!url || !/\/p\d+[-_]/i.test(url)) continue;
      pages.push({ index: pages.length, url });
    }
    return { chapterId, pages };
  },
};

export default adapter;
