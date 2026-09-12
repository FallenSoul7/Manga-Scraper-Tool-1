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

export async function clientWebtoonsList(kind: "popular" | "latest" | "search", page: number, query = ""): Promise<ClientListResponse> {
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

export const isClientWebtoons = (sourceId: string) => sourceId === "all.webtoons";
