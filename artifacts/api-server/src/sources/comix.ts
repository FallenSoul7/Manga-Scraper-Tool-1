import axios, { type AxiosInstance } from "axios";
import { generateHash } from "../lib/hash";
import type {
  MangaSource,
  ListOptions,
  DetailOptions,
  MangaListResponse,
  MangaDetail,
  ChapterListResponse,
  PageListResponse,
  PosterQuality,
  SourceTag,
} from "./types";

const BASE_URL = "https://comix.to";
const API_URL = `${BASE_URL}/api/v2`;
const NSFW_GENRE_IDS = ["87264", "8", "87265", "13", "87266", "87268"];

const client: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 25000,
  headers: {
    Referer: `${BASE_URL}/`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
  },
  validateStatus: (s) => s >= 200 && s < 500,
});

interface Term {
  term_id: number;
  type: string;
  title: string;
  slug: string;
  count?: number | null;
}
interface Poster {
  small: string;
  medium: string;
  large: string;
}
interface MangaDTO {
  hash_id: string;
  title: string;
  alt_titles?: string[];
  synopsis?: string | null;
  type?: string;
  poster: Poster;
  status?: string;
  is_nsfw?: boolean;
  author?: Term[] | null;
  artist?: Term[] | null;
  genre?: Term[] | null;
  theme?: Term[] | null;
  demographic?: Term[] | null;
  rated_avg?: number;
}
interface ChapterRaw {
  chapter_id: number;
  scanlation_group_id: number;
  number: number;
  name: string;
  votes: number;
  updated_at: number;
  scanlation_group?: { name: string } | null;
  is_official: number | boolean;
}
interface SearchResponse {
  result: {
    items: MangaDTO[];
    pagination: { current_page: number; last_page: number };
  };
}
interface SingleMangaResponse {
  result: MangaDTO;
}
interface ChapterDetailsResponse {
  result: {
    items: ChapterRaw[];
    pagination: { current_page: number; last_page: number };
  };
}
interface ChapterPagesResponse {
  result?: {
    chapterId?: number;
    chapter_id?: number;
    images: { url: string }[];
  };
}

function pickPoster(p: Poster, quality: PosterQuality): string {
  if (quality === "large") return p.large;
  if (quality === "small") return p.small;
  return p.medium;
}
function toSummary(m: MangaDTO, quality: PosterQuality) {
  return {
    id: m.hash_id,
    title: m.title,
    thumbnail: pickPoster(m.poster, quality),
    type: m.type ?? "",
    isNsfw: !!m.is_nsfw,
  };
}
function statusToString(s?: string): string {
  switch (s) {
    case "releasing":
      return "Ongoing";
    case "on_hiatus":
      return "On Hiatus";
    case "finished":
      return "Completed";
    case "discontinued":
      return "Cancelled";
    default:
      return "Unknown";
  }
}
function fancyScore(rated: number): string {
  if (!rated || rated === 0) return "";
  const stars = Math.round(rated / 2);
  const scoreStr = rated.toString();
  let s = "";
  s += "★".repeat(Math.max(0, Math.min(5, stars)));
  if (stars < 5) s += "☆".repeat(5 - stars);
  s += ` ${scoreStr}`;
  return s;
}
function getGenres(m: MangaDTO): string[] {
  const out: string[] = [];
  switch (m.type) {
    case "manhwa":
      out.push("Manhwa");
      break;
    case "manhua":
      out.push("Manhua");
      break;
    case "manga":
      out.push("Manga");
      break;
    default:
      out.push("Other");
  }
  for (const t of m.genre ?? []) out.push(t.title);
  for (const t of m.theme ?? []) out.push(t.title);
  for (const t of m.demographic ?? []) out.push(t.title);
  if (m.is_nsfw) out.push("NSFW");
  return Array.from(new Set(out));
}

function listParams(opts: ListOptions): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {
    limit: "50",
    page: String(opts.page),
  };
  // Combine NSFW exclusions with positive tag filters into a single genres[] list.
  const genres: string[] = [];
  if (!opts.nsfw) {
    for (const g of NSFW_GENRE_IDS) genres.push(`-${g}`);
  }
  if (opts.tagIds && opts.tagIds.length > 0) {
    for (const t of opts.tagIds) genres.push(String(t));
  }
  if (genres.length > 0) params["genres[]"] = genres;
  return params;
}

async function getList(
  order: string,
  opts: ListOptions,
  extra: Record<string, string | string[]> = {},
): Promise<MangaListResponse> {
  const res = await client.get<SearchResponse>("/manga", {
    params: { [order]: "desc", ...listParams(opts), ...extra },
  });
  if (res.status >= 400 || !res.data?.result) {
    throw new Error(`Comix API error ${res.status}`);
  }
  return {
    items: res.data.result.items.map((m) => toSummary(m, opts.poster)),
    page: res.data.result.pagination.current_page,
    hasNextPage:
      res.data.result.pagination.current_page <
      res.data.result.pagination.last_page,
  };
}

function officialBool(v: number | boolean): boolean {
  if (typeof v === "boolean") return v;
  return v === 1;
}
function chapterTitle(ch: ChapterRaw): string {
  const num = ch.number.toString().replace(/\.0$/, "");
  let t = `Chapter ${num}`;
  if (ch.name && ch.name.length > 0) t += `: ${ch.name}`;
  return t;
}
function chapterScanlator(ch: ChapterRaw): string {
  if (ch.scanlation_group && ch.scanlation_group.name)
    return ch.scanlation_group.name;
  if (officialBool(ch.is_official)) return "Official";
  return "Unknown";
}
function dedupeAdd(map: Map<number, ChapterRaw>, ch: ChapterRaw) {
  const cur = map.get(ch.number);
  if (!cur) {
    map.set(ch.number, ch);
    return;
  }
  const newOff = officialBool(ch.is_official);
  const curOff = officialBool(cur.is_official);
  const newGroup = ch.scanlation_group_id === 10702;
  const curGroup = cur.scanlation_group_id === 10702;
  let better: boolean;
  if (newOff && !curOff) better = true;
  else if (!newOff && curOff) better = false;
  else if (newGroup && !curGroup) better = true;
  else if (!newGroup && curGroup) better = false;
  else if (ch.votes > cur.votes) better = true;
  else if (ch.votes < cur.votes) better = false;
  else better = ch.updated_at > cur.updated_at;
  if (better) map.set(ch.number, ch);
}

// In-memory cache for the tag (genre/theme/demographic) catalog. The upstream
// list is essentially static, so we hold it for an hour to avoid hammering
// /api/v2/terms on every browse view.
let TAG_CACHE: { at: number; tags: SourceTag[] } | null = null;
const TAG_TTL_MS = 60 * 60 * 1000;

interface TermRaw {
  term_id: number;
  type: string;
  title: string;
  slug: string;
  count: number;
}
interface TermResponse {
  result?: { items?: TermRaw[] };
}

async function fetchTermType(type: string, group: string): Promise<SourceTag[]> {
  const res = await client.get<TermResponse>("/terms", { params: { type } });
  if (res.status >= 400 || !res.data?.result?.items) return [];
  return res.data.result.items.map((t) => ({
    id: String(t.term_id),
    name: t.title,
    group,
    count: t.count,
  }));
}

export const ComixSource: MangaSource = {
  id: "en.comix",
  name: "Comix",
  lang: "en",
  isNsfw: true,
  imageReferer: `${BASE_URL}/`,

  async tags(): Promise<SourceTag[]> {
    if (TAG_CACHE && Date.now() - TAG_CACHE.at < TAG_TTL_MS) {
      return TAG_CACHE.tags;
    }
    const [genres, themes, demos] = await Promise.all([
      fetchTermType("genre", "Genre").catch(() => []),
      fetchTermType("theme", "Theme").catch(() => []),
      fetchTermType("demographic", "Demographic").catch(() => []),
    ]);
    // Drop NSFW-only genres from the picker so it's safe to expose by default.
    const nsfwSet = new Set(NSFW_GENRE_IDS);
    const tags = [...genres, ...themes, ...demos]
      .filter((t) => !nsfwSet.has(t.id))
      .sort((a, b) => {
        if (a.group !== b.group) return (a.group ?? "").localeCompare(b.group ?? "");
        return a.name.localeCompare(b.name);
      });
    TAG_CACHE = { at: Date.now(), tags };
    return tags;
  },

  async popular(opts) {
    return getList("order[views_30d]", opts);
  },
  async latest(opts) {
    return getList("order[chapter_updated_at]", opts);
  },
  async search(query, opts) {
    const trimmed = query.trim();
    try {
      const u = new URL(trimmed);
      const host = u.host.replace(/^www\./, "");
      if (host === "comix.to") {
        const segs = u.pathname.split("/").filter(Boolean);
        if (segs.length >= 2 && segs[0] === "title") {
          const mangaId = segs[1]!.split("-")[0]!;
          const detail = await this.details(mangaId, {
            poster: opts.poster,
            alt: false,
            score: "none",
          });
          return {
            items: [
              {
                id: detail.id,
                title: detail.title,
                thumbnail: detail.thumbnail,
                type: detail.type ?? "",
                isNsfw: !!detail.isNsfw,
              },
            ],
            page: 1,
            hasNextPage: false,
          };
        }
      }
    } catch {
      /* not a URL — keyword search */
    }
    return getList("order[relevance]", opts, { keyword: trimmed });
  },
  async details(id, opts: DetailOptions): Promise<MangaDetail> {
    const res = await client.get<SingleMangaResponse>(`/manga/${id}`, {
      params: {
        "includes[]": [
          "demographic",
          "genre",
          "theme",
          "author",
          "artist",
          "publisher",
        ],
      },
    });
    if (res.status >= 400 || !res.data?.result) {
      throw new Error(`Comix API error ${res.status}`);
    }
    const m = res.data.result;
    const score = fancyScore(m.rated_avg ?? 0);
    let synopsis = "";
    if (opts.score === "top" && score) synopsis += score + "\n\n";
    if (m.synopsis) synopsis += m.synopsis;
    if (opts.alt && m.alt_titles && m.alt_titles.length > 0) {
      synopsis += "\n\nAlternative Names:\n" + m.alt_titles.join("\n");
    }
    if (opts.score === "bottom" && score) {
      if (synopsis.length > 0) synopsis += "\n\n";
      synopsis += score;
    }
    return {
      id: m.hash_id,
      title: m.title,
      author: (m.author ?? []).map((t) => t.title).join(", "),
      artist: (m.artist ?? []).map((t) => t.title).join(", "),
      synopsis,
      altTitles: m.alt_titles ?? [],
      status: statusToString(m.status),
      type: m.type ?? "",
      isNsfw: !!m.is_nsfw,
      rating: m.rated_avg ?? 0,
      thumbnail: pickPoster(m.poster, opts.poster),
      genres: getGenres(m),
      score,
      scorePosition: opts.score,
    };
  },
  async chapters(mangaId, dedupe): Promise<ChapterListResponse> {
    const collect: ChapterRaw[] = [];
    const map = new Map<number, ChapterRaw>();
    let page = 1;
    let lastPage = 1;
    do {
      const path = `/manga/${mangaId}/chapters`;
      const time = 1;
      const hashToken = generateHash(path, 0, time);
      const res = await client.get<ChapterDetailsResponse>(
        `/manga/${mangaId}/chapters`,
        {
          params: {
            "order[number]": "desc",
            limit: "100",
            page: String(page),
            time: String(time),
            _: hashToken,
          },
        },
      );
      if (res.status >= 400 || !res.data?.result) {
        throw new Error(`Comix API error ${res.status}`);
      }
      const items = res.data.result.items;
      lastPage = res.data.result.pagination.last_page;
      if (dedupe) {
        for (const ch of items) dedupeAdd(map, ch);
      } else {
        collect.push(...items);
      }
      page++;
    } while (page <= lastPage);
    const finalRaw = dedupe ? Array.from(map.values()) : collect;
    finalRaw.sort((a, b) => b.number - a.number);
    return {
      items: finalRaw.map((ch) => ({
        id: ch.chapter_id,
        number: ch.number,
        title: chapterTitle(ch),
        scanlator: chapterScanlator(ch),
        date: ch.updated_at,
        votes: ch.votes,
        isOfficial: officialBool(ch.is_official),
      })),
    };
  },
  async pages(chapterId): Promise<PageListResponse> {
    const res = await client.get<ChapterPagesResponse>(`/chapters/${chapterId}`);
    if (res.status >= 400 || !res.data?.result) {
      throw new Error(`Chapter not found`);
    }
    const result = res.data.result;
    const cid = result.chapterId ?? result.chapter_id ?? Number(chapterId);
    return {
      chapterId: cid,
      pages: result.images.map((img, i) => ({ index: i, url: img.url })),
    };
  },
};
