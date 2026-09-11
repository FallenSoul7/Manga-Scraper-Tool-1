import * as cheerio from "cheerio";
import type {
  MangaSource, ListOptions, MangaListResponse, MangaDetail, DetailOptions,
  ChapterListResponse, PageListResponse, MangaSummary, ChapterSummary, SourceTag,
} from "./types";
import { makeHttp, fetchHtml, absUrl, slugFromUrl } from "./scraper-utils";

const BASE_URL = "https://novelfull.net";
const http = makeHttp(BASE_URL);
const SOURCE_ID = "en.novelfull";

function text($el: cheerio.Cheerio<any>): string {
  return $el.text().replace(/\s+/g, " ").trim();
}

function chapterNumber(label: string, fallback: number): number {
  const match = label.match(/chapter\s+([\d.]+)/i) || label.match(/(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/);
  const value = match ? Number(match[1]) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

function summaryFromLink($: cheerio.CheerioAPI, el: any): MangaSummary | null {
  const href = $(el).attr("href") || "";
  if (!href || !/\.html(?:\?|$)/i.test(href) || /chapter-/i.test(href)) return null;
  const url = absUrl(BASE_URL, href);
  const id = slugFromUrl(url);
  const title = text($(el));
  if (!id || !title || title.length < 2) return null;
  const card = $(el).closest(".novel-item, .row, .item-summary, .list-chapter");
  const image = card.find("img").first();
  const thumbnail = absUrl(BASE_URL, image.attr("data-src") || image.attr("src") || "");
  return { id, title, thumbnail, type: "Novel", isNsfw: false };
}

function parseNovelLinks($: cheerio.CheerioAPI): MangaSummary[] {
  const seen = new Set<string>();
  const items: MangaSummary[] = [];
  $("a[href$='.html'], a[href*='.html?']").each((_i, el) => {
    const item = summaryFromLink($, el);
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  });
  return items.slice(0, 30);
}

export const NovelFullSource: MangaSource = {
  id: SOURCE_ID,
  name: "NovelFull",
  lang: "en",
  isNsfw: false,
  imageReferer: `${BASE_URL}/`,

  async popular(opts: ListOptions): Promise<MangaListResponse> {
    const { $ } = await fetchHtml(http, `${BASE_URL}/?page=${Math.max(1, opts.page)}`);
    return { items: parseNovelLinks($), page: opts.page, hasNextPage: true };
  },

  async latest(opts: ListOptions): Promise<MangaListResponse> {
    const { $ } = await fetchHtml(http, `${BASE_URL}/?page=${Math.max(1, opts.page)}`);
    return { items: parseNovelLinks($), page: opts.page, hasNextPage: true };
  },

  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    const q = encodeURIComponent(query.trim());
    const { $ } = await fetchHtml(http, `${BASE_URL}/search?keyword=${q}&page=${Math.max(1, opts.page)}`);
    return { items: parseNovelLinks($), page: opts.page, hasNextPage: false };
  },

  async tags(): Promise<SourceTag[]> {
    const { $ } = await fetchHtml(http, BASE_URL);
    const tags: SourceTag[] = [];
    $("a[href*='/genre/']").each((_i, el) => {
      const href = $(el).attr("href") || "";
      const name = text($(el));
      const id = href.split("/").filter(Boolean).pop() || "";
      if (id && name && !tags.some((tag) => tag.id === id)) tags.push({ id, name, group: "Genre" });
    });
    return tags;
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const { $ } = await fetchHtml(http, `${BASE_URL}/${id}.html`);
    const title = text($("h1").first()) || id.replace(/-/g, " ");
    const author = text($(".info-item:contains('Author')").first().find("a, span").last());
    const synopsis = text($(".desc-text, .desc-text p, [itemprop='description']").first());
    const thumbnail = absUrl(BASE_URL, $(".book img, .novel-cover img, img[itemprop='image']").first().attr("src") || "");
    const genres = $("a[href*='/genre/']").map((_i, el) => text($(el))).get().filter(Boolean);
    return {
      id, title, author, artist: "", synopsis, altTitles: [], status: text($(".info-item:contains('Status')").first()),
      type: "Novel", isNsfw: false, rating: 0, thumbnail, genres, score: "", scorePosition: "none",
    };
  },

  async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const items: ChapterSummary[] = [];
    for (let page = 1; page <= 50; page++) {
      const { $ } = await fetchHtml(http, `${BASE_URL}/${mangaId}.html${page > 1 ? `?page=${page}` : ""}`);
      $("a[href*='/chapter-']").each((_i, el) => {
        const href = absUrl(BASE_URL, $(el).attr("href") || "");
        const id = slugFromUrl(href);
        const title = text($(el));
        if (!id || !title || items.some((chapter) => chapter.id === id)) return;
        items.push({ id, number: chapterNumber(title, items.length + 1), title, scanlator: "NovelFull", date: 0 });
      });
      const next = $("a[rel='next'], a:contains('Next')").filter((_i, el) => !!$(el).attr("href")).first();
      if (!next.length) break;
    }
    items.sort((a, b) => a.number - b.number);
    return { items };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const { $ } = await fetchHtml(http, `${BASE_URL}/${chapterId}.html`);
    const title = text($("h1").first()) || chapterId.replace(/-/g, " ");
    const contentRoot = $(".chapter-c, .chapter-content, .reading-content, [itemprop='articleBody']").first();
    const content = contentRoot.length
      ? contentRoot.find("script, style, .ads, .ad, .social-share").remove().end().html()?.trim() || ""
      : "";
    if (!content) throw new Error("Novel chapter content was not found");
    return { chapterId, pages: [{ index: 0, url: "", text: content, title }] };
  },
};

export function createNovelFullSource(): MangaSource { return NovelFullSource; }
