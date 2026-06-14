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
import { fetchJson, makeHttp } from "./scraper-utils";

/**
 * Danbooru scraper.
 *
 * Danbooru is a booru-style image board, not a manga site. We map its concept of
 * "pools" (curated image sets) to a manga, with a single chapter containing the
 * pool's images. Standalone posts are exposed as one-page "manga" via the
 * /posts list when no pool is selected.
 */

const BASE = "https://danbooru.donmai.us";
const http = makeHttp(BASE);
const PER_PAGE = 30;

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
  source?: string;
  rating?: string;
  tag_string?: string;
  tag_string_general?: string;
  tag_string_artist?: string;
  pool_string?: string;
  image_width?: number;
  image_height?: number;
}

function normalizePoolName(s: string): string {
  return s.replace(/_/g, " ").trim() || "(untitled)";
}

async function fetchPool(id: number): Promise<DbPool> {
  return fetchJson<DbPool>(http, `/pools/${id}.json`);
}

async function fetchPostsForPool(pool: DbPool, page: number, limit: number): Promise<DbPost[]> {
  // Use `pool:<id>` tag search; sort=id asc for chapter order
  const ids = pool.post_ids.slice((page - 1) * limit, page * limit);
  if (ids.length === 0) return [];
  return fetchJson<DbPost[]>(http, "/posts.json", {
    params: { tags: `id:${ids.join(",")} order:custom`, limit: ids.length },
  });
}

async function fetchPostThumb(id: number): Promise<string> {
  try {
    const post = await fetchJson<DbPost>(http, `/posts/${id}.json`);
    return post.preview_file_url || post.large_file_url || post.file_url || "";
  } catch {
    return "";
  }
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

export const DanbooruSource: MangaSource = {
  id: "all.danbooru",
  name: "Danbooru",
  lang: "all",
  isNsfw: true,
  imageReferer: `${BASE}/`,

  async popular(o: ListOptions): Promise<MangaListResponse> {
    const pools = await fetchJson<DbPool[]>(http, "/pools.json", {
      params: { "search[order]": "post_count", limit: PER_PAGE, page: o.page },
    });
    const items: MangaSummary[] = [];
    // Fetch first-post thumbnail for each pool, in parallel
    const thumbs = await Promise.all(
      pools.map((p) => (p.post_ids[0] ? fetchPostThumb(p.post_ids[0]) : Promise.resolve(""))),
    );
    pools.forEach((p, i) => items.push(poolToSummary(p, thumbs[i] || "")));
    return { items, page: o.page, hasNextPage: pools.length === PER_PAGE };
  },

  async latest(o: ListOptions): Promise<MangaListResponse> {
    const pools = await fetchJson<DbPool[]>(http, "/pools.json", {
      params: { "search[order]": "updated_at", limit: PER_PAGE, page: o.page },
    });
    const thumbs = await Promise.all(
      pools.map((p) => (p.post_ids[0] ? fetchPostThumb(p.post_ids[0]) : Promise.resolve(""))),
    );
    const items = pools.map((p, i) => poolToSummary(p, thumbs[i] || ""));
    return { items, page: o.page, hasNextPage: pools.length === PER_PAGE };
  },

  async search(query: string, o: ListOptions): Promise<MangaListResponse> {
    const pools = await fetchJson<DbPool[]>(http, "/pools.json", {
      params: { "search[name_matches]": `*${query}*`, limit: PER_PAGE, page: o.page },
    });
    const thumbs = await Promise.all(
      pools.map((p) => (p.post_ids[0] ? fetchPostThumb(p.post_ids[0]) : Promise.resolve(""))),
    );
    const items = pools.map((p, i) => poolToSummary(p, thumbs[i] || ""));
    return { items, page: o.page, hasNextPage: pools.length === PER_PAGE };
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const poolId = Number(id.replace(/^pool:/, ""));
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

  async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const poolId = Number(mangaId.replace(/^pool:/, ""));
    const pool = await fetchPool(poolId);
    // We expose the pool as a single chapter (its full ordered list of posts)
    const chap: ChapterSummary = {
      id: `pool:${pool.id}`,
      number: 1,
      title: normalizePoolName(pool.name),
      scanlator: "Danbooru",
      date: Date.parse(pool.updated_at) || Date.now(),
    };
    return { items: [chap] };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const poolId = Number(chapterId.replace(/^pool:/, ""));
    const pool = await fetchPool(poolId);
    const ids = pool.post_ids;
    if (ids.length === 0) return { chapterId, pages: [] };
    // Danbooru API limit is 200 ids per request; chunk it
    const pages: PageInfo[] = [];
    const chunkSize = 100;
    let index = 0;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const posts = await fetchJson<DbPost[]>(http, "/posts.json", {
        params: { tags: `id:${chunk.join(",")}`, limit: chunk.length },
      });
      // Map posts back to id order
      const byId = new Map(posts.map((p) => [p.id, p]));
      for (const id of chunk) {
        const p = byId.get(id);
        const url = p?.file_url || p?.large_file_url || "";
        if (url) pages.push({ index: index++, url });
      }
    }
    return { chapterId, pages };
  },
};
