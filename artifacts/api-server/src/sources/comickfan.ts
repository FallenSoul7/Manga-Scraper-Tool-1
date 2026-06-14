import * as cheerio from "cheerio";
import type {
  MangaSource,
  ListOptions,
  MangaListResponse,
  MangaDetail,
  DetailOptions,
  ChapterListResponse,
  PageListResponse,
  MangaSummary,
  SourceTag,
} from "./types";
import { makeHttp } from "./scraper-utils";

const BASE = "https://comickfan.com";
const PER_PAGE = 24;

// HTML scraping client
const html = makeHttp(BASE);

// JSON API client (same domain, different Accept header)
const api = makeHttp(BASE, { Accept: "application/json" });

// ---------------------------------------------------------------------------
// NSFW genre detection
// ---------------------------------------------------------------------------
const NSFW_GENRES = new Set([
  "adult", "mature", "hentai", "18+", "ecchi", "smut",
  "doujinshi", "yaoi", "yuri", "gore", "sexual violence",
]);

function checkNsfw(genres: string[]): boolean {
  return genres.some(g => NSFW_GENRES.has(g.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Grid parser — shared by popular / latest / search pages
// ---------------------------------------------------------------------------
function parseGrid($: ReturnType<typeof cheerio.load>): MangaSummary[] {
  const items: MangaSummary[] = [];
  const seen = new Set<string>();

  $("div.thumb-item-flow").each((_i, el) => {
    // Link / slug
    const link = $(el).find("a[href*='/manga/']").first();
    const href = link.attr("href") ?? "";
    const slug = href.split("/manga/")[1]?.replace(/\/$/, "") ?? "";
    if (!slug || seen.has(slug)) return;

    // Cover image — look inside the card
    const img = $(el).find("img[src*='cdncmk.com'], img[src*='comickfan.com']").first();
    const thumbnail = img.attr("src") ?? "";
    if (!thumbnail || thumbnail.includes("thumb-default") || thumbnail.includes("logo")) return;

    // Title — prefer the title attribute of the image, else the bold span text
    const title =
      img.attr("title")?.trim() ||
      $(el).find("span.line-clamp-2, span.font-bold").first().text().trim();
    if (!title) return;

    // Type badge (bottom-left of thumb-cover)
    const typeBadge = $(el).find(".thumb-cover span.uppercase").last().text().trim().toLowerCase();
    const type =
      typeBadge === "manhwa" ? "manhwa" : typeBadge === "manhua" ? "manhua" : typeBadge === "manga" ? "manga" : "manga";

    seen.add(slug);
    items.push({ id: slug, title, thumbnail, type, isNsfw: false });
  });

  return items;
}

// ---------------------------------------------------------------------------
// Chapter API types
// ---------------------------------------------------------------------------
interface CfChapter {
  id: number;
  hash_id: string;
  chapter: string | null;
  title: string | null;
  volume: string | null;
  language: string;
  group_names?: string[];
  published_at?: string | null;
  created_at: string;
  upvotes?: number;
}

interface CfChapterResp {
  data: CfChapter[];
  pagination: {
    current_page: number;
    last_page: number;
    total: number;
  };
}

// Encode chapter identity for use as our chapter ID
function encodeChapterId(slug: string, chapter: string, hashId: string): string {
  return `${slug}|||${chapter}|||${hashId}`;
}
function decodeChapterId(id: string): { slug: string; chapter: string; hashId: string } | null {
  const parts = id.split("|||");
  if (parts.length !== 3) return null;
  return { slug: parts[0], chapter: parts[1], hashId: parts[2] };
}

// Tag cache
let cachedTags: SourceTag[] | null = null;

/**
 * Shared pagination-link detector: is there a page link pointing beyond `currentPage`?
 */
function hasNext($: ReturnType<typeof cheerio.load>, currentPage: number): boolean {
  return !!$("a[href]").filter((_i, el) => {
    const href = $((el as any)).attr("href") ?? "";
    if (!href.includes("page=")) return false;
    try {
      const base = href.startsWith("http") ? href : `https://comickfan.com${href}`;
      const p = parseInt(new URL(base).searchParams.get("page") ?? "0");
      return p > currentPage;
    } catch { return false; }
  }).length;
}

/**
 * Fetch a genre-browsing page via /manga-list/{slug}.
 * This URL reliably supports ?page=N and ?sort=latest.
 * comickfan.com's /advanced-search genre filter is JS-driven and does not
 * support URL params — manga-list is the only server-rendered genre endpoint.
 */
async function fetchMangaList(genre: string, page: number, sort?: string): Promise<MangaListResponse> {
  const params: Record<string, string | number> = { page };
  if (sort) params.sort = sort;
  const res = await html.get(`/manga-list/${genre}`, { params });
  if (res.status >= 400) throw new Error(`ComicKFan manga-list/${genre} error ${res.status}`);
  const $ = cheerio.load(res.data as string);
  return { items: parseGrid($), page, hasNextPage: hasNext($, page) };
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------
export const ComickFanSource: MangaSource = {
  id: "en.comickfan",
  name: "ComicK Fanmade",
  lang: "en",
  isNsfw: false,
  imageReferer: "https://comickfan.com/",

  // ---- Popular ---------------------------------------------------------------
  async popular(opts: ListOptions): Promise<MangaListResponse> {
    const included = (opts.tagIds ?? []).filter((t) => !t.startsWith("-"));
    // Genre filter: use /manga-list/{slug} — the only server-rendered genre endpoint
    if (included.length > 0) return fetchMangaList(included[0], opts.page, opts.sort);
    const params: Record<string, string | number> = { page: opts.page };
    if (opts.sort) params.sort = opts.sort;
    const res = await html.get("/advanced-search", { params });
    if (res.status >= 400) throw new Error(`ComicKFan popular error ${res.status}`);
    const $ = cheerio.load(res.data as string);
    return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($, opts.page) };
  },

  popularSorts: [
    { value: "latest", label: "Last Updated" },
    { value: "", label: "All" },
  ],

  // ---- Latest ---------------------------------------------------------------
  async latest(opts: ListOptions): Promise<MangaListResponse> {
    const included = (opts.tagIds ?? []).filter((t) => !t.startsWith("-"));
    if (included.length > 0) return fetchMangaList(included[0], opts.page, "latest");
    const res = await html.get("/advanced-search", { params: { page: opts.page, sort: "latest" } });
    if (res.status >= 400) throw new Error(`ComicKFan latest error ${res.status}`);
    const $ = cheerio.load(res.data as string);
    return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($, opts.page) };
  },

  // ---- Search ---------------------------------------------------------------
  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    // Genre-only filter (no text query): use manga-list
    const included = (opts.tagIds ?? []).filter((t) => !t.startsWith("-"));
    if (included.length > 0 && !query) return fetchMangaList(included[0], opts.page, opts.sort);
    // Text search via advanced-search (genre filter not supported server-side here)
    const params: Record<string, string | number> = { page: opts.page };
    if (query) params.name = query;
    if (opts.sort) params.sort = opts.sort;
    const res = await html.get("/advanced-search", { params });
    if (res.status >= 400) throw new Error(`ComicKFan search error ${res.status}`);
    const $ = cheerio.load(res.data as string);
    const items = parseGrid($);
    return { items, page: opts.page, hasNextPage: items.length >= PER_PAGE };
  },

  // ---- Details --------------------------------------------------------------
  async details(slug: string, _opts: DetailOptions): Promise<MangaDetail> {
    const res = await html.get(`/manga/${slug}`);
    if (res.status >= 400) throw new Error(`ComicKFan detail error ${res.status} for ${slug}`);
    const $ = cheerio.load(res.data as string);

    // Title
    const title =
      $("h1.comic-title-content").text().trim() ||
      $("meta[property='og:title']").attr("content")?.replace(" - ComicK Fanmade", "").trim() ||
      slug;

    // Cover
    const thumbnail =
      $("img[alt='poster']").attr("src") ||
      $("meta[property='og:image']").attr("content") ||
      "";

    // Alt titles (the alt-title text block)
    const altTitleRaw = $(".manga-title-desktop").text().trim() ||
      $("div.text-gray-100.font-medium").filter((_i, el) => $(el).text().trim() === "").parent().find("div.overflow-y-scroll").text().trim();
    const altTitles = altTitleRaw
      ? altTitleRaw.split(/[/,]/).map((s: string) => s.trim()).filter(Boolean)
      : [];

    // Status / Type — each is in a .bg-gray-700 flex row with a label and a value
    let status = "Unknown";
    let type = "manga";
    $(".bg-gray-700.px-2").each((_i, el) => {
      const label = $(el).find(".text-gray-500").first().text().trim();
      const value = $(el).find(".text-gray-500, .text-white").last().text().trim();
      if (label === "Status") status = value || "Unknown";
      if (label === "Type") type = value.toLowerCase() || "manga";
    });

    // Author — label "Author" then <p> children
    let author = "";
    $("div.text-gray-100.font-medium").each((_i, el) => {
      if ($(el).text().trim() === "Author") {
        author = $(el)
          .parent()
          .find("p")
          .map((_j, p) => $(p).text().trim())
          .get()
          .filter(Boolean)
          .join(", ");
      }
    });
    if (!author) {
      // fallback: look for the author label in the info section
      $("div").filter((_i, el) => $(el).text().trim() === "Author").each((_i, el) => {
        const authorDiv = $(el).closest(".space-y-").find("p").first().text().trim();
        if (authorDiv) author = authorDiv;
      });
    }

    // Genres — links that point to /manga-list/*
    const genres: string[] = [];
    const sourceTags: Array<{ id: string; name: string; group: string }> = [];
    $("a[href*='/manga-list/']").each((_i, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr("href") ?? "";
      const genreSlug = href.split("/manga-list/")[1] ?? "";
      if (name && genreSlug && !genres.includes(name)) {
        genres.push(name);
        sourceTags.push({ id: genreSlug, name, group: "Genre" });
      }
    });

    // Synopsis — the .prose div; strip the "X summary: \n..." prefix
    let synopsis = "";
    $(".prose, .prose-invert, [class*='prose']").each((_i, el) => {
      const raw = $(el).text().trim();
      if (raw.length > synopsis.length) synopsis = raw;
    });
    // Clean up common boilerplate prefix like "Title summary: \n \n You are reading..."
    synopsis = synopsis.replace(/^[^\n]*summary:\s*\n\s*/i, "").trim();

    return {
      id: slug,
      title,
      author: author || "_",
      artist: "",
      synopsis,
      altTitles,
      status,
      type,
      isNsfw: checkNsfw(genres),
      rating: 0,
      thumbnail,
      genres: Array.from(new Set(genres)),
      score: "",
      scorePosition: _opts.score,
      sourceTags,
    };
  },

  // ---- Chapters -------------------------------------------------------------
  async chapters(slug: string): Promise<ChapterListResponse> {
    const allChapters: CfChapter[] = [];
    let page = 1;
    let lastPage = 1;

    do {
      const res = await api.get<CfChapterResp>(`/api/comics/${slug}/chapter-list`, {
        params: { page },
        headers: { Referer: `${BASE}/manga/${slug}` },
      });
      if (res.status >= 400) throw new Error(`ComicKFan chapters error ${res.status}`);
      const body = res.data;
      allChapters.push(...(body.data ?? []));
      lastPage = body.pagination?.last_page ?? 1;
      page++;
    } while (page <= lastPage && page <= 20);

    // Deduplicate by hash_id (keep highest upvotes per chapter number)
    const byChap = new Map<string, CfChapter>();
    for (const ch of allChapters) {
      const key = ch.chapter ?? "0";
      const existing = byChap.get(key);
      if (!existing || (ch.upvotes ?? 0) > (existing.upvotes ?? 0)) {
        byChap.set(key, ch);
      }
    }

    return {
      items: Array.from(byChap.values()).map((ch) => {
        const chapStr = ch.chapter ?? "0";
        const num = parseFloat(chapStr) || 0;
        const numLabel = chapStr.replace(/\.0$/, "");
        let chTitle = `Chapter ${numLabel}`;
        if (ch.volume) chTitle = `Vol.${ch.volume} ${chTitle}`;
        if (ch.title?.trim()) chTitle += `: ${ch.title.trim()}`;
        const scanlator = (ch.group_names ?? []).filter(Boolean).join(", ") || "Unknown";
        const dateStr = ch.published_at ?? ch.created_at;
        const date = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : 0;
        return {
          id: encodeChapterId(slug, chapStr, ch.hash_id),
          number: num,
          title: chTitle,
          scanlator,
          date,
        };
      }),
    };
  },

  // ---- Pages ----------------------------------------------------------------
  async pages(chapterId: string): Promise<PageListResponse> {
    const decoded = decodeChapterId(chapterId);
    if (!decoded) throw new Error(`ComicKFan: invalid chapter ID "${chapterId}"`);
    const { slug, chapter, hashId } = decoded;

    const readingUrl = `/manga/${slug}/chapter-${chapter}-${hashId}`;
    const res = await html.get(readingUrl, {
      headers: { Referer: `${BASE}/manga/${slug}` },
    });
    if (res.status >= 400) throw new Error(`ComicKFan pages error ${res.status}`);

    const $ = cheerio.load(res.data as string);

    // Get the manga cover URL to exclude it from page list
    const coverUrl = $("meta[property='og:image']").attr("content") ?? "";

    // Chapter pages are <img> tags with cdncmk.com src
    const seen = new Set<string>();
    const pageUrls: string[] = [];
    $("img[src*='cdncmk.com']").each((_i, el) => {
      const src = $(el).attr("src") ?? "";
      if (!src || src === coverUrl || seen.has(src)) return;
      seen.add(src);
      pageUrls.push(src);
    });

    return {
      chapterId,
      pages: pageUrls.map((url, i) => ({ index: i, url })),
    };
  },

  // ---- Tags -----------------------------------------------------------------
  async tags(): Promise<SourceTag[]> {
    if (cachedTags) return cachedTags;
    try {
      const res = await html.get("/genres");
      if (res.status >= 400) return [];
      const $ = cheerio.load(res.data as string);
      const tags: SourceTag[] = [];
      const seen = new Set<string>();
      $("a[href*='/manga-list/']").each((_i, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr("href") ?? "";
        const slug = href.split("/manga-list/")[1]?.replace(/\/$/, "") ?? "";
        if (name && slug && !seen.has(slug)) {
          seen.add(slug);
          tags.push({ id: slug, name, group: "Genre" });
        }
      });
      tags.sort((a, b) => a.name.localeCompare(b.name));
      if (tags.length > 0) cachedTags = tags;
      return tags;
    } catch {
      return [];
    }
  },
};
