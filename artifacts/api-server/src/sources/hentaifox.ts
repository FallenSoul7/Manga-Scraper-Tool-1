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

// ---------------------------------------------------------------------------
// Title extraction (works on search result cards)
// ---------------------------------------------------------------------------
function extractTitle($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string {
  // Try common title elements inside a search result card
  const selectors = [
    ".caption h2", ".caption h3", "h2", "h3", ".gallery_title", ".thumb-caption",
  ];
  for (const sel of selectors) {
    const text = $el.find(sel).first().text().trim();
    if (text && !/^\d+$/.test(text)) return text;
  }
  // Fallbacks: img alt or a title attribute
  const imgAlt = $el.find("img").first().attr("alt")?.trim();
  if (imgAlt && !/^\d+$/.test(imgAlt)) return imgAlt;
  const aTitle = $el.find("a").first().attr("title")?.trim();
  if (aTitle && !/^\d+$/.test(aTitle)) return aTitle;
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
  const title = extractTitle($, $el) || `Gallery ${id}`;
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

// ---------------------------------------------------------------------------
// Listing – always uses search endpoint (which returns correct titles)
// ---------------------------------------------------------------------------
async function fetchSearchResults(params: Record<string, string>, page: number): Promise<MangaListResponse> {
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  const url = `${BASE_URL}/search/?${query.toString()}`;
  console.log(`[HentaiFox] Fetching search: ${url}`);
  const { $ } = await fetchHtml(http, url);
  const items: MangaSummary[] = [];
  // The search results page uses a grid similar to the homepage
  $(".col-6, .gallery, .g-wrap, .search-results .item").each((_i, el) => {
    const s = buildSummary($, el);
    if (s) items.push(s);
  });
  // Fallback: any link containing /gallery/
  if (items.length === 0) {
    $("a[href*='/gallery/']").each((_i, el) => {
      const $el = $(el);
      const href = $el.attr("href") || "";
      const m = href.match(/\/gallery\/(\d+)/);
      if (!m) return;
      const id = m[1];
      if (items.some(i => i.id === id)) return;
      const title = extractTitle($, $el) || `Gallery ${id}`;
      const img = $el.find("img");
      const thumb = img.attr("data-src") || img.attr("src") || "";
      items.push({ id, title, thumbnail: absUrl(BASE_URL, thumb), type: "Doujinshi", isNsfw: true });
    });
  }
  const hasNext = $("a.next, .next a, [rel='next']").length > 0;
  console.log(`[HentaiFox] Found ${items.length} items, hasNext: ${hasNext}`);
  return { items, page, hasNextPage: hasNext };
}

// ---------------------------------------------------------------------------
// Brace‑counting JSON extractor
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Source object
// ---------------------------------------------------------------------------
export const HentaiFoxSource: MangaSource = {
  id: "all.hentaifox",
  name: "HentaiFox",
  lang: "all",
  isNsfw: true,
  imageReferer: `${BASE_URL}/`,

  // ── Popular ──────────────────────────────────────────────────
  async popular(o: ListOptions) {
    const params: Record<string, string> = { sort: "views" };
    if (o.tagIds?.length) {
      params.tags = o.tagIds.filter(t => !t.startsWith("-")).join(",");
    }
    return fetchSearchResults(params, o.page);
  },

  // ── Latest ────────────────────────────────────────────────────
  async latest(o: ListOptions) {
    const params: Record<string, string> = { sort: "date" };
    if (o.tagIds?.length) {
      params.tags = o.tagIds.filter(t => !t.startsWith("-")).join(",");
    }
    return fetchSearchResults(params, o.page);
  },

  // ── Search ────────────────────────────────────────────────────
  async search(query: string, o: ListOptions) {
    const params: Record<string, string> = {};
    if (query) params.q = query;
    if (o.tagIds?.length) {
      params.tags = o.tagIds.filter(t => !t.startsWith("-")).join(",");
    }
    return fetchSearchResults(params, o.page);
  },

  // ── Tags ──────────────────────────────────────────────────────
  async tags(): Promise<SourceTag[]> {
    if (cachedTags) return cachedTags;
    console.log("[HentaiFox] Fetching tags...");
    const tags: SourceTag[] = [];
    const seen = new Set<string>();
    // From /tags/ page
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
    // From search form checkboxes
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
    const galleryUrl = `${BASE_URL}/gallery/${chapterId}/`;
    console.log(`[HentaiFox] Fetching pages for gallery ${chapterId}`);

    // Strategy 1: Try AJAX API (common pattern)
    try {
      const apiData = await fetchJson<any>(http, `/api/gallery/${chapterId}`, {
        headers: { Referer: galleryUrl, "X-Requested-With": "XMLHttpRequest" },
      });
      if (apiData && Array.isArray(apiData.images)) {
        console.log(`[HentaiFox] API returned ${apiData.images.length} images`);
        return {
          chapterId,
          pages: apiData.images.map((img: string, i: number) => ({ index: i, url: img })),
        };
      }
    } catch (e: any) {
      console.log(`[HentaiFox] API try failed: ${e.message}`);
    }

    // Strategy 2: Parse gallery HTML for script variables or inline images
    const { $, html } = await fetchHtml(http, galleryUrl);

    // 2a. Script variables: "pages", "rff_imageList", etc.
    for (const varName of ["pages", "rff_imageList", "gallery", "images"]) {
      const data = extractJsonFromScript(html, varName);
      if (data && Array.isArray(data) && data.length > 0) {
        const urls = data.map((item: any) => (typeof item === "string" ? item : item.url || item.src || ""));
        if (urls[0]) {
          console.log(`[HentaiFox] Found ${urls.length} URLs via "${varName}"`);
          return { chapterId, pages: urls.map((u: string, i: number) => ({ index: i, url: u })) };
        }
      }
    }

    // 2b. Direct regex for CDN image URLs
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

    // 2d. Thumbnails (convert 't' suffix)
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

    // 2e. Use cover image URL to infer page pattern (cover.jpg → 1.jpg)
    const coverSrc = $(".cover img").attr("src") || $(".cover img").attr("data-src") || "";
    if (coverSrc) {
      const coverBase = coverSrc.replace(/\/cover\.jpg$/, "");
      // Get total pages from page count if possible
      const pageCountText = $(".pages, .info li:contains('Pages')").text();
      const pageCount = parseInt(pageCountText.replace(/\D/g, ""), 10) || 0;
      if (pageCount > 0) {
        console.log(`[HentaiFox] Inferring ${pageCount} pages from cover URL pattern`);
        return {
          chapterId,
          pages: Array.from({ length: pageCount }, (_, i) => ({
            index: i,
            url: `${coverBase}/${i + 1}.jpg`,
          })),
        };
      }
    }

    // Nothing worked
    console.error("[HentaiFox] All page extraction strategies failed. Dumping first 2000 chars of HTML:");
    console.error(html.slice(0, 2000));
    return { chapterId, pages: [] };
  },
};
