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
// Title extraction (Updated Selectors)
// ---------------------------------------------------------------------------
function extractTitle($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string {
  const title = $el.find(".caption h2, .caption h3, .inner h2").first().text().trim();
  if (title && !/^\d+$/.test(title)) return title;

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
// Listing (Fixed to use Homepage for Latest/Popular)
// ---------------------------------------------------------------------------
async function fetchStandardList(page: number): Promise<MangaListResponse> {
  const url = page === 1 ? BASE_URL : `${BASE_URL}/pag/${page}/`;
  console.log(`[HentaiFox] Fetching list: ${url}`);
  
  const { $ } = await fetchHtml(http, url);
  const items: MangaSummary[] = [];
  
  $(".col-6, .gallery, .g-wrap, .item").each((_i, el) => {
    const s = buildSummary($, el);
    if (s) items.push(s);
  });
  
  const hasNext = $(".pagination .next, .pagination a:contains('Next')").length > 0;
  return { items, page, hasNextPage: hasNext };
}

async function fetchSearchResults(params: Record<string, string>, page: number): Promise<MangaListResponse> {
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  const url = `${BASE_URL}/search/?${query.toString()}`;
  console.log(`[HentaiFox] Fetching search: ${url}`);
  const { $ } = await fetchHtml(http, url);
  const items: MangaSummary[] = [];
  
  $(".col-6, .gallery, .g-wrap, .search-results .item").each((_i, el) => {
    const s = buildSummary($, el);
    if (s) items.push(s);
  });
  
  const hasNext = $("a.next, .next a, [rel='next']").length > 0;
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

  async popular(o: ListOptions) {
    return fetchStandardList(o.page);
  },

  async latest(o: ListOptions) {
    return fetchStandardList(o.page);
  },

  async search(query: string, o: ListOptions) {
    const params: Record<string, string> = {};
    if (query) params.q = query;
    if (o.tagIds?.length) {
      params.tags = o.tagIds.filter(t => !t.startsWith("-")).join(",");
    }
    return fetchSearchResults(params, o.page);
  },

  async tags(): Promise<SourceTag[]> {
    if (cachedTags) return cachedTags;
    const tags: SourceTag[] = [];
    const seen = new Set<string>();
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
      console.warn("[HentaiFox] /tags/ fetch failed.");
    }
    cachedTags = tags;
    return tags;
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const url = `${BASE_URL}/gallery/${id}/`;
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

  async chapters(mangaId: string): Promise<ChapterListResponse> {
    const url = `${BASE_URL}/gallery/${mangaId}/`;
    const { $ } = await fetchHtml(http, url);
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

  async pages(chapterId: string): Promise<PageListResponse> {
    const galleryUrl = `${BASE_URL}/gallery/${chapterId}/`;
    try {
      const apiData = await fetchJson<any>(http, `/api/gallery/${chapterId}`, {
        headers: { Referer: galleryUrl, "X-Requested-With": "XMLHttpRequest" },
      });
      if (apiData && Array.isArray(apiData.images)) {
        return {
          chapterId,
          pages: apiData.images.map((img: string, i: number) => ({ index: i, url: img })),
        };
      }
    } catch (e: any) {}

    const { $, html } = await fetchHtml(http, galleryUrl);
    for (const varName of ["pages", "rff_imageList", "gallery", "images"]) {
      const data = extractJsonFromScript(html, varName);
      if (data && Array.isArray(data) && data.length > 0) {
        const urls = data.map((item: any) => (typeof item === "string" ? item : item.url || item.src || ""));
        if (urls[0]) {
          return { chapterId, pages: urls.map((u: string, i: number) => ({ index: i, url: u })) };
        }
      }
    }

    const cdnRegex = /https?:\/\/[^"'\\\s]*hentaifox\.com\/[^"'\\\s]*\.(?:jpg|png|webp)/gi;
    const matches = [...html.matchAll(cdnRegex)];
    if (matches.length > 0) {
      return { chapterId, pages: matches.map((m, i) => ({ index: i, url: m[0] })) };
    }

    const coverSrc = $(".cover img").attr("src") || $(".cover img").attr("data-src") || "";
    if (coverSrc) {
      const coverBase = coverSrc.replace(/\/cover\.jpg$/, "");
      const pageCountText = $(".pages, .info li:contains('Pages')").text();
      const pageCount = parseInt(pageCountText.replace(/\D/g, ""), 10) || 0;
      if (pageCount > 0) {
        return {
          chapterId,
          pages: Array.from({ length: pageCount }, (_, i) => ({
            index: i,
            url: `${coverBase}/${i + 1}.jpg`,
          })),
        };
      }
    }

    return { chapterId, pages: [] };
  },
};
