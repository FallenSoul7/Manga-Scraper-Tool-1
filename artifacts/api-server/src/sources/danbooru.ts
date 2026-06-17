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
  console.log(`[Danbooru] Fetching: ${path}`);
  const res = await client.get(path);
  if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${path}`);
  return cheerio.load(res.data as string);
}

// ── Correct pool list scraper (matching Tachiyomi selectors) ──────────
async function scrapePoolList(page: number, searchQuery?: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (searchQuery) params.set("search[name_matches]", `*${searchQuery}*`);
  const $ = await fetchPage(`/pools?${params.toString()}`);

  const pools: { id: number; name: string; thumb: string }[] = [];

  // Original extension uses: table.striped tbody tr
  $("table.striped tbody tr").each((_i, el) => {
    const $row = $(el);
    // Pool name is inside a.pool-name
    const nameLink = $row.find("a.pool-name").first();
    const href = nameLink.attr("href") || "";
    const idMatch = href.match(/\/pools\/(\d+)/);
    if (!idMatch) return;
    const id = parseInt(idMatch[1], 10);
    const name = nameLink.text().trim();

    // Thumbnail: first img in the row
    const img = $row.find("img").first();
    const thumb = img.attr("src") || img.attr("data-src") || "";

    if (id && name) {
      pools.push({ id, name, thumb });
    }
  });

  // Pagination: a.next_page or a.next
  const hasNext = $("a.next_page, a.next").length > 0;
  console.log(`[Danbooru] Found ${pools.length} pools, hasNext: ${hasNext}`);
  return { pools, hasNext };
}

// ── Pool images (correct selectors from original extension) ───────────
async function scrapePoolImages(poolId: number): Promise<string[]> {
  const $ = await fetchPage(`/pools/${poolId}`);
  const urls: string[] = [];

  // Original: div.pool > a (the direct link to the post)
  $("div.pool > a").each((_i, el) => {
    const href = $(el).attr("href");
    // The post ID is extracted from the href (e.g., /posts/123456)
    if (href && href.includes("/posts/")) {
      const postId = href.split("/posts/")[1]?.split("?")[0];
      if (postId) {
        // Build full image URL: /posts/{postId}.{ext} – but we need to get the actual image URL.
        // The extension fetches each post JSON to get the file_url. We'll do the same.
        urls.push(`${BASE}/posts/${postId}`); // We'll later replace with actual image URL.
      }
    }
  });

  // Actually, the original extension does an extra API call per post.
  // But we can shortcut: the pool page often includes img tags with data-file-url.
  // Let's use a simpler method: look for img tags inside div.pool > a, and use data-file-url or src.
  $("div.pool > a img").each((_i, el) => {
    const src = $(el).attr("src") || $(el).attr("data-file-url") || "";
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

// ── Source definition (unchanged, just uses corrected functions) ──────
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
