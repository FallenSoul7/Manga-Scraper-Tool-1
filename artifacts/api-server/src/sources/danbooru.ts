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
import { absUrl } from "./scraper-utils";
import axios from "axios";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

const BASE = "https://danbooru.donmai.us";

// Persistent cookie jar (same as Tachiyomi's cookieJar)
const jar = new CookieJar();
const client = wrapper(axios.create({ jar, withCredentials: true }));

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${BASE}/`,
};

async function fetchPage(path: string) {
  const url = `${BASE}${path}`;
  console.log(`[Danbooru] Fetching: ${url}`);
  const res = await client.get(url, { headers });
  if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`);
  return cheerio.load(res.data as string);
}

// ── Pool list ─────────────────────────────────────────────────────────
async function scrapePoolList(page: number, searchQuery?: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (searchQuery) params.set("search[name_matches]", `*${searchQuery}*`);
  const $ = await fetchPage(`/pools?${params.toString()}`);

  const pools: { id: number; name: string; thumb: string }[] = [];
  $("table tbody tr, div.pool-item, .pool-list-item").each((_i, el) => {
    const $row = $(el);
    const link = $row.find("a[href*='/pools/']").first();
    const href = link.attr("href") || "";
    const m = href.match(/\/pools\/(\d+)/);
    if (!m) return;
    const id = parseInt(m[1], 10);
    const name =
      link.text().trim() ||
      $row.find(".pool-name, .pool-title").text().trim();
    const img = $row.find("img").first();
    const thumb = img.attr("src") || img.attr("data-src") || "";
    if (id && name) pools.push({ id, name, thumb });
  });

  const hasNext =
    $("a.next_page, .pagination .next, a[rel='next']").length > 0;
  console.log(`[Danbooru] Found ${pools.length} pools, hasNext: ${hasNext}`);
  return { pools, hasNext };
}

// ── Pool images (thumbnails → original) ───────────────────────────────
async function scrapePoolImages(poolId: number): Promise<string[]> {
  const $ = await fetchPage(`/pools/${poolId}`);
  const urls: string[] = [];
  $(".post-preview img, .pool-post img, .post img").each((_i, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (src && !src.includes("blank.gif")) {
      const full = src.replace(/\/\d+x\d+\/__/, "/original/");
      urls.push(full);
    }
  });
  console.log(`[Danbooru] Extracted ${urls.length} images from pool`);
  return urls;
}

function normalizePoolName(s: string): string {
  return s.replace(/_/g, " ").trim() || "(untitled)";
}

// ── Source definition ─────────────────────────────────────────────────
export const DanbooruSource: MangaSource = {
  id: "all.danbooru",
  name: "Danbooru",
  lang: "all",
  isNsfw: true,
  imageReferer: `${BASE}/`,

  async popular(o: ListOptions): Promise<MangaListResponse> {
    try {
      const { pools, hasNext } = await scrapePoolList(o.page);
      const items: MangaSummary[] = pools.map((p) => ({
        id: `pool:${p.id}`,
        title: normalizePoolName(p.name),
        thumbnail: p.thumb,
        type: "Collection",
        isNsfw: true,
      }));
      return { items, page: o.page, hasNextPage: hasNext };
    } catch (e: any) {
      console.error(`[Danbooru] Popular failed: ${e.message}`);
      return { items: [], page: o.page, hasNextPage: false };
    }
  },

  async latest(o: ListOptions): Promise<MangaListResponse> {
    return this.popular(o);
  },

  async search(query: string, o: ListOptions): Promise<MangaListResponse> {
    try {
      const { pools, hasNext } = await scrapePoolList(o.page, query);
      const items: MangaSummary[] = pools.map((p) => ({
        id: `pool:${p.id}`,
        title: normalizePoolName(p.name),
        thumbnail: p.thumb,
        type: "Collection",
        isNsfw: true,
      }));
      return { items, page: o.page, hasNextPage: hasNext };
    } catch (e: any) {
      console.error(`[Danbooru] Search failed: ${e.message}`);
      return { items: [], page: o.page, hasNextPage: false };
    }
  },

  async tags(): Promise<SourceTag[]> {
    return [];
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const poolId = Number(id.replace(/^pool:/, ""));
    const $ = await fetchPage(`/pools/${poolId}`);
    const name =
      $("#pool-name, .pool-name, h1").first().text().trim() ||
      `Pool ${poolId}`;
    const description = $(
      "#pool-description, .pool-description, .description"
    ).text().trim();
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

  async chapters(
    mangaId: string,
    _dedupe: boolean
  ): Promise<ChapterListResponse> {
    const poolId = Number(mangaId.replace(/^pool:/, ""));
    const $ = await fetchPage(`/pools/${poolId}`);
    const name =
      $("#pool-name, .pool-name, h1").first().text().trim() ||
      `Pool ${poolId}`;

    return {
      items: [
        {
          id: `pool:${poolId}`,
          number: 1,
          title: normalizePoolName(name),
          scanlator: "Danbooru",
          date: Math.floor(Date.now() / 1000),
        },
      ],
    };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const poolId = Number(chapterId.replace(/^pool:/, ""));
    const images = await scrapePoolImages(poolId);
    return {
      chapterId,
      pages: images.map((url, i) => ({ index: i, url })),
    };
  },
};
