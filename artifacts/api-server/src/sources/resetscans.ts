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
import * as cheerio from "cheerio";

const BASE = "https://www.resetscans.net";
const LANGUAGE_ROOT = "/en";
const http = makeHttp(BASE, { Referer: `${BASE}/` });

function parseDate(text: string): number {
  const timestamp = Date.parse(text.trim());
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function numberFrom(text: string): number {
  const match = text.match(/chapter\s*([\d.]+)/i) ?? text.match(/([\d.]+)/);
  return match ? Number(match[1]) || 0 : 0;
}

function backgroundImage($el: cheerio.Cheerio<any>): string {
  const style = $el.attr("style") ?? "";
  const match = style.match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  return match?.[1]?.trim() ?? "";
}

function parseCards($: cheerio.CheerioAPI): MangaSummary[] {
  const items: MangaSummary[] = [];
  const seen = new Set<string>();

  $(".series-card, .manga-item, .page-item-detail").each((_i, el) => {
    const root = $(el);
    const link = root.find("a.series-card-link, a[href*='/manga/']").first();
    const href = link.attr("href");
    if (!href || !href.includes("/manga/")) return;
    const id = href.replace(BASE, "");
    if (seen.has(id)) return;
    seen.add(id);

    const title = (
      root.find(".series-card-title, .post-title, .item-summary h3, .item-summary h4").first().text() ||
      link.attr("title") ||
      link.text()
    ).replace(/\s+/g, " ").trim();

    items.push({
      id,
      title: title || "Untitled",
      // Reset Scans uses CSS background images for its cards rather than
      // <img> elements. Keep the normal img fallback for older page layouts.
      thumbnail: absUrl(
        BASE,
        backgroundImage(root.find(".series-card-thumb, .manga-thumb, .thumb").first()) ||
          imgAttr(root.find("img").first()),
      ),
      type: "Manga",
      isNsfw: false,
    });
  });

  return items;
}

function pageHasLoadMore($: cheerio.CheerioAPI, kind: "series_grid" | "search"): boolean {
  return kind === "search"
    ? $("#load-more-search").length > 0
    : $("#load-more-series-grid").length > 0;
}

function getLoadMoreNonce(html: string): string {
  const match = html.match(/var\s+mangaverse_ajax\s*=\s*(\{.*?\});/s);
  if (!match) throw new Error("Reset Scans load-more configuration is missing");
  try {
    const config = JSON.parse(match[1]) as { nonce?: string };
    if (!config.nonce) throw new Error("Reset Scans load-more nonce is missing");
    return config.nonce;
  } catch {
    throw new Error("Reset Scans load-more configuration is invalid");
  }
}

async function fetchSeriesPage(
  page: number,
  kind: "series_grid" | "search",
  query?: string,
): Promise<MangaListResponse> {
  const queryParams = query ? { s: query } : undefined;
  const firstPage = await fetchHtml(http, `${LANGUAGE_ROOT}/`, { params: queryParams });
  if (page === 1) {
    return {
      items: parseCards(firstPage.$),
      page,
      hasNextPage: pageHasLoadMore(firstPage.$, kind),
    };
  }

  const body = new URLSearchParams({
    action: "mangaverse_load_more",
    nonce: getLoadMoreNonce(firstPage.html),
    page: String(page),
    type: kind,
    lang: "en",
    ...(query ? { search_query: query } : {}),
  });
  const response = await http.post("/wp-admin/admin-ajax.php", body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: `${BASE}${LANGUAGE_ROOT}/`,
    },
  });
  const result = response.data as {
    success?: boolean;
    data?: { html?: string; has_more?: boolean };
  };
  if (!result.success || !result.data?.html) {
    throw new Error(`Reset Scans load-more request failed (HTTP ${response.status})`);
  }
  return {
    items: parseCards(cheerio.load(result.data.html)),
    page,
    hasNextPage: result.data.has_more === true,
  };
}

function chapterPathFromId(id: string): string {
  return id.startsWith("http") ? id : absUrl(BASE, id);
}

export const ResetScansSource: MangaSource = {
  id: "en.resetscans",
  name: "Reset Scans",
  lang: "en",
  isNsfw: false,
  imageReferer: `${BASE}/`,

  async popular(opts: ListOptions): Promise<MangaListResponse> {
    return fetchSeriesPage(opts.page, "series_grid");
  },

  async latest(opts: ListOptions): Promise<MangaListResponse> {
    return fetchSeriesPage(opts.page, "series_grid");
  },

  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    return fetchSeriesPage(opts.page, "search", query);
  },

  async details(id: string, opts: DetailOptions): Promise<MangaDetail> {
    const { $ } = await fetchHtml(http, id);
    const title = $(".series-title, h1.entry-title").first().text().trim();
    const description = $(".series-description, .entry-content").first().text().replace(/\s+/g, " ").trim();
    const thumbnail = imgAttr($(".series-header-thumbnail img, .manga-hero-header img").first());
    const genres = $(".manga-genres a, .genres a, .cat-links a").map((_i, el) => $(el).text().trim()).get().filter(Boolean);

    return {
      id,
      title: title || "Untitled",
      author: "",
      artist: "",
      synopsis: description,
      altTitles: [],
      status: "Ongoing",
      type: "Manga",
      isNsfw: false,
      rating: 0,
      thumbnail: absUrl(BASE, thumbnail),
      genres,
      score: "",
      scorePosition: opts.score,
    };
  },

  async chapters(mangaId: string): Promise<ChapterListResponse> {
    const { $ } = await fetchHtml(http, mangaId);
    const items: ChapterSummary[] = [];
    const seen = new Set<string>();

    $(".chapters-list .chapter-item, .chapter-list .chapter-item").each((_i, el) => {
      const root = $(el);
      const link = root.find("a.chapter-link, a[href]").first();
      const href = link.attr("href");
      if (!href) return;
      const id = href.replace(BASE, "");
      if (seen.has(id)) return;
      seen.add(id);
      const title = (root.find(".chapter-title").text() || link.text()).replace(/\s+/g, " ").trim();
      if (!title) return;
      items.push({
        id,
        number: numberFrom(title),
        title,
        scanlator: "Reset Scans",
        date: parseDate(root.find("time, .chapter-date, .chapter-release-date").first().attr("datetime") || ""),
      });
    });

    return { items };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const { $ } = await fetchHtml(http, chapterPathFromId(chapterId));
    const pages: PageInfo[] = [];
    const seen = new Set<string>();
    $(".entry-content img, .chapter-content img, .reading-content img, .wp-block-image img").each((_i, el) => {
      const url = absUrl(BASE, imgAttr($(el)));
      if (!url || seen.has(url) || url.startsWith("data:")) return;
      seen.add(url);
      pages.push({ index: pages.length, url });
    });
    return { chapterId, pages };
  },
};