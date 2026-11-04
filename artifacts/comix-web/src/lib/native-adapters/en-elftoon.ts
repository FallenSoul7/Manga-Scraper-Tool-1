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
const COVER_FALLBACK = "/source-icons/en.elftoon.png";
const PAGE_SIZE = 60;

interface ElfToonSeries {
  slug?: string;
  urlSlug?: string;
  title?: string;
  coverImage?: string;
  type?: string;
  isMature?: boolean;
  nsfw?: boolean;
}

interface ElfToonSeriesResponse {
  data?: ElfToonSeries[];
  meta?: { hasMore?: boolean };
}

interface ElfToonFacetsResponse {
  genres?: Array<{ slug?: string; name?: string }>;
}

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
  const raw = image.getAttribute("data-src")
    || image.getAttribute("data-lazy-src")
    || image.getAttribute("src")
    || image.getAttribute("srcset")
    || "";
  const candidates = raw.split(",")
    .map(value => value.trim().split(/\s+/)[0])
    .map(decodeNextImage)
    .filter(value => value && !value.startsWith("data:") && !/logo|placeholder|avatar/i.test(value));
  return candidates[0] || "";
}

function chapterNumber(text: string, href: string): number {
  const match = `${text} ${href}`.match(/chapter[\s/-]*(\d+(?:\.\d+)?)/i);
  return Number(match?.[1] || 0);
}

function typeLabel(value?: string): string {
  const type = clean(value || "").toUpperCase();
  const labels: Record<string, string> = {
    MANGA: "Manga",
    MANHWA: "Manhwa",
    MANHUA: "Manhua",
    WEBTOON: "Webtoon",
  };
  return labels[type] || clean(value || "Manga") || "Manga";
}

function appendGenreFilters(params: URLSearchParams, tagIds: string[] = []): void {
  const included = new Set<string>();
  const excluded = new Set<string>();
  for (const rawId of tagIds) {
    const isExcluded = rawId.startsWith("-");
    const slug = rawId.replace(/^-+/, "").replace(/^\/+|\/+$/g, "").trim();
    if (slug) (isExcluded ? excluded : included).add(slug);
  }
  if (included.size) params.set("genre", [...included].join(","));
  if (excluded.size) params.set("exgenre", [...excluded].join(","));
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await clientFetch(new URL(path, BASE).toString(), {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${SOURCE_NAME}: HTTP ${response.status}`);
  return await response.json() as T;
}

async function fetchSeriesPage(
  page: number,
  sort?: "popular" | "latest",
  query = "",
  tagIds: string[] = [],
): Promise<ClientListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), contentMode: "all" });
  if (sort) params.set("sort", sort);
  if (query.trim()) params.set("q", query.trim());
  appendGenreFilters(params, tagIds);

  const result = await fetchJson<ElfToonSeriesResponse>(`/api/series?${params.toString()}`);
  if (!Array.isArray(result.data)) throw new Error(`${SOURCE_NAME}: invalid series response.`);
  const items = result.data.flatMap(item => {
    const slug = item.urlSlug || item.slug;
    if (!slug) return [];
    const title = clean(item.title || slug.replace(/-/g, " "));
    return [{
      id: encodeURIComponent(`series/comic/${slug}`),
      title,
      thumbnail: item.coverImage ? absoluteUrl(item.coverImage) : COVER_FALLBACK,
      type: typeLabel(item.type),
      isNsfw: Boolean(item.nsfw || item.isMature),
    }];
  });
  return { items, page, hasNextPage: result.meta?.hasMore ?? result.data.length >= PAGE_SIZE };
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
  const metaImage = document.querySelector('meta[property="og:image"], meta[name="twitter:image"]')?.getAttribute("content") || "";
  if (metaImage && !/logo|placeholder|avatar/i.test(metaImage)) return absoluteUrl(decodeNextImage(metaImage));
  const images = Array.from(document.querySelectorAll("img"));
  const matching = images.find(image => {
    const value = imageValue(image);
    return value.includes(`/uploads/series/${slug}/`) && /\/cover[^/]*\.(?:webp|jpg|jpeg|png)$/i.test(value);
  });
  const cover = imageValue(matching ?? null)
    || images.map(imageValue).find(value => value.includes("/uploads/series/") && /cover/i.test(value));
  return cover ? absoluteUrl(cover) : COVER_FALLBACK;
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  async popular(page, tagIds) {
    return fetchSeriesPage(page, "popular", "", tagIds);
  },

  async latest(page, tagIds) {
    return fetchSeriesPage(page, "latest", "", tagIds);
  },

  async search(query, page, tagIds) {
    return fetchSeriesPage(page, undefined, query, tagIds);
  },

  async tags() {
    const facets = await fetchJson<ElfToonFacetsResponse>("/api/series/facets");
    const tags: NonNullable<ClientMangaDetail["sourceTags"]> = [];
    const seen = new Set<string>();
    for (const genre of facets.genres || []) {
      const id = genre.slug?.trim() || "";
      const name = clean(genre.name || "");
      const key = id.toLowerCase();
      if (!id || !name || seen.has(key)) continue;
      seen.add(key);
      tags.push({ id, name, group: "Genre" });
    }
    if (tags.length === 0) throw new Error(`${SOURCE_NAME}: the genre directory could not be read.`);
    return tags;
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
      type: "Manhua",
      isNsfw: false,
      rating: 0,
      thumbnail: findCover(document, slug),
      genres,
      score: "",
      scorePosition: options?.scorePosition ?? "none",
      sourceTags: genres.map(name => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name, group: "Genre" })),
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
    for (const image of Array.from(document.querySelectorAll("img[src*='/uploads/series/'], img[data-src*='/uploads/series/']"))) {
      const url = absoluteUrl(imageValue(image));
      if (!url || !/\/p\d+[-_]/i.test(url)) continue;
      pages.push({ index: pages.length, url });
    }
    return { chapterId, pages };
  },
};

export default adapter;
