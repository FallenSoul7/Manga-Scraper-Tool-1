import type {
  MangaSource,
  ListOptions,
  MangaListResponse,
  MangaDetail,
  DetailOptions,
  ChapterListResponse,
  PageListResponse,
  MangaSummary,
  SourceTag,
} from "./types";
import { makeHttp } from "./scraper-utils";

const BASE_URL = "https://9hentai.so";

const http = makeHttp(BASE_URL, {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
});

// Simple in-memory cookie jar — refreshed once per hour.
interface CookieJar {
  cookieHeader: string;
  xsrfToken: string;
  expiresAt: number;
}
let cookieJar: CookieJar | null = null;

async function ensureCookies(): Promise<CookieJar> {
  if (cookieJar && Date.now() < cookieJar.expiresAt) return cookieJar;

  const res = await http.get("/", { responseType: "text" });
  const setCookies: string[] = Array.isArray(res.headers["set-cookie"])
    ? res.headers["set-cookie"]
    : [];

  const cookieMap: Record<string, string> = {};
  for (const raw of setCookies) {
    const part = raw.split(";")[0];
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) continue;
    const name = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1);
    cookieMap[name] = value;
  }

  const xsrfEncoded = cookieMap["XSRF-TOKEN"] || "";
  const xsrfToken = decodeURIComponent(xsrfEncoded);
  const cookieHeader = Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  cookieJar = { cookieHeader, xsrfToken, expiresAt: Date.now() + 55 * 60 * 1000 };
  return cookieJar;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const jar = await ensureCookies();
  const res = await http.post<T>(path, body, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN": jar.xsrfToken,
      Cookie: jar.cookieHeader,
      Referer: `${BASE_URL}/`,
    },
    responseType: "json",
  });
  if (res.status >= 400) {
    // Cookie might have expired — clear and retry once
    cookieJar = null;
    const jar2 = await ensureCookies();
    const res2 = await http.post<T>(path, body, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-XSRF-TOKEN": jar2.xsrfToken,
        Cookie: jar2.cookieHeader,
        Referer: `${BASE_URL}/`,
      },
      responseType: "json",
    });
    if (res2.status >= 400) throw new Error(`9hentai.so returned HTTP ${res2.status}`);
    return res2.data as T;
  }
  return res.data as T;
}

// ────────── Response shapes ──────────

interface NineTag {
  id: number;
  name: string;
  type: number; // 1=tag, 2=group, 3=parody, 4=artist, 5=character, 6=category
}

interface NineBook {
  id: number;
  title: string;
  alt_title?: string;
  total_page: number;
  image_server: string;
  tags?: NineTag[];
  upload_date?: string;
  total_favorite?: number;
}

interface SearchResponseBody {
  status: boolean;
  total_count: number;
  results: NineBook[];
}

interface DetailResponseBody {
  status: boolean;
  results: NineBook;
}

// ────────── Helpers ──────────

interface TagItem { id: number; type: number }

function buildSearchBody(opts: {
  text?: string;
  page: number; // 0-indexed
  sort: number;
  included?: TagItem[];
  excluded?: TagItem[];
}) {
  return {
    search: {
      text: opts.text ?? "",
      page: opts.page,
      sort: opts.sort,
      pages: { range: [0, 2000] },
      tag: {
        items: {
          included: opts.included ?? [],
          excluded: opts.excluded ?? [],
        },
      },
    },
  };
}

/**
 * Tag IDs are encoded as "TYPE:ID" (e.g. "1:42" = tag 42, "6:15" = category 15).
 * Excluded tags are prefixed with "-" (e.g. "-1:42").
 */
function parseTagIds(tagIds?: string[]): { included: TagItem[]; excluded: TagItem[] } {
  const included: TagItem[] = [];
  const excluded: TagItem[] = [];
  for (let raw of tagIds ?? []) {
    const isExcluded = raw.startsWith("-");
    if (isExcluded) raw = raw.slice(1);
    const [typePart, idPart] = raw.split(":");
    const type = Number(typePart);
    const id = Number(idPart);
    if (isNaN(type) || isNaN(id)) continue;
    (isExcluded ? excluded : included).push({ id, type });
  }
  return { included, excluded };
}

function thumbUrl(book: NineBook): string {
  return `${book.image_server}${book.id}/1.jpg`;
}

function toSummary(book: NineBook): MangaSummary {
  return {
    id: String(book.id),
    title: book.title || `Gallery ${book.id}`,
    thumbnail: thumbUrl(book),
    type: "Doujinshi",
    isNsfw: true,
  };
}

function tagsOf(book: NineBook, type: number): string[] {
  return (book.tags || []).filter(t => t.type === type).map(t => t.name);
}

async function fetchPage(
  sort: number,
  page: number,
  query?: string,
  tagIds?: string[],
): Promise<MangaListResponse> {
  const { included, excluded } = parseTagIds(tagIds);
  const body = buildSearchBody({ text: query, page: page - 1, sort, included, excluded });
  const data = await apiPost<SearchResponseBody>("/api/getBook", body);
  if (!data.status) throw new Error("9hentai.so returned status:false");
  const totalPages = Math.ceil(data.total_count / 20);
  return {
    items: (data.results || []).map(toSummary),
    page,
    hasNextPage: page < totalPages,
  };
}

let tagCache: SourceTag[] | null = null;

interface NineTagResult extends NineTag {
  books_count?: number;
}

interface TagListResponseBody {
  status: boolean;
  results: NineTagResult[];
  total_count?: number;
}

const TAG_TYPE_MAP: Array<{ type: number; group: string; pages: number }> = [
  { type: 6, group: "Category", pages: 1 },  // ~7 categories, 1 page is enough
  { type: 1, group: "Tag", pages: 2 },        // thousands of tags, take 2 pages sorted
];

async function fetchTags(): Promise<SourceTag[]> {
  const all: SourceTag[] = [];
  for (const { type, group, pages } of TAG_TYPE_MAP) {
    try {
      for (let page = 0; page < pages; page++) {
        const data = await apiPost<TagListResponseBody>("/api/getTags", {
          search: { text: "", page, letter: "", sort: 0, uses: 1 },
          type,
        });
        if (!data.status || !Array.isArray(data.results)) break;
        for (const t of data.results) {
          // Encode type into the ID so parseTagIds can reconstruct {id, type}
          all.push({ id: `${type}:${t.id}`, name: t.name, group, count: t.books_count });
        }
        if (data.results.length < 50) break; // last page
      }
    } catch {
      // skip on error
    }
  }
  // Sort tags by book count descending so most popular appear first
  all.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  return all;
}

// ────────── Source ──────────

// Sort values: 0=Newest, 1=Popular, 2=Most Fapped, 3=Most Viewed
const NINE_SORTS: Record<string, number> = { "0": 0, "1": 1, "2": 2, "3": 3 };

export const NineHentaiSource: MangaSource = {
  id: "en.ninehentai",
  name: "9Hentai",
  lang: "en",
  isNsfw: true,
  imageReferer: `${BASE_URL}/`,

  popularSorts: [
    { value: "0", label: "Newest" },
    { value: "1", label: "Popular" },
    { value: "2", label: "Most Fapped" },
    { value: "3", label: "Most Viewed" },
  ],

  async popular(o: ListOptions) {
    const sortNum = o.sort !== undefined && NINE_SORTS[o.sort] !== undefined
      ? NINE_SORTS[o.sort]
      : 1;
    return fetchPage(sortNum, o.page, undefined, o.tagIds);
  },

  async latest(o: ListOptions) {
    const sortNum = o.sort !== undefined && NINE_SORTS[o.sort] !== undefined
      ? NINE_SORTS[o.sort]
      : 0;
    return fetchPage(sortNum, o.page, undefined, o.tagIds);
  },

  async search(query: string, o: ListOptions) {
    return fetchPage(0, o.page, query || undefined, o.tagIds);
  },

  async tags(): Promise<SourceTag[]> {
    if (tagCache) return tagCache;
    tagCache = await fetchTags();
    return tagCache;
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const data = await apiPost<DetailResponseBody>("/api/getBookByID", { id: Number(id) });
    if (!data.status) throw new Error(`9hentai.so: book ${id} not found`);
    const book = data.results;

    const artists = tagsOf(book, 4);
    const groups = tagsOf(book, 2);
    const tags = tagsOf(book, 1);
    const parodies = tagsOf(book, 3);
    const characters = tagsOf(book, 5);
    const categories = tagsOf(book, 6);

    const allGenres = [...tags, ...parodies, ...characters, ...categories];

    return {
      id,
      title: book.title || `Gallery ${id}`,
      thumbnail: thumbUrl(book),
      author: artists.join(", "),
      artist: groups.join(", "),
      synopsis: allGenres.slice(0, 12).join(", "),
      altTitles: book.alt_title ? [book.alt_title] : [],
      status: "Completed",
      type: "Doujinshi",
      isNsfw: true,
      rating: 0,
      genres: allGenres,
      score: book.total_favorite ? String(book.total_favorite) : "",
      scorePosition: book.total_favorite ? "left" : "none",
    };
  },

  async chapters(mangaId: string): Promise<ChapterListResponse> {
    const data = await apiPost<DetailResponseBody>("/api/getBookByID", { id: Number(mangaId) });
    if (!data.status) throw new Error(`9hentai.so: book ${mangaId} not found`);
    const book = data.results;
    return {
      items: [
        {
          id: Number(mangaId),
          number: 1,
          title: book.title || `Gallery ${mangaId}`,
          scanlator: "9Hentai",
          date: Math.floor(Date.now() / 1000),
        },
      ],
    };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const data = await apiPost<DetailResponseBody>("/api/getBookByID", { id: Number(chapterId) });
    if (!data.status) throw new Error(`9hentai.so: book ${chapterId} not found`);
    const book = data.results;
    const base = `${book.image_server}${book.id}`;
    const total = book.total_page || 0;
    return {
      chapterId,
      pages: Array.from({ length: total }, (_, i) => ({
        index: i,
        url: `${base}/${i + 1}.jpg`,
      })),
    };
  },
};
