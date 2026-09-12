export interface ClientMangaSummary {
  id: string;
  title: string;
  thumbnail: string;
  type: string;
  isNsfw: boolean;
}

export interface ClientListResponse {
  items: ClientMangaSummary[];
  page: number;
  hasNextPage: boolean;
}

export type ClientSourceMode = "client" | "server";

export interface ClientSourceAdapter {
  sourceId: string;
  mode: ClientSourceMode;
  popular(page: number): Promise<ClientListResponse>;
  latest(page: number): Promise<ClientListResponse>;
  search(query: string, page: number): Promise<ClientListResponse>;
}

const WEBTOONS_BASE = "https://www.webtoons.com";
const CACHE_DB = "comihub-client-cache";
const CACHE_VERSION = 1;
const CACHE_STORE = "responses";
const CACHE_TTL = 5 * 60 * 1000;

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function cachedText(key: string, loader: () => Promise<string>): Promise<string> {
  try {
    const db = await openCache();
    const cached = await new Promise<{ value: string; savedAt: number } | undefined>((resolve, reject) => {
      const request = db.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (cached && Date.now() - cached.savedAt < CACHE_TTL) return cached.value;
  } catch {
    // IndexedDB is optional; client fetching still works without it.
  }

  const value = await loader();
  try {
    const db = await openCache();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).put({ key, value, savedAt: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignore private-mode/storage quota errors.
  }
  return value;
}

function parseCards(html: string): ClientMangaSummary[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const seen = new Set<string>();
  const items: ClientMangaSummary[] = [];
  document.querySelectorAll(".webtoon_list li a, ul.lst_type1 li a, ul.list_type1 li a").forEach((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    if (!href.includes("title_no=")) return;
    const id = href.replace(WEBTOONS_BASE, "");
    if (seen.has(id)) return;
    const title = anchor.querySelector(".title, .subj")?.textContent?.trim() ?? "";
    if (!title) return;
    seen.add(id);
    const image = anchor.querySelector("img");
    items.push({
      id,
      title,
      thumbnail: image?.getAttribute("src") || image?.getAttribute("data-src") || "",
      type: "manga",
      isNsfw: false,
    });
  });
  return items;
}

const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

async function clientWebtoonsList(kind: "popular" | "latest" | "search", page: number, query = ""): Promise<ClientListResponse> {
  let path: string;
  if (kind === "search") {
    path = `/en/search/webtoon?keyword=${encodeURIComponent(query)}&page=${page}`;
  } else if (kind === "latest") {
    path = `/en/originals/${days[new Date().getDay()]}?sortOrder=UPDATE`;
  } else {
    const rankings = ["trending", "popular", "originals", "canvas"];
    path = `/en/ranking/${rankings[Math.max(0, Math.min(rankings.length - 1, page - 1))]}`;
  }
  const url = `${WEBTOONS_BASE}${path}`;
  const html = await cachedText(`webtoons:list:${url}`, async () => {
    const response = await fetch(url, { credentials: "omit", headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error(`Webtoons client request failed: ${response.status}`);
    return response.text();
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  return {
    items: parseCards(html),
    page,
    hasNextPage: kind === "popular" ? page < 4 : Boolean(document.querySelector("a.pagination[aria-current=true] + a, .paginate .btn_next")),
  };
}

const webtoonsAdapter: ClientSourceAdapter = {
  sourceId: "all.webtoons",
  mode: "client",
  popular: (page) => clientWebtoonsList("popular", page),
  latest: (page) => clientWebtoonsList("latest", page),
  search: (query, page) => clientWebtoonsList("search", page, query),
};

async function clientJson<T>(key: string, url: string): Promise<T> {
  const raw = await cachedText(`client-json:${key}`, async () => {
    const response = await fetch(url, { credentials: "omit", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Client source request failed: ${response.status}`);
    return response.text();
  });
  return JSON.parse(raw) as T;
}

type AsuraList = { data: Array<{ slug: string; title: string; cover?: string; type?: string }>; meta: { has_more: boolean } };
const asuraList = (sort: string, page: number, query = "") => clientJson<AsuraList>(`asura:${sort}:${query}:${page}`, `https://api.asurascans.com/api/series?offset=${(page - 1) * 20}&limit=20&sort=${sort}${query ? `&search=${encodeURIComponent(query)}` : ""}`).then((data) => ({ page, hasNextPage: data.meta?.has_more === true, items: data.data.map((s) => ({ id: s.slug, title: s.title, thumbnail: s.cover ?? "", type: s.type ?? "manga", isNsfw: false })) }));
const asuraAdapter: ClientSourceAdapter = { sourceId: "en.asurascans", mode: "client", popular: (page) => asuraList("popular", page), latest: (page) => asuraList("latest", page), search: (query, page) => asuraList("latest", page, query) };

function mapMangaDex(data: { data: any[]; total: number }, page: number): ClientListResponse {
  return { page, hasNextPage: page * 20 < data.total, items: data.data.map((m) => {
    const title = m.attributes?.title?.en || Object.values(m.attributes?.title ?? {})[0] || m.id;
    const cover = m.relationships?.find((r: any) => r.type === "cover_art")?.attributes?.fileName;
    return { id: m.id, title: String(title), thumbnail: cover ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.256.jpg` : "", type: "manga", isNsfw: false };
  }) };
}
const mangaDexList = (page: number, order: string, query = "") => {
  const params = new URLSearchParams({ limit: "20", offset: String((page - 1) * 20), "includes[]": "cover_art" });
  if (query) { params.set("title", query); params.set("order[relevance]", "desc"); }
  else params.set(`order[${order}]`, "desc");
  return clientJson<{ data: any[]; total: number }>(`mangadex:${order}:${query}:${page}`, `https://api.mangadex.org/manga?${params}`).then((data) => mapMangaDex(data, page));
};
const mangaDexAdapter: ClientSourceAdapter = { sourceId: "all.mangadex", mode: "client", popular: (page) => mangaDexList(page, "followedCount"), latest: (page) => mangaDexList(page, "latestUploadedChapter"), search: (query, page) => mangaDexList(page, "relevance", query) };

const thunderAdapter: ClientSourceAdapter = {
  sourceId: "all.thunderscans", mode: "client",
  popular: (page) => themesiaList("popular", page), latest: (page) => themesiaList("update", page), search: (query, page) => themesiaList("search", page, query),
};
async function themesiaList(order: string, page: number, query = ""): Promise<ClientListResponse> {
  const params = new URLSearchParams({ order, page: String(page) });
  if (query) params.set("title", query);
  const url = `https://en-thunderscans.com/comics/?${params}`;
  const html = await cachedText(`thunderscans:list:${url}`, async () => { const response = await fetch(url, { credentials: "omit" }); if (!response.ok) throw new Error(`Thunder Scans client request failed: ${response.status}`); return response.text(); });
  const document = new DOMParser().parseFromString(html, "text/html");
  const items: ClientMangaSummary[] = [];
  document.querySelectorAll(".listupd .bs .bsx, .listo .bs .bsx, .utao .uta .imgu").forEach((root) => {
    const a = root.querySelector("a"); const href = a?.getAttribute("href"); const title = a?.getAttribute("title") || root.querySelector(".tt")?.textContent?.trim() || a?.textContent?.trim();
    if (!href || !title || items.some((item) => item.id === href)) return;
    const image = root.querySelector("img"); items.push({ id: encodeURIComponent(href.replace("https://en-thunderscans.com", "").replace(/^\/+|\/+$/g, "")), title, thumbnail: image?.getAttribute("data-src") || image?.getAttribute("src") || "", type: "Manga", isNsfw: false });
  });
  return { items, page, hasNextPage: Boolean(document.querySelector(".pagination .next, .hpage .r")) };
}

// Centralized execution policy. Adding a source later means registering its
// adapter here; caching, fallback, and query routing stay shared.
const sourceModes: Record<string, ClientSourceMode> = {
  "all.webtoons": "client",
  "en.asurascans": "client",
  "all.mangadex": "client",
  "all.thunderscans": "client",
  "en.ninehentai": "server",
  "en.royalroad": "server",
  "all.pawchive": "server",
};

const clientAdapters: Record<string, ClientSourceAdapter> = {
  "all.webtoons": webtoonsAdapter,
  "en.asurascans": asuraAdapter,
  "all.mangadex": mangaDexAdapter,
  "all.thunderscans": thunderAdapter,
};

export function getClientSourceAdapter(sourceId: string): ClientSourceAdapter | null {
  const adapter = clientAdapters[sourceId];
  return adapter && sourceModes[sourceId] === "client" ? adapter : null;
}

export function getClientSourceMode(sourceId: string): ClientSourceMode {
  return sourceModes[sourceId] ?? "server";
}

export const isClientWebtoons = (sourceId: string) => getClientSourceAdapter(sourceId)?.sourceId === "all.webtoons";
