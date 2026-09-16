import type {
  MangaSource, ListOptions, MangaListResponse, MangaDetail, DetailOptions,
  ChapterListResponse, PageListResponse, MangaSummary, ChapterSummary, SourceTag,
} from "./types";
import { absUrl, fetchJson, makeHttp } from "./scraper-utils";

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
type AtsuChapterResponse = { readChapter?: { id: string; title?: string; pages?: Array<{ image?: string; number?: number }> } };

const BASE_URL = "https://atsu.moe";
const http = makeHttp(BASE_URL, { Accept: "application/json" });
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const posterUrl = (value: AtsuPoster | undefined, fallback?: string) => {
  const raw = typeof value === "string" ? value : value?.image || fallback || "";
  return raw ? absUrl(BASE_URL, raw.startsWith("/static/") ? raw : `/static/${raw.replace(/^static\//, "")}`) : "";
};
const tagsFor = (manga: AtsuManga) => [
  ...(manga.genres || []).map(tag => ({ name: clean(tag.name), group: "Genre" })),
  ...(manga.tags || []).map(tag => ({ name: clean(tag.name), group: "Tag" })),
].filter(tag => tag.name);
const summary = (manga: AtsuManga): MangaSummary => ({
  id: manga.id,
  title: clean(manga.title || manga.englishTitle) || manga.id,
  thumbnail: posterUrl(manga.poster, manga.posterMedium || manga.posterSmall),
  type: (clean(manga.type || manga.medium) || "Manga").replace(/^Manwha$/i, "Manhwa"),
  isNsfw: !!manga.isAdult,
});

async function searchAtsu(query: string, page: number): Promise<MangaListResponse> {
  const params = new URLSearchParams({ q: query, query_by: "title,otherNames", page: String(page), per_page: "30" });
  const data = await fetchJson<AtsuSearchResponse>(http, `/api/search/manga?${params}`);
  const items = (data.hits || []).map(hit => hit.document).filter((m): m is AtsuManga => !!m).map(summary);
  return { items, page, hasNextPage: items.length === 30 };
}

export const AtsuSource: MangaSource = {
  id: "all.atsu",
  name: "Atsu",
  lang: "all",
  isNsfw: false,
  imageReferer: `${BASE_URL}/`,
  async popular(o: ListOptions) { return searchAtsu("", o.page); },
  async latest(o: ListOptions) { return searchAtsu("", o.page); },
  async search(query: string, o: ListOptions) { return searchAtsu(query, o.page); },
  async tags(): Promise<SourceTag[]> { return []; },
  async details(id: string, _o: DetailOptions): Promise<MangaDetail> {
    const data = await fetchJson<AtsuMangaPageResponse>(http, `/api/manga/page?id=${encodeURIComponent(id)}`);
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
      type: (clean(manga.type || manga.medium) || "Manga").replace(/^Manwha$/i, "Manhwa"),
      isNsfw: !!manga.isAdult,
      rating: Number(manga.avgRating || 0),
      thumbnail: posterUrl(manga.poster, manga.posterMedium || manga.posterSmall),
      genres: tags.map(tag => tag.name),
      sourceTags: tags.map(tag => ({ id: `${tag.group?.toLowerCase()}:${tag.name}`, name: tag.name, group: tag.group })),
      score: clean(manga.avgRating),
      scorePosition: "none",
    };
  },
  async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const page = await fetchJson<AtsuMangaPageResponse>(http, `/api/manga/page?id=${encodeURIComponent(mangaId)}`);
    const scanlatorNames = new Map((page.mangaPage?.scanlators || []).map(scanlator => [scanlator.id, scanlator.name]));
    const data = await fetchJson<AtsuChaptersResponse>(http, `/api/manga/allChapters?mangaId=${encodeURIComponent(mangaId)}`);
    const seen = new Set<string>();
    const items: ChapterSummary[] = [];
    for (const chapter of data.chapters || []) {
      if (!chapter.id || seen.has(chapter.id)) continue;
      seen.add(chapter.id);
      const scanlatorId = (chapter.scanlationMangaId || "").trim();
      items.push({
        id: `${mangaId}|${chapter.id}|${scanlatorId}`,
        number: Number(chapter.number ?? chapter.index ?? items.length + 1),
        title: clean(chapter.title) || `Chapter ${chapter.number ?? items.length + 1}`,
        scanlator: scanlatorNames.get(scanlatorId) || scanlatorId || "Atsu",
        date: Number(chapter.createdAt || 0),
        attachmentCount: chapter.pageCount,
        mediaType: "image",
      });
    }
    return { items };
  },
  async pages(chapterKey: string): Promise<PageListResponse> {
    const [mangaId, chapterId] = chapterKey.split("|");
    if (!mangaId || !chapterId) throw new Error("Invalid Atsu chapter identifier");
    const data = await fetchJson<AtsuChapterResponse>(http, `/api/read/chapter?mangaId=${encodeURIComponent(mangaId)}&chapterId=${encodeURIComponent(chapterId)}`);
    const chapter = data.readChapter;
    if (!chapter) throw new Error(`Atsu chapter ${chapterId} was not found`);
    return {
      chapterId: chapterKey,
      pages: (chapter.pages || []).map((page, index) => ({
        index: Number(page.number ?? index),
        url: absUrl(BASE_URL, page.image),
        title: clean(chapter.title) || "Chapter",
      })),
    };
  },
};
