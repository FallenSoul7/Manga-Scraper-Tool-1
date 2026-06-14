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

function buildSummary($: cheerio.CheerioAPI, el: any): MangaSummary | null {
  const $el = $(el);
  const a = $el.find("a").first();
  const href = a.attr("href") || "";
  if (!href) return null;
  const idMatch = href.match(/\/gallery\/(\d+)/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const title = $el.find(".caption h2, h2, .t").text().trim() || $el.find("img").attr("alt") || "Untitled";
  const img = $el.find("img");
  const thumb = img.attr("data-src") || img.attr("src") || "";
  return {
    id,
    title: title.trim(),
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
  $(".col-6, .gallery, .g-wrap").each((_i, el) => {
    const s = buildSummary($, el);
    if (s) items.push(s);
  });
  // Fallback: look for .doujin_page_thumb or .preview-gallery
  if (items.length === 0) {
    $("a[href*='/gallery/']").each((_i, el) => {
      const $el = $(el);
      const href = $el.attr("href") || "";
      const m = href.match(/\/gallery\/(\d+)/);
      if (!m) return;
      const id = m[1];
      if (items.some(i => i.id === id)) return;
      const title = $el.attr("title") || $el.text().trim() || id;
      const img = $el.find("img");
      const thumb = img.attr("data-src") || img.attr("src") || "";
      items.push({ id, title, thumbnail: absUrl(BASE_URL, thumb), type: "Doujinshi", isNsfw: true });
    });
  }
  const hasNext = $("a.next, .next a, [rel='next']").length > 0
    || $("ul.pagination li.active").next("li").length > 0;
  return { items, page, hasNextPage: hasNext };
}

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
    const galleryId = chapterId.split("/")[0];

    // HentaiFox gallery page has hidden inputs with all needed data:
    //   <input id="load_dir"   value="004"     /> — CDN bucket
    //   <input id="load_id"    value="3917106" /> — internal image ID (≠ gallery URL ID)
    //   <input id="load_pages" value="41"      /> — total pages
    // Cover:  https://i3.hentaifox.com/{dir}/{load_id}/cover.jpg
    // Pages:  https://i3.hentaifox.com/{dir}/{load_id}/1.jpg, 2.jpg, ...
    // Thumbs: same but with 't' suffix  →  1t.jpg
    const { $: $ } = await fetchHtml(http, `${BASE_URL}/gallery/${galleryId}/`);

    const loadDir   = $("input#load_dir").val()   as string | undefined;
    const loadId    = $("input#load_id").val()    as string | undefined;
    const loadPages = $("input#load_pages").val() as string | undefined;

    if (loadDir && loadId && loadPages) {
      const count = parseInt(loadPages, 10);
      // Determine CDN host from cover image (may be i.hentaifox.com, i2..., i3...)
      const coverSrc = $(".cover img").attr("src") || $(".cover img").attr("data-src") || "";
      const cdnHostMatch = coverSrc.match(/(https?:\/\/i\d*\.hentaifox\.com)/);
      const cdn = cdnHostMatch ? cdnHostMatch[1] : "https://i.hentaifox.com";

      return {
        chapterId,
        pages: Array.from({ length: count }, (_, i) => ({
          index: i,
          url: `${cdn}/${loadDir}/${loadId}/${i + 1}.jpg`,
        })),
      };
    }

    // Fallback: collect page thumbnails from the gallery div (.cover a img[data-src])
    // and strip the trailing 't' to get full-size URLs
    const pages: Array<{ index: number; url: string }> = [];
    $(".cover a").each((i, el) => {
      const img = $(el).find("img");
      const src = img.attr("data-src") || img.attr("src") || "";
      if (!src || src.includes("svg")) return;
      // "1t.jpg" → "1.jpg"
      const full = src.replace(/(\d+)t(\.\w+)$/, "$1$2");
      pages.push({ index: i, url: full });
    });

    return { chapterId, pages };
  },
};
