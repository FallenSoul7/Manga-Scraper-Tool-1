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

const API_URL = "https://api.allanime.day/api";
const SITE_URL = "https://allmanga.to";
const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";
const VIDEO_HOSTS = [
  "https://aln.youtube-anime.com",
  "https://agendao.youtube-anime.com",
  "https://aimgf.youtube-anime.com",
];
const PAGE_SIZE = 20;

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
    episodeInfos(showId: $showId, episodeNumStart: 0, episodeNumEnd: 9999) {
      episodeIdNum notes uploadDates
    }
  }
`;

const SHOW_DETAILS_QUERY = `
  query ($id: String!) {
    show(_id: $id) {
      _id name thumbnail description genres tags status altNames englishName
    }
    episodeInfos(showId: $id, episodeNumStart: 0, episodeNumEnd: 9999) {
      episodeIdNum notes uploadDates
      vidInforssub vidInforsdub vidInforsraw thumbnails
    }
  }
`;

const PAGE_QUERY = `
  query ($mangaId: String!, $chapterString: String!,
         $translationType: VaildTranslationTypeMangaEnumType!) {
    chapterPages(mangaId: $mangaId, chapterString: $chapterString,
                 translationType: $translationType) {
      edges { pictureUrlHead pictureUrls }
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
    availableChaptersDetail?: { sub?: string[] | null } | null;
  } | null;
  episodeInfos: Array<{
    episodeIdNum: number | string;
    notes?: string | null;
    uploadDates?: { sub?: string | null } | null;
  }>;
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

async function listKind(query: string, opts: ListOptions, kind: "manga" | "anime"): Promise<{ items: MangaSummary[]; hasNextPage: boolean }> {
  const variables = {
    search: { query: query.trim() || null, allowAdult: true, allowUnknown: false },
    size: PAGE_SIZE,
    page: opts.page,
    translationType: "sub",
    countryOrigin: "ALL",
  };
  if (kind === "manga") {
    const data = await graphQl<MangaSearchData>(MANGA_SEARCH_QUERY, variables);
    const items = data.mangas.edges.map(item => toSummary(item, kind));
    return { items, hasNextPage: items.length === PAGE_SIZE };
  }
  const data = await graphQl<ShowSearchData>(SHOW_SEARCH_QUERY, variables);
  const items = data.shows.edges.map(item => toSummary(item, kind));
  return { items, hasNextPage: items.length === PAGE_SIZE };
}

async function listCombined(query: string, opts: ListOptions): Promise<MangaListResponse> {
  const [manga, anime] = await Promise.all([
    listKind(query, opts, "manga"),
    listKind(query, opts, "anime"),
  ]);
  const items = [...manga.items, ...anime.items];
  return { items, page: opts.page, hasNextPage: manga.hasNextPage || anime.hasNextPage };
}

function videoUrl(info: VideoInfo | null | undefined): string | null {
  const path = info?.vidPath?.trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = `/${path.replace(/^\/+/, "")}`;
  const direct = `${VIDEO_HOSTS[0]}${cleanPath}`;
  return `/api/allmanga/video?url=${encodeURIComponent(direct)}`;
}

function chapterDate(detail: { uploadDates?: { sub?: string; dub?: string } | null } | undefined): number {
  return parseDate(detail?.uploadDates?.sub ?? detail?.uploadDates?.dub);
}

const source: MangaSource = {
  id: "en.allanime",
  name: "AllManga",
  lang: "en",
  isNsfw: true,
  imageReferer: `${SITE_URL}/`,

  async popular(opts): Promise<MangaListResponse> {
    // AllAnime's popular enum has changed over time. Its stable search
    // connections are more reliable, so popular intentionally uses the
    // current catalog ordering while preserving the source's page contract.
    return this.search("", opts);
  },

  async latest(opts): Promise<MangaListResponse> {
    return this.search("", opts);
  },

  async search(query, opts): Promise<MangaListResponse> {
    const kind = mediaFilter(opts);
    const result = kind === "all"
      ? await listCombined(query, opts)
      : { ...(await listKind(query, opts, kind)), page: opts.page };
    return result;
  },

  async tags(): Promise<SourceTag[]> {
    return [];
  },

  async details(rawId, _opts): Promise<MangaDetail> {
    const { kind, id } = parseMediaId(rawId);
    if (kind === "anime") {
      const data = await graphQl<ShowData>(SHOW_DETAILS_QUERY, { id });
      return toDetail(rawId, data.show, kind);
    }
    const data = await graphQl<MangaData>(MANGA_DETAILS_QUERY, {
      id,
      showId: `manga@${id}`,
    });
    return toDetail(rawId, data.manga, kind);
  },

  async chapters(rawId): Promise<ChapterListResponse> {
    const { kind, id } = parseMediaId(rawId);
    if (kind === "anime") {
      const data = await graphQl<ShowData>(SHOW_DETAILS_QUERY, { id });
      if (!data.show) throw new Error("AllManga anime was not found");
      return {
        items: data.episodeInfos
          .filter(item => item.episodeIdNum !== null && item.episodeIdNum !== undefined)
          .map((item, index): ChapterSummary => ({
            id: `${encodedId("anime", id)}:${item.episodeIdNum}`,
            number: Number(item.episodeIdNum) || index + 1,
            title: item.notes ? `Episode ${item.episodeIdNum}: ${item.notes}` : `Episode ${item.episodeIdNum}`,
            scanlator: "AllManga",
            date: chapterDate(item),
          }))
          .sort((a, b) => b.number - a.number),
      };
    }

    const data = await graphQl<MangaData>(MANGA_DETAILS_QUERY, { id, showId: `manga@${id}` });
    if (!data.manga) throw new Error("AllManga manga was not found");
    const byNumber = new Map(data.episodeInfos.map(item => [String(item.episodeIdNum), item]));
    const available = data.manga.availableChaptersDetail?.sub ?? [];
    return {
      items: available.map((number, index) => {
        const detail = byNumber.get(String(number));
        return {
          id: `${encodedId("manga", id)}:${number}`,
          number: Number(number) || index + 1,
          title: detail?.notes ? `Chapter ${number}: ${detail.notes}` : `Chapter ${number}`,
          scanlator: "AllManga",
          date: parseDate(detail?.uploadDates?.sub),
        };
      }),
    };
  },

  async pages(rawChapterId): Promise<PageListResponse> {
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
      // Prefer English-subbed HD, then dub, then raw. The player can stream
      // the CDN path directly and supports range requests natively.
      const url = videoUrl(episode.vidInforssub) ?? videoUrl(episode.vidInforsdub) ?? videoUrl(episode.vidInforsraw);
      if (!url) throw new Error(`AllManga episode ${chapterString} has no playable video`);
      return { chapterId: rawChapterId, pages: [{ index: 0, url }] };
    }

    const data = await graphQl<PageData>(PAGE_QUERY, {
      mangaId: id,
      chapterString,
      translationType: "sub",
    });
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