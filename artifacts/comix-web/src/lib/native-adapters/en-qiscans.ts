import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://qimanga.com";
const API_BASE = "https://api.qimanga.com";
const SOURCE_ID = "en.qiscans";
const SOURCE_NAME = "Qi Scans";
const COVER_FALLBACK = "/public/source-icons/en.qiscans.png";
const CHAPTER_PAGE_SIZE = 100;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function absoluteUrl(value: string, reference = BASE): string {
  if (!value) return "";
  try {
    return new URL(value, reference).toString();
  } catch {
    return value;
  }
}

function imageValue(image: Element | null): string {
  if (!image) return "";
  const value = image.getAttribute("src")
    || image.getAttribute("data-src")
    || image.getAttribute("data-lazy-src")
    || image.getAttribute("data-original")
    || image.getAttribute("srcset")
    || "";
  return value.split(",").map(candidate => candidate.trim().split(/\s+/)[0]).find(Boolean) || "";
}

function sourcePath(value: string): string {
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return "";
    return url.pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return value.replace(/^\/+|\/+$/g, "");
  }
}

function routeId(path: string): string {
  return encodeURIComponent(path.replace(/^\/+|\/+$/g, ""));
}

function routeFromId(id: string): string {
  const path = decodeURIComponent(id).replace(/^\/+|\/+$/g, "");
  if (!path.startsWith("series/")) throw new Error(`${SOURCE_NAME}: invalid series or chapter ID.`);
  return path;
}

async function fetchDocument(path: string): Promise<Document> {
  const url = new URL(path, BASE).toString();
  const response = await clientFetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  });
  if (!response.ok) throw new Error(`${SOURCE_NAME}: HTTP ${response.status}`);
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await clientFetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${SOURCE_NAME}: chapter API returned HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

function listPath(page: number, sort: "latest" | "popular", tagIds: string[] = []): string {
  const tag = tagIds.find(value => value && !value.startsWith("-"));
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (!tag) params.set("sort", sort);
  const query = params.toString();
  return `${tag ? `/genres/${encodeURIComponent(tag)}` : "/browse"}${query ? `?${query}` : ""}`;
}

function pageHasNext(document: Document, page: number, itemCount: number): boolean {
  const info = clean(document.querySelector("nav.pagination .page-info")?.textContent || "");
  const match = info.match(/(\d+)\s*\/\s*(\d+)/);
  if (match) return Number(match[1]) < Number(match[2]);
  const next = document.querySelector<HTMLButtonElement>(
    "nav.pagination button[aria-label*='Next'], nav.pagination button.page-nav:last-child",
  );
  if (next) return !next.disabled && next.getAttribute("aria-disabled") !== "true";
  return itemCount >= 20 && page >= 1;
}

function parseList(document: Document, page: number): ClientListResponse {
  const items: ClientListResponse["items"] = [];
  const seen = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/series/"]'))) {
    const path = sourcePath(anchor.href);
    const match = path.match(/^series\/([^/]+)$/i);
    if (!match || seen.has(match[1])) continue;
    const image = anchor.querySelector("img");
    const card = anchor.closest("article") || anchor.closest(".series-card, .series-item, .manga-card") || anchor;
    const title = clean(
      image?.getAttribute("alt")
      || anchor.querySelector("h2, h3, .series-title, .series-name")?.textContent
      || anchor.getAttribute("title")
      || "",
    );
    if (!title) continue;
    const typeText = clean(card.textContent || "").match(/\b(MANHWA|MANGA|MANHUA|NOVEL)\b/i)?.[1]?.toLowerCase();
    const type = typeText ? typeText[0].toUpperCase() + typeText.slice(1) : "Manga";
    const thumbnail = absoluteUrl(imageValue(image)) || COVER_FALLBACK;
    seen.add(match[1]);
    items.push({
      id: routeId(path),
      title,
      thumbnail,
      type,
      isNsfw: false,
    });
  }
  return { items, page, hasNextPage: pageHasNext(document, page, items.length) };
}

function parseGenreLinks(document: Document): Array<{ id: string; name: string; group: string }> {
  const tags: Array<{ id: string; name: string; group: string }> = [];
  const seen = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const path = sourcePath(anchor.href);
    const match = path.match(/^genres\/([^/]+)$/i);
    if (!match) continue;
    let id = match[1];
    try { id = decodeURIComponent(id); } catch { /* Keep the source slug. */ }
    const name = clean(anchor.textContent || "").replace(/\s*\d+\s+series\b.*$/i, "");
    const key = id.toLowerCase();
    if (!id || !name || seen.has(key)) continue;
    seen.add(key);
    tags.push({ id, name, group: "Genre" });
  }
  return tags;
}

function labelValue(document: Document, labelText: string): string {
  for (const label of Array.from(document.querySelectorAll(".status-label, dt"))) {
    if (clean(label.textContent || "").toLowerCase() !== labelText.toLowerCase()) continue;
    const parent = label.parentElement;
    const value = parent?.querySelector(".status-value, dd, a")?.textContent
      || parent?.textContent?.replace(label.textContent || "", "")
      || "";
    return clean(value);
  }
  for (const label of Array.from(document.querySelectorAll("span, strong, b, dt"))) {
    if (clean(label.textContent || "").toLowerCase() !== labelText.toLowerCase()) continue;
    const value = label.parentElement?.textContent?.replace(label.textContent || "", "") || "";
    if (clean(value)) return clean(value);
  }
  return "";
}

function parseRating(document: Document): number {
  const raw = document.querySelector('meta[itemprop="ratingValue"]')?.getAttribute("content")
    || document.querySelector(".rating-score, .rating-value, .rating-number")?.textContent
    || "";
  const value = Number.parseFloat(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

interface QiChapter {
  slug: string;
  number: number;
  title: string | null;
  cover: string | null;
  createdAt: string | null;
}
interface QiChapterPage {
  data: QiChapter[];
  totalItems: number;
  nextCursor: string | null;
  hasMore: boolean;
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",
  fallbackToServerOnNative: true,
  async popular(page, tagIds) {
    return parseList(await fetchDocument(listPath(page, "popular", tagIds)), page);
  },
  async latest(page, tagIds) {
    return parseList(await fetchDocument(listPath(page, "latest", tagIds)), page);
  },
  async search(query, page) {
    const params = new URLSearchParams({ q: query });
    if (page > 1) params.set("page", String(page));
    return parseList(await fetchDocument(`/search?${params.toString()}`), page);
  },
  async tags() {
    const tags = parseGenreLinks(await fetchDocument("/genres"));
    if (tags.length === 0) throw new Error(`${SOURCE_NAME}: the genre directory could not be read.`);
    return tags;
  },
  async details(id, options): Promise<ClientMangaDetail> {
    const path = routeFromId(id);
    const document = await fetchDocument(`/${path}`);
    const title = clean(document.querySelector("h1")?.textContent || document.title.replace(/\s*\|.*$/, ""));
    const synopsisHeading = Array.from(document.querySelectorAll("h2.section-heading"))
      .find(heading => clean(heading.textContent || "").toLowerCase() === "synopsis");
    const synopsisContainer = synopsisHeading?.parentElement;
    const synopsis = clean(
      synopsisContainer?.querySelector("p, .synopsis-text, .synopsis-content")?.textContent
      || synopsisContainer?.textContent?.replace(synopsisHeading?.textContent || "", "")
      || document.querySelector('meta[name="description"]')?.getAttribute("content")
      || "",
    );
    const tags = parseGenreLinks(document);
    const image = document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
    const thumbnail = absoluteUrl(image) || COVER_FALLBACK;
    const type = labelValue(document, "Title Type") || "Manga";
    const status = labelValue(document, "Title Status") || "Unknown";
    return {
      id,
      title: title || path.split("/").pop() || "Untitled",
      author: labelValue(document, "Author"),
      artist: labelValue(document, "Artist"),
      synopsis,
      altTitles: [],
      status,
      type: type.charAt(0).toUpperCase() + type.slice(1).toLowerCase(),
      isNsfw: false,
      rating: parseRating(document),
      thumbnail,
      genres: tags.map(tag => tag.name),
      score: "",
      scorePosition: options?.scorePosition ?? "none",
      sourceTags: tags,
    };
  },
  async chapters(id): Promise<ClientChapterResponse> {
    const seriesPath = routeFromId(id);
    const seriesSlug = seriesPath.split("/").pop() || "";
    if (!seriesSlug) throw new Error(`${SOURCE_NAME}: invalid series ID.`);
    const items: ClientChapterResponse["items"] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let totalItems = 0;
    let hasMore = true;
    let requestCount = 0;
    while (hasMore) {
      if (++requestCount > 100) throw new Error(`${SOURCE_NAME}: chapter pagination exceeded its safety limit.`);
      const params = new URLSearchParams({ limit: String(CHAPTER_PAGE_SIZE), sort: "desc" });
      if (cursor) params.set("cursor", cursor);
      const result = await fetchJson<QiChapterPage>(
        `${API_BASE}/api/v2/series/${encodeURIComponent(seriesSlug)}/chapters?${params.toString()}`,
      );
      if (!Array.isArray(result.data)) throw new Error(`${SOURCE_NAME}: chapter API returned an invalid response.`);
      totalItems = result.totalItems || totalItems;
      for (const chapter of result.data) {
        if (!chapter.slug || !Number.isFinite(Number(chapter.number))) continue;
        const chapterPath = `${seriesPath}/${chapter.slug}`;
        const subtitle = clean(chapter.title || "");
        const date = chapter.createdAt ? Date.parse(chapter.createdAt) : 0;
        items.push({
          id: routeId(chapterPath),
          number: Number(chapter.number),
          title: `Chapter ${chapter.number}${subtitle ? ` ${subtitle}` : ""}`,
          scanlator: SOURCE_NAME,
          date: Number.isFinite(date) ? date : 0,
          ...(chapter.cover ? { thumbnail: absoluteUrl(chapter.cover, API_BASE) } : {}),
        });
      }
      hasMore = Boolean(result.hasMore);
      const nextCursor = result.nextCursor || null;
      if (hasMore && (!nextCursor || seenCursors.has(nextCursor))) {
        throw new Error(`${SOURCE_NAME}: chapter pagination returned an invalid cursor.`);
      }
      if (nextCursor) seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    if (totalItems > 0 && items.length < totalItems) {
      throw new Error(`${SOURCE_NAME}: only ${items.length} of ${totalItems} chapters could be loaded.`);
    }
    return { items };
  },
  async pages(chapterId): Promise<ClientPageResponse> {
    const chapterPath = routeFromId(chapterId);
    const document = await fetchDocument(`/${chapterPath}`);
    const pageImages = Array.from(document.querySelectorAll("img"))
      .map(image => ({ image, value: imageValue(image) }))
      .filter(({ image, value }) => /^page\s+\d+$/i.test(clean(image.getAttribute("alt") || ""))
        || /\/page_\d+\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(value))
      .map(({ image, value }) => ({
        page: Number(clean(image.getAttribute("alt") || "").match(/\d+/)?.[0] || value.match(/page_(\d+)/i)?.[1] || 0),
        url: absoluteUrl(value),
      }))
      .filter(page => page.page > 0 && page.url)
      .sort((a, b) => a.page - b.page);
    if (pageImages.length === 0) throw new Error(`${SOURCE_NAME}: no reader pages were found for this chapter.`);
    return {
      chapterId,
      pages: pageImages.map((page, index) => ({ index, url: page.url })),
    };
  },
};

export default adapter;
