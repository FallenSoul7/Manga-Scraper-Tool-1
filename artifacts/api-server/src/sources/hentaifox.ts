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
import { absUrl, fetchHtml, makeHttp } from "./scraper-utils";

const BASE_URL = "https://hentaifox.com";
const http = makeHttp(BASE_URL);

let cachedTags: SourceTag[] | null = null;

// ── Title extraction helper ──────────────────────────────────────────────
function extractTitle($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string {
  const candidates = [
    $el.find(".caption h2, .caption h3").first().text().trim(),
    $el.find("a").first().attr("title")?.trim(),
    $el.find("h2, h3").first().text().trim(),
    $el.find("img").attr("alt")?.trim(),
    $el.text().trim(),
  ];
  // Return the first candidate that is not just digits
  for (const c of candidates) {
    if (c && !/^\d+$/.test(c)) return c;
  }
  return ""; // fallback will use gallery ID
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

async function fetchList(url: string, page: number): Promise<MangaListResponse> {
  const sep = url.includes("?") ? "&" : "?";
  const pageUrl = page > 1 ? `${url}${sep}page=${page}` : url;
  const { $ } = await fetchHtml(http, pageUrl);
  const items: MangaSummary[] = [];
  // Primary grid
  $(".col-6, .gallery, .g-wrap").each((_i, el) => {
    const s = buildSummary($, el);
    if (s) items.push(s);
  });
  // Fallback
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
  const hasNext = $("a.next, .next a, [rel='next']").length > 0
    || $("ul.pagination li.active").next("li").length > 0;
  return { items, page, hasNextPage: hasNext };
}

// ── Brace‑counting JSON extractor (like mangathemesia) ──────────────────
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

  async popular(o: ListOptions) {
    const tagPath = o.tagIds && o.tagIds.length > 0
      ? `/tag/${o.tagIds.filter(t => !t.startsWith("-"))[0] || ""}/`
      : "/";
    return fetchList(`${BASE_URL}${tagPath}`, o.page);
  },

  async latest(o: ListOptions) {
    return fetchList(`${BASE_URL}/`, o.page);
  },

  async search(query: string, o: ListOptions) {
    const tagFilter = o.tagIds?.filter(t => !t.startsWith("-")) ?? [];
    if (!query && tagFilter.length > 0) {
      return fetchList(`${BASE_URL}/tag/${tagFilter[0]}/`, o.page);
    }
    return fetchList(`${BASE_URL}/search/?q=${encodeURIComponent(query)}`, o.page);
  },

  async tags(): Promise<SourceTag[]> {
    if (cachedTags) return cachedTags;
    try {
      const { $ } = await fetchHtml(http, `${BASE_URL}/tags/`);
      const tags: SourceTag[] = [];
      $("a[href*='/tag/']").each((_i, el) => {
        const $el = $(el);
        const href = $el.attr("href") || "";
        const m = href.match(/\/tag\/([^/]+)\/?$/);
        if (!m) return;
        const slug = m[1];
        const name = $el.text().trim().replace(/\s*\d+$/, "").trim();
        if (!name || !slug) return;
        tags.push({ id: slug, name, group: "Tag" });
      });
      cachedTags = tags;
      return tags;
    } catch {
      return [];
    }
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

  async pages(chapterId: string): Promise<PageListResponse> {
    const url = `${BASE_URL}/gallery/${chapterId}/`;
    console.log(`[HentaiFox] Fetching pages for gallery ${chapterId} from ${url}`);
    let html = "";
    let $: cheerio.CheerioAPI;

    try {
      const result = await fetchHtml(http, url);
      $ = result.$;
      html = result.html;
    } catch (e: any) {
      console.error(`[HentaiFox] Failed to fetch gallery page: ${e.message}`);
      throw new Error(`HentaiFox network error: ${e.message}`);
    }

    // ── Strategy 1: JSON object/array in <script> ──────────────────────
    // Try "pages" variable (array of objects with url)
    let pagesVar = extractJsonFromScript(html, "var pages");
    if (pagesVar && Array.isArray(pagesVar) && pagesVar.length > 0) {
      console.log(`[HentaiFox] Found "pages" variable with ${pagesVar.length} entries`);
      return {
        chapterId,
        pages: pagesVar.map((p: any, i: number) => ({
          index: i,
          url: p.url || p.img || "",
        })).filter(p => p.url),
      };
    }

    // Try "rff_imageList" (array of URLs)
    let imgList = extractJsonFromScript(html, "rff_imageList");
    if (imgList && Array.isArray(imgList) && imgList.length > 0) {
      console.log(`[HentaiFox] Found "rff_imageList" with ${imgList.length} entries`);
      return {
        chapterId,
        pages: imgList.map((url: string, i: number) => ({
          index: i,
          url,
        })),
      };
    }

    // ── Strategy 2: Direct regex for image URLs ─────────────────────────
    const imgRegex = /https?:\/\/[^"'\\\s]*hentaifox\.com\/[^"'\\\s]*\.(?:jpg|png|webp)/gi;
    const matches = [...html.matchAll(imgRegex)];
    if (matches.length > 0) {
      console.log(`[HentaiFox] Found ${matches.length} direct image URLs via regex`);
      const pages = matches.map((m, i) => ({ index: i, url: m[0] }));
      return { chapterId, pages };
    }

    // ── Strategy 3: Hidden inputs (legacy) ──────────────────────────────
    const loadDir   = $("#load_dir").val();
    const loadId    = $("#load_id").val();
    const loadPages = $("#load_pages").val();
    if (loadDir && loadId && loadPages) {
      const count = parseInt(loadPages, 10);
      console.log(`[HentaiFox] Using hidden inputs: dir=${loadDir}, id=${loadId}, pages=${count}`);
      const cdn = "https://i.hentaifox.com";
      return {
        chapterId,
        pages: Array.from({ length: count }, (_, i) => ({
          index: i,
          url: `${cdn}/${loadDir}/${loadId}/${i + 1}.jpg`,
        })),
      };
    }

    // ── Strategy 4: Gallery thumbnails (convert to full size) ───────────
    const thumbPages: Array<{ index: number; url: string }> = [];
    $(".cover a, .gallery a").each((i, el) => {
      const img = $(el).find("img");
      let src = img.attr("data-src") || img.attr("src") || "";
      if (src) {
        // Convert "1t.jpg" -> "1.jpg"
        const full = src.replace(/(\d+)t(\.\w+)$/, "$1$2");
        thumbPages.push({ index: i, url: full });
      }
    });
    if (thumbPages.length > 0) {
      console.log(`[HentaiFox] Using thumbnail conversion: ${thumbPages.length} pages`);
      return { chapterId, pages: thumbPages };
    }

    // ── Nothing worked ──────────────────────────────────────────────────
    console.error("[HentaiFox] All extraction strategies failed. Dumping first 2000 chars of HTML:");
    console.error(html.slice(0, 2000));
    // Return empty so reader shows "Chapter unavailable", but error is logged.
    return { chapterId, pages: [] };
  },
};
