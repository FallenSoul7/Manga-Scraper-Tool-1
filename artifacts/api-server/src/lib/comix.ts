import axios, { type AxiosInstance } from "axios";
import { generateHash } from "./hash";

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

export type PosterQuality = "small" | "medium" | "large";

export interface Term {
  term_id: number;
  type: string;
  title: string;
  slug: string;
  count?: number | null;
}

export interface Poster {
  small: string;
  medium: string;
  large: string;
}

export interface MangaDTO {
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

export interface ChapterRaw {
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
  const scoreStr =
    Number.isInteger(rated) ? rated.toString() : rated.toString();
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

interface ListOptions {
  page: number;
  nsfw: boolean;
  poster: PosterQuality;
}

function listParams(opts: ListOptions): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {
    limit: "50",
    page: String(opts.page),
  };
  if (!opts.nsfw) {
    params["genres[]"] = NSFW_GENRE_IDS.map((g) => `-${g}`);
  }
  return params;
}

async function getList(
  order: string,
  opts: ListOptions,
  extra: Record<string, string | string[]> = {},
) {
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

export const ComixAPI = {
  async popular(opts: ListOptions) {
    return getList("order[views_30d]", opts);
  },
  async latest(opts: ListOptions) {
    return getList("order[chapter_updated_at]", opts);
  },
  async search(query: string, opts: ListOptions) {
    const trimmed = query.trim();
    // detect comix.to URL
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
      // not a URL — keyword search
    }
    return getList("order[relevance]", opts, { keyword: trimmed });
  },
  async details(
    id: string,
    opts: { poster: PosterQuality; alt: boolean; score: "top" | "bottom" | "none" },
  ) {
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
      synopsis +=
        "\n\nAlternative Names:\n" + m.alt_titles.join("\n");
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
  async chapters(mangaId: string, dedupe: boolean) {
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
  async pages(chapterId: string) {
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

const REFERER = `${BASE_URL}/`;
export async function fetchImage(url: string) {
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: {
      Referer: REFERER,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    validateStatus: (s) => s >= 200 && s < 500,
  });
  return {
    status: res.status,
    contentType:
      (res.headers["content-type"] as string | undefined) ?? "image/jpeg",
    data: Buffer.from(res.data),
  };
}
