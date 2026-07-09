/**
 * Rule34 source — backed by rule34.paheal.net (open XML DAPI + HTML tag scraping).
 *
 * Each post is a single artwork entry: one chapter, one image (or video preview).
 * Tags are scraped from /tags/popularity and /tags/map?starts_with=X pages.
 */
import * as cheerio from "cheerio";
import type {
  MangaSource,
  ListOptions,
  MangaListResponse,
  MangaDetail,
  MangaDetailSourceTag,
  DetailOptions,
  ChapterListResponse,
  PageListResponse,
  MangaSummary,
  SourceTag,
} from "./types";
import { makeHttp } from "./scraper-utils";

const BASE_URL = "https://rule34.paheal.net";
const CDN_URL  = "https://r34i.paheal-cdn.net";

const http = makeHttp(BASE_URL, {
  Accept: "text/html,text/xml,application/xml,*/*",
  Referer: `${BASE_URL}/`,
});

const PAGE_SIZE = 20;

// ── Meta tags to skip when picking a display title ───────────────────────────
const META_TAGS = new Set([
  "ai-generated", "animated", "sound", "video", "tagme", "edit", "3d",
  "rule34", "audio", "loop", "fakes", "comic", "crossover", "absurdres",
  "highres", "lowres", "sketch", "monochrome", "censored", "uncensored",
  "english_text", "speech_bubble", "text", "watermark", "signature",
  "artist_request", "character_request", "series_request",
]);

// ── Raw URL passthrough ────────────────────────────────────────────────────────
// The frontend's proxyImage() wraps raw URLs as /api/image?url=<raw>&source=en.rule34
// The /api/image route then uses source.imageReferer (https://rule34.paheal.net/)
// to set the correct referer when fetching from paheal's CDN.
// Do NOT pre-proxy here — returning /api/image-proxy?... relative paths causes a
// double-wrap that makes /api/image fail its URL validation with 400.
function rawUrl(url: string): string {
  return url ?? "";
}

// ── Video file detection ──────────────────────────────────────────────────────
function isVideo(fileName: string, fileUrl?: string): boolean {
  const check = fileName || fileUrl || "";
  return /\.(mp4|webm|mov|avi|mkv|flv)$/i.test(check);
}

// ── XML fetch helper ──────────────────────────────────────────────────────────
async function fetchXml(path: string): Promise<cheerio.CheerioAPI> {
  const res = await http.get(path, { responseType: "text" });
  if (res.status >= 400) {
    throw new Error(`[Rule34] HTTP ${res.status} for ${path}`);
  }
  return cheerio.load(typeof res.data === "string" ? res.data : String(res.data), { xmlMode: true });
}

// ── HTML fetch helper ─────────────────────────────────────────────────────────
async function fetchHtmlPage(path: string): Promise<cheerio.CheerioAPI> {
  const res = await http.get(path, { responseType: "text" });
  if (res.status >= 400) throw new Error(`[Rule34] HTTP ${res.status} for ${path}`);
  return cheerio.load(typeof res.data === "string" ? res.data : String(res.data));
}

// ── Post → title (skip meta tags, pick first meaningful one) ─────────────────
function pickTitle(rawTags: string, id: string): string {
  const tags = rawTags.split(/\s+/).filter(Boolean);
  const meaningful = tags.find(t => !META_TAGS.has(t.toLowerCase()));
  if (meaningful) {
    // Convert underscore to space and title-case for display
    return meaningful.replace(/_/g, " ");
  }
  return `Post #${id}`;
}

// ── Post → summary ────────────────────────────────────────────────────────────
function toSummary($: cheerio.CheerioAPI, el: cheerio.Element): MangaSummary {
  const $el     = $(el);
  const id      = $el.attr("id") ?? "";
  const rawTags = ($el.attr("tags") ?? "").trim();
  const preview = $el.attr("preview_url") ?? "";

  return {
    id,
    title:     pickTitle(rawTags, id),
    thumbnail: rawUrl(preview),
    type:      "Artwork",
    isNsfw:    true,
  };
}

// ── Core post fetch ───────────────────────────────────────────────────────────
async function fetchPosts(tags: string, page: number): Promise<MangaListResponse> {
  // paheal is 1-indexed; omit tags param entirely when empty
  const tagsParam = tags.trim()
    ? `&tags=${encodeURIComponent(tags.trim())}`
    : "";
  const path = `/api/danbooru/find_posts?limit=${PAGE_SIZE}&page=${page}${tagsParam}`;
  console.log(`[Rule34] GET ${path}`);

  const $ = await fetchXml(path);
  const posts = $("posts > tag").toArray();
  const items = posts.map(el => toSummary($, el));

  const total  = parseInt($("posts").attr("count") ?? "0", 10);
  const hasNextPage = (page - 1) * PAGE_SIZE + items.length < total;

  return { items, page, hasNextPage };
}

// ── Tags: scrape /tags/popularity then /tags/map?starts_with=X ───────────────

let tagCache: SourceTag[] | null = null;
let tagLoadPromise: Promise<SourceTag[]> | null = null;

function parseFontSize(style: string): number {
  const m = style.match(/font-size:\s*([\d.]+)em/);
  return m ? parseFloat(m[1]) : 1;
}

async function scrapeTagPage(path: string): Promise<SourceTag[]> {
  const tags: SourceTag[] = [];
  try {
    const $ = await fetchHtmlPage(path);
    $("a[href^='/post/list/']").each((_i, el) => {
      try {
        const $a  = $(el);
        const href = $a.attr("href") ?? "";
        const m   = href.match(/^\/post\/list\/([^/]+)\/1$/);
        if (!m) return;

        let rawId: string;
        try {
          rawId = decodeURIComponent(m[1]); // e.g. "A_Certain_Magical_Index"
        } catch {
          rawId = m[1]; // use raw if decode fails
        }
        const name = rawId.replace(/_/g, " ");
        if (!name.trim()) return;

        const style = $a.attr("style") ?? "";
        const size  = parseFontSize(style);
        tags.push({ id: rawId, name, group: "Tag", count: Math.round(size * 1000) });
      } catch {
        // skip malformed entries silently
      }
    });
  } catch (e: any) {
    console.warn(`[Rule34] Tag scrape failed for ${path}: ${e.message}`);
  }
  return tags;
}

async function loadAllTags(): Promise<SourceTag[]> {
  const seen = new Map<string, SourceTag>();

  // 1. Popularity page — top tags first (seeded with higher counts)
  const popularTags = await scrapeTagPage("/tags/popularity");
  for (const t of popularTags) {
    seen.set(t.id, { ...t, count: (t.count ?? 0) + 100_000 }); // boost so they sort first
  }

  // 2. A–Z + digits map pages in parallel (batches of 6)
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
  const BATCH = 6;
  for (let i = 0; i < chars.length; i += BATCH) {
    const batch = chars.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(c => scrapeTagPage(`/tags/map?starts_with=${c}`))
    );
    for (const tags of results) {
      for (const t of tags) {
        if (!seen.has(t.id)) {
          seen.set(t.id, t);
        }
      }
    }
  }

  // Sort: most popular first (by count proxy)
  const all = Array.from(seen.values());
  all.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  return all;
}

async function getTags(): Promise<SourceTag[]> {
  if (tagCache) return tagCache;
  if (tagLoadPromise) return tagLoadPromise;

  tagLoadPromise = loadAllTags()
    .then(tags => {
      tagCache = tags;
      tagLoadPromise = null;
      console.log(`[Rule34] Loaded ${tags.length} tags`);
      return tags;
    })
    .catch(e => {
      tagLoadPromise = null;
      console.error("[Rule34] Tag load failed:", e.message);
      return [];
    });

  return tagLoadPromise;
}

// ── Tags string builder ────────────────────────────────────────────────────────
// Paheal booru convention: space = AND between separate tags.
// Multi-word tag names use underscores (e.g. One_Piece, Genshin_Impact).
// We pass each query word as its own tag so "naruto hinata" = posts with BOTH.
// Users wanting a multi-word series should type underscores: "One_Piece".
function buildTagsString(tagIds: string[] | undefined, query?: string): string {
  const parts: string[] = [];

  if (query && query.trim()) {
    // Each whitespace-separated token is its own tag term
    for (const word of query.trim().split(/\s+/)) {
      if (word) parts.push(word);
    }
  }

  for (const t of tagIds ?? []) {
    if (t) parts.push(t);
  }

  return parts.join(" ");
}

// ── Source export ─────────────────────────────────────────────────────────────
export const Rule34Source: MangaSource = {
  id:           "en.rule34",
  name:         "Rule34",
  lang:         "en",
  isNsfw:       true,
  imageReferer: `${BASE_URL}/`,

  async popular(o: ListOptions): Promise<MangaListResponse> {
    return fetchPosts(buildTagsString(o.tagIds), o.page);
  },

  async latest(o: ListOptions): Promise<MangaListResponse> {
    return fetchPosts(buildTagsString(o.tagIds), o.page);
  },

  async search(query: string, o: ListOptions): Promise<MangaListResponse> {
    return fetchPosts(buildTagsString(o.tagIds, query), o.page);
  },

  async tags(): Promise<SourceTag[]> {
    return getTags();
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const path = `/api/danbooru/find_posts?limit=1&tags=${encodeURIComponent(`id=${id}`)}`;
    const $ = await fetchXml(path);
    const el = $("posts > tag").first();

    if (!el.length) throw new Error(`[Rule34] Post ${id} not found`);

    const rawTags  = (el.attr("tags") ?? "").trim();
    const tagList  = rawTags.split(/\s+/).filter(Boolean);
    const fileName = el.attr("file_name") ?? "";
    const score    = parseInt(el.attr("score") ?? "0", 10);
    const author   = el.attr("author") ?? "";
    const source   = el.attr("source") ?? "";
    const preview  = el.attr("preview_url") ?? "";

    // Build sourceTags — each tag on the post, grouped simply as "Tag"
    const sourceTags: MangaDetailSourceTag[] = tagList.map(t => ({
      id:    t,
      name:  t.replace(/_/g, " "),
      group: "Tag",
    }));

    return {
      id,
      title:         pickTitle(rawTags, id),
      author:        author || "",
      artist:        source || "",
      synopsis:      "",
      altTitles:     [],
      status:        "Completed",
      type:          "Artwork",
      isNsfw:        true,
      rating:        0,
      thumbnail:     rawUrl(preview),
      genres:        tagList.map(t => t.replace(/_/g, " ")),
      score:         score > 0 ? String(score) : "",
      scorePosition: score > 0 ? "bottom" : "none",
      sourceTags,
    };
  },

  async chapters(mangaId: string): Promise<ChapterListResponse> {
    return {
      items: [{
        id:        mangaId,
        number:    1,
        title:     `Post #${mangaId}`,
        scanlator: "Rule34",
        date:      Math.floor(Date.now() / 1000),
      }],
    };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const path = `/api/danbooru/find_posts?limit=1&tags=${encodeURIComponent(`id=${chapterId}`)}`;
    const $ = await fetchXml(path);
    const el = $("posts > tag").first();

    if (!el.length) throw new Error(`[Rule34] Post ${chapterId} not found`);

    const fileName   = el.attr("file_name") ?? "";
    const fileUrl    = el.attr("file_url") ?? "";
    const previewUrl = el.attr("preview_url") ?? "";

    // For videos, fall back to the preview thumbnail (viewer is image-only)
    const isVid = isVideo(fileName, fileUrl);
    const imageUrl = isVid ? previewUrl : (fileUrl || previewUrl);

    if (!imageUrl) throw new Error(`[Rule34] No image URL for post ${chapterId}`);

    return {
      chapterId,
      pages: [{ index: 0, url: imageUrl }],
    };
  },
};
