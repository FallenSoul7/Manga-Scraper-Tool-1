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
import axios, { type AxiosInstance } from "axios";

const BASE = "https://danbooru.donmai.us";

// ── Proxy helper ──────────────────────────────────────────────────────
function parseProxy(proxyUrl?: string): { host: string; port: number; auth?: { username: string; password: string } } | false {
  if (!proxyUrl) return false;
  try {
    const url = new URL(proxyUrl);
    const host = url.hostname;
    const port = parseInt(url.port, 10) || 80;
    const auth = url.username
      ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
      : undefined;
    return { host, port, auth };
  } catch {
    return false;
  }
}

function createClient(): AxiosInstance {
  const proxyStr = process.env.DANBOORU_PROXY;
  const proxy = parseProxy(proxyStr);

  return axios.create({
    baseURL: BASE,
    timeout: 30000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${BASE}/`,
    },
    proxy: proxy ? {
      protocol: "http",
      host: proxy.host,
      port: proxy.port,
      auth: proxy.auth,
    } : false,
  });
}

async function fetchPage(path: string) {
  const client = createClient();
  const res = await client.get(path);
  if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${path}`);
  return cheerio.load(res.data as string);
}

// ── Bulletproof Pool List Scraper ─────────────────────────────────────
async function scrapePoolList(page: number, searchQuery?: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (searchQuery) params.set("search[name_matches]", `*${searchQuery}*`);
  const $ = await fetchPage(`/pools?${params.toString()}`);

  const pools: { id: number; name: string; thumb: string }[] = [];

  // Find ANY link that points to a pool, regardless of the HTML layout
  $("a[href^='/pools/']").each((_i, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";
    const idMatch = href.match(/\/pools\/(\d+)/);
    if (!idMatch) return;
    const id = parseInt(idMatch[1], 10);
    
    // Ignore utility links like "Edit", "Show", or purely numbers
    const name = $a.text().trim();
    if (!name || name === "Show" || name === "Edit" || name.match(/^\d+$/)) return;
    
    // Prevent duplicates
    if (pools.some(p => p.id === id)) return;

    // Look for an image inside the link, or expand outward to the nearest container
    const $container = $a.closest("tr, article, div.pool-category-collection, div");
    const thumb = $container.find("img").first().attr("src") || 
                  $container.find("img").first().attr("data-src") || "";

    pools.push({ id, name, thumb });
  });

  const hasNext = $("a.next_page, a.next, [rel='next']").length > 0;
  return { pools, hasNext };
}

// ── Pool images ───────────────────────────────────────────────────────
async function scrapePoolImages(poolId: number): Promise<string[]> {
  const $ = await fetchPage(`/pools/${poolId}`);
  const urls: string[] = [];

  $("div.pool > a img, article img, a[href*='/posts/'] img").each((_i, el) => {
    const src = $(el).attr("src") || $(el).attr("data-file-url") || "";
    if (src && !src.includes("blank.gif")) {
      const full = src.replace(/\/\d+x\d+\/__/, "/original/");
      urls.push(full);
    }
  });

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
    const thumbImg = $(".pool-cover img, .pool-thumb img, article img").first();
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
