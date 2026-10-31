import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientMangaSummary,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

type AtsuScanlator = { id: string; name: string };
type AtsuPoster = string | { image?: string } | null;
type AtsuChapter = {
  id: string;
  title?: string;
  number?: number;
  index?: number;
  createdAt?: number;
  pageCount?: number;
  scanlationMangaId?: string;
};
type AtsuManga = {
  id: string;
  title?: string;
  englishTitle?: string;
  type?: string;
  medium?: string;
  isAdult?: boolean;
  synopsis?: string;
  status?: string;
  avgRating?: number;
  poster?: AtsuPoster;
  posterMedium?: string;
  posterSmall?: string;
  genres?: Array<{ name?: string }>;
  tags?: Array<{ name?: string }>;
  authors?: Array<{ name?: string }>;
  scanlators?: AtsuScanlator[];
};
type AtsuMangaPageResponse = { mangaPage?: AtsuManga & { chapters?: AtsuChapter[] } };
type AtsuSearchResponse = { hits?: Array<{ document?: AtsuManga }> };
type AtsuChaptersResponse = { chapters?: AtsuChapter[] };
type AtsuChapterResponse = {
  readChapter?: { id: string; title?: string; pages?: Array<{ image?: string; number?: number }> };
};
type AtsuNovelChapterResponse = {
  readNovelChapter?: { id: string; title?: string; paragraphs?: string[] };
};

const BASE_URL = "https://atsu.moe";
const CDN_URL = "https://cdn.atsu.moe";

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

function assetUrl(value: string): string {
  if (!value) return "";
  if (value.startsWith("/static/")) return `${CDN_URL}${value}`;
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return value;
  }
}

function posterUrl(value: AtsuPoster | undefined, fallback?: string): string {
  const raw = typeof value === "string" ? value : value?.image || fallback || "";
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.startsWith("static/") ? `/${raw}` : raw.startsWith("/") ? raw : `/static/${raw}`;
  return assetUrl(path);
}

function mediaType(manga: AtsuManga): string {
  return clean(manga.medium).toLowerCase() === "novel"
    ? "Novel"
    : (clean(manga.type || manga.medium) || "Manga").replace(/^Manwha$/i, "Manhwa");
}

function summary(manga: AtsuManga): ClientMangaSummary {
  return {
    id: manga.id,
    title: clean(manga.title || manga.englishTitle) || manga.id,
    thumbnail: posterUrl(manga.poster, manga.posterMedium || manga.posterSmall),
    type: mediaType(manga),
    isNsfw: !!manga.isAdult,
  };
}

async function fetchAtsuJson<T>(path: string): Promise<T> {
  const url = new URL(path, BASE_URL).toString();
  try {
    const response = await clientFetch(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } catch {
    throw new Error("Atsu is temporarily unavailable or blocking requests. Please check your connection and try again later.");
  }
}

async function searchAtsu(query: string, page: number): Promise<ClientListResponse> {
  const params = new URLSearchParams({
    q: query,
    query_by: "title,otherNames",
    page: String(page),
    per_page: "30",
  });
  const data = await fetchAtsuJson<AtsuSearchResponse>(`/api/search/manga?${params}`);
  const items = (data.hits || [])
    .map(hit => hit.document)
    .filter((manga): manga is AtsuManga => !!manga)
    .map(summary);
  return { items, page, hasNextPage: items.length === 30 };
}

function tagsFor(manga: AtsuManga): Array<{ name: string; group: string }> {
  return [
    ...(manga.genres || []).map(tag => ({ name: clean(tag.name), group: "Genre" })),
    ...(manga.tags || []).map(tag => ({ name: clean(tag.name), group: "Tag" })),
  ].filter(tag => tag.name);
}

async function atsuDetails(id: string): Promise<ClientMangaDetail> {
  const data = await fetchAtsuJson<AtsuMangaPageResponse>(`/api/manga/page?id=${encodeURIComponent(id)}`);
  const manga = data.mangaPage;
  if (!manga) throw new Error(`Atsu manga ${id} was not found`);
  const tags = tagsFor(manga);
  const authors = (manga.authors || []).map(author => clean(author.name)).filter(Boolean);
  return {
    id: manga.id,
    title: clean(manga.title || manga.englishTitle) || id,
    author: authors.join(", "),
    artist: "",
    synopsis: clean(manga.synopsis),
    altTitles: [],
    status: clean(manga.status) || "Unknown",
    type: mediaType(manga),
    isNsfw: !!manga.isAdult,
    rating: Number(manga.avgRating || 0),
    thumbnail: posterUrl(manga.poster, manga.posterMedium || manga.posterSmall),
    genres: tags.map(tag => tag.name),
    sourceTags: tags.map(tag => ({ id: `${tag.group.toLowerCase()}:${tag.name}`, name: tag.name, group: tag.group })),
    score: clean(manga.avgRating),
    scorePosition: "none",
  };
}

async function atsuChapters(mangaId: string): Promise<ClientChapterResponse> {
  const page = await fetchAtsuJson<AtsuMangaPageResponse>(`/api/manga/page?id=${encodeURIComponent(mangaId)}`);
  const scanlatorNames = new Map((page.mangaPage?.scanlators || []).map(scanlator => [scanlator.id, scanlator.name]));
  const data = await fetchAtsuJson<AtsuChaptersResponse>(`/api/manga/allChapters?mangaId=${encodeURIComponent(mangaId)}`);
  const seen = new Set<string>();
  const items: ClientChapterResponse["items"] = [];
  for (const chapter of data.chapters || []) {
    if (!chapter.id || seen.has(chapter.id)) continue;
    seen.add(chapter.id);
    const scanlatorId = (chapter.scanlationMangaId || "").trim();
    items.push({
      id: `${mangaId}|${chapter.id}|${scanlatorId}|${clean(page.mangaPage?.medium).toLowerCase() === "novel" ? "novel" : "comic"}`,
      number: Number(chapter.number ?? chapter.index ?? items.length + 1),
      title: clean(chapter.title) || `Chapter ${chapter.number ?? items.length + 1}`,
      scanlator: scanlatorNames.get(scanlatorId) || scanlatorId || "Atsu",
      date: Number(chapter.createdAt || 0),
      mediaType: "image",
    });
  }
  return { items };
}

async function atsuPages(chapterKey: string): Promise<ClientPageResponse> {
  const [mangaId, chapterId, _scanlatorId, medium] = chapterKey.split("|");
  if (!mangaId || !chapterId) throw new Error("Invalid Atsu chapter identifier");

  if (medium === "novel") {
    const params = new URLSearchParams({ mangaId, chapterId });
    const data = await fetchAtsuJson<AtsuNovelChapterResponse>(`/api/read/novelChapter?${params}`);
    const chapter = data.readNovelChapter;
    if (!chapter) throw new Error(`Atsu novel chapter ${chapterId} was not found`);
    const text = (chapter.paragraphs || []).map(clean).filter(Boolean).join("\n\n");
    if (!text) throw new Error(`Atsu novel chapter ${chapterId} has no text`);
    return {
      chapterId: chapterKey,
      pages: [{
        index: 0,
        url: "",
        title: clean(chapter.title) || "Chapter",
        text,
      }],
    };
  }

  const params = new URLSearchParams({ mangaId, chapterId });
  const data = await fetchAtsuJson<AtsuChapterResponse>(`/api/read/chapter?${params}`);
  const chapter = data.readChapter;
  if (!chapter) throw new Error(`Atsu chapter ${chapterId} was not found`);
  return {
    chapterId: chapterKey,
    pages: (chapter.pages || []).map((page, index) => ({
      index: Number(page.number ?? index),
      url: assetUrl(page.image || ""),
      title: clean(chapter.title) || "Chapter",
    })),
  };
}

export const atsuAdapter: ClientSourceAdapter = {
  sourceId: "all.atsu",
  mode: "client",
  popular: page => searchAtsu("", page),
  latest: page => searchAtsu("", page),
  search: (query, page) => searchAtsu(query, page),
  details: atsuDetails,
  chapters: atsuChapters,
  pages: atsuPages,
};
