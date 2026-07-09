/**
 * Rule34 source — backed by rule34.paheal.net (open XML DAPI, no auth needed).
 *
 * Each post is treated as a single-page "manga": one chapter, one image/video.
 * The post's numeric id is used as both mangaId and chapterId throughout.
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

const http = makeHttp(BASE_URL, {
  Accept: "text/xml,application/xml,*/*",
  Referer: `${BASE_URL}/`,
});

const PAGE_SIZE = 20;

// ── XML helpers ───────────────────────────────────────────────────────────────

async function fetchXml(path: string): Promise<cheerio.CheerioAPI> {
  const res = await http.get(path, { responseType: "text" });
  if (res.status >= 400) {
    throw new Error(`[Rule34] Upstream returned HTTP ${res.status} for ${path}`);
  }
  const xml = typeof res.data === "string" ? res.data : String(res.data);
  return cheerio.load(xml, { xmlMode: true });
}

// ── Post → summary/detail helpers ────────────────────────────────────────────

function postTitle(el: cheerio.Element, $: cheerio.CheerioAPI): string {
  const tags = ($(el).attr("tags") ?? "").trim();
  const id   = $(el).attr("id") ?? "";
  const first = tags.split(/\s+/).find(t => t.length > 0) ?? "";
  return first ? `${first} #${id}` : `Post #${id}`;
}

function toSummary($: cheerio.CheerioAPI, el: cheerio.Element): MangaSummary {
  const $el      = $(el);
  const id       = $el.attr("id") ?? "";
  const preview  = $el.attr("preview_url") ?? "";
  return {
    id,
    title:     postTitle(el, $),
    thumbnail: preview,
    type:      "Artwork",
    isNsfw:    true,
  };
}

// ── Core post fetch ───────────────────────────────────────────────────────────

async function fetchPosts(
  tags: string,
  page: number,
): Promise<MangaListResponse> {
  // paheal uses 1-indexed pages; omit tags param entirely when empty (passing "all" returns 0)
  const tagsParam = tags ? `&tags=${encodeURIComponent(tags)}` : "";
  const path = `/api/danbooru/find_posts?limit=${PAGE_SIZE}&page=${page}${tagsParam}`;
  console.log(`[Rule34] GET ${path}`);

  const $ = await fetchXml(path);
  const posts = $("posts > tag").toArray();
  const items = posts.map(el => toSummary($, el));

  // total count is on the <posts> root element
  const total = parseInt($("posts").attr("count") ?? "0", 10);
  const fetched = (page - 1) * PAGE_SIZE + items.length;
  const hasNextPage = fetched < total;

  return { items, page, hasNextPage };
}

// ── Tag cache ─────────────────────────────────────────────────────────────────

let tagCache: SourceTag[] | null = null;

async function loadTags(): Promise<SourceTag[]> {
  if (tagCache) return tagCache;
  const all: SourceTag[] = [];

  // Fetch top ~200 tags across a handful of popular name prefixes
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  const fetched = new Set<string>();

  for (const letter of letters.slice(0, 10)) {
    try {
      const path = `/api/danbooru/find_tags?name=${encodeURIComponent(letter)}&limit=20`;
      const $ = await fetchXml(path);
      $("tags > tag").each((_i, el) => {
        const name   = $(el).attr("name") ?? "";
        const counts = parseInt($(el).attr("counts") ?? "0", 10);
        if (name && !fetched.has(name)) {
          fetched.add(name);
          all.push({ id: name, name, group: "Tag", count: counts });
        }
      });
    } catch {
      // skip failed letters
    }
  }

  // Sort by usage count descending
  all.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  tagCache = all;
  return all;
}

// ── Tags query string builder ─────────────────────────────────────────────────

function buildTagsString(tagIds: string[] | undefined, query?: string): string {
  const parts: string[] = [];

  // Free-text query: treat each word as a tag filter
  if (query && query.trim()) {
    // Replace spaces with underscores (booru convention) and push each token
    for (const word of query.trim().split(/\s+/)) {
      parts.push(word.replace(/\s/g, "_"));
    }
  }

  for (const t of tagIds ?? []) {
    if (t.startsWith("-")) {
      parts.push(`-${t.slice(1)}`);
    } else {
      parts.push(t);
    }
  }

  return parts.join(" ");
}

// ── Source export ─────────────────────────────────────────────────────────────

export const Rule34Source: MangaSource = {
  id:           "en.rule34",
  name:         "Rule34",
  lang:         "en",
  isNsfw:       true,
  // paheal CDN doesn't hotlink-block; no special referer required
  imageReferer: `${BASE_URL}/`,

  async popular(o: ListOptions): Promise<MangaListResponse> {
    const tags = buildTagsString(o.tagIds);
    return fetchPosts(tags, o.page);
  },

  async latest(o: ListOptions): Promise<MangaListResponse> {
    const tags = buildTagsString(o.tagIds);
    return fetchPosts(tags, o.page);
  },

  async search(query: string, o: ListOptions): Promise<MangaListResponse> {
    const tags = buildTagsString(o.tagIds, query);
    return fetchPosts(tags, o.page);
  },

  async tags(): Promise<SourceTag[]> {
    return loadTags();
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const path = `/api/danbooru/find_posts?limit=1&tags=${encodeURIComponent(`id=${id}`)}`;
    const $ = await fetchXml(path);
    const el = $("posts > tag").first();

    if (!el.length) {
      throw new Error(`[Rule34] Post ${id} not found`);
    }

    const rawTags  = (el.attr("tags") ?? "").trim();
    const tagList  = rawTags.split(/\s+/).filter(Boolean);
    const score    = parseInt(el.attr("score") ?? "0", 10);
    const author   = el.attr("author") ?? "";
    const source   = el.attr("source") ?? "";
    const preview  = el.attr("preview_url") ?? "";

    const sourceTags: MangaDetailSourceTag[] = tagList.map(t => ({
      id:    t,
      name:  t.replace(/_/g, " "),
      group: "Tag",
    }));

    return {
      id,
      title:         postTitle(el[0], $),
      author:        author || source || "",
      artist:        "",
      synopsis:      tagList.slice(0, 20).map(t => t.replace(/_/g, " ")).join(", "),
      altTitles:     [],
      status:        "Completed",
      type:          "Artwork",
      isNsfw:        true,
      rating:        0,
      thumbnail:     preview,
      genres:        tagList.map(t => t.replace(/_/g, " ")),
      score:         score > 0 ? String(score) : "",
      scorePosition: score > 0 ? "bottom" : "none",
      sourceTags,
    };
  },

  async chapters(mangaId: string): Promise<ChapterListResponse> {
    return {
      items: [
        {
          id:        mangaId,
          number:    1,
          title:     `Post #${mangaId}`,
          scanlator: "Rule34",
          date:      Math.floor(Date.now() / 1000),
        },
      ],
    };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const path = `/api/danbooru/find_posts?limit=1&tags=${encodeURIComponent(`id=${chapterId}`)}`;
    const $ = await fetchXml(path);
    const el = $("posts > tag").first();

    if (!el.length) {
      throw new Error(`[Rule34] Post ${chapterId} not found`);
    }

    // Prefer full-resolution file; fall back to preview
    const url = el.attr("file_url") ?? el.attr("preview_url") ?? "";
    if (!url) throw new Error(`[Rule34] No file URL for post ${chapterId}`);

    return {
      chapterId,
      pages: [{ index: 0, url }],
    };
  },
};
