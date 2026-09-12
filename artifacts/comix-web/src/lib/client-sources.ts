export interface ClientMangaSummary {
  id: string;
  title: string;
  thumbnail: string;
  type: string;
  isNsfw: boolean;
  mediaType?: "manga" | "anime";
}

export interface ClientListResponse {
  items: ClientMangaSummary[];
  page: number;
  hasNextPage: boolean;
}

export interface ClientMangaDetail {
  id: string;
  title: string;
  author: string;
  artist: string;
  synopsis: string;
  altTitles: string[];
  status: string;
  type: string;
  isNsfw: boolean;
  rating: number;
  thumbnail: string;
  genres: string[];
  score: string;
  scorePosition: "top" | "bottom" | "none";
  sourceTags?: Array<{ id: string; name: string; group?: string }>;
  mediaType?: "manga" | "anime";
}

export interface ClientChapter {
  id: number | string;
  number: number;
  title: string;
  scanlator: string;
  date: number;
  isOfficial?: boolean;
  lang?: string;
  mediaType?: "image" | "video" | "mixed";
}

export interface ClientChapterResponse { items: ClientChapter[]; }
export interface ClientPageResponse {
  chapterId: number | string;
  pages: Array<{ index: number; url: string; text?: string; title?: string }>;
}

export type ClientSourceMode = "client" | "server";

export interface ClientSourceAdapter {
  sourceId: string;
  mode: ClientSourceMode;
  popular(page: number): Promise<ClientListResponse>;
  latest(page: number): Promise<ClientListResponse>;
  search(query: string, page: number): Promise<ClientListResponse>;
  details?(id: string, options?: { scorePosition?: "top" | "bottom" | "none" }): Promise<ClientMangaDetail>;
  chapters?(id: string): Promise<ClientChapterResponse>;
  pages?(chapterId: string): Promise<ClientPageResponse>;
}

const WEBTOONS_BASE = "https://www.webtoons.com";
const WEBTOONS_MOBILE = "https://m.webtoons.com";
const ASURA_API = "https://api.asurascans.com/api";
const MANGADEX_API = "https://api.mangadex.org";
const CACHE_DB = "comihub-client-cache";
const CACHE_VERSION = 1;
const CACHE_STORE = "responses";
const CACHE_TTL = 5 * 60 * 1000;

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: "key" });
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
  } catch { /* IndexedDB is optional. */ }
  const value = await loader();
  try {
    const db = await openCache();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).put({ key, value, savedAt: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch { /* Ignore private-mode/storage quota errors. */ }
  return value;
}

async function clientJson<T>(key: string, url: string, init?: RequestInit): Promise<T> {
  const raw = await cachedText(`client-json:${key}`, async () => {
    const response = await fetch(url, { credentials: "omit", ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
    if (!response.ok) throw new Error(`Client source request failed: ${response.status}`);
    return response.text();
  });
  return JSON.parse(raw) as T;
}

async function clientHtml(key: string, url: string, init?: RequestInit): Promise<Document> {
  const raw = await cachedText(`client-html:${key}`, async () => {
    const response = await fetch(url, { credentials: "omit", ...init, headers: { Accept: "text/html", ...(init?.headers ?? {}) } });
    if (!response.ok) throw new Error(`Client source request failed: ${response.status}`);
    return response.text();
  });
  return new DOMParser().parseFromString(raw, "text/html");
}

function parseCards(document: Document): ClientMangaSummary[] {
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
    items.push({ id, title, thumbnail: image?.getAttribute("src") || image?.getAttribute("data-src") || "", type: "manga", isNsfw: false });
  });
  return items;
}

const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

async function clientWebtoonsList(kind: "popular" | "latest" | "search", page: number, query = ""): Promise<ClientListResponse> {
  let path: string;
  if (kind === "search") path = `/en/search/webtoon?keyword=${encodeURIComponent(query)}&page=${page}`;
  else if (kind === "latest") path = `/en/originals/${days[new Date().getDay()]}?sortOrder=UPDATE`;
  else path = `/en/ranking/${["trending", "popular", "originals", "canvas"][Math.max(0, Math.min(3, page - 1))]}`;
  const document = await clientHtml(`webtoons:list:${path}`, `${WEBTOONS_BASE}${path}`);
  return { items: parseCards(document), page, hasNextPage: kind === "popular" ? page < 4 : Boolean(document.querySelector("a.pagination[aria-current=true] + a, .paginate .btn_next")) };
}

function webtoonType(id: string): "webtoon" | "canvas" { return id.includes("/canvas/") ? "canvas" : "webtoon"; }
function webtoonTitleNo(id: string): string { return new URL(id.startsWith("http") ? id : `${WEBTOONS_BASE}${id}`, WEBTOONS_BASE).searchParams.get("title_no") ?? ""; }

async function webtoonDetails(id: string, options?: { scorePosition?: "top" | "bottom" | "none" }): Promise<ClientMangaDetail> {
  const document = await clientHtml(`webtoons:detail:${id}`, id.startsWith("http") ? id : `${WEBTOONS_BASE}${id}`, { headers: { Cookie: "ageGatePass=true; locale=en; needGDPR=false" } });
  const title = document.querySelector("h1.subj, .detail_header h1")?.textContent?.trim() || id;
  const synopsis = document.querySelector("p.summary, .detail_header .summary")?.textContent?.trim() || "";
  const thumbnail = document.querySelector("meta[property='og:image']")?.getAttribute("content") || document.querySelector(".detail_header .thmb img")?.getAttribute("src") || "";
  const author = document.querySelector(".author_area .author, .author_area")?.textContent?.trim() || "";
  const genres = Array.from(document.querySelectorAll(".genre")).map(el => el.textContent?.trim() || "").filter(Boolean);
  const statusText = document.querySelector(".day_info")?.textContent || "";
  return { id, title, author, artist: author, synopsis, altTitles: [], status: /END|COMPLETED/i.test(statusText) ? "Completed" : "Ongoing", type: webtoonType(id), isNsfw: false, rating: 0, thumbnail, genres, score: "", scorePosition: options?.scorePosition ?? "none", sourceTags: genres.map(g => ({ id: g.toLowerCase().replace(/\s+/g, "-"), name: g, group: "Genre" })) };
}

async function webtoonChapters(id: string): Promise<ClientChapterResponse> {
  const titleNo = webtoonTitleNo(id);
  if (!titleNo) throw new Error(`Webtoons: cannot parse title_no from ${id}`);
  const data = await clientJson<any>(`webtoons:chapters:${id}`, `${WEBTOONS_MOBILE}/api/v1/${webtoonType(id)}/${titleNo}/episodes?pageSize=99999`, { headers: { Cookie: "ageGatePass=true; locale=en; needGDPR=false", Referer: `${WEBTOONS_MOBILE}/` } });
  const episodes = data?.result?.episodeList ?? [];
  return { items: episodes.map((ep: any) => ({ id: ep.viewerLink, number: ep.episodeNo, title: ep.episodeTitle, scanlator: "", date: Math.floor((ep.exposureDateMillis ?? 0) / 1000) })).reverse() };
}

async function webtoonPages(chapterId: string): Promise<ClientPageResponse> {
  const document = await clientHtml(`webtoons:pages:${chapterId}`, chapterId.startsWith("http") ? chapterId : `${WEBTOONS_BASE}${chapterId}`, { headers: { Cookie: "ageGatePass=true; locale=en; needGDPR=false", Referer: `${WEBTOONS_BASE}/` } });
  const urls = Array.from(document.querySelectorAll("#_imageList > img[data-url], img[data-url]")).map(el => el.getAttribute("data-url") || "").filter(url => url && !url.includes("/thumb_")).filter((url, index, all) => all.indexOf(url) === index);
  if (!urls.length) throw new Error(`Webtoons: no pages found for ${chapterId}`);
  return { chapterId, pages: urls.map((url, index) => ({ index, url })) };
}

type AsSeries = { slug: string; title: string; cover?: string; type?: string; description?: string; author?: string; artist?: string; status?: string; alt_titles?: string[]; genres?: Array<{ slug: string; name: string }> };
function asuraDetail(id: string, s: AsSeries, scorePosition?: "top" | "bottom" | "none"): ClientMangaDetail {
  const status = (s.status ?? "").toLowerCase();
  return { id, title: s.title ?? id, author: s.author ?? "", artist: s.artist ?? "", synopsis: s.description ?? "", altTitles: s.alt_titles ?? [], status: status.includes("ongoing") ? "Ongoing" : status.includes("completed") ? "Completed" : "Unknown", type: (s.type ?? "").toLowerCase().includes("manhwa") ? "manhwa" : (s.type ?? "").toLowerCase().includes("manhua") ? "manhua" : "manga", isNsfw: false, rating: 0, thumbnail: s.cover ?? "", genres: (s.genres ?? []).map(g => g.name), score: "", scorePosition: scorePosition ?? "none", sourceTags: (s.genres ?? []).map(g => ({ id: g.slug, name: g.name, group: "Genre" })) };
}
async function asuraDetails(id: string, options?: { scorePosition?: "top" | "bottom" | "none" }): Promise<ClientMangaDetail> {
  const data = await clientJson<any>(`asura:detail:${id}`, `${ASURA_API}/series/${encodeURIComponent(id)}`);
  return asuraDetail(id, data?.data?.series ?? data?.series ?? data, options?.scorePosition);
}
async function asuraChapters(id: string): Promise<ClientChapterResponse> {
  const data = await clientJson<any>(`asura:chapters:${id}`, `${ASURA_API}/series/${encodeURIComponent(id)}/chapters?page=1&perPage=9999`);
  return { items: (data?.data ?? []).map((ch: any) => ({ id: `${id}|||${ch.slug || ch.number}`, number: ch.number, title: ch.title ? `Chapter ${ch.number}: ${ch.title}` : `Chapter ${ch.number}`, scanlator: "", date: ch.published_at ? Math.floor(new Date(ch.published_at).getTime() / 1000) : 0 })) };
}
async function asuraPages(chapterId: string): Promise<ClientPageResponse> {
  const [series, chapter] = chapterId.split("|||");
  if (!series || !chapter) throw new Error(`AsuraScans: invalid chapter ${chapterId}`);
  const data = await clientJson<any>(`asura:pages:${chapterId}`, `${ASURA_API}/series/${encodeURIComponent(series)}/chapters/${encodeURIComponent(chapter)}`);
  const pages = data?.data?.chapter?.pages ?? [];
  if (!pages.length) throw new Error(`AsuraScans: no pages returned for ${chapterId}`);
  return { chapterId, pages: pages.map((page: any, index: number) => ({ index, url: page.url })) };
}

async function mangaDexDetails(id: string, options?: { scorePosition?: "top" | "bottom" | "none" }): Promise<ClientMangaDetail> {
  const data = await clientJson<any>(`mangadex:detail:${id}`, `${MANGADEX_API}/manga/${encodeURIComponent(id)}?includes[]=cover_art&includes[]=author&includes[]=artist`);
  const a = data.data?.attributes ?? {};
  const title = a.title?.en || Object.values(a.title ?? {})[0] || id;
  const desc = a.description?.en || Object.values(a.description ?? {})[0] || "";
  const cover = (data.data?.relationships ?? []).find((r: any) => r.type === "cover_art")?.attributes?.fileName;
  const authors = (data.data?.relationships ?? []).filter((r: any) => r.type === "author" || r.type === "artist").map((r: any) => r.attributes?.name).filter(Boolean);
  const genres = (a.tags ?? []).map((t: any) => t.attributes?.name?.en).filter(Boolean);
  return { id, title: String(title), author: authors.join(", "), artist: authors.join(", "), synopsis: String(desc), altTitles: Object.values(a.altTitles ?? {}).flatMap((v: any) => Object.values(v ?? {})).map(String), status: a.status ? String(a.status).replace(/^./, (c: string) => c.toUpperCase()) : "Unknown", type: "manga", isNsfw: false, rating: 0, thumbnail: cover ? `https://uploads.mangadex.org/covers/${id}/${cover}.256.jpg` : "", genres, score: "", scorePosition: options?.scorePosition ?? "none", sourceTags: genres.map((g: string) => ({ id: g.toLowerCase().replace(/\s+/g, "-"), name: g, group: "Genre" })) };
}
async function mangaDexChapters(id: string): Promise<ClientChapterResponse> {
  const params = new URLSearchParams({ limit: "500", "order[chapter]": "desc" });
  params.append("translatedLanguage[]", "en");
  const data = await clientJson<any>(`mangadex:chapters:${id}`, `${MANGADEX_API}/manga/${encodeURIComponent(id)}/feed?${params}`);
  return { items: (data.data ?? []).map((ch: any) => ({ id: ch.id, number: Number(ch.attributes?.chapter ?? 0), title: ch.attributes?.title || `Chapter ${ch.attributes?.chapter ?? ""}`, scanlator: "", date: ch.attributes?.publishAt ? Math.floor(Date.parse(ch.attributes.publishAt) / 1000) : 0 })) };
}
async function mangaDexPages(chapterId: string): Promise<ClientPageResponse> {
  const data = await clientJson<any>(`mangadex:pages:${chapterId}`, `${MANGADEX_API}/at-home/server/${encodeURIComponent(chapterId)}`);
  const base = `${data.baseUrl}/data/${data.chapter.hash}`;
  return { chapterId, pages: (data.chapter.data ?? []).map((file: string, index: number) => ({ index, url: `${base}/${file}` })) };
}

const webtoonsAdapter: ClientSourceAdapter = { sourceId: "all.webtoons", mode: "client", popular: p => clientWebtoonsList("popular", p), latest: p => clientWebtoonsList("latest", p), search: (q, p) => clientWebtoonsList("search", p, q), details: webtoonDetails, chapters: webtoonChapters, pages: webtoonPages };

type AsuraList = { data: Array<{ slug: string; title: string; cover?: string; type?: string }>; meta: { has_more: boolean } };
const asuraList = (sort: string, page: number, query = "") => clientJson<AsuraList>(`asura:${sort}:${query}:${page}`, `${ASURA_API}/series?offset=${(page - 1) * 20}&limit=20&sort=${sort}${query ? `&search=${encodeURIComponent(query)}` : ""}`).then(data => ({ page, hasNextPage: data.meta?.has_more === true, items: data.data.map(s => ({ id: s.slug, title: s.title, thumbnail: s.cover ?? "", type: s.type ?? "manga", isNsfw: false })) }));
const asuraAdapter: ClientSourceAdapter = { sourceId: "en.asurascans", mode: "client", popular: p => asuraList("popular", p), latest: p => asuraList("latest", p), search: (q, p) => asuraList("latest", p, q), details: asuraDetails, chapters: asuraChapters, pages: asuraPages };

function mapMangaDex(data: { data: any[]; total: number }, page: number): ClientListResponse { return { page, hasNextPage: page * 20 < data.total, items: data.data.map(m => { const title = m.attributes?.title?.en || Object.values(m.attributes?.title ?? {})[0] || m.id; const cover = m.relationships?.find((r: any) => r.type === "cover_art")?.attributes?.fileName; return { id: m.id, title: String(title), thumbnail: cover ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.256.jpg` : "", type: "manga", isNsfw: false }; }) }; }
const mangaDexList = (page: number, order: string, query = "") => { const params = new URLSearchParams({ limit: "20", offset: String((page - 1) * 20), "includes[]": "cover_art" }); if (query) { params.set("title", query); params.set("order[relevance]", "desc"); } else params.set(`order[${order}]`, "desc"); return clientJson<{ data: any[]; total: number }>(`mangadex:${order}:${query}:${page}`, `${MANGADEX_API}/manga?${params}`).then(data => mapMangaDex(data, page)); };
const mangaDexAdapter: ClientSourceAdapter = { sourceId: "all.mangadex", mode: "client", popular: p => mangaDexList(p, "followedCount"), latest: p => mangaDexList(p, "latestUploadedChapter"), search: (q, p) => mangaDexList(p, "relevance", q), details: mangaDexDetails, chapters: mangaDexChapters, pages: mangaDexPages };

async function themesiaList(order: string, page: number, query = ""): Promise<ClientListResponse> { const params = new URLSearchParams({ order, page: String(page) }); if (query) params.set("title", query); const document = await clientHtml(`thunderscans:list:${params}`, `https://en-thunderscans.com/comics/?${params}`); const items: ClientMangaSummary[] = []; document.querySelectorAll(".listupd .bs .bsx, .listo .bs .bsx, .utao .uta .imgu").forEach(root => { const a = root.querySelector("a"); const href = a?.getAttribute("href"); const title = a?.getAttribute("title") || root.querySelector(".tt")?.textContent?.trim() || a?.textContent?.trim(); if (!href || !title || items.some(item => item.id === href)) return; const image = root.querySelector("img"); items.push({ id: encodeURIComponent(href.replace("https://en-thunderscans.com", "").replace(/^\/+|\/+$/g, "")), title, thumbnail: image?.getAttribute("data-src") || image?.getAttribute("src") || "", type: "Manga", isNsfw: false }); }); return { items, page, hasNextPage: Boolean(document.querySelector(".pagination .next, .hpage .r")) }; }
const thunderAdapter: ClientSourceAdapter = { sourceId: "all.thunderscans", mode: "client", popular: p => themesiaList("popular", p), latest: p => themesiaList("update", p), search: (q, p) => themesiaList("search", p, q) };

const sourceModes: Record<string, ClientSourceMode> = { "all.webtoons": "client", "en.asurascans": "client", "all.mangadex": "client", "all.thunderscans": "client", "en.ninehentai": "server", "en.royalroad": "server", "all.pawchive": "server" };
const clientAdapters: Record<string, ClientSourceAdapter> = { "all.webtoons": webtoonsAdapter, "en.asurascans": asuraAdapter, "all.mangadex": mangaDexAdapter, "all.thunderscans": thunderAdapter };
export function getClientSourceAdapter(sourceId: string): ClientSourceAdapter | null { const adapter = clientAdapters[sourceId]; return adapter && sourceModes[sourceId] === "client" ? adapter : null; }
export function getClientSourceMode(sourceId: string): ClientSourceMode { return sourceModes[sourceId] ?? "server"; }
export const isClientWebtoons = (sourceId: string) => getClientSourceAdapter(sourceId)?.sourceId === "all.webtoons";
export const isClientSource = (sourceId: string) => getClientSourceMode(sourceId) === "client";
