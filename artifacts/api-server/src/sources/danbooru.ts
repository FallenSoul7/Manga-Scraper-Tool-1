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

const BASE = "https://danbooru.donmai.us";
const http = makeHttp(BASE, {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": `${BASE}/`,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
});

const PER_PAGE = 20;

// ── Helpers ────────────────────────────────────────────────────────────────
function normalizePoolName(s: string): string {
  return s.replace(/_/g, " ").trim() || "(untitled)";
}

/** Convert a Danbooru thumbnail URL to the full-size original image URL. */
function thumbToOriginal(thumbUrl: string): string {
  // Thumb: https://cdn.donmai.us/180x180/__filename.jpg
  // Full:  https://cdn.donmai.us/original/filename.jpg
  return thumbUrl.replace(/\/\d+x\d+\/__/, "/original/");
}

/**
 * Scrape a pool listing page (HTML).
 * URL: /pools?page=N
 */
async function scrapePoolList(page: number): Promise<{ pools: { id: number; name: string; thumb: string }[]; hasNext: boolean }> {
  const url = `${BASE}/pools?page=${page}`;
  console.log(`[Danbooru] Fetching pool list: ${url}`);
  const { $ } = await fetchHtml(http, url);

  const pools: { id: number; name: string; thumb: string }[] = [];

  // Each pool row: table tbody tr or div.pool-item
  const rows = $("table tbody tr, div.pool-item, .pool-list-item");
  rows.each((_i, el) => {
    const $row = $(el);
    const link = $row.find("a[href*='/pools/']").first();
    const href = link.attr("href") || "";
    const idMatch = href.match(/\/pools\/(\d+)/);
    if (!idMatch) return;

    const id = parseInt(idMatch[1], 10);
    const name = link.text().trim() || $row.find(".pool-name, .pool-title").text().trim();
    const img = $row.find("img").first();
    const thumb = img.attr("src") || img.attr("data-src") || "";

    if (id && name) {
      pools.push({ id, name, thumb });
    }
  });

  const hasNext = $("a.next_page, .pagination .next, a[rel='next']").length > 0;
  console.log(`[Danbooru] Found ${pools.length} pools, hasNext: ${hasNext}`);
  return { pools, hasNext };
}

/**
 * Scrape a pool's page to extract all post image URLs.
 * URL: /pools/ID
 */
async function scrapePoolImages(poolId: number): Promise<string[]> {
  const url = `${BASE}/pools/${poolId}`;
  console.log(`[Danbooru] Fetching pool page: ${url}`);
  const { $ } = await fetchHtml(http, url);

  const imageUrls: string[] = [];

  // Images are inside .post-preview img, .pool-post img, etc.
  $(".post-preview img, .pool-post img, .post img").each((_i, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (src && !src.includes("blank.gif")) {
      const full = thumbToOriginal(src);
      imageUrls.push(full);
    }
  });

  console.log(`[Danbooru] Extracted ${imageUrls.length} images from pool page`);
  return imageUrls;
}

// ── Source object ─────────────────────────────────────────────────────────
export const DanbooruSource: MangaSource = {
  id: "all.danbooru",
  name: "Danbooru",
  lang: "all",
  isNsfw: true,
  imageReferer: `${BASE}/`,

  // ── Popular (by post count, scraped from pool list sorted? We'll just fetch default order,
  //      which is by creation date. For popular, we can't sort without API.
  //      We'll just use the pool list as-is. ──────────────────────────────
  async popular(o: ListOptions): Promise<MangaListResponse> {
    try {
      const { pools, hasNext } = await scrapePoolList(o.page);
      const items: MangaSummary[] = pools.map(p => ({
        id: `pool:${p.id}`,
        title: normalizePoolName(p.name),
        thumbnail: p.thumb,
        type: "Collection",
        isNsfw: true,
      }));
      return { items, page: o.page, hasNextPage: hasNext };
    } catch (e: any) {
      console.error(`[Danbooru] Popular scrape failed: ${e.message}`);
      return { items: [], page: o.page, hasNextPage: false };
    }
  },

  // ── Latest (pool list is sorted by update date by default) ───────────
  async latest(o: ListOptions): Promise<MangaListResponse> {
    return this.popular(o); // same endpoint, default sort is latest
  },

  // ── Search (by name) ────────────────────────────────────────────────
  async search(query: string, o: ListOptions): Promise<MangaListResponse> {
    try {
      const url = `${BASE}/pools?search[name_matches]=*${encodeURIComponent(query)}*&page=${o.page}`;
      console.log(`[Danbooru] Search pools: ${url}`);
      const { $ } = await fetchHtml(http, url);
      const pools: { id: number; name: string; thumb: string }[] = [];

      $("table tbody tr, div.pool-item").each((_i, el) => {
        const $row = $(el);
        const link = $row.find("a[href*='/pools/']").first();
        const href = link.attr("href") || "";
        const idMatch = href.match(/\/pools\/(\d+)/);
        if (!idMatch) return;
        const id = parseInt(idMatch[1], 10);
        const name = link.text().trim() || $row.find(".pool-name, .pool-title").text().trim();
        const img = $row.find("img").first();
        const thumb = img.attr("src") || img.attr("data-src") || "";
        if (id && name) pools.push({ id, name, thumb });
      });

      const hasNext = $("a.next_page, .pagination .next, a[rel='next']").length > 0;
      const items: MangaSummary[] = pools.map(p => ({
        id: `pool:${p.id}`,
        title: normalizePoolName(p.name),
        thumbnail: p.thumb,
        type: "Collection",
        isNsfw: true,
      }));
      return { items, page: o.page, hasNextPage: hasNext };
    } catch (e: any) {
      console.error(`[Danbooru] Search scrape failed: ${e.message}`);
      return { items: [], page: o.page, hasNextPage: false };
    }
  },

  // ── Tags (not easily scraped without API; return empty) ──────────────
  async tags(): Promise<SourceTag[]> {
    return [];
  },

  // ── Details ──────────────────────────────────────────────────────────
  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const poolId = Number(id.replace(/^pool:/, ""));
    const url = `${BASE}/pools/${poolId}`;
    console.log(`[Danbooru] Fetching pool details: ${url}`);
    const { $ } = await fetchHtml(http, url);

    const name = $("#pool-name, .pool-name, h1").first().text().trim() || `Pool ${poolId}`;
    const description = $("#pool-description, .pool-description, .description").text().trim();
    const thumbImg = $(".pool-cover img, .pool-thumb img").first();
    const thumb = thumbImg.attr("src") || thumbImg.attr("data-src") || "";

    return {
      id,
      title: normalizePoolName(name),
      author: "",
      artist: "",
      synopsis: description,
      altTitles: [],
      status: "Completed",
      type: "Collection",
      isNsfw: true,
      rating: 0,
      thumbnail: thumb,
      genres: [],
      score: "",
      scorePosition: "none",
    };
  },

  // ── Chapters (single chapter = whole pool) ───────────────────────────
  async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const poolId = Number(mangaId.replace(/^pool:/, ""));
    const url = `${BASE}/pools/${poolId}`;
    console.log(`[Danbooru] Fetching chapters for pool ${poolId}`);
    const { $ } = await fetchHtml(http, url);
    const name = $("#pool-name, .pool-name, h1").first().text().trim() || `Pool ${poolId}`;
    return {
      items: [{
        id: `pool:${poolId}`,
        number: 1,
        title: normalizePoolName(name),
        scanlator: "Danbooru",
        date: Math.floor(Date.now() / 1000),
      }],
    };
  },

  // ── Pages (scrape pool page for image thumbnails, convert to full) ───
  async pages(chapterId: string): Promise<PageListResponse> {
    const poolId = Number(chapterId.replace(/^pool:/, ""));
    const images = await scrapePoolImages(poolId);
    return {
      chapterId,
      pages: images.map((url, i) => ({ index: i, url })),
    };
  },
};
