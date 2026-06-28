import * as cheerio from "cheerio";
import type {
  MangaSource, ListOptions, MangaListResponse, MangaDetail,
  DetailOptions, ChapterListResponse, PageListResponse, MangaSummary, SourceTag,
} from "./types";
import { makeHttp } from "./scraper-utils";

const API  = "https://api.asurascans.com/api";
const SITE = "https://asurascans.com";

const api  = makeHttp(API,  { Accept: "application/json", Origin: SITE, Referer: `${SITE}/` });
const html = makeHttp(SITE, { Referer: `${SITE}/` });

const PER = 20;

// ── Types ──────────────────────────────────────────────────────────────────
interface AsSeries {
  id: number; slug: string; title: string;
  alt_titles?: string[]; description?: string;
  cover?: string; status?: string; type?: string;
  author?: string; artist?: string;
  genres?: Array<{ id: number; name: string; slug: string }>;
  public_url?: string; last_chapter_at?: string;
}
interface AsChapter {
  id: number; number: number; title?: string; slug: string;
  is_premium?: boolean; published_at?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function publicSlugFrom(publicUrl: string | undefined, fallback: string): string {
  if (!publicUrl) return fallback;
  return publicUrl.split("/").filter(Boolean).pop() ?? fallback;
}
function toItem(s: AsSeries): MangaSummary {
  const typeRaw = (s.type ?? "").toLowerCase();
  return {
    id: s.slug,
    title: s.title,
    thumbnail: s.cover ?? "",
    type: typeRaw.includes("manhwa") ? "manhwa" : typeRaw.includes("manhua") ? "manhua" : "manga",
    isNsfw: false,
  };
}
function mapStatus(s: string | undefined): string {
  const l = (s ?? "").toLowerCase();
  if (l.includes("ongoing"))   return "Ongoing";
  if (l.includes("completed")) return "Completed";
  if (l.includes("hiatus"))    return "Hiatus";
  if (l.includes("dropped"))   return "Dropped";
  return "Unknown";
}

// ── Pages helper — tries Astro island props, JSON scripts, then img DOM ──────
function extractAstroPages(html: string): string[] {
  // 1) Primary: <astro-island props="HTML-encoded-JSON"> — Astro SSR serialisation format.
  //    Values are wrapped as [type, value] pairs where [0, v] = literal, [1, v] = complex.
  //    Pages array shape: pages → [1, [[0, {url:[0,"https://..."], ...}], ...]]
  const islandMatch = html.match(/<astro-island[^>]+\sprops="([^"]{50,})"/);
  if (islandMatch) {
    try {
      const decoded = islandMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
      const props = JSON.parse(decoded) as Record<string, unknown>;
      const pagesData = props["pages"] as unknown[] | undefined;
      if (Array.isArray(pagesData) && Array.isArray(pagesData[1])) {
        const urls = (pagesData[1] as unknown[])
          .map((entry) => {
            const obj = (entry as unknown[])[1] as Record<string, unknown[]> | undefined;
            const urlTuple = obj?.["url"] as unknown[] | undefined;
            return urlTuple?.[1] as string | undefined;
          })
          .filter((u): u is string => typeof u === "string" && u.startsWith("http"));
        if (urls.length > 0) return urls;
      }
    } catch { /* skip */ }
  }

  // 2) Fallback: <script type="application/json"> blobs
  const jsonScripts = Array.from(html.matchAll(/<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/g));
  for (const m of jsonScripts) {
    try {
      const obj = JSON.parse(m[1] as string);
      const pages: string[] =
        (obj as any)?.pages?.pages ?? (obj as any)?.pages ?? (obj as any)?.data?.pages ?? [];
      if (pages.length > 0) return pages;
    } catch { /* skip */ }
  }

  // 3) Fallback: inline `"pages":[...]`
  const inline = html.match(/"pages"\s*:\s*(\[[\s\S]{1,8000}?\])/);
  if (inline) {
    try {
      const arr = JSON.parse(inline[1] as string) as unknown[];
      const urls: string[] = arr
        .map((p) => (typeof p === "string" ? p : ((p as any).url ?? (p as any).src ?? (p as any).image ?? "")))
        .filter(Boolean);
      if (urls.length > 0) return urls;
    } catch { /* skip */ }
  }
  return [];
}

let cachedTags: SourceTag[] | null = null;

// ── Source ─────────────────────────────────────────────────────────────────
export const AsuraScansSource: MangaSource = {
  id:           "en.asurascans",
  name:         "Asura Scans",
  lang:         "en",
  isNsfw:       false,
  imageReferer: `${SITE}/`,

  popularSorts: [
    { value: "popular", label: "Most Popular" },
    { value: "latest",  label: "Latest Update" },
    { value: "new",     label: "Newest"        },
  ],

  async popular(opts: ListOptions): Promise<MangaListResponse> {
    const res = await api.get<{ data: AsSeries[]; meta: { has_more: boolean } }>("/series", {
      params: { offset: (opts.page - 1) * PER, limit: PER, sort: opts.sort ?? "popular" },
    });
    return { items: res.data.data.map(toItem), page: opts.page, hasNextPage: res.data.meta.has_more };
  },

  async latest(opts: ListOptions): Promise<MangaListResponse> {
    const res = await api.get<{ data: AsSeries[]; meta: { has_more: boolean } }>("/series", {
      params: { offset: (opts.page - 1) * PER, limit: PER, sort: "latest" },
    });
    return { items: res.data.data.map(toItem), page: opts.page, hasNextPage: res.data.meta.has_more };
  },

  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    const included = (opts.tagIds ?? []).filter(t => !t.startsWith("-"));
    const params: Record<string, string | number> = {
      offset: (opts.page - 1) * PER,
      limit:  PER,
    };
    if (query)          params.search = query;
    if (opts.sort)      params.sort   = opts.sort;
    if (included.length) params.genres = included.join(",");

    const res = await api.get<{ data: AsSeries[]; meta: { has_more: boolean } }>("/series", { params });
    return { items: res.data.data.map(toItem), page: opts.page, hasNextPage: res.data.meta.has_more };
  },

  async details(slug: string, opts: DetailOptions): Promise<MangaDetail> {
    const res = await api.get<any>(`/series/${slug}`);
    const s: AsSeries = res.data?.data?.series ?? res.data?.series ?? res.data;

    return {
      id:            slug,
      title:         s.title ?? slug,
      author:        s.author ?? "",
      artist:        s.artist ?? "",
      synopsis:      s.description ?? "",
      altTitles:     s.alt_titles ?? [],
      status:        mapStatus(s.status),
      type:          (s.type ?? "").toLowerCase().includes("manhwa") ? "manhwa"
                     : (s.type ?? "").toLowerCase().includes("manhua") ? "manhua" : "manga",
      isNsfw:        false,
      rating:        0,
      thumbnail:     s.cover ?? "",
      genres:        (s.genres ?? []).map(g => g.name),
      score:         "",
      scorePosition: opts.score,
      sourceTags:    (s.genres ?? []).map(g => ({ id: g.slug, name: g.name, group: "Genre" })),
    };
  },

  async chapters(slug: string, _dedupe: boolean): Promise<ChapterListResponse> {
    // Get the public URL slug (randomised) for building chapter page URLs
    const detailRes = await api.get<any>(`/series/${slug}`);
    const s: AsSeries = detailRes.data?.data?.series ?? detailRes.data?.series ?? detailRes.data;
    const pubSlug = publicSlugFrom(s.public_url, slug);

    const chapRes = await api.get<{ data: AsChapter[] }>(`/series/${slug}/chapters`, {
      params: { page: 1, perPage: 9999 },
    });
    const chapters = chapRes.data?.data ?? [];

    return {
      items: chapters.map(ch => ({
        // Format: pubSlug|||chapterSlug  e.g. "nano-machine-fc4c7eba|||chapter-318"
        id:        `${pubSlug}|||${ch.slug || String(ch.number)}`,
        number:    ch.number,
        title:     ch.title ? `Chapter ${ch.number}: ${ch.title}` : `Chapter ${ch.number}`,
        scanlator: "",
        date:      ch.published_at ? Math.floor(new Date(ch.published_at).getTime() / 1000) : 0,
      })),
    };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const [pubSlug, chapSlugOrNum] = chapterId.split("|||");
    // Support old format (plain number like "318") and new format (slug like "chapter-318")
    const chapPath = /^\d+(\.\d+)?$/.test(chapSlugOrNum)
      ? `chapter/${chapSlugOrNum}`
      : chapSlugOrNum;
    const chapterUrl = `/comics/${pubSlug}/${chapPath}`;

    const res = await html.get(chapterUrl, {
      headers: { Referer: `${SITE}/comics/${pubSlug}` },
    });
    const pageHtml = res.data as string;

    // 1) Try Astro embedded JSON props
    const fromAstro = extractAstroPages(pageHtml);
    if (fromAstro.length > 0) {
      return {
        chapterId,
        pages: fromAstro.map((url, i) => ({
          index: i,
          url: `/api/image-proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(SITE + "/")}`,
        })),
      };
    }

    // 2) Parse DOM for img tags in the reader
    const $ = cheerio.load(pageHtml);
    const urls: string[] = [];
    $("img[src], img[data-src], img[data-lazy]").each((_i, el) => {
      const src = $(el).attr("src") ?? $(el).attr("data-src") ?? $(el).attr("data-lazy") ?? "";
      if (!src || !src.startsWith("http")) return;
      if (src.includes("logo") || src.includes("avatar") || src.includes("cover") || src.includes("banner")) return;
      if (!urls.includes(src)) urls.push(src);
    });

    if (urls.length > 0) {
      return {
        chapterId,
        pages: urls.map((url, i) => ({
          index: i,
          url: `/api/image-proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(SITE + "/")}`,
        })),
      };
    }

    throw new Error(`AsuraScans: no pages found for ${chapterUrl}. The chapter may require a premium subscription.`);
  },

  async tags(): Promise<SourceTag[]> {
    if (cachedTags) return cachedTags;
    try {
      const res = await api.get<{ data: Array<{ slug: string; name: string }> }>("/genres");
      const tags = (res.data?.data ?? []).map(g => ({ id: g.slug, name: g.name, group: "Genre" }));
      if (tags.length > 0) { cachedTags = tags; return tags; }
    } catch { /* fallback */ }
    cachedTags = [
      { id: "action",       name: "Action",       group: "Genre" },
      { id: "adventure",    name: "Adventure",     group: "Genre" },
      { id: "comedy",       name: "Comedy",        group: "Genre" },
      { id: "drama",        name: "Drama",         group: "Genre" },
      { id: "fantasy",      name: "Fantasy",       group: "Genre" },
      { id: "romance",      name: "Romance",       group: "Genre" },
      { id: "isekai",       name: "Isekai",        group: "Genre" },
      { id: "martial-arts", name: "Martial Arts",  group: "Genre" },
      { id: "supernatural", name: "Supernatural",  group: "Genre" },
      { id: "system",       name: "System",        group: "Genre" },
      { id: "manhwa",       name: "Manhwa",        group: "Format"},
    ];
    return cachedTags;
  },
};
