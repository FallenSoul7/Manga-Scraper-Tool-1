import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE_URL = "https://9hentai.so";
const SOURCE_ID = "en.ninehentai";

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
  total_count?: number;
  results: NineBook[];
}

interface DetailResponseBody {
  status: boolean;
  results: NineBook;
}

interface TagItem {
  id: number;
  type: number;
}

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

function thumbUrl(book: NineBook): string {
  return `${book.image_server}${book.id}/1.jpg`;
}

function toSummary(book: NineBook) {
  return {
    id: String(book.id),
    title: book.title || `Gallery ${book.id}`,
    thumbnail: thumbUrl(book),
    type: "Doujinshi",
    isNsfw: true,
  };
}

function tagsOf(book: NineBook, type: number): string[] {
  return (book.tags || []).filter(tag => tag.type === type).map(tag => tag.name);
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await clientFetch(new URL(path, BASE_URL).toString(), {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`9hentai.so returned HTTP ${response.status}`);
  return await response.json() as T;
}

async function fetchPage(sort: number, page: number, query?: string): Promise<ClientListResponse> {
  const data = await apiPost<SearchResponseBody>("/api/getBook", buildSearchBody({
    text: query,
    page: page - 1,
    sort,
  }));
  if (!data.status) throw new Error("9hentai.so returned status:false");

  const items = (data.results || []).map(toSummary);
  const totalCount = typeof data.total_count === "number" && data.total_count > 0
    ? data.total_count
    : 0;
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / 20) : 0;
  const hasNextPage = totalPages > 0 ? page < totalPages : items.length === 20;
  return { items, page, hasNextPage };
}

async function getBook(id: string): Promise<NineBook> {
  const data = await apiPost<DetailResponseBody>("/api/getBookByID", { id: Number(id) });
  if (!data.status) throw new Error(`9hentai.so: book ${id} not found`);
  return data.results;
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page): Promise<ClientListResponse> {
    return fetchPage(1, page);
  },

  latest(page): Promise<ClientListResponse> {
    return fetchPage(0, page);
  },

  search(query, page): Promise<ClientListResponse> {
    return fetchPage(0, page, query || undefined);
  },

  async details(id, options): Promise<ClientMangaDetail> {
    const book = await getBook(id);
    let effective = book;

    const cleanTitle = book.title
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim()
      .split(" ")
      .slice(0, 4)
      .join(" ");
    if (cleanTitle) {
      try {
        const enriched = await apiPost<SearchResponseBody>("/api/getBook", buildSearchBody({
          text: cleanTitle,
          page: 0,
          sort: 0,
        }));
        if (enriched.status && enriched.results?.length) {
          effective = enriched.results.find(candidate => candidate.id === book.id) ?? book;
        }
      } catch {
        // Fall back to the detail response when enrichment is unavailable.
      }
    }

    const artists = tagsOf(effective, 4);
    const groups = tagsOf(effective, 2);
    const tags = tagsOf(effective, 1);
    const parodies = tagsOf(effective, 3);
    const characters = tagsOf(effective, 5);
    const categories = tagsOf(effective, 6);
    const genres = [...tags, ...parodies, ...characters, ...categories];
    const groupNames: Record<number, string> = {
      1: "Tag",
      3: "Parody",
      5: "Character",
      6: "Category",
    };
    const sourceTags = (effective.tags || [])
      .filter(tag => groupNames[tag.type])
      .map(tag => ({ id: `${tag.type}:${tag.id}`, name: tag.name, group: groupNames[tag.type] }));

    return {
      id,
      title: book.title || `Gallery ${id}`,
      thumbnail: thumbUrl(book),
      author: artists.join(", "),
      artist: groups.join(", "),
      synopsis: genres.slice(0, 12).join(", "),
      altTitles: book.alt_title ? [book.alt_title] : [],
      status: "Completed",
      type: "Doujinshi",
      isNsfw: true,
      rating: 0,
      genres,
      score: book.total_favorite ? String(book.total_favorite) : "",
      scorePosition: book.total_favorite ? "bottom" : (options?.scorePosition ?? "none"),
      sourceTags,
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const book = await getBook(id);
    return {
      items: [{
        id: Number(id),
        number: 1,
        title: book.title || `Gallery ${id}`,
        scanlator: "9Hentai",
        date: Math.floor(Date.now() / 1000),
      }],
    };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const book = await getBook(String(chapterId));
    const base = `${book.image_server}${book.id}`;
    const total = book.total_page || 0;
    return {
      chapterId,
      pages: Array.from({ length: total }, (_, index) => ({
        index,
        url: `${base}/${index + 1}.jpg`,
      })),
    };
  },
};

export default adapter;
