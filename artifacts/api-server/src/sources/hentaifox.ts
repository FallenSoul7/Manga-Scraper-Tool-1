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
import { absUrl, fetchHtml, makeHttp, fetchJson } from "./scraper-utils";

const BASE_URL = "https://hentaifox.com";
const http = makeHttp(BASE_URL);

let cachedTags: SourceTag[] | null = null;

// ── Title extraction helpers ──────────────────────────────────────────────
function extractTitleFromElement($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string {
  const candidates = [
    $el.find(".caption h2, .caption h3").first().text().trim(),
    $el.find("a").first().attr("title")?.trim(),
    $el.find("h2, h3").first().text().trim(),
    $el.find("img").attr("alt")?.trim(),
  ];
  for (const c of candidates) {
    if (c && !/^\d+$/.test(c)) return c;
  }
  return "";
}

function buildSummary($: cheerio.CheerioAPI, el: any): MangaSummary | null {
  const $el = $(el);
  const a = $el.find("a").first();
  const href = a.attr("href") || "";
  if (!href) return null;
  const idMatch = href.match(/\/gallery\/(\d+)/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const title = extractTitleFromElement($, $el) || `Gallery ${id}`;
  const img = $el.find("img");
  const thumb = img.attr("data-src") || img.attr("src") || "";
  return {
    id,
    title,
    thumbnail: absUrl(BASE_URL, thumb),
    type: "Doujinshi",
    isNsfw: true,
  };
}

// ── Listing helpers ───────────────────────────────────────────────────────

/**
 * Fetch a server‑rendered listing page. `path` is relative to BASE_URL
 * (e.g. "/" or "/tag/sometag/"). Pagination is done by appending
 * /page/{page}/ to the URL (the way HentaiFox actually works).
 */
async function fetchLegacyList(path: string, page: number): Promise<MangaListResponse> {
  // Ensure path ends with /
  const base = path.endsWith("/") ? path : path + "/";
  const url = page > 1 ? `${BASE_URL}${base}page/${page}/` : `${BASE_URL}${base}`;
  console.log(`[HentaiFox] Fetching legacy list: ${url}`);
  const { $ } = await fetchHtml(http, url);
  const items: MangaSummary[] = [];
  $(".col-6, .gallery, .g-wrap").each((_i, el) => {
    const s = buildSummary($, el);
    if (s) items.push(s);
  });
  // If no items found, try looser selector
  if (items.length === 0) {
    $("a[href*='/gallery/']").each((_i, el) => {
      const $el = $(el);
      const href = $el.attr("href") || "";
      const m = href.match(/\/gallery\/(\d+)/);
      if (!m) return;
      const id = m[1];
      if (items.some(i => i.id === id)) return;
      const title = extractTitleFromElement($, $el) || `Gallery ${id}`;
      const img = $el.find("img");
      const thumb = img.attr("data-src") || img.attr("src") || "";
      items.push({ id, title, thumbnail: absUrl(BASE_URL, thumb), type: "Doujinshi", isNsfw: true });
    });
  }
  const hasNext = $("a.next, .next a, [rel='next']").length > 0
    || $("ul.pagination li.active").next("li").length > 0;
  console.log(`[HentaiFox] Legacy list found ${items.length} items, hasNext: ${hasNext}`);
  return { items, page, hasNextPage: hasNext };
}

/**
 * Fallback: use the search endpoint (which is server‑rendered)
 * with an empty query and a sort parameter.
 */
async function fetchSearchList(sort: string, page: number, query: string = ""): Promise<MangaListResponse> {
  const params = new URLSearchParams();
  params.set("q", query);
  if (sort) params.set("sort", sort);
  params.set("page", String(page));
  const url = `${BASE_URL}/search/?${params.toString()}`;
  console.log(`[HentaiFox] Fetching search list: ${url}`);
  const { $ } = await fetchHtml(http, url);
  const items: MangaSummary[] = [];
  // The search results use the same grid structure
  $(".col-6, .gallery, .g-wrap").each((_i, el) => {
    const s = buildSummary($, el);
    if (s) items.push(s);
  });
  if (items.length === 0) {
    $("a[href*='/gallery/']").each((_i, el) => {
      const $el = $(el);
      const href = $el.attr("href") || "";
      const m = href.match(/\/gallery\/(\d+)/);
      if (!m) return;
      const id = m[1];
      if (items.some(i => i.id === id)) return;
      const title = extractTitleFromElement($, $el) || `Gallery ${id}`;
      const img = $el.find("img");
      const thumb = img.attr("data-src") || img.attr("src") || "";
      items.push({ id, title, thumbnail: absUrl(BASE_URL, thumb), type: "Doujinshi", isNsfw: true });
    });
  }
  const hasNext = $("a.next, .next a, [rel='next']").length > 0
    || $("ul.pagination li.active").next("li").length > 0;
  console.log(`[HentaiFox] Search list found ${items.length} items, hasNext: ${hasNext}`);
  return { items, page, hasNextPage: hasNext };
}

// ── Brace‑counting JSON extractor ─────────────────────────────────────────
function extractJsonFromScript(html: string, varName: string): any | null {
  const idx = html.indexOf(varName);
  if (idx === -1) return null;
  const start = html.indexOf("{", idx);
  const bracket = html.indexOf("[", idx);
  let realStart = start;
  if (bracket !== -1 && (start === -1 || bracket < start)) realStart = bracket;
  if (realStart === -1) return null;
  const char = html[realStart];
  const close = char === "{" ? "}" : "]";
  let depth = 0;
  let end = -1;
  for (let i = realStart; i < html.length; i++) {
    if (html[i] === char) depth++;
    else if (html[i] === close) {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  try {
    return JSON.parse(html.slice(realStart, end + 1));
  } catch {
    return null;
  }
}

// ── Source object ─────────────────────────────────────────────────────────
export const HentaiFoxSource: MangaSource = {
  id: "all.hentaifox",
  name: "HentaiFox",
  lang: "all",
  isNsfw: true,
  imageReferer: `${BASE_URL}/`,

  // ── Popular ──────────────────────────────────────────────────
  async popular(o: ListOptions) {
    // If tags are selected, use the legacy tag page (which might be server-rendered)
    if (o.tagIds && o.tagIds.length > 0) {
      const tag = o.tagIds.filter(t => !t.startsWith("-"))[0] || "";
      if (tag) return fetchLegacyList(`/tag/${tag}/`, o.page);
    }
    // Otherwise, use the search endpoint with sort=views (most popular)
    return fetchSearchList("views", o.page);
  },

  // ── Latest ────────────────────────────────────────────────────
  async latest(o: ListOptions) {
    if (o.tagIds && o.tagIds.length > 0) {
      const tag = o.tagIds.filter(t => !t.startsWith("-"))[0] || "";
      if (tag) return fetchLegacyList(`/tag/${tag}/`, o.page);
    }
    return fetchSearchList("date", o.page);
  },

  // ── Search ────────────────────────────────────────────────────
  async search(query: string, o: ListOptions) {
    if (!query && o.tagIds && o.tagIds.length > 0) {
      const tag = o.tagIds.filter(t => !t.startsWith("-"))[0] || "";
      if (tag) return fetchLegacyList(`/tag/${tag}/`, o.page);
    }
    return fetchSearchList("", o.page, query);
  },

  // ── Tags ──────────────────────────────────────────────────────
  async tags(): Promise<SourceTag[]> {
    if (cachedTags) return cachedTags;
    console.log("[HentaiFox] Fetching tags...");
    const tags: SourceTag[] = [];
    const seen = new Set<string>();

    // 1. From /tags/ page
    try {
      const { $ } = await fetchHtml(http, `${BASE_URL}/tags/`);
      $("a[href*='/tag/']").each((_i, el) => {
        const $el = $(el);
        const href = $el.attr("href") || "";
        const m = href.match(/\/tag\/([^/]+)\/?$/);
        if (!m) return;
        const slug = m[1];
        const name = $el.text().trim().replace(/\s*\d+$/, "").trim();
        if (name && slug && !seen.has(slug)) {
          seen.add(slug);
          tags.push({ id: slug, name, group: "Tag" });
        }
      });
    } catch (e) {
      console.warn("[HentaiFox] /tags/ fetch failed, trying search form.");
    }

    // 2. From the search form checkboxes (present on / and /search/)
    try {
      const { $ } = await fetchHtml(http, `${BASE_URL}/`);
      $("input[name='tag[]'], input[data-tag]").each((_i, el) => {
        const $el = $(el);
        const value = $el.attr("value") || $el.attr("data-tag") || "";
        const label = $(`label[for="${$el.attr("id")}"]`).text().trim()
                     || $el.closest("label").text().trim()
                     || value;
        if (value && !seen.has(value)) {
          seen.add(value);
          tags.push({ id: value, name: label || value, group: "Tag" });
        }
      });
    } catch (e) {
      console.warn("[HentaiFox] Search form tags fetch failed.");
    }

    cachedTags = tags;
    console.log(`[HentaiFox] Found ${tags.length} tags`);
    return tags;
  },

  // ── Details ───────────────────────────────────────────────────
  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const url = `${BASE_URL}/gallery/${id}/`;
    console.log(`[HentaiFox] Fetching details: ${url}`);
    const { $ } = await fetchHtml(http, url);

    const title = $("h1, .info h1, .caption h1").first().text().trim()
      || $("title").text().replace(/\s*[-|].*$/, "").trim();

    const thumb = $(".cover img, .preview_thumb img").first();
    const thumbnail = absUrl(BASE_URL, thumb.attr("data-src") || thumb.attr("src") || "");

    const genres: string[] = [];
    $("a[href*='/tag/'], a[href*='/category/']").each((_i, el) => {
      const t = $(el).text().trim().replace(/\s*\d+$/, "").trim();
      if (t) genres.push(t);
    });

    const pageCount = parseInt($(".pages, .info li:contains('Pages')").text().replace(/\D/g, "")) || 0;

    return {
      id,
      title: title || `Gallery ${id}`,
      author: $("a[href*='/artist/']").first().text().trim(),
      artist: "",
      synopsis: `${pageCount > 0 ? `${pageCount} pages. ` : ""}${genres.slice(0, 8).join(", ")}`,
      altTitles: [],
      status: "Completed",
      type: "Doujinshi",
      isNsfw: true,
      rating: 0,
      thumbnail,
      genres,
      score: "",
      scorePosition: "none",
    };
  },

  // ── Chapters ──────────────────────────────────────────────────
  async chapters(mangaId: string): Promise<ChapterListResponse> {
    const url = `${BASE_URL}/gallery/${mangaId}/`;
    const { $ } = await fetchHtml(http, url);
    const pageCount = parseInt($(".pages, .info li:contains('Pages')").text().replace(/\D/g, "")) || 1;
    const title = $("h1, .info h1").first().text().trim() || `Gallery ${mangaId}`;
    return {
      items: [{
        id: mangaId,
        number: 1,
        title,
        scanlator: "HentaiFox",
        date: Math.floor(Date.now() / 1000),
      }],
    };
  },

  // ── Pages ─────────────────────────────────────────────────────
  async pages(chapterId: string): Promise<PageListResponse> {
    const url = `${BASE_URL}/gallery/${chapterId}/`;
    console.log(`[HentaiFox] Fetching pages for gallery ${chapterId}`);

    // Strategy 1: Try the AJAX API that the page likely calls
    try {
      const apiUrl = `/api/gallery/${chapterId}`;
      console.log(`[HentaiFox] Attempting API: ${BASE_URL}${apiUrl}`);
      const apiRes = await fetchJson<any>(http, apiUrl, {
        headers: { Referer: url, "X-Requested-With": "XMLHttpRequest" },
      });
      if (apiRes && Array.isArray(apiRes.images)) {
        console.log(`[HentaiFox] API returned ${apiRes.images.length} images`);
        return {
          chapterId,
          pages: apiRes.images.map((img: string, i: number) => ({ index: i, url: img })),
        };
      }
    } catch (e: any) {
      console.log(`[HentaiFox] API try failed: ${e.message}`);
    }

    // Strategy 2: Fetch the gallery HTML and look for any script with image URLs
    const { $, html } = await fetchHtml(http, url);

    // 2a. Known variables
    for (const varName of ["pages", "rff_imageList", "gallery", "images"]) {
      const data = extractJsonFromScript(html, varName);
      if (data && Array.isArray(data)) {
        const urls = data.map((item: any) => (typeof item === "string" ? item : item.url || item.src || ""));
        if (urls.length > 0 && urls[0]) {
          console.log(`[HentaiFox] Found ${urls.length} URLs via variable "${varName}"`);
          return { chapterId, pages: urls.map((u: string, i: number) => ({ index: i, url: u })) };
        }
      }
    }

    // 2b. Brute‑force regex for HentaiFox CDN images in the whole HTML
    const cdnRegex = /https?:\/\/[^"'\\\s]*hentaifox\.com\/[^"'\\\s]*\.(?:jpg|png|webp)/gi;
    const matches = [...html.matchAll(cdnRegex)];
    if (matches.length > 0) {
      console.log(`[HentaiFox] Regex found ${matches.length} image URLs`);
      return { chapterId, pages: matches.map((m, i) => ({ index: i, url: m[0] })) };
    }

    // 2c. Hidden inputs (legacy)
    const loadDir   = $("#load_dir").val();
    const loadId    = $("#load_id").val();
    const loadPages = $("#load_pages").val();
    if (loadDir && loadId && loadPages) {
      const count = parseInt(loadPages, 10);
      console.log(`[HentaiFox] Using hidden inputs: ${count} pages`);
      const cdn = "https://i.hentaifox.com";
      return {
        chapterId,
        pages: Array.from({ length: count }, (_, i) => ({
          index: i,
          url: `${cdn}/${loadDir}/${loadId}/${i + 1}.jpg`,
        })),
      };
    }

    // 2d. Thumbnails → full size
    const thumbPages: Array<{ index: number; url: string }> = [];
    $(".cover a, .gallery a").each((i, el) => {
      const img = $(el).find("img");
      let src = img.attr("data-src") || img.attr("src") || "";
      if (src) {
        const full = src.replace(/(\d+)t(\.\w+)$/, "$1$2");
        thumbPages.push({ index: i, url: full });
      }
    });
    if (thumbPages.length > 0) {
      console.log(`[HentaiFox] Using thumbnail conversion: ${thumbPages.length} pages`);
      return { chapterId, pages: thumbPages };
    }

    console.error("[HentaiFox] All page extraction strategies failed. Dumping first 2000 chars of HTML:");
    console.error(html.slice(0, 2000));
    return { chapterId, pages: [] };
  },
};
