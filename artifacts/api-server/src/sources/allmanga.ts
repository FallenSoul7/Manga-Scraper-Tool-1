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

  if (!response.ok) throw new Error(`AllManga API returned HTTP ${response.status}`);
  const payload = (await response.json()) as GraphQlResponse<T>;
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
  const date = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(date) ? 0 : date;
}

interface SearchEdge {
  _id: string;
  name: string;
  thumbnail?: string | null;
  englishName?: string | null;
}

interface SearchData {
  mangas: { edges: SearchEdge[] };
}

function toSummary(item: SearchEdge): MangaSummary {
  return {
    id: item._id,
    title: item.englishName || item.name || "Untitled",
    thumbnail: thumbnailUrl(item.thumbnail),
    type: "Manga",
    isNsfw: true,
  };
}

const SEARCH_QUERY = `
  query ($search: SearchInput, $size: Int, $page: Int,
         $translationType: VaildTranslationTypeMangaEnumType,
         $countryOrigin: VaildCountryOriginEnumType) {
    mangas(search: $search, limit: $size, page: $page,
           translationType: $translationType, countryOrigin: $countryOrigin) {
      edges { _id name thumbnail englishName }
    }
  }
`;

const POPULAR_QUERY = `
  query ($type: VaildPopularTypeEnumType!, $size: Int!, $page: Int,
         $dateRange: Int, $allowAdult: Boolean, $allowUnknown: Boolean) {
    queryPopular(type: $type, size: $size, dateRange: $dateRange, page: $page,
                 allowAdult: $allowAdult, allowUnknown: $allowUnknown) {
      recommendations { anyCard { _id name thumbnail englishName } }
    }
  }
`;

const DETAILS_QUERY = `
  query ($id: String!, $showId: String!) {
    manga(_id: $id) {
      _id name thumbnail description authors genres tags status altNames
      englishName relatedMangas availableChaptersDetail
    }
    episodeInfos(showId: $showId, episodeNumStart: 0, episodeNumEnd: 9999) {
      episodeIdNum notes uploadDates
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
  };
  episodeInfos: Array<{
    episodeIdNum: number | string;
    notes?: string | null;
    uploadDates?: { sub?: string | null } | null;
  }>;
}

const PAGE_QUERY = `
  query ($mangaId: String!, $chapterString: String!,
         $translationType: VaildTranslationTypeMangaEnumType!) {
    chapterPages(mangaId: $mangaId, chapterString: $chapterString,
                 translationType: $translationType) {
      edges { pictureUrlHead pictureUrls }
    }
  }
`;

interface PageData {
  chapterPages: {
    edges: Array<{
      pictureUrlHead?: string | null;
      pictureUrls?: Array<{ url?: string | null } | string> | null;
    }>;
  } | null;
}

const source: MangaSource = {
  id: "en.allanime",
  name: "AllManga",
  lang: "en",
  isNsfw: true,
  imageReferer: `${SITE_URL}/`,
  async popular(opts: ListOptions): Promise<MangaListResponse> {
    const data = await graphQl<{
      queryPopular: { recommendations: Array<{ anyCard: SearchEdge | null }> };
    }>(POPULAR_QUERY, {
      type: "manga",
      size: PAGE_SIZE,
      dateRange: 0,
      page: opts.page,
      allowAdult: true,
      allowUnknown: false,
    });
    const items = data.queryPopular.recommendations
      .map((entry) => entry.anyCard)
      .filter((entry): entry is SearchEdge => !!entry)
      .map(toSummary);
    return { items, page: opts.page, hasNextPage: items.length === PAGE_SIZE };
  },
  async latest(opts: ListOptions): Promise<MangaListResponse> {
    return this.search("", opts);
  },
  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    const data = await graphQl<SearchData>(SEARCH_QUERY, {
      search: {
        query: query.trim() || null,
        isManga: true,
        allowAdult: true,
        allowUnknown: false,
      },
      size: PAGE_SIZE,
      page: opts.page,
      translationType: "sub",
      countryOrigin: "ALL",
    });
    const items = data.mangas.edges.map(toSummary);
    return { items, page: opts.page, hasNextPage: items.length === PAGE_SIZE };
  },
  async tags(): Promise<SourceTag[]> {
    return [];
  },
  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const data = await graphQl<MangaData>(DETAILS_QUERY, {
      id: decodeURIComponent(id),
      showId: `manga@${decodeURIComponent(id)}`,
    });
    const manga = data.manga;
    const title = manga.englishName || manga.name || "Untitled";
    return {
      id,
      title,
      author: manga.authors?.join(", ") ?? "",
      artist: manga.authors?.join(", ") ?? "",
      synopsis: (manga.description ?? "").replace(/<br\s*\/?>/gi, "\n"),
      altTitles: manga.altNames ?? [],
      status: manga.status?.toLowerCase().includes("releas") ? "Ongoing" : manga.status ?? "Unknown",
      type: "Manga",
      isNsfw: true,
      rating: 0,
      thumbnail: thumbnailUrl(manga.thumbnail),
      genres: [...(manga.genres ?? []), ...(manga.tags ?? [])],
      score: "",
      scorePosition: "none",
    };
  },
  async chapters(mangaId: string): Promise<ChapterListResponse> {
    const id = decodeURIComponent(mangaId);
    const data = await graphQl<MangaData>(DETAILS_QUERY, {
      id,
      showId: `manga@${id}`,
    });
    const byNumber = new Map(data.episodeInfos.map((item) => [String(item.episodeIdNum), item]));
    const available = data.manga.availableChaptersDetail?.sub ?? [];
    const items: ChapterSummary[] = available.map((number, index) => {
      const detail = byNumber.get(String(number));
      return {
        id: `${id}:${number}`,
        number: Number(number) || index + 1,
        title: detail?.notes ? `Chapter ${number}: ${detail.notes}` : `Chapter ${number}`,
        scanlator: "AllManga",
        date: parseDate(detail?.uploadDates?.sub),
      };
    });
    return { items };
  },
  async pages(chapterId: string): Promise<PageListResponse> {
    const [mangaId, chapterString] = decodeURIComponent(chapterId).split(":");
    if (!mangaId || !chapterString) throw new Error("Invalid AllManga chapter ID");
    const data = await graphQl<PageData>(PAGE_QUERY, {
      mangaId,
      chapterString,
      translationType: "sub",
    });
    if (!data.chapterPages) {
      throw new Error("AllManga requires a browser verification token before chapter pages can be loaded");
    }
    const edge = data.chapterPages.edges.find((item) => item.pictureUrls?.length) ?? data.chapterPages.edges[0];
    if (!edge) return { chapterId, pages: [] };
    const head = edge.pictureUrlHead
      ? (/^https?:\/\//i.test(edge.pictureUrlHead) ? edge.pictureUrlHead : `https://${edge.pictureUrlHead.replace(/^\/+/, "")}/`)
      : "https://ytimgf.youtube-anime.com/";
    const pages = (edge.pictureUrls ?? []).flatMap((item, index) => {
      const value = typeof item === "string" ? item : item.url;
      if (!value) return [];
      return [{ index, url: /^https?:\/\//i.test(value) ? value : `${head}${value.replace(/^\/+/, "")}` }];
    });
    return { chapterId, pages };
  },
};

export const AllMangaSource = source;