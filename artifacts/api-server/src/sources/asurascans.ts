import type {
  MangaSource, ListOptions, MangaListResponse, MangaDetail,
  DetailOptions, ChapterListResponse, PageListResponse, MangaSummary, SourceTag,
} from "./types";
import { makeHttp } from "./scraper-utils";

const API  = "https://api.asurascans.com/api";
const SITE = "https://asurascans.com";

const api = makeHttp(API, { Accept: "application/json", Origin: SITE, Referer: `${SITE}/` });

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
    const chapRes = await api.get<{ data: AsChapter[] }>(`/series/${slug}/chapters`, {
      params: { page: 1, perPage: 9999 },
    });
    const chapters = chapRes.data?.data ?? [];

    return {
      items: chapters.map(ch => ({
        // Format: seriesSlug|||chapterSlug  e.g. "nano-machine|||chapter-318"
        id:        `${slug}|||${ch.slug || String(ch.number)}`,
        number:    ch.number,
        title:     ch.title ? `Chapter ${ch.number}: ${ch.title}` : `Chapter ${ch.number}`,
        scanlator: "",
        date:      ch.published_at ? Math.floor(new Date(ch.published_at).getTime() / 1000) : 0,
      })),
    };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const parts = chapterId.split("|||");
    const seriesSlug = parts[0]!;
    const chapSlug   = parts[1]!;

    interface AsPageInfo { url: string; width?: number; height?: number }
    interface AsChapterRes {
      data: {
        access_gate?: string;
        chapter: { pages: AsPageInfo[] };
      };
    }

    const res = await api.get<AsChapterRes>(`/series/${seriesSlug}/chapters/${chapSlug}`);
    const pages = res.data?.data?.chapter?.pages ?? [];

    if (pages.length === 0) {
      throw new Error(`AsuraScans: no pages returned for ${seriesSlug}/${chapSlug}. The chapter may be locked or unavailable.`);
    }

    return {
      chapterId,
      pages: pages.map((p, i) => ({
        index: i,
        url: `/api/image-proxy?url=${encodeURIComponent(p.url)}&referer=${encodeURIComponent(SITE + "/")}`,
      })),
    };
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
