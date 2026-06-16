import type {
  MangaSource,
  ListOptions,
  MangaListResponse,
  MangaDetail,
  MangaDetailSourceTag,
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
  type: number;
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

interface TagItem { id: number; type: number }

function buildSearchBody(opts: {
  text?: string;
  page: number;
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

// ────────── Core fetch — no artificial cap ──────────────────────────────────
// Each API call returns 20 results. `page` is 1-indexed externally,
// converted to 0-indexed internally. Pass page=1 for normal single-page use.
// To get ALL results up to 2000, the caller fetches pages 1..100 in batches.

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
    totalCount: data.total_count, // expose so callers know how many pages exist
  };
}

// ────────── Multi-page fetch — up to 2000 results in parallel batches ───────

const MAX_RESULTS = 2000;
const PAGE_SIZE   = 20;
const BATCH_SIZE  = 10; // concurrent requests per batch

async function fetchAllPages(
  sort: number,
  query?: string,
  tagIds?: string[],
): Promise<MangaSummary[]> {
  // Step 1: fetch page 1 to learn total_count
  const first = await fetchPage(sort, 1, query, tagIds);
  const all: MangaSummary[] = [...first.items];

  if (!first.hasNextPage) return all;

  const totalCount = (first as any).totalCount as number ?? MAX_RESULTS;
  const totalPages = Math.min(Math.ceil(totalCount / PAGE_SIZE), MAX_RESULTS / PAGE_SIZE);

  // Step 2: fetch remaining pages in parallel batches
  for (let batchStart = 2; batchStart <= totalPages; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPages);
    const pageNums = Array.from(
      { length: batchEnd - batchStart + 1 },
      (_, i) => batchStart + i
    );

    const results = await Promise.allSettled(
      pageNums.map(p => fetchPage(sort, p, query, tagIds))
    );

    let gotAny = false;
    for (const res of results) {
      if (res.status === "fulfilled" && res.value.items.length) {
        all.push(...res.value.items);
        gotAny = true;
      }
    }

    if (!gotAny) break;
    if (all.length >= MAX_RESULTS) break;
  }

  return all.slice(0, MAX_RESULTS);
}

// ────────── Tag fetcher ──────────────────────────────────────────────────────

let tagCache: SourceTag[] | null = null;

interface NineTagResult extends NineTag {
  books_count?: number;
}

interface TagListResponseBody {
  status: boolean;
  results: NineTagResult[];
  total_count?: number;
}

const TAG_TYPE_MAP: Array<{ type: number; group: string; maxPages: number }> = [
  { type: 6, group: "Category",  maxPages: 2  },
  { type: 1, group: "Tag",       maxPages: 10 },
  { type: 3, group: "Parody",    maxPages: 5  },
  { type: 5, group: "Character", maxPages: 5  },
  { type: 4, group: "Artist",    maxPages: 5  },
  { type: 2, group: "Group",     maxPages: 5  },
];

async function fetchTags(): Promise<SourceTag[]> {
  const all: SourceTag[] = [];

  const fetchPromises = TAG_TYPE_MAP.map(async ({ type, group, maxPages }) => {
    for (let page = 0; page < maxPages; page++) {
      try {
        const data = await apiPost<TagListResponseBody>("/api/getTags", {
          search: { text: "", page, letter: "", sort: 0, uses: 1 },
          type,
        });
        if (!data.status || !Array.isArray(data.results) || data.results.length === 0) break;
        for (const t of data.results) {
          all.push({ id: `${type}:${t.id}`, name: t.name, group, count: t.books_count });
        }
        if (data.results.length < 30) break;
      } catch {
        break;
      }
    }
  });

  await Promise.all(fetchPromises);
  all.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  return all;
}

// ────────── Sort map ─────────────────────────────────────────────────────────

const NINE_SORTS: Record<string, number> = { "0": 0, "1": 1, "2": 2, "3": 3 };

function resolveSort(o: ListOptions, fallback: number): number {
  return o.sort !== undefined && NINE_SORTS[o.sort] !== undefined
    ? NINE_SORTS[o.sort]
    : fallback;
}

// ────────── Source export ────────────────────────────────────────────────────

export const NineHentaiSource: MangaSource = {
  id: "en.ninehentai",
  name: "9Hentai",
  lang: "en",
  isNsfw: true,
  imageReferer: `${BASE_URL}/`,

  popularSorts: [
    { value: "0", label: "Newest"      },
    { value: "1", label: "Popular"     },
    { value: "2", label: "Most Fapped" },
    { value: "3", label: "Most Viewed" },
  ],

  // Single-page calls — used by the browse UI (infinite scroll handles pagination)
  async popular(o: ListOptions) {
    return fetchPage(resolveSort(o, 1), o.page, undefined, o.tagIds);
  },

  async latest(o: ListOptions) {
    return fetchPage(resolveSort(o, 0), o.page, undefined, o.tagIds);
  },

  async search(query: string, o: ListOptions) {
    return fetchPage(0, o.page, query || undefined, o.tagIds);
  },

  // Bulk calls — used by Comi AI to return up to 2000 results at once
  async popularAll(o: ListOptions) {
    const items = await fetchAllPages(resolveSort(o, 1), undefined, o.tagIds);
    return { items, page: 1, hasNextPage: false };
  },

  async latestAll(o: ListOptions) {
    const items = await fetchAllPages(resolveSort(o, 0), undefined, o.tagIds);
    return { items, page: 1, hasNextPage: false };
  },

  async searchAll(query: string, o: ListOptions) {
    const items = await fetchAllPages(0, query || undefined, o.tagIds);
    return { items, page: 1, hasNextPage: false };
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

    let enrichedBook: NineBook | null = null;

    try {
      await Promise.race([
        (async () => {
          const cleanTitle = book.title
            .replace(/[^a-zA-Z0-9\s]/g, "")
            .trim()
            .split(" ")
            .slice(0, 4)
            .join(" ");
          if (!cleanTitle) return;
          const searchData = await apiPost<SearchResponseBody>(
            "/api/getBook",
            buildSearchBody({ text: cleanTitle, page: 0, sort: 0 })
          );
          if (searchData.status && searchData.results?.length > 0) {
            enrichedBook = searchData.results.find(b => b.id === book.id) ?? null;
          }
        })(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("tag enrichment timeout")), 4000)
        ),
      ]);
    } catch {
      // fall through to basic book data
    }

    const effective = enrichedBook ?? book;

    const artists    = tagsOf(effective, 4);
    const groups     = tagsOf(effective, 2);
    const tags       = tagsOf(effective, 1);
    const parodies   = tagsOf(effective, 3);
    const characters = tagsOf(effective, 5);
    const categories = tagsOf(effective, 6);
    const allGenres  = [...tags, ...parodies, ...characters, ...categories];

    const GROUP_NAMES: Record<number, string> = {
      1: "Tag", 3: "Parody", 5: "Character", 6: "Category",
    };
    const sourceTags: MangaDetailSourceTag[] = (effective.tags || [])
      .filter(t => GROUP_NAMES[t.type])
      .map(t => ({ id: `${t.type}:${t.id}`, name: t.name, group: GROUP_NAMES[t.type] }));

    return {
      id,
      title:         book.title || `Gallery ${id}`,
      thumbnail:     thumbUrl(book),
      author:        artists.join(", "),
      artist:        groups.join(", "),
      synopsis:      allGenres.slice(0, 12).join(", "),
      altTitles:     book.alt_title ? [book.alt_title] : [],
      status:        "Completed",
      type:          "Doujinshi",
      isNsfw:        true,
      rating:        0,
      genres:        allGenres,
      score:         book.total_favorite ? String(book.total_favorite) : "",
      scorePosition: book.total_favorite ? "bottom" : "none",
      sourceTags,
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
    const base  = `${book.image_server}${book.id}`;
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
