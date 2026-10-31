import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://danbooru.donmai.us";
const SOURCE_ID = "all.danbooru";

function absoluteUrl(value: string, reference: string): string {
  if (!value) return "";
  try {
    return new URL(value, reference).toString();
  } catch {
    return value;
  }
}

async function fetchDocument(path: string): Promise<{ document: Document; url: string }> {
  const url = new URL(path, BASE).toString();
  try {
    const response = await clientFetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`the site returned ${contentType} instead of HTML`);
    }
    const html = await response.text();
    return { document: new DOMParser().parseFromString(html, "text/html"), url };
  } catch {
    throw new Error("Danbooru is temporarily unavailable or blocking requests. Please check your connection and try again later.");
  }
}

function poolIdFrom(value: string): number {
  const poolId = Number(value.replace(/^pool:/, ""));
  if (!Number.isSafeInteger(poolId) || poolId < 0) {
    throw new Error(`Danbooru: invalid pool ID ${value}`);
  }
  return poolId;
}

function normalizePoolName(value: string): string {
  return value.replace(/_/g, " ").trim() || "(untitled)";
}

function poolName(document: Document, poolId: number): string {
  const name = document.querySelector("#pool-name, .pool-name, h1")?.textContent?.trim() ?? "";
  return name || `Pool ${poolId}`;
}

async function scrapePoolList(page: number, searchQuery?: string): Promise<ClientListResponse> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (searchQuery) params.set("search[name_matches]", `*${searchQuery}*`);
  const { document } = await fetchDocument(`/pools?${params.toString()}`);
  const seen = new Set<number>();
  const items: ClientListResponse["items"] = [];

  document.querySelectorAll("a[href^='/pools/']").forEach(anchor => {
    const href = anchor.getAttribute("href") ?? "";
    const idMatch = href.match(/\/pools\/(\d+)/);
    if (!idMatch) return;
    const id = Number.parseInt(idMatch[1], 10);
    const title = anchor.textContent?.trim() ?? "";
    if (!title || title === "Show" || title === "Edit" || /^\d+$/.test(title) || seen.has(id)) return;
    seen.add(id);

    const container = anchor.closest("tr, article, div.pool-category-collection, div");
    const image = container?.querySelector("img") ?? null;
    const thumbnail = image?.getAttribute("src") || image?.getAttribute("data-src") || "";
    items.push({
      id: `pool:${id}`,
      title: normalizePoolName(title),
      thumbnail: absoluteUrl(thumbnail, BASE),
      type: "Collection",
      isNsfw: true,
    });
  });

  const hasNextPage = Boolean(document.querySelector("a.next_page, a.next, [rel='next']"));
  return { items, page, hasNextPage };
}

async function poolDetail(id: string): Promise<{ poolId: number; url: string; document: Document }> {
  const poolId = poolIdFrom(id);
  const { document, url } = await fetchDocument(`/pools/${poolId}`);
  return { poolId, url, document };
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page): Promise<ClientListResponse> {
    return scrapePoolList(page);
  },

  latest(page): Promise<ClientListResponse> {
    // The existing source defines latest as the same pool listing as popular.
    return scrapePoolList(page);
  },

  search(query, page): Promise<ClientListResponse> {
    return scrapePoolList(page, query);
  },

  async details(id, options): Promise<ClientMangaDetail> {
    const { poolId, url, document } = await poolDetail(id);
    const title = normalizePoolName(poolName(document, poolId));
    const synopsis = document.querySelector("#pool-description, .pool-description, .description")?.textContent?.trim() ?? "";
    const image = document.querySelector(".pool-cover img, .pool-thumb img, article img");
    const thumbnail = image?.getAttribute("src") || image?.getAttribute("data-src") || "";
    return {
      id,
      title,
      author: "",
      artist: "",
      synopsis,
      altTitles: [],
      status: "Completed",
      type: "Collection",
      isNsfw: true,
      rating: 0,
      thumbnail: absoluteUrl(thumbnail, url),
      genres: [],
      score: "",
      scorePosition: options?.scorePosition ?? "none",
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const { poolId, document } = await poolDetail(id);
    return {
      items: [{
        id: `pool:${poolId}`,
        number: 1,
        title: normalizePoolName(poolName(document, poolId)),
        scanlator: "Danbooru",
        date: Math.floor(Date.now() / 1000),
      }],
    };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const poolId = poolIdFrom(String(chapterId));
    const { url, document } = await fetchDocument(`/pools/${poolId}`);
    const pages: ClientPageResponse["pages"] = [];

    document.querySelectorAll("div.pool > a img, article img, a[href*='/posts/'] img").forEach(image => {
      const src = image.getAttribute("src") || image.getAttribute("data-file-url") || "";
      if (!src || src.includes("blank.gif")) return;
      const full = absoluteUrl(src.replace(/\/\d+x\d+\/__/, "/original/"), url);
      pages.push({ index: pages.length, url: full });
    });

    return { chapterId, pages };
  },
};

export default adapter;
