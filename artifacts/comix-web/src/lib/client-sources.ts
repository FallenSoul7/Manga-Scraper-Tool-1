import { createTier1ClientAdapter, getImportedTier1Extension } from "./imported-extensions";
import { clientFetch } from "./client-fetch";
import { atsuAdapter } from "./native-adapters/all-atsu";
import danbooruAdapter from "./native-adapters/all-danbooru";
import { pawchiveAdapter } from "./native-adapters/all-pawchive";
import comickfanAdapter from "./native-adapters/en-comickfan";
import allmangaAdapter from "./native-adapters/en-allmanga";
import rule34Adapter from "./native-adapters/en-rule34";
import xkcdAdapter from "./native-adapters/en-xkcd";
import royalroadAdapter from "./native-adapters/en-royalroad";
import hentaifoxAdapter from "./native-adapters/all-hentaifox";
import onlythebesthentaiAdapter from "./native-adapters/en-onlythebesthentai";
import mangafreakAdapter from "./native-adapters/en-mangafreak";
import novelfullAdapter from "./native-adapters/en-novelfull";
import novelhallAdapter from "./native-adapters/en-novelhall";
import ninehentaiAdapter from "./native-adapters/en-ninehentai";
import resetscansAdapter from "./native-adapters/en-resetscans";
import pandachaikaAdapter from "./native-adapters/all-pandachaika";
import animeggAdapter from "./native-adapters/en-animegg";
import mihentaiAdapter from "./native-adapters/all-mihentai";
import ravenscansAdapter from "./native-adapters/en-ravenscans";
import elftoonAdapter from "./native-adapters/en-elftoon";

export interface ClientMangaSummary {
  id: string;
  title: string;
  thumbnail: string;
  type: string;
  isNsfw: boolean;
  mediaType?: "manga" | "anime" | "novel";
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
  mediaType?: "manga" | "anime" | "novel";
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
  thumbnail?: string;
  thumbnailIsStatic?: boolean;
  attachmentCount?: number;
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
  /** When false, failures stay on the client instead of calling an unsupported backend source. */
  fallbackToServer?: boolean;
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
const MANGADEX_COVER_FALLBACK = "/public/source-icons/all.mangadex.png";
const CACHE_DB = "comihub-client-cache";
const CACHE_VERSION = 1;
const CACHE_STORE = "responses";
const CACHE_TTL = 5 * 60 * 1000;
function clientSourceLabel(key: string): string {
  const id = key.split(":", 1)[0].toLowerCase();
  const labels: Record<string, string> = {
    asura: "Asura Scans",
    mangadex: "MangaDex",
    thunderscans: "Thunder Scans",
    webtoons: "Webtoons",
    pawchive: "Pawchive",
  };
  return labels[id] ?? "This source";
}
function unavailableSourceError(key: string): Error {
  return new Error(`${clientSourceLabel(key)} is temporarily unavailable or blocking requests. Please check your connection and try again later.`);
}

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
  try {
    const raw = await cachedText(`client-json:${key}`, async () => {
      const response = await clientFetch(url, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    });
    return JSON.parse(raw) as T;
  } catch {
    throw unavailableSourceError(key);
  }
}

async function clientHtml(key: string, url: string, init?: RequestInit): Promise<Document> {
  try {
    const raw = await cachedText(`client-html:${key}`, async () => {
      const response = await clientFetch(url, { ...init, headers: { Accept: "text/html", ...(init?.headers ?? {}) } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    });
    return new DOMParser().parseFromString(raw, "text/html");
  } catch {
    throw unavailableSourceError(key);
  }
}

function parseCards(document: Document): ClientMangaSummary[] {
  const seen = new Set<string>();
  const items: ClientMangaSummary[] = [];
  const imageUrl = (image: HTMLImageElement | null): string => {
    if (!image) return "";
    const candidates = [
      image.getAttribute("data-url"), image.getAttribute("data-src"),
      image.getAttribute("data-original"), image.getAttribute("data-lazy-src"),
      image.getAttribute("data-srcset"), image.getAttribute("srcset"),
      image.getAttribute("src"),
    ].filter(Boolean) as string[];
    const raw = candidates.find(value => !value.startsWith("data:") && !/transparent|blank|placeholder/i.test(value)) || "";
    const first = raw.split(",")[0].trim().split(/\s+/)[0];
    try { return first ? new URL(first, WEBTOONS_BASE).toString() : ""; }
    catch { return first; }
  };
  document.querySelectorAll(".webtoon_list li a, ul.lst_type1 li a, ul.list_type1 li a").forEach((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    if (!href.includes("title_no=")) return;
    const id = href.replace(WEBTOONS_BASE, "");
    if (seen.has(id)) return;
    const title = anchor.querySelector(".title, .subj")?.textContent?.trim() ?? "";
    if (!title) return;
    seen.add(id);
    items.push({ id, title, thumbnail: imageUrl(anchor.querySelector("img")), type: "manga", isNsfw: false });
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
  const thumbnail = document.querySelector("meta[property='og:image']")?.getAttribute("content")
    || document.querySelector(".detail_header .thmb img")?.getAttribute("data-src")
    || document.querySelector(".detail_header .thmb img")?.getAttribute("src") || "";
  const author = document.querySelector(".author_area .author, .author_area")?.textContent?.trim() || "";
  const genres = Array.from(document.querySelectorAll(".genre")).map(el => el.textContent?.trim() || "").filter(Boolean);
  const statusText = document.querySelector(".day_info")?.textContent || "";
  return { id, title, author, artist: author, synopsis, altTitles: [], status: /END|COMPLETED/i.test(statusText) ? "Completed" : "Ongoing", type: webtoonType(id), isNsfw: false, rating: 0, thumbnail, genres, score: "", scorePosition: options?.scorePosition ?? "none", sourceTags: genres.map(g => ({ id: g.toLowerCase().replace(/\s+/g, "-"), name: g, group: "Genre" })) };
}

async function webtoonChapters(id: string): Promise<ClientChapterResponse> {
  const titleNo = webtoonTitleNo(id);
  if (!titleNo) throw new Error(`Webtoons: cannot parse title_no from ${id}`);
  const data = await clientJson<any>(`webtoons:chapters:${id}`, `${WEBTOONS_MOBILE}/api/v1/${webtoonType(id)}/${titleNo}/episodes?pageSize=99999`, { headers: { Cookie: "ageGatePass=true; locale=en; needGDPR=false" } });
  const episodes = data?.result?.episodeList ?? [];
  return { items: episodes.map((ep: any) => ({ id: ep.viewerLink, number: ep.episodeNo, title: ep.episodeTitle, scanlator: "", date: Math.floor((ep.exposureDateMillis ?? 0) / 1000) })).reverse() };
}

async function webtoonPages(chapterId: string): Promise<ClientPageResponse> {
  const document = await clientHtml(`webtoons:pages:${chapterId}`, chapterId.startsWith("http") ? chapterId : `${WEBTOONS_BASE}${chapterId}`, { headers: { Cookie: "ageGatePass=true; locale=en; needGDPR=false" } });
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
  const params = new URLSearchParams();
  params.append("includes[]", "cover_art");
  params.append("includes[]", "author");
  params.append("includes[]", "artist");
  params.append("contentRating[]", "safe");
  params.append("contentRating[]", "suggestive");
  const data = await clientJson<any>(`mangadex:detail:${id}`, `${MANGADEX_API}/manga/${encodeURIComponent(id)}?${params}`);
  const a = data.data?.attributes ?? {};
  const title = a.title?.en || Object.values(a.title ?? {})[0] || id;
  const desc = a.description?.en || Object.values(a.description ?? {})[0] || "";
  const cover = (data.data?.relationships ?? []).find((r: any) => r?.type === "cover_art")?.attributes?.fileName;
  const authors = (data.data?.relationships ?? []).filter((r: any) => r.type === "author" || r.type === "artist").map((r: any) => r.attributes?.name).filter(Boolean);
  const genres = (a.tags ?? []).map((t: any) => t.attributes?.name?.en).filter(Boolean);
  return { id, title: String(title), author: authors.join(", "), artist: authors.join(", "), synopsis: String(desc), altTitles: Object.values(a.altTitles ?? {}).flatMap((v: any) => Object.values(v ?? {})).map(String), status: a.status ? String(a.status).replace(/^./, (c: string) => c.toUpperCase()) : "Unknown", type: "manga", isNsfw: false, rating: 0, thumbnail: cover ? `https://uploads.mangadex.org/covers/${encodeURIComponent(id)}/${encodeURIComponent(String(cover))}.256.jpg` : MANGADEX_COVER_FALLBACK, genres, score: "", scorePosition: options?.scorePosition ?? "none", sourceTags: genres.map((g: string) => ({ id: g.toLowerCase().replace(/\s+/g, "-"), name: g, group: "Genre" })) };
}
async function mangaDexChapters(id: string): Promise<ClientChapterResponse> {
  const all: any[] = [];
  const limit = 100;
  let offset = 0;
  let total = 0;
  do {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      "order[chapter]": "desc",
      "order[volume]": "desc",
    });
    // Do not send translatedLanguage[] here. The chapter language picker needs
    // the complete MangaDex feed, not only English chapters.
    params.append("includes[]", "scanlation_group");
    for (const rating of ["safe", "suggestive", "erotica", "pornographic"]) {
      params.append("contentRating[]", rating);
    }
    const data = await clientJson<any>(
      `mangadex:chapters:${id}:${offset}`,
      `${MANGADEX_API}/manga/${encodeURIComponent(id)}/feed?${params}`,
    );
    const page = data.data ?? [];
    all.push(...page);
    total = Number(data.total ?? all.length);
    offset += limit;
    if (page.length === 0) break;
  } while (offset < total && offset < 5000);

  return {
    items: all.map((ch: any) => {
      const attributes = ch.attributes ?? {};
      const group = (ch.relationships ?? []).find((r: any) => r.type === "scanlation_group");
      const chapterNumber = attributes.chapter ?? "";
      return {
        id: ch.id,
        number: Number(chapterNumber) || 0,
        title: attributes.title || `Chapter ${chapterNumber}`,
        scanlator: group?.attributes?.name || "",
        date: attributes.publishAt ? Math.floor(Date.parse(attributes.publishAt) / 1000) : 0,
        lang: attributes.translatedLanguage || undefined,
      };
    }),
  };
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

function mangaDexCover(id: string, relationship: any): string {
  const fileName = relationship?.attributes?.fileName;
  return fileName ? `https://uploads.mangadex.org/covers/${encodeURIComponent(id)}/${encodeURIComponent(String(fileName))}.256.jpg` : MANGADEX_COVER_FALLBACK;
}
function mapMangaDex(data: { data: any[]; total: number }, page: number): ClientListResponse { return { page, hasNextPage: page * 20 < data.total, items: (data.data ?? []).map(m => { const title = m.attributes?.title?.en || Object.values(m.attributes?.title ?? {})[0] || m.id; const cover = m.relationships?.find((r: any) => r?.type === "cover_art"); return { id: m.id, title: String(title), thumbnail: mangaDexCover(String(m.id), cover), type: "manga", isNsfw: false }; }) }; }
const mangaDexList = (page: number, order: string, query = "") => { const params = new URLSearchParams(); params.set("limit", "20"); params.set("offset", String((page - 1) * 20)); params.append("includes[]", "cover_art"); params.append("contentRating[]", "safe"); params.append("contentRating[]", "suggestive"); if (query) { params.set("title", query); params.set("order[relevance]", "desc"); } else params.set(`order[${order}]`, "desc"); return clientJson<{ data: any[]; total: number }>(`mangadex:${order}:${query}:${page}`, `${MANGADEX_API}/manga?${params}`).then(data => mapMangaDex(data, page)); };
const mangaDexAdapter: ClientSourceAdapter = { sourceId: "all.mangadex", mode: "client", popular: p => mangaDexList(p, "followedCount"), latest: p => mangaDexList(p, "latestUploadedChapter"), search: (q, p) => mangaDexList(p, "relevance", q), details: mangaDexDetails, chapters: mangaDexChapters, pages: mangaDexPages };

const THUNDER_BASE = "https://en-thunderscans.com";
function themesiaText(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
function themesiaUrl(value: string, base: string): string {
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}
function themesiaImage(element: Element | null, base: string): string {
  if (!element) return "";
  const raw = ["data-src", "data-original", "data-lazy-src", "data-image", "srcset", "src"]
    .map(attribute => element.getAttribute(attribute))
    .find(value => !!value && !value.startsWith("data:") && !/transparent|blank|placeholder/i.test(value)) ?? "";
  const candidate = raw.split(",")[0].trim().split(/\s+/)[0];
  return candidate ? themesiaUrl(candidate, base) : "";
}
async function withThunderError<T>(action: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(`Thunder Scans could not load ${action}. The source may be temporarily unavailable or rejecting requests; try again later.`);
  }
}
function thunderPageUrl(id: string): string {
  const path = decodeURIComponent(id).replace(/^\/+|\/+$/g, "");
  const url = new URL(`${path}/`, `${THUNDER_BASE}/`);
  if (url.origin !== THUNDER_BASE) throw new Error("Invalid Thunder Scans source path.");
  return url.href;
}
async function themesiaList(order: string, page: number, query = ""): Promise<ClientListResponse> {
  const params = new URLSearchParams({ order, page: String(page) });
  if (query) params.set("title", query);
  const document = await clientHtml(`thunderscans:list:${params}`, `${THUNDER_BASE}/comics/?${params}`);
  const items: ClientMangaSummary[] = [];
  document.querySelectorAll(".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx").forEach(root => {
    const anchor = root.matches("a") ? root : root.querySelector("a");
    const rawHref = anchor?.getAttribute("href") ?? "";
    const href = themesiaUrl(rawHref, `${THUNDER_BASE}/`);
    const title = anchor?.getAttribute("title") || themesiaText(root.querySelector(".tt")) || themesiaText(anchor) || themesiaText(root);
    if (!href || new URL(href).origin !== THUNDER_BASE || !title) return;
    const id = encodeURIComponent(new URL(href).pathname.replace(/^\/+|\/+$/g, ""));
    if (items.some(item => item.id === id)) return;
    items.push({ id, title, thumbnail: themesiaImage(root.querySelector("img"), href), type: "Manga", isNsfw: false });
  });
  return { items, page, hasNextPage: Boolean(document.querySelector(".pagination .next, .hpage .r")) };
}
function themesiaStatus(value: string): string {
  const text = value.toLowerCase();
  if (text.includes("ongoing") || text.includes("publishing")) return "Ongoing";
  if (text.includes("completed") || text.includes("finished") || text.includes("end")) return "Completed";
  if (text.includes("hiatus")) return "Hiatus";
  if (text.includes("cancel") || text.includes("dropped")) return "Cancelled";
  return value.trim() || "Unknown";
}
function themesiaInfoValue(root: ParentNode, labels: string[]): string {
  for (const label of labels) {
    for (const row of Array.from(root.querySelectorAll(".tsinfo .imptdt, .infotable tr, .fmed"))) {
      if (!themesiaText(row).toLowerCase().includes(label)) continue;
      const values = Array.from(row.querySelectorAll("i, td:last-child, span"));
      const value = themesiaText(values[values.length - 1] ?? row);
      if (value && value.toLowerCase() !== label) return value;
    }
  }
  return "";
}
async function thunderDetails(id: string, options?: { scorePosition?: "top" | "bottom" | "none" }): Promise<ClientMangaDetail> {
  return withThunderError("manga details", async () => {
    const url = thunderPageUrl(id);
    const document = await clientHtml(`thunderscans:details:${id}`, url);
    const root = document.querySelector("div.bigcontent, div.animefull, div.main-info, div.postbody") ?? document;
    const title = themesiaText(root.querySelector("h1.entry-title")) || "Untitled";
    const thumb = themesiaImage(root.querySelector(".thumb img, .ts-post-image"), url);
    const synopsis = themesiaText(root.querySelector(".desc, .entry-content[itemprop='description']"));
    const altText = themesiaText(root.querySelector(".alternative, .seriestualt"));
    const genres = Array.from(root.querySelectorAll(".mgen a, .seriestugenre a, .gnr a"))
      .map(element => themesiaText(element)).filter(Boolean);
    const author = themesiaInfoValue(root, ["author"]);
    return {
      id,
      title,
      author,
      artist: themesiaInfoValue(root, ["artist"]),
      synopsis,
      altTitles: altText ? altText.split(/[,;|]/).map(value => value.trim()).filter(Boolean) : [],
      status: themesiaStatus(themesiaInfoValue(root, ["status"])),
      type: "Manga",
      isNsfw: false,
      rating: 0,
      thumbnail: thumb,
      genres,
      score: "",
      scorePosition: options?.scorePosition ?? "none",
    };
  });
}
async function thunderChapters(mangaId: string): Promise<ClientChapterResponse> {
  return withThunderError("the chapter list", async () => {
    const mangaUrl = thunderPageUrl(mangaId);
    const document = await clientHtml(`thunderscans:chapters:${mangaId}`, mangaUrl);
    const seen = new Set<string>();
    const items: ClientChapterResponse["items"] = [];
    document.querySelectorAll("#chapterlist li, div.eplister li, .clstyle li").forEach(row => {
      const anchor = row.querySelector("a");
      const href = anchor?.getAttribute("href") ?? "";
      const chapterUrl = href ? themesiaUrl(href, mangaUrl) : "";
      if (!chapterUrl || new URL(chapterUrl).origin !== THUNDER_BASE) return;
      const title = themesiaText(row.querySelector(".chapternum")) || themesiaText(anchor);
      if (!title) return;
      const id = encodeURIComponent(new URL(chapterUrl).pathname.replace(/^\/+|\/+$/g, ""));
      if (seen.has(id)) return;
      seen.add(id);
      const number = Number((title.match(/chapter\s*([\d.]+)/i) || title.match(/([\d.]+)/) || [])[1]) || 0;
      const rawDate = themesiaText(row.querySelector(".chapterdate"));
      const parsedDate = Date.parse(rawDate);
      items.push({
        id,
        number,
        title,
        scanlator: "Thunder Scans",
        date: Number.isFinite(parsedDate) ? Math.floor(parsedDate / 1000) : 0,
        mediaType: "image",
      });
    });
    return { items };
  });
}
function themesiaReaderImages(document: Document): string[] {
  for (const script of Array.from(document.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    const callIndex = text.indexOf("ts_reader.run(");
    const start = callIndex >= 0 ? text.indexOf("{", callIndex) : -1;
    if (start < 0) continue;
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const character = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "\"" || character === "'") quote = character;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0) {
        try {
          const payload = JSON.parse(text.slice(start, index + 1)) as { sources?: Array<{ images?: unknown[] }> };
          const images = payload.sources?.[0]?.images ?? [];
          if (Array.isArray(images)) return images.filter((value): value is string => typeof value === "string" && !!value.trim());
        } catch {
          break;
        }
      }
    }
  }
  return [];
}
async function thunderPages(chapterId: string): Promise<ClientPageResponse> {
  return withThunderError("chapter pages", async () => {
    const url = thunderPageUrl(chapterId);
    const document = await clientHtml(`thunderscans:pages:${chapterId}`, url);
    const embedded = themesiaReaderImages(document);
    const imageValues = embedded.length ? embedded : Array.from(document.querySelectorAll("#readerarea img, div.reader-area img"))
      .map(image => themesiaImage(image, url)).filter(value => value && !/\/themes\/|404/i.test(value));
    const pages = imageValues.map((value, index) => ({ index, url: themesiaUrl(value, url) })).filter(page => !!page.url);
    if (!pages.length) throw new Error("No safe Thunder Scans images were found for this chapter.");
    return { chapterId, pages };
  });
}
const thunderAdapter: ClientSourceAdapter = {
  sourceId: "all.thunderscans",
  mode: "client",
  popular: page => withThunderError("popular series", () => themesiaList("popular", page)),
  latest: page => withThunderError("latest series", () => themesiaList("update", page)),
  search: (query, page) => withThunderError("search results", () => themesiaList("search", page, query)),
  details: thunderDetails,
  chapters: thunderChapters,
  pages: thunderPages,
};

const sourceModes: Record<string, ClientSourceMode> = {
  "all.atsu": "client",
  "all.danbooru": "client",
  "all.webtoons": "client",
  "en.asurascans": "client",
  "all.mangadex": "client",
  "all.thunderscans": "client",
  "all.pawchive": "client",
  "en.comickfan": "client",
  "en.allmanga": "client",
  "en.rule34": "client",
  "en.xkcd": "client",
  "en.royalroad": "client",
  "all.hentaifox": "client",
  "en.onlythebesthentai": "client",
  "en.mangafreak": "client",
  "en.novelfull": "client",
  "en.novelhall": "client",
  "en.ninehentai": "client",
  "en.resetscans": "client",
  "all.pandachaika": "client",
  "en.pandachaika": "client",
  "en.animegg": "client",
  "all.mihentai": "client",
  "en.ravenscans": "client",
  "en.elftoon": "client",
  "en.allanime": "client",
};
const clientAdapters: Record<string, ClientSourceAdapter> = {
  "all.atsu": atsuAdapter,
  "all.danbooru": danbooruAdapter,
  "all.webtoons": webtoonsAdapter,
  "en.asurascans": asuraAdapter,
  "all.mangadex": mangaDexAdapter,
  "all.thunderscans": thunderAdapter,
  "all.pawchive": pawchiveAdapter,
  "en.comickfan": comickfanAdapter,
  "en.allmanga": allmangaAdapter,
  "en.rule34": rule34Adapter,
  "en.xkcd": xkcdAdapter,
  "en.royalroad": royalroadAdapter,
  "all.hentaifox": hentaifoxAdapter,
  "en.onlythebesthentai": onlythebesthentaiAdapter,
  "en.mangafreak": mangafreakAdapter,
  "en.novelfull": novelfullAdapter,
  "en.novelhall": novelhallAdapter,
  "en.ninehentai": ninehentaiAdapter,
  "en.resetscans": resetscansAdapter,
  "all.pandachaika": pandachaikaAdapter,
  "en.pandachaika": pandachaikaAdapter,
  "en.animegg": animeggAdapter,
  "all.mihentai": mihentaiAdapter,
  "en.ravenscans": ravenscansAdapter,
  "en.elftoon": elftoonAdapter,
  "en.allanime": allmangaAdapter,
};
const tier1Adapters = new Map<string, { key: string; adapter: ClientSourceAdapter }>();
function getTier1Adapter(sourceId: string): ClientSourceAdapter | null {
  const extension = getImportedTier1Extension(sourceId);
  if (!extension) { tier1Adapters.delete(sourceId); return null; }
  const key = `${extension.manifestUrl}:${extension.importedAt}:${extension.manifest.sourceName}`;
  const cached = tier1Adapters.get(sourceId);
  if (cached?.key === key) return cached.adapter;
  const adapter = createTier1ClientAdapter(extension);
  tier1Adapters.set(sourceId, { key, adapter });
  return adapter;
}
export function getClientSourceAdapter(sourceId: string): ClientSourceAdapter | null {
  const adapter = clientAdapters[sourceId];
  if (adapter && sourceModes[sourceId] === "client") return adapter;
  return getTier1Adapter(sourceId);
}
export function getClientSourceMode(sourceId: string): ClientSourceMode { return getClientSourceAdapter(sourceId)?.mode ?? sourceModes[sourceId] ?? "server"; }
export const isClientWebtoons = (sourceId: string) => getClientSourceAdapter(sourceId)?.sourceId === "all.webtoons";
export const isClientSource = (sourceId: string) => getClientSourceMode(sourceId) === "client";
