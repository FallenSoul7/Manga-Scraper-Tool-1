import * as cheerio from "cheerio";
import type { MangaSource, ListOptions, MangaListResponse, MangaDetail, DetailOptions, ChapterListResponse, PageListResponse, MangaSummary, ChapterSummary, SourceTag } from "./types";
import { makeHttp, fetchHtml, absUrl, slugFromUrl } from "./scraper-utils";

const BASE_URL = "https://www.royalroad.com";
const http = makeHttp(BASE_URL);
const SOURCE_ID = "en.royalroad";

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const parseNumber = (value: string, fallback: number) => {
  const match = value.match(/\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : fallback;
  return Number.isFinite(number) ? number : fallback;
};

function fictionId(id: string): string {
  const match = id.match(/^(\d+)(?:[:/].*)?$/);
  return match ? match[1] : id;
}

function fictionPath(id: string): string {
  const [number, slug] = id.split(":");
  return slug ? `/fiction/${encodeURIComponent(number)}/${encodeURIComponent(slug)}` : `/fiction/${encodeURIComponent(fictionId(id))}`;
}

function parseListing($: cheerio.CheerioAPI): MangaSummary[] {
  const seen = new Set<string>();
  const items: MangaSummary[] = [];
  $("a[href^='/fiction/']").each((_i, el) => {
    const href = $(el).attr("href") || "";
    if (!/^\/fiction\/\d+\/[^/]+(?:\?|$)/.test(href) || /\/chapter\//.test(href)) return;
    const match = href.match(/^\/fiction\/(\d+)\/([^/?#]+)/);
    const title = clean($(el).text());
    if (!match || !title || title.length < 2 || seen.has(match[1])) return;
    seen.add(match[1]);
    const card = $(el).closest(".fiction-list-item, .row, article, .fiction-card");
    const thumbnail = card.find("img").first().attr("src") || "";
    items.push({ id: `${match[1]}:${match[2]}`, title, thumbnail: absUrl(BASE_URL, thumbnail), type: "Novel", isNsfw: false });
  });
  return items.slice(0, 30);
}

export const RoyalRoadSource: MangaSource = {
  id: SOURCE_ID,
  name: "Royal Road",
  lang: "en",
  isNsfw: false,

  async popular(opts: ListOptions): Promise<MangaListResponse> {
    const { $ } = await fetchHtml(http, `/fictions/best-rated?page=${Math.max(1, opts.page)}`);
    return { items: parseListing($), page: opts.page, hasNextPage: true };
  },

  async latest(opts: ListOptions): Promise<MangaListResponse> {
    const { $ } = await fetchHtml(http, `/fictions/latest-updates?page=${Math.max(1, opts.page)}`);
    return { items: parseListing($), page: opts.page, hasNextPage: true };
  },

  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    const { $ } = await fetchHtml(http, `/fictions/search?title=${encodeURIComponent(query.trim())}&page=${Math.max(1, opts.page)}`);
    return { items: parseListing($), page: opts.page, hasNextPage: true };
  },

  async tags(): Promise<SourceTag[]> {
    return ["Action", "Adventure", "Fantasy", "LitRPG", "Romance", "Mystery", "Progression", "Sci-fi", "Horror", "Comedy"].map((name) => ({ id: name.toLowerCase(), name, group: "Genre" }));
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const { $ } = await fetchHtml(http, fictionPath(id));
    const title = clean($("h1").first().text());
    const author = clean($(".fiction-title a[href^='/profile/'], a[href^='/profile/']").first().text());
    const synopsis = clean($(".description").first().text());
    const thumbnail = $("img.thumbnail[data-type='cover'], img.thumbnail").first().attr("src") || "";
    const genres = $("a[href*='tagsAdd='], a[href*='genre=']").map((_i, el) => clean($(el).text())).get().filter(Boolean);
    return { id, title: title || id, author, artist: "", synopsis, altTitles: [], status: clean($(".fiction-status").first().text()), type: "Novel", isNsfw: false, rating: 0, thumbnail: absUrl(BASE_URL, thumbnail), genres, score: "", scorePosition: "none" };
  },

  async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const { $ } = await fetchHtml(http, fictionPath(mangaId));
    const items: ChapterSummary[] = [];
    $("tr.chapter-row").each((_i, el) => {
      const href = $(el).attr("data-url") || $(el).find("a").first().attr("href") || "";
      const linkTitle = clean($(el).find("td").first().text());
      const id = href;
      if (!id || !href) return;
      items.push({ id, number: parseNumber(linkTitle, items.length + 1), title: linkTitle || `Chapter ${items.length + 1}`, scanlator: "Royal Road", date: 0 });
    });
    return { items };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const chapterUrl = chapterId.startsWith("http") ? chapterId : absUrl(BASE_URL, chapterId);
    const { $ } = await fetchHtml(http, chapterUrl);
    const title = clean($("h1").first().text()) || "Chapter";
    const contentRoot = $(".chapter-inner, .chapter-content, .chapter-content-container").first();
    const content = contentRoot.length ? contentRoot.find("script, style, .ad, .ads, .chapter-footer").remove().end().html()?.trim() || "" : "";
    if (!content) throw new Error("Royal Road chapter content was not found");
    return { chapterId, pages: [{ index: 0, url: "", text: content, title }] };
  },
};
