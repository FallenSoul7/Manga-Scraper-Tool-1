import type {
  ChapterListResponse,
  ChapterSummary,
  DetailOptions,
  ListOptions,
  MangaDetail,
  MangaListResponse,
  MangaSource,
  MangaSummary,
  PageListResponse,
  SourceTag,
} from "./types";
import { buildAaReq, getQueryHash, decodeTobeparsed, resetKeygenCache } from "../lib/allanime-crypto.js";

const API_URL = "https://api.allanime.day/api";
const NEW_API_URL = "https://api.mkissa.net/api";
const SITE_URL = "https://mkissa.to";
const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";
const VIDEO_HOSTS = [
  "https://aln.youtube-anime.com",
  "https://agendao.youtube-anime.com",
  "https://aimgf.youtube-anime.com",
];
const PAGE_SIZE = 20;

// Persisted query hashes for the new API (from keygen, with hardcoded fallback).
const CHAPTER_PAGES_LANE = "k9";
const EPISODE_LANE = "k7";

type GraphQlResponse<T> = { data?: T; errors?: Array<{ message?: string }> };

async function graphQl<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "ComixHub / AllManga source",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json().catch(() => ({}))) as GraphQlResponse<T>;
  if (!response.ok) throw new Error(`AllManga API returned HTTP ${response.status}`);
  if (payload.errors?.length) {
    throw new Error(`AllManga API: ${payload.errors[0]?.message ?? "request failed"}`);
  }
  if (!payload.data) throw new Error("AllManga API returned no data");
  return payload.data;
}

/**
 * Send a persisted GraphQL query via GET with an aaReq crypto token.
 * This is required by the new api.mkissa.net endpoint for chapter pages
 * and episode source URLs. Without the token the API returns
 * AA_CRYPTO_MISSING and the response contains broken/placeholder data.
 */
async function graphQlWithToken<T>(
  queryName: "search" | "manga" | "chapter",
  lane: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const queryHash = await getQueryHash(queryName);
  const { token, buildId } = await buildAaReq(queryHash, lane);

  const params = new URLSearchParams();
  params.set("variables", JSON.stringify(variables));
  params.set("extensions", JSON.stringify({
    persistedQuery: { version: 1, sha256Hash: queryHash },
    aaReq: token,
    k: lane,
  }));

  const response = await fetch(`${NEW_API_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Referer: SITE_URL,
      Origin: SITE_URL,
      "x-build-id": buildId,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as GraphQlResponse<T> & { data?: { tobeparsed?: string } };

  if (payload.errors?.length) {
    const msg = payload.errors[0]?.message ?? "request failed";
    if (msg.includes("CRYPTO") || msg.includes("STALE") || msg.includes("PersistedQueryNotFound")) {
      resetKeygenCache();
      throw new Error(`AllManga API crypto error: ${msg}`);
    }
    throw new Error(`AllManga API: ${msg}`);
  }

  // Handle encrypted tobeparsed response
  if (payload.data?.tobeparsed) {
    const decoded = await decodeTobeparsed(payload.data.tobeparsed, lane);
    if (decoded) return decoded as T;
    resetKeygenCache();
    throw new Error("AllManga API: failed to decode tobeparsed response");
  }

  if (!payload.data) throw new Error("AllManga API returned no data");
  return payload.data as T;
}

function thumbnailUrl(value: string | null | undefined): string {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `${THUMBNAIL_CDN}${value}?w=250`;
}

function parseDate(value: unknown): number {
  if (typeof value === "number") return value > 10_000_000_000 ? value : value * 1000;
  const date = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(date) ? 0 : date;
}

function encodedId(kind: "manga" | "anime", id: string): string {
  return `${kind}:${id}`;
}

function parseMediaId(value: string, fallback: "manga" | "anime" = "manga"): { kind: "manga" | "anime"; id: string } {
  const decoded = decodeURIComponent(value);
  const match = decoded.match(/^(manga|anime):(.*)$/);
  return match
    ? { kind: match[1] as "manga" | "anime", id: match[2] }
    : { kind: fallback, id: decoded };
}

function mediaFilter(opts: ListOptions): "all" | "manga" | "anime" {
  return opts.media ?? "all";
}

interface MediaEdge {
  _id: string;
  name: string;
  thumbnail?: string | null;
  englishName?: string | null;
  type?: string | null;
  status?: string | null;
}

interface MangaSearchData { mangas: { edges: MediaEdge[] }; }
interface ShowSearchData { shows: { edges: MediaEdge[] }; }

function toSummary(item: MediaEdge, kind: "manga" | "anime"): MangaSummary {
  return {
    id: encodedId(kind, item._id),
    title: item.englishName || item.name || "Untitled",
    thumbnail: thumbnailUrl(item.thumbnail),
    type: kind === "anime" ? "Anime" : "Manga",
    mediaType: kind,
    isNsfw: true,
  };
}

const MANGA_SEARCH_QUERY = `
  query ($search: SearchInput, $size: Int, $page: Int,
         $translationType: VaildTranslationTypeMangaEnumType,
         $countryOrigin: VaildCountryOriginEnumType) {
    mangas(search: $search, limit: $size, page: $page,
           translationType: $translationType, countryOrigin: $countryOrigin) {
      edges { _id name thumbnail englishName type status }
    }
  }
`;

const SHOW_SEARCH_QUERY = `
  query ($search: SearchInput, $size: Int, $page: Int,
         $translationType: VaildTranslationTypeEnumType,
         $countryOrigin: VaildCountryOriginEnumType) {
    shows(search: $search, limit: $size, page: $page,
          translationType: $translationType, countryOrigin: $countryOrigin) {
      edges { _id name thumbnail englishName type status }
    }
  }
`;

const MANGA_DETAILS_QUERY = `
  query ($id: String!, $showId: String!) {
    manga(_id: $id) {
      _id name thumbnail description authors genres tags status altNames
      englishName availableChaptersDetail
    }
  }
`;

const SHOW_DETAILS_QUERY = `
  query ($id: String!) {
    show(_id: $id) {
      _id name thumbnail description genres tags status altNames
      englishName
    }
    episodeInfos {
      episodeIdNum notes uploadDates
      vidInforssub { vidPath vidResolution vidDuration }
      vidInforsdub { vidPath vidResolution vidDuration }
      vidInforsraw { vidPath vidResolution vidDuration }
      thumbnails
    }
  }
`;

const PAGE_QUERY = `
  query ($mangaId: String!, $chapterString: String!, $translationType: VaildTranslationTypeMangaEnumType!) {
    chapterPages(mangaId: $mangaId, chapterString: $chapterString, translationType: $translationType) {
      edges { pictureUrlHead pictureUrls { url } }
    }
  }
`;

interface MangaData {
  manga: {
    _id: string;
    name: string;
    thumbnail?: string | null;
    description?: string | null;
    authors?: string[] | null;
    genres?: string[] | null;
    tags?: string[] | null;
    status?: string | null;
    altNames?: string[] | null;
    englishName?: string | null;
    availableChaptersDetail?: { sub?: number[]; dub?: number[] } | null;
  } | null;
}

interface ShowData {
  show: {
    _id: string;
    name: string;
    thumbnail?: string | null;
    description?: string | null;
    genres?: string[] | null;
    tags?: string[] | null;
    status?: string | null;
    altNames?: string[] | null;
    englishName?: string | null;
  } | null;
  episodeInfos: Array<{
    episodeIdNum: number | string;
    notes?: string | null;
    uploadDates?: { sub?: string; dub?: string } | null;
    vidInforssub?: VideoInfo | null;
    vidInforsdub?: VideoInfo | null;
    vidInforsraw?: VideoInfo | null;
    thumbnails?: string[] | null;
  }>;
}

interface VideoInfo {
  vidPath?: string | null;
  vidResolution?: number | null;
  vidDuration?: number | null;
}

interface PageData {
  chapterPages: {
    edges: Array<{
      pictureUrlHead?: string | null;
      pictureUrls?: Array<{ url?: string | null } | string> | null;
    }>;
  } | null;
}

function cleanDescription(value: string | null | undefined): string {
  return (value ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
}

function toDetail(id: string, item: ShowData["show"] | MangaData["manga"], kind: "manga" | "anime"): MangaDetail {
  if (!item) throw new Error(`AllManga ${kind} was not found`);
  const title = item.englishName || item.name || "Untitled";
  return {
    id,
    title,
    author: kind === "manga" ? ((item as MangaData["manga"]).authors?.join(", ") ?? "") : "",
    artist: kind === "manga" ? ((item as MangaData["manga"]).authors?.join(", ") ?? "") : "",
    synopsis: cleanDescription(item.description),
    altTitles: item.altNames ?? [],
    status: item.status?.toLowerCase().includes("releas") ? "Ongoing" : item.status ?? "Unknown",
    type: kind === "anime" ? "Anime" : "Manga",
    mediaType: kind,
    isNsfw: true,
    rating: 0,
    thumbnail: thumbnailUrl(item.thumbnail),
    genres: [...(item.genres ?? []), ...(item.tags ?? [])],
    score: "",
    scorePosition: "none",
  };
}

function videoUrl(info?: VideoInfo | null): string | null {
  if (!info?.vidPath) return null;
  const path = info.vidPath;
  for (const host of VIDEO_HOSTS) {
    if (path.startsWith(host)) return path;
  }
  if (/^https?:\/\//i.test(path)) return path;
  return `https://aln.youtube-anime.com${path.startsWith("/") ? "" : "/"}${path}`;
}

function videoProxyUrl(url: string): string {
  return `/api/allmanga/video?url=${encodeURIComponent(url)}`;
}

async function listKind(query: string, opts: ListOptions, kind: "manga" | "anime"): Promise<{ items: MangaSummary[]; hasNextPage: boolean }> {
  const variables = {
    search: { query: query.trim() || null, allowAdult: true, allowUnknown: true, sortBy: opts.sort === "latest" ? "Latest" : "Name_ASC" },
    size: PAGE_SIZE,
    page: opts.page ?? 1,
    translationType: "sub",
    countryOrigin: "ALL",
  };
  const data = kind === "manga"
    ? await graphQl<MangaSearchData>(MANGA_SEARCH_QUERY, variables)
    : await graphQl<ShowSearchData>(SHOW_SEARCH_QUERY, variables);
  const edges = kind === "manga" ? (data as MangaSearchData).mangas?.edges : (data as ShowSearchData).shows?.edges;
  const items = (edges ?? []).map(item => toSummary(item, kind));
  return { items, hasNextPage: items.length === PAGE_SIZE };
}

async function listAll(query: string, opts: ListOptions): Promise<MangaListResponse> {
  const media = mediaFilter(opts);
  if (media === "manga" || media === "anime") {
    const { items, hasNextPage } = await listKind(query, opts, media);
    return { items, page: opts.page, hasNextPage };
  }

  const [manga, anime] = await Promise.all([
    listKind(query, opts, "manga").catch(() => ({ items: [], hasNextPage: false })),
    listKind(query, opts, "anime").catch(() => ({ items: [], hasNextPage: false })),
  ]);
  return {
    items: [...manga.items, ...anime.items],
    page: opts.page,
    hasNextPage: manga.hasNextPage || anime.hasNextPage,
  };
}

const source: MangaSource = {
  id: "en.allmanga",
  name: "AllManga",
  tags: [
    { id: "manga", name: "Manga", group: "Media" },
    { id: "anime", name: "Anime", group: "Media" },
    { id: "video", name: "Video", group: "Media" },
  ],
  isNsfw: true,

  async popular(opts: ListOptions): Promise<MangaListResponse> {
    return listAll("", opts);
  },

  async latest(opts: ListOptions): Promise<MangaListResponse> {
    return this.popular({ ...opts, sort: "latest" });
  },

  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    return listAll(query, { ...opts, page: 1 });
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const { kind, id: rawId } = parseMediaId(id);
    if (kind === "anime") {
      const data = await graphQl<ShowData>(SHOW_DETAILS_QUERY, { id: rawId });
      return toDetail(id, data.show, "anime");
    }
    const data = await graphQl<MangaData>(MANGA_DETAILS_QUERY, { id: rawId, showId: rawId });
    return toDetail(id, data.manga, "manga");
  },

  async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const { kind, id } = parseMediaId(mangaId);
    if (kind === "anime") {
      const data = await graphQl<ShowData>(SHOW_DETAILS_QUERY, { id });
      const episodes = data.episodeInfos ?? [];
      const items: ChapterSummary[] = episodes
        .filter(ep => ep.vidInforssub || ep.vidInforsdub || ep.vidInforsraw)
        .map(ep => ({
          id: `${mangaId}:${ep.episodeIdNum}`,
          number: Number(ep.episodeIdNum) || 0,
          title: ep.notes || `Episode ${ep.episodeIdNum}`,
          date: parseDate(ep.uploadDates?.sub),
          scanlator: "",
          isOfficial: true,
          votes: 0,
        }))
        .sort((a, b) => b.number - a.number);
      return { items };
    }
    const data = await graphQl<MangaData>(MANGA_DETAILS_QUERY, { id, showId: id });
    const chapters = data.manga?.availableChaptersDetail?.sub ?? [];
    const items: ChapterSummary[] = chapters
      .map(ch => ({
        id: `${mangaId}:${ch}`,
        number: ch,
        title: `Chapter ${ch}`,
         date: 0,
        scanlator: "",
        isOfficial: true,
        votes: 0,
      }))
      .sort((a, b) => b.number - a.number);
    return { items };
  },

  async pages(rawChapterId: string): Promise<PageListResponse> {
    const decoded = decodeURIComponent(rawChapterId);
    const separator = decoded.lastIndexOf(":");
    if (separator <= 0) throw new Error("Invalid AllManga chapter ID");
    const parent = decoded.slice(0, separator);
    const chapterString = decoded.slice(separator + 1);
    const { kind, id } = parseMediaId(parent);

    if (kind === "anime") {
      const data = await graphQl<ShowData>(SHOW_DETAILS_QUERY, { id });
      const episode = data.episodeInfos.find(item => String(item.episodeIdNum) === chapterString);
      if (!episode) throw new Error(`AllManga episode ${chapterString} was not found`);
      const url = videoUrl(episode.vidInforssub) ?? videoUrl(episode.vidInforsdub) ?? videoUrl(episode.vidInforsraw);
      if (!url) throw new Error(`AllManga episode ${chapterString} has no playable video`);
       // Keep the CDN URL behind the API proxy. Apart from preserving the
       // AllManga referer, this gives the browser a same-origin stream with
       // range support for seeking.
       return { chapterId: rawChapterId, pages: [{ index: 0, url: videoProxyUrl(url) }] };
    }

    // Chapter pages: use GET + aaReq crypto token (required by the new API).
    // The old POST approach without a token returns AA_CRYPTO_MISSING and
    // the response contains broken/placeholder image URLs (the "symbol images" bug).
    const variables = {
      mangaId: id,
      chapterString,
      translationType: "sub",
      limit: 10,
      offset: 0,
    };

    let data: PageData;
    try {
      data = await graphQlWithToken<PageData>("chapter", CHAPTER_PAGES_LANE, variables);
    } catch (tokenErr) {
      // Fallback: try the old POST approach (works if the old API is still up
      // and doesn't require the token for this particular query).
      try {
        data = await graphQl<PageData>(PAGE_QUERY, variables);
      } catch (postErr) {
        throw new Error(
          `AllManga chapter pages failed: token query error (${tokenErr instanceof Error ? tokenErr.message : tokenErr}), ` +
          `fallback query error (${postErr instanceof Error ? postErr.message : postErr})`,
        );
      }
    }

    if (!data.chapterPages) throw new Error("AllManga returned no page data for this chapter");
    const edge = data.chapterPages.edges.find(item => item.pictureUrls?.length) ?? data.chapterPages.edges[0];
    if (!edge) throw new Error("AllManga returned no pages for this chapter");
    const rawHead = edge.pictureUrlHead?.trim() || "https://ytimgf.youtube-anime.com/";
    const head = /^https?:\/\//i.test(rawHead)
      ? (rawHead.endsWith("/") ? rawHead : `${rawHead}/`)
      : `https://${rawHead.replace(/^\/+/, "").replace(/\/?$/, "/")}`;
    const pages = (edge.pictureUrls ?? []).flatMap((item, index) => {
      const value = (typeof item === "string" ? item : item.url)?.trim();
      if (!value) return [];
      return [{ index, url: /^https?:\/\//i.test(value) ? value : `${head}${value.replace(/^\/+/, "")}` }];
    });
    if (!pages.length) throw new Error("AllManga returned an empty page list for this chapter");
    return { chapterId: rawChapterId, pages };
  },
};

export const AllMangaSource = source;
