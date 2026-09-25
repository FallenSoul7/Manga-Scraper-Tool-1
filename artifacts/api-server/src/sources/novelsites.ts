import * as cheerio from "cheerio";
import type {
  MangaSource, ListOptions, MangaListResponse, MangaDetail, DetailOptions,
  ChapterListResponse, PageListResponse, MangaSummary, ChapterSummary, SourceTag,
} from "./types";
import { absUrl, fetchHtmlWithBypass, imgAttr, makeHttp } from "./scraper-utils";

export interface NovelSiteOptions {
  id: string;
  name: string;
  baseUrl: string;
  searchPath: (query: string, page: number) => string;
  tags?: string[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const num = (s: string, fallback: number) => Number(s.match(/\d+(?:\.\d+)?/)?.[0] ?? fallback) || fallback;

function firstHref($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, selectors: string[]): string {
  for (const selector of selectors) {
    const href = root.find(selector).first().attr("href");
    if (href) return href;
  }
  let result = "";
  root.find("a[href]").each((_i, el) => {
    const href = $(el).attr("href") || "";
    if (!result && href && !href.startsWith("/genre/") && !href.startsWith("javascript:") && href !== "#" && !href.includes("/chapter/")) result = href;
  });
  return result;
}

function absoluteId(base: string, href: string): string {
  try {
    const url = new URL(href, `${base}/`);
    return `${url.pathname}${url.search}`.replace(/^\/+|\/+$/g, "");
  } catch {
    return href.replace(base, "").replace(/^\/+|\/+$/g, "");
  }
}

export function createNovelSiteSource(opts: NovelSiteOptions): MangaSource {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const http = makeHttp(base);
  const readerHttp = makeHttp("https://r.jina.ai");
  const fetchPage = async (url: string) => {
    try {
      return await fetchHtmlWithBypass(http, url, {}, { referer: `${base}/` });
    } catch (error) {
      // NovelFull and NovelHall periodically challenge server-side clients.
      // Jina's HTML reader provides the same document without changing the
      // source URLs exposed to the reader or image proxy.
      const target = `${base}${url.startsWith("/") ? "" : "/"}${url}`;
      try {
        const targetUrl = new URL(target);
        const jinaPath = `/http://${targetUrl.host}${targetUrl.pathname}${targetUrl.search}`;
        const response = await readerHttp.get(jinaPath, {
          responseType: "text",
          headers: { "X-Respond-With": "html" },
        });
        const raw = typeof response.data === "string" ? response.data : String(response.data);
        let html = raw;
        try {
          const payload = JSON.parse(raw) as { data?: { html?: string }; html?: string };
          html = payload.data?.html || payload.html || raw;
        } catch {
          // Jina may return the HTML directly depending on its cache state.
        }
        return { $: cheerio.load(html), finalUrl: target, html };
      } catch {
        throw error;
      }
    }
  };

  function parseListing($: cheerio.CheerioAPI): MangaSummary[] {
    const items: MangaSummary[] = [];
    const seen = new Set<string>();
    $(".novel-item, .list-novel .row, .list-truyen .row, .archive .row, .row[itemtype*='Book'], .book-item, .novel-list .row, .top-item, #main .section1 li, table tr, article").each((_i, el) => {
      const root = $(el);
      const href = firstHref($, root, ["h3 a", ".truyen-title a", ".novel-title a", ".title a", ".book-title a", ".book-info h2 a", "h2 a"]);
      const title = clean(root.find("h3, h2, .truyen-title, .novel-title, .title, .book-title, .s-title, .book-info h2").first().text() || root.find("a[href]").filter((_i, a) => {
        const href = $(a).attr("href") || "";
        return !href.startsWith("/genre/") && !href.startsWith("javascript:") && href !== "#" && !href.includes("/chapter/");
      }).first().text());
      if (!href || !title || title.length < 2) return;
      const id = absoluteId(base, href);
      if (!id || seen.has(id)) return;
      seen.add(id);
      const thumbnail = imgAttr(root.find(".cover img, .book-img img, img").first());
      items.push({ id: encodeURIComponent(id), title, thumbnail: absUrl(base, thumbnail), type: "Novel", isNsfw: false });
    });
    return items.slice(0, 50);
  }

  function novelPath(id: string) {
    return `/${decodeURIComponent(id).replace(/^\/+|\/+$/g, "")}`;
  }

  return {
    id: opts.id, name: opts.name, lang: "en", isNsfw: false, imageReferer: `${base}/`,
    async popular(o: ListOptions): Promise<MangaListResponse> {
      const { $ } = await fetchPage(opts.searchPath("", o.page));
      return { items: parseListing($), page: o.page, hasNextPage: true };
    },
    async latest(o: ListOptions): Promise<MangaListResponse> {
      const { $ } = await fetchPage(opts.searchPath("", o.page));
      return { items: parseListing($), page: o.page, hasNextPage: true };
    },
    async search(query: string, o: ListOptions): Promise<MangaListResponse> {
      const { $ } = await fetchPage(opts.searchPath(query, o.page));
      return { items: parseListing($), page: o.page, hasNextPage: true };
    },
    async tags(): Promise<SourceTag[]> {
      return (opts.tags ?? []).map(name => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name, group: "Genre" }));
    },
    async details(id: string, _o: DetailOptions): Promise<MangaDetail> {
      const { $ } = await fetchPage(novelPath(id));
      const title = clean($("#bookname, .desc h3.title, .novel-title, .book-title, .bookname, h1, [itemprop='name']")
        .filter((_i, el) => !$(el).closest(".breadcrumb, nav, header").length).first().text())
        || clean($("meta[property='og:title'], meta[name='title']").first().attr("content") || "")
        || id;
      const synopsis = clean($(".intro, .summary, .description, .desc-text, .novel-detail .content, [itemprop='description'], meta[name='description']").first().attr("content") || $(".intro, .summary, .description, .desc-text, .novel-detail .content, [itemprop='description']").first().text());
      const author = clean($("#author, .info a[href*='/author/'], .author, [itemprop='author']").first().text());
      const thumbnail = imgAttr($(".books img, .novel-cover img, .book-cover img, .book-img img, img[itemprop='image'], .cover img").first())
        || $("meta[property='og:image'], meta[name='image']").first().attr("content") || "";
      const genres = $(".genres a, .genre a, .categories a, a[href*='genre']").map((_i, el) => clean($(el).text())).get().filter(Boolean);
      const status = clean($(".status, [itemprop='status']").first().text()) || "Unknown";
      return { id, title, author, artist: "", synopsis, altTitles: [], status, type: "Novel", isNsfw: false, rating: 0, thumbnail: absUrl(base, thumbnail), genres, score: "", scorePosition: "none" };
    },
    async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
      const { $ } = await fetchPage(novelPath(mangaId));
      const items: ChapterSummary[] = [];
      const seen = new Set<string>();
      $("#list-chapter a, .list-chapter a, .chapter-list a, .chapters a, ul.chapter-list li a, .row-chapter a, li.post a[href$='.html'], a.chapter").each((_i, el) => {
        const href = $(el).attr("href") || "";
        const title = clean($(el).text());
        if (!href || !title) return;
        const id = absoluteId(base, href);
        if (!id || seen.has(id)) return;
        seen.add(id);
        items.push({ id: encodeURIComponent(id), number: num(title, items.length + 1), title, scanlator: opts.name, date: 0 });
      });
      return { items };
    },
    async pages(chapterId: string): Promise<PageListResponse> {
      const { $, html } = await fetchPage(novelPath(chapterId));
      // Remove ad frames globally before selecting the content root. Some
      // NovelFull layouts place the iframe outside the chapter container,
      // while others leave it inside an empty wrapper.
      $("iframe, script, style, .ads, .ad, .advertisement, [id*='ad-'], [id*='ads'], [class*='ad-'], [class*='ads-']").remove();
      $("a[href*='freegames'], a[href*='ads'], a[rel*='sponsored'], [title*='Advertisement'], [aria-label*='Advertisement']").each((_i, el) => { $(el).closest("div").remove(); });
      const title = clean($("h1, .chapter-title, .chapter-name").first().text()) || "Chapter";
      const candidates = $(".chapter-content, .chapter-inner, .reading-content, #chapter-content, #htmlContent, .entry-content, .chapter-c, .chr-c, .chapter-detail, .read-content, .content-inner, .content").toArray();
      const root = $(candidates.find(el => clean($(el).text()).length > 40) ?? candidates[0]);
      if (!root.length) throw new Error(`${opts.name} chapter content was not found`);
      root.find("script, style, iframe, .ads, .ad, .advertisement, .chapter-footer, .social-share, [id*='ad-'], [id*='ads'], [class*='ad-'], [class*='ads-'], [class*='advert']").remove();
      root.find("a[href*='freegames'], a[href*='ads'], a[rel*='sponsored'], [title*='Advertisement'], [aria-label*='Advertisement']").each((_i, el) => {
        $(el).closest("div").remove();
      });
      root.find("div[style*='300px'][style*='250px'], div[style*='iframe']").remove();
      root.find("p, div").each((_i, el) => {
        const text = clean($(el).text());
        if (/ads?\s*(popup|redirect)|advertisement|freegames\.click|report chapter/i.test(text) && $(el).find("p").length === 0) $(el).remove();
      });
      const text = root.html()?.trim() || clean(root.text());
      if (!text) throw new Error(`${opts.name} chapter text was empty`);
      return { chapterId, pages: [{ index: 0, url: "", text, title }] };
    },
  };
}

export const NovelFullSource = createNovelSiteSource({
  id: "en.novelfull",
  name: "NovelFull",
  baseUrl: "https://novelfull.com",
  searchPath: (query, page) => query ? `/search?keyword=${encodeURIComponent(query)}&page=${page}` : `/latest-release-novel?page=${page}`,
  tags: ["Action", "Adventure", "Fantasy", "Romance", "Fan-fic", "System", "Reincarnation", "Game", "Naruto", "Anime", "Movies"],
});

export const NovelHallSource = createNovelSiteSource({
  id: "en.novelhall",
  name: "NovelHall",
  baseUrl: "https://www.novelhall.com",
  searchPath: (query, page) => query ? `/index.php?s=so&module=book&keyword=${encodeURIComponent(query)}&page=${page}` : `/?page=${page}`,
  tags: ["Action", "Adventure", "Fantasy", "Romance", "Eastern", "Urban", "Drama", "Comedy", "Fan-fic", "System", "Reincarnation"],
});
