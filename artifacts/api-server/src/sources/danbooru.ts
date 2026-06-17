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
  SourceTag,
} from "./types";
import { fetchJson, makeHttp, absUrl } from "./scraper-utils";

const BASE = "https://danbooru.donmai.us";
const http = makeHttp(BASE);
const PER_PAGE = 20; // Danbooru default limit

// ── Response types ─────────────────────────────────────────────────────────
interface DbPool {
  id: number;
  name: string;
  description: string;
  category: string;
  post_count: number;
  post_ids: number[];
  created_at: string;
  updated_at: string;
}

interface DbPost {
  id: number;
  file_url?: string;
  large_file_url?: string;
  preview_file_url?: string;
  rating?: string;
  tag_string?: string;
  pool_string?: string;
}

interface DbTag {
  id: number;
  name: string;
  post_count: number;
  category: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function normalizePoolName(s: string): string {
  return s.replace(/_/g, " ").trim() || "(untitled)";
}

function poolToSummary(p: DbPool, thumb: string): MangaSummary {
  return {
    id: `pool:${p.id}`,
    title: normalizePoolName(p.name),
    thumbnail: thumb,
    type: p.category === "series" ? "Series" : "Collection",
    isNsfw: true,
  };
}

// Fetch a single post thumbnail
async function fetchPostThumb(id: number): Promise<string> {
  try {
    const post = await fetchJson<DbPost>(http, `/posts/${id}.json`);
    return post.preview_file_url || post.large_file_url || post.file_url || "";
  } catch {
    return "";
  }
}

// Fetch pool details
async function fetchPool(id: number): Promise<DbPool> {
  return fetchJson<DbPool>(http, `/pools/${id}.json`);
}

// ── Source object ─────────────────────────────────────────────────────────
export const DanbooruSource: MangaSource = {
  id: "all.danbooru",
  name: "Danbooru",
  lang: "all",
  isNsfw: true,
  imageReferer: `${BASE}/`,

  // ── Popular pools ─────────────────────────────────────────────────
  async popular(o: ListOptions): Promise<MangaListResponse> {
    console.log(`[Danbooru] Fetching popular pools, page ${o.page}`);
    const pools = await fetchJson<DbPool[]>(http, "/pools.json", {
      params: {
        search: { order: "post_count" },
        limit: PER_PAGE,
        page: o.page,
      },
    });
    const thumbs = await Promise.all(
      pools.map(p => (p.post_ids[0] ? fetchPostThumb(p.post_ids[0]) : Promise.resolve("")))
    );
    const items = pools.map((p, i) => poolToSummary(p, thumbs[i] || ""));
    console.log(`[Danbooru] Popular found ${items.length} pools`);
    return { items, page: o.page, hasNextPage: pools.length === PER_PAGE };
  },

  // ── Latest pools ──────────────────────────────────────────────────
  async latest(o: ListOptions): Promise<MangaListResponse> {
    console.log(`[Danbooru] Fetching latest pools, page ${o.page}`);
    const pools = await fetchJson<DbPool[]>(http, "/pools.json", {
      params: {
        search: { order: "updated_at" },
        limit: PER_PAGE,
        page: o.page,
      },
    });
    const thumbs = await Promise.all(
      pools.map(p => (p.post_ids[0] ? fetchPostThumb(p.post_ids[0]) : Promise.resolve("")))
    );
    const items = pools.map((p, i) => poolToSummary(p, thumbs[i] || ""));
    console.log(`[Danbooru] Latest found ${items.length} pools`);
    return { items, page: o.page, hasNextPage: pools.length === PER_PAGE };
  },

  // ── Search pools ──────────────────────────────────────────────────
  async search(query: string, o: ListOptions): Promise<MangaListResponse> {
    console.log(`[Danbooru] Searching pools for "${query}", page ${o.page}`);
    const pools = await fetchJson<DbPool[]>(http, "/pools.json", {
      params: {
        search: { name_matches: `*${query}*` },
        limit: PER_PAGE,
        page: o.page,
      },
    });
    const thumbs = await Promise.all(
      pools.map(p => (p.post_ids[0] ? fetchPostThumb(p.post_ids[0]) : Promise.resolve("")))
    );
    const items = pools.map((p, i) => poolToSummary(p, thumbs[i] || ""));
    console.log(`[Danbooru] Search found ${items.length} pools`);
    return { items, page: o.page, hasNextPage: pools.length === PER_PAGE };
  },

  // ── Tags ──────────────────────────────────────────────────────────
  async tags(): Promise<SourceTag[]> {
    console.log("[Danbooru] Fetching tags...");
    try {
      const tags = await fetchJson<DbTag[]>(http, "/tags.json", {
        params: { limit: 0, search: { order: "count" } }, // no limit? Danbooru caps at 1000 by default, but we can get many
      });
      const result: SourceTag[] = tags.map(t => ({
        id: t.name,
        name: t.name,
        group: ["general", "artist", "copyright", "character", "meta"][t.category] || "other",
        count: t.post_count,
      }));
      console.log(`[Danbooru] Found ${result.length} tags`);
      return result;
    } catch (e) {
      console.error("[Danbooru] Failed to fetch tags:", e);
      return [];
    }
  },

  // ── Details ───────────────────────────────────────────────────────
  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const poolId = Number(id.replace(/^pool:/, ""));
    console.log(`[Danbooru] Fetching details for pool ${poolId}`);
    const pool = await fetchPool(poolId);
    const thumb = pool.post_ids[0] ? await fetchPostThumb(pool.post_ids[0]) : "";
    return {
      id,
      title: normalizePoolName(pool.name),
      author: "",
      artist: "",
      synopsis: pool.description || "",
      altTitles: [],
      status: pool.category === "series" ? "Ongoing" : "Completed",
      type: pool.category === "series" ? "Series" : "Collection",
      isNsfw: true,
      rating: 0,
      thumbnail: thumb,
      genres: [],
      score: "",
      scorePosition: "none",
    };
  },

  // ── Chapters ──────────────────────────────────────────────────────
  async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const poolId = Number(mangaId.replace(/^pool:/, ""));
    console.log(`[Danbooru] Fetching chapters for pool ${poolId}`);
    const pool = await fetchPool(poolId);
    const chap: ChapterSummary = {
      id: `pool:${pool.id}`,
      number: 1,
      title: normalizePoolName(pool.name),
      scanlator: "Danbooru",
      date: Date.parse(pool.updated_at) || Date.now(),
    };
    return { items: [chap] };
  },

  // ── Pages ─────────────────────────────────────────────────────────
  async pages(chapterId: string): Promise<PageListResponse> {
    const poolId = Number(chapterId.replace(/^pool:/, ""));
    console.log(`[Danbooru] Fetching pages for pool ${poolId}`);
    const pool = await fetchPool(poolId);
    const postIds = pool.post_ids;
    if (postIds.length === 0) {
      console.log("[Danbooru] Pool has no posts");
      return { chapterId, pages: [] };
    }

    // Fetch posts in chunks of 100 (Danbooru API limit)
    const pages: PageInfo[] = [];
    const chunkSize = 100;
    let index = 0;
    for (let i = 0; i < postIds.length; i += chunkSize) {
      const chunk = postIds.slice(i, i + chunkSize);
      console.log(`[Danbooru] Fetching posts chunk ${i}-${i + chunk.length}`);
      const posts = await fetchJson<DbPost[]>(http, "/posts.json", {
        params: { tags: `id:${chunk.join(",")}`, limit: chunk.length },
      });
      const byId = new Map(posts.map(p => [p.id, p]));
      for (const id of chunk) {
        const post = byId.get(id);
        const url = post?.file_url || post?.large_file_url || "";
        if (url) pages.push({ index: index++, url });
      }
    }
    console.log(`[Danbooru] Extracted ${pages.length} pages`);
    return { chapterId, pages };
  },
};
