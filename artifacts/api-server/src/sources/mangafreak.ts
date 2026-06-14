import type {
  MangaSource,
  ListOptions,
  DetailOptions,
  MangaListResponse,
  MangaDetail,
  ChapterListResponse,
  PageListResponse,
  MangaSummary,
  ChapterSummary,
  PageInfo,
} from "./types";
import { absUrl, fetchHtml, imgAttr, makeHttp } from "./scraper-utils";

const BASE = "https://ww2.mangafreak.me";

const http = makeHttp(BASE);

function summaryFrom($el: ReturnType<ReturnType<typeof makeHttp>["get"]> extends never ? never : any, urlSel: string): MangaSummary | null {
  return null;
}

export const MangafreakSource: MangaSource = {
  id: "en.mangafreak",
  name: "Mangafreak",
  lang: "en",
  isNsfw: false,
  imageReferer: `${BASE}/`,

  async popular(o: ListOptions): Promise<MangaListResponse> {
    const url = `${BASE}/Genre/All/${o.page}`;
    const { $ } = await fetchHtml(http, url);
    const items: MangaSummary[] = [];
    $("div.ranking_item").each((_i, el) => {
      const $el = $(el);
      const a = $el.find("a").first();
      const href = a.attr("href") || "";
      if (!href) return;
      items.push({
        id: encodeURIComponent(href.replace(/^https?:\/\/[^/]+/, "").replace(/^\/+|\/+$/g, "")),
        title: a.text().trim() || "Untitled",
        thumbnail: absUrl(BASE, imgAttr($el.find("img").first())),
        type: "Manga",
        isNsfw: false,
      });
    });
    const hasNext = $("a.next_p").length > 0;
    return { items, page: o.page, hasNextPage: hasNext };
  },

  async latest(o: ListOptions): Promise<MangaListResponse> {
    const url = o.page === 1 ? BASE : `${BASE}/Latest_Releases/${o.page}`;
    const { $ } = await fetchHtml(http, url);
    const items: MangaSummary[] = [];
    $("div.latest_item, div.latest_releases_item").each((_i, el) => {
      const $el = $(el);
      let href: string | undefined;
      let title: string;
      if ($el.hasClass("latest_item")) {
        const a = $el.find("a.name");
        href = a.attr("href");
        title = a.text().trim();
      } else {
        const a = $el.find("a").first();
        href = a.attr("href");
        title = $el.find("a").first().text().trim();
      }
      if (!href) return;
      let thumb = imgAttr($el.find("img").first());
      // Fix mini_images thumbnails: replace with manga_images/<slug>.jpg
      try {
        const u = new URL(thumb);
        const segs = u.pathname.split("/").filter(Boolean);
        if (segs[0] === "mini_images" && segs.length >= 2) {
          thumb = `${u.origin}/manga_images/${segs[1]}.jpg`;
        }
      } catch {
        /* ignore */
      }
      items.push({
        id: encodeURIComponent(href.replace(/^https?:\/\/[^/]+/, "").replace(/^\/+|\/+$/g, "")),
        title: title || "Untitled",
        thumbnail: thumb,
        type: "Manga",
        isNsfw: false,
      });
    });
    const hasNext = $("a.next_p").length > 0;
    return { items, page: o.page, hasNextPage: hasNext };
  },

  async search(query: string, o: ListOptions): Promise<MangaListResponse> {
    const url = `${BASE}/Find/${encodeURIComponent(query)}`;
    const { $ } = await fetchHtml(http, url);
    const items: MangaSummary[] = [];
    $("div.manga_search_item, div.mangaka_search_item").each((_i, el) => {
      const $el = $(el);
      const a = $el.find("h3 a, h5 a").first();
      const href = a.attr("href") || "";
      if (!href) return;
      items.push({
        id: encodeURIComponent(href.replace(/^https?:\/\/[^/]+/, "").replace(/^\/+|\/+$/g, "")),
        title: a.text().trim() || "Untitled",
        thumbnail: absUrl(BASE, imgAttr($el.find("img").first())),
        type: "Manga",
        isNsfw: false,
      });
    });
    return { items, page: o.page, hasNextPage: false };
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const path = decodeURIComponent(id);
    const url = `${BASE}/${path}`;
    const { $ } = await fetchHtml(http, url);
    const data = $("div.manga_series_data");
    const title = data.find("h1, h5").first().text().trim();
    const thumb = imgAttr($("div.manga_series_image img").first());

    // Page text uses prefixed labels we can match: "This is ... series", "Written By: ...", etc.
    let statusRaw = "";
    let author = "";
    let artist = "";
    let altTitlesRaw = "";
    data.children("div").each((_i, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (/this is .+ series/i.test(text)) statusRaw = text;
      else if (/^Written By:/i.test(text)) author = text.replace(/^Written By:\s*/i, "");
      else if (/^Illustrated By:/i.test(text)) artist = text.replace(/^Illustrated By:\s*/i, "");
      else if (/^Alternative Title:/i.test(text)) altTitlesRaw = text.replace(/^Alternative Title:\s*/i, "");
    });
    const status =
      /on-going|ongoing/i.test(statusRaw) ? "Ongoing" :
      /completed/i.test(statusRaw) ? "Completed" : "Unknown";
    const altTitles = altTitlesRaw
      ? altTitlesRaw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean)
      : [];
    const genres: string[] = [];
    $("div.series_sub_genre_list a").each((_i, el) => {
      const t = $(el).text().trim();
      if (t) genres.push(t);
    });
    const description = $("div.manga_series_description p").text().trim();

    return {
      id,
      title: title || "Untitled",
      author,
      artist,
      synopsis: description,
      altTitles: [],
      status,
      type: "Manga",
      isNsfw: false,
      rating: 0,
      thumbnail: absUrl(BASE, thumb),
      genres,
      score: "",
      scorePosition: "none",
    };
  },

  async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const path = decodeURIComponent(mangaId);
    const url = `${BASE}/${path}`;
    const { $ } = await fetchHtml(http, url);
    const items: ChapterSummary[] = [];
    $("div.manga_series_list tr:has(a)").each((_i, el) => {
      const $el = $(el);
      const a = $el.find("a").first();
      const href = a.attr("href") || "";
      if (!href) return;
      const name = $el.find("td:eq(0)").text().trim();
      const numMatch = name.match(/(\d+(?:\.\d+)?)/);
      const num = numMatch ? Number(numMatch[1]) : 0;
      const dateText = $el.find("td:eq(1)").text().trim();
      const ts = Date.parse(dateText);
      items.push({
        id: encodeURIComponent(href.replace(/^https?:\/\/[^/]+/, "").replace(/^\/+|\/+$/g, "")),
        number: num,
        title: name,
        scanlator: "Mangafreak",
        date: Number.isNaN(ts) ? Date.now() : ts,
      });
    });
    return { items: items.reverse() };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const path = decodeURIComponent(chapterId);
    const url = `${BASE}/${path}`;
    const { $ } = await fetchHtml(http, url);
    const pages: PageInfo[] = [];
    $("img#gohere[src], img#gohere").each((i, el) => {
      const src = imgAttr($(el));
      if (src) pages.push({ index: i, url: absUrl(BASE, src) });
    });
    return { chapterId, pages };
  },
};
