import axios, { type AxiosInstance } from "axios";
import type {
  MangaSource,
  ListOptions,
  DetailOptions,
  MangaListResponse,
  MangaDetail,
  ChapterListResponse,
  PageListResponse,
  SourceTag,
} from "./types";

const API_URL = "https://api.mangadex.org";
const COVER_URL = "https://uploads.mangadex.org/covers";
const PER_PAGE = 32;

/** Custom param serialiser so arrays become `key[]=a&key[]=b` and nested
 *  objects become `key[sub]=val` — exactly what the MangaDex API expects. */
function serializeParams(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) sp.append(`${k}[]`, String(item));
    } else if (typeof v === "object") {
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (sv !== undefined && sv !== null) sp.append(`${k}[${sk}]`, String(sv));
      }
    } else {
      sp.append(k, String(v));
    }
  }
  return sp.toString();
}

const client: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 25000,
  headers: {
    "User-Agent": "Comix Lounge / 1.0 (web reader)",
    Accept: "application/json",
  },
  validateStatus: (s) => s >= 200 && s < 500,
  paramsSerializer: { serialize: serializeParams },
});

interface MdRel {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
}
interface MdManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles: Array<Record<string, string>>;
    description: Record<string, string>;
    contentRating: string;
    status: string;
    tags: Array<{ attributes: { name: Record<string, string>; group: string } }>;
    publicationDemographic?: string | null;
    originalLanguage: string;
  };
  relationships: MdRel[];
}
interface MdResp<T> {
  result: string;
  data: T;
  total?: number;
  limit?: number;
  offset?: number;
}
interface MdList<T> {
  result: string;
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

function pickTitle(m: MdManga): string {
  const t = m.attributes.title;
  return t.en ?? Object.values(t)[0] ?? "(Untitled)";
}
function pickDesc(m: MdManga): string {
  const d = m.attributes.description;
  return d.en ?? Object.values(d)[0] ?? "";
}
function coverUrl(m: MdManga): string {
  const cover = m.relationships.find((r) => r.type === "cover_art");
  const filename = cover?.attributes?.["fileName"] as string | undefined;
  if (!filename) return "";
  return `${COVER_URL}/${m.id}/${filename}.512.jpg`;
}
function pickAuthors(m: MdManga, type: "author" | "artist"): string {
  return m.relationships
    .filter((r) => r.type === type)
    .map((r) => (r.attributes?.["name"] as string | undefined) ?? "")
    .filter(Boolean)
    .join(", ");
}
function statusToString(s: string): string {
  switch (s) {
    case "ongoing": return "Ongoing";
    case "completed": return "Completed";
    case "hiatus": return "On Hiatus";
    case "cancelled": return "Cancelled";
    default: return "Unknown";
  }
}
function isNsfw(m: MdManga): boolean {
  return ["pornographic", "erotica"].includes(m.attributes.contentRating);
}
function getGenres(m: MdManga): string[] {
  const out: string[] = [];
  if (m.attributes.publicationDemographic) {
    out.push(
      m.attributes.publicationDemographic[0]!.toUpperCase() +
        m.attributes.publicationDemographic.slice(1),
    );
  }
  for (const t of m.attributes.tags) {
    const name = t.attributes.name?.["en"];
    if (name) out.push(name);
  }
  if (isNsfw(m)) out.push("NSFW");
  return Array.from(new Set(out));
}
function toSummary(m: MdManga) {
  return {
    id: m.id,
    title: pickTitle(m),
    thumbnail: coverUrl(m),
    type: "manga",
    isNsfw: isNsfw(m),
  };
}

function buildListParams(
  opts: ListOptions,
  order: Record<string, string>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    limit: PER_PAGE,
    offset: (opts.page - 1) * PER_PAGE,
    includes: ["cover_art", "author", "artist"],
    contentRating: opts.nsfw
      ? ["safe", "suggestive", "erotica", "pornographic"]
      : ["safe", "suggestive"],
    order,
  };

  // Tag filtering: IDs prefixed with "-" are excluded, the rest included.
  if (opts.tagIds && opts.tagIds.length > 0) {
    const included = opts.tagIds.filter((t) => !t.startsWith("-"));
    const excluded = opts.tagIds.filter((t) => t.startsWith("-")).map((t) => t.slice(1));
    if (included.length > 0) params.includedTags = included;
    if (excluded.length > 0) params.excludedTags = excluded;
  }

  return params;
}

// Cache tags so we don't hammer the endpoint.
let cachedMdTags: SourceTag[] | null = null;

export const MangaDexSource: MangaSource = {
  id: "all.mangadex",
  name: "MangaDex",
  lang: "all",
  isNsfw: false,
  imageReferer: "https://mangadex.org/",

  async popular(opts) {
    const res = await client.get<MdList<MdManga>>("/manga", {
      params: buildListParams(opts, { followedCount: "desc" }),
    });
    if (res.status >= 400) throw new Error(`MangaDex error ${res.status}`);
    return {
      items: res.data.data.map(toSummary),
      page: opts.page,
      hasNextPage: res.data.offset + res.data.limit < res.data.total,
    };
  },

  async latest(opts) {
    const res = await client.get<MdList<MdManga>>("/manga", {
      params: buildListParams(opts, { latestUploadedChapter: "desc" }),
    });
    if (res.status >= 400) throw new Error(`MangaDex error ${res.status}`);
    return {
      items: res.data.data.map(toSummary),
      page: opts.page,
      hasNextPage: res.data.offset + res.data.limit < res.data.total,
    };
  },

  async search(query, opts): Promise<MangaListResponse> {
    const res = await client.get<MdList<MdManga>>("/manga", {
      params: { ...buildListParams(opts, { relevance: "desc" }), title: query },
    });
    if (res.status >= 400) throw new Error(`MangaDex error ${res.status}`);
    return {
      items: res.data.data.map(toSummary),
      page: opts.page,
      hasNextPage: res.data.offset + res.data.limit < res.data.total,
    };
  },

  async tags(): Promise<SourceTag[]> {
    if (cachedMdTags) return cachedMdTags;
    try {
      const res = await client.get<{ data: Array<{ id: string; attributes: { name: Record<string, string>; group: string } }> }>("/manga/tag");
      if (res.status >= 400) return [];
      const tags: SourceTag[] = res.data.data
        .filter((t) => t.attributes?.name?.en)
        .map((t) => ({
          id: t.id,
          name: t.attributes.name.en!,
          group: t.attributes.group
            ? t.attributes.group[0]!.toUpperCase() + t.attributes.group.slice(1)
            : "Tag",
        }));
      cachedMdTags = tags;
      return tags;
    } catch {
      return [];
    }
  },

  async details(id, opts: DetailOptions): Promise<MangaDetail> {
    const res = await client.get<MdResp<MdManga>>(`/manga/${id}`, {
      params: { includes: ["cover_art", "author", "artist"] },
    });
    if (res.status >= 400 || !res.data?.data)
      throw new Error(`MangaDex error ${res.status}`);
    const m = res.data.data;
    const altTitles = m.attributes.altTitles
      .map((t) => Object.values(t)[0])
      .filter((v): v is string => typeof v === "string");
    let synopsis = pickDesc(m);
    if (opts.alt && altTitles.length > 0) {
      synopsis += "\n\nAlternative Names:\n" + altTitles.join("\n");
    }
    return {
      id: m.id,
      title: pickTitle(m),
      author: pickAuthors(m, "author"),
      artist: pickAuthors(m, "artist"),
      synopsis,
      altTitles,
      status: statusToString(m.attributes.status),
      type: "manga",
      isNsfw: isNsfw(m),
      rating: 0,
      thumbnail: coverUrl(m),
      genres: getGenres(m),
      score: "",
      scorePosition: opts.score,
    };
  },

  async chapters(mangaId): Promise<ChapterListResponse> {
    interface MdChapter {
      id: string;
      attributes: {
        chapter: string | null;
        title: string | null;
        translatedLanguage: string;
        publishAt: string;
        readableAt: string;
      };
      relationships: MdRel[];
    }
    const all: MdChapter[] = [];
    let offset = 0;
    const limit = 100;
    let total = 0;
    do {
      const res = await client.get<MdList<MdChapter>>(
        `/manga/${mangaId}/feed`,
        {
          params: {
            limit,
            offset,
            translatedLanguage: ["en"],
            order: { chapter: "desc", volume: "desc" },
            includes: ["scanlation_group"],
            contentRating: ["safe", "suggestive", "erotica", "pornographic"],
          },
        },
      );
      if (res.status >= 400) throw new Error(`MangaDex error ${res.status}`);
      total = res.data.total;
      all.push(...res.data.data);
      offset += limit;
    } while (offset < total && offset < 1000);

    return {
      items: all.map((c) => {
        const num = parseFloat(c.attributes.chapter ?? "0") || 0;
        const numStr = (c.attributes.chapter ?? "0").replace(/\.0$/, "");
        let title = `Chapter ${numStr}`;
        if (c.attributes.title) title += `: ${c.attributes.title}`;
        const scan = c.relationships.find((r) => r.type === "scanlation_group");
        const scanlator =
          (scan?.attributes?.["name"] as string | undefined) ?? "Unknown";
        return {
          id: c.id,
          number: num,
          title,
          scanlator,
          date: Math.floor(new Date(c.attributes.publishAt).getTime() / 1000),
        };
      }),
    };
  },

  async pages(chapterId): Promise<PageListResponse> {
    const res = await client.get<{
      result: string;
      baseUrl: string;
      chapter: { hash: string; data: string[]; dataSaver: string[] };
    }>(`/at-home/server/${chapterId}`);
    if (res.status >= 400 || !res.data?.chapter)
      throw new Error(`MangaDex chapter error ${res.status}`);
    const { baseUrl, chapter } = res.data;
    return {
      chapterId,
      pages: chapter.data.map((file, i) => ({
        index: i,
        url: `${baseUrl}/data/${chapter.hash}/${file}`,
      })),
    };
  },
};
