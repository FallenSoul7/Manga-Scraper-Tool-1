import * as cheerio from "cheerio";
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

const BASE = "https://comickfan.com";

const html = makeHttp(BASE);
const api  = makeHttp(BASE, { Accept: "application/json" });

// ---------------------------------------------------------------------------
// NSFW detection
// ---------------------------------------------------------------------------
const NSFW_GENRES = new Set(["adult","mature","hentai","18+","ecchi","smut","doujinshi","yaoi","yuri","gore","sexual violence"]);
function checkNsfw(genres: string[]): boolean {
  return genres.some(g => NSFW_GENRES.has(g.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Grid parser — used by all listing pages
// ---------------------------------------------------------------------------
function parseGrid($: ReturnType<typeof cheerio.load>): MangaSummary[] {
  const items: MangaSummary[] = [];
  const seen  = new Set<string>();

  const cards = $("div:has(> form) + div.grid > a, div.grid > a[href*='comickfan.com/manga/']");

  cards.each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const mangaMatch = href.match(/\/manga\/([a-z0-9][a-z0-9_-]*)(?:[/?#]|$)/);
    const slug = mangaMatch?.[1] ?? "";
    if (!slug || seen.has(slug)) return;

    const img   = $(el).find("img").first();
    const title = (img.attr("alt") ?? img.attr("title") ?? "").trim();
    const thumbnail = img.attr("src") ?? "";

    if (!title || !thumbnail || thumbnail.includes("logo.png")) return;

    seen.add(slug);
    items.push({ id: slug, title, thumbnail, type: "manga", isNsfw: false });
  });

  return items;
}

function hasNext($: ReturnType<typeof cheerio.load>): boolean {
  return $("a:has(img[alt='Next']), a:has(img[alt=Next])").length > 0;
}

function getValue($: ReturnType<typeof cheerio.load>, label: string): string | null {
  let result: string | null = null;
  $("div.flex-row.gap-4").each((_i, row): false | void => {
    const cells = $(row).find("> div");
    const labelText = cells.eq(0).text().trim();
    if (labelText === label) {
      const val = cells.eq(1).text().trim();
      if (val && val !== "-" && val !== "_") result = val;
      return false; 
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// Chapter API types
// ---------------------------------------------------------------------------
interface CfChapter {
  hash_id:      string;
  chapter:      string;
  title?:       string | null;
  volume?:      string | null;
  group_names?: string[];
  published_at?: string | null;
  created_at?:  string | null;
}
interface CfChapterResp { data: CfChapter[] }

function encodeChapterId(slug: string, chapter: string, hashId: string): string {
  return `${slug}|||${chapter}|||${hashId}`;
}
function decodeChapterId(id: string): { slug: string; chapter: string; hashId: string } | null {
  const parts = id.split("|||");
  if (parts.length !== 3) return null;
  return { slug: parts[0], chapter: parts[1], hashId: parts[2] };
}

let cachedTags: SourceTag[] | null = null;

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------
export const ComickFanSource: MangaSource = {
  id:           "en.comickfan",
  name:         "ComicK Fanmade",
  lang:         "en",
  isNsfw:       false,
  imageReferer: "https://comickfan.com/",

  popularSorts: [
    { value: "rating",  label: "Top Rated"    },
    { value: "latest",  label: "Last Updated" },
    { value: "bookmark",label: "Most Bookmarked" },
    { value: "",        label: "Default"      },
  ],

  async popular(opts: ListOptions): Promise<MangaListResponse> {
    const included = (opts.tagIds ?? []).filter(t => !t.startsWith("-"));
    if (included.length > 0) {
      const res = await html.get(`/manga-list/${included[0]}`, {
        params: { page: opts.page, ...(opts.sort ? { sort: opts.sort } : {}) },
      });
      if (res.status >= 400) throw new Error(`ComicKFan manga-list error ${res.status}`);
      const $ = cheerio.load(res.data as string);
      return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($) };
    }
    const res = await html.get("/advanced-search", {
      params: { page: opts.page, sort: opts.sort ?? "rating" },
    });
    if (res.status >= 400) throw new Error(`ComicKFan popular error ${res.status}`);
    const $ = cheerio.load(res.data as string);
    return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($) };
  },

  async latest(opts: ListOptions): Promise<MangaListResponse> {
    const included = (opts.tagIds ?? []).filter(t => !t.startsWith("-"));
    if (included.length > 0) {
      const res = await html.get(`/manga-list/${included[0]}`, {
        params: { page: opts.page, sort: "latest" },
      });
      if (res.status >= 400) throw new Error(`ComicKFan manga-list error ${res.status}`);
      const $ = cheerio.load(res.data as string);
      return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($) };
    }
    const res = await html.get("/advanced-search", {
      params: { page: opts.page, sort: "latest" },
    });
    if (res.status >= 400) throw new Error(`ComicKFan latest error ${res.status}`);
    const $ = cheerio.load(res.data as string);
    return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($) };
  },

  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    const included = (opts.tagIds ?? []).filter(t => !t.startsWith("-"));
    if (included.length > 0 && !query) {
      const res = await html.get(`/manga-list/${included[0]}`, {
        params: { page: opts.page, ...(opts.sort ? { sort: opts.sort } : {}) },
      });
      if (res.status >= 400) throw new Error(`ComicKFan manga-list error ${res.status}`);
      const $ = cheerio.load(res.data as string);
      return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($) };
    }
    const params: Record<string, string | number> = { page: opts.page };
    if (query)    params.name = query;
    if (opts.sort) params.sort = opts.sort;
    if (included.length > 0) params.genres = included.join("_");
    const res = await html.get("/advanced-search", { params });
    if (res.status >= 400) throw new Error(`ComicKFan search error ${res.status}`);
    const $ = cheerio.load(res.data as string);
    return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($) };
  },

  async details(slug: string, opts: DetailOptions): Promise<MangaDetail> {
    const res = await html.get(`/manga/${slug}`);
    if (res.status >= 400) throw new Error(`ComicKFan detail error ${res.status} for ${slug}`);
    const $ = cheerio.load(res.data as string);

    const title = $("h1").first().text().trim() || slug;

    let synopsis = $("div.comic-content.desk").first().text().trim();
    synopsis = synopsis.replace(/^Read\s+\S+\s+/, "");
    if (title && synopsis.startsWith(title)) synopsis = synopsis.slice(title.length);
    synopsis = synopsis.replace(/^\s*\/\s*/, "");
    synopsis = synopsis.replace(/^[^A-Za-z.!?'"(]+(?=[A-Z])/, "");
    synopsis = synopsis.trim();

    const thumbnail =
      $("div.thumb-cover img").first().attr("src") ??
      $("meta[property='og:image']").attr("content") ??
      "";

    const genres: string[] = [];
    const sourceTags: Array<{ id: string; name: string; group: string }> = [];
    $("a[href*='comickfan.com/manga-list/'], a[href^='/manga-list/']").each((_i, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr("href") ?? "";
      const genreSlug = (href.split("/manga-list/")[1] ?? "").replace(/[/?#].*$/, "");
      if (name && genreSlug && !genres.includes(name)) {
        genres.push(name);
        sourceTags.push({ id: genreSlug, name, group: "Genre" });
      }
    });

    const author    = getValue($, "Author")  ?? "";
    const artist    = getValue($, "Artist")  ?? "";
    const statusRaw = getValue($, "Status")  ?? "";
    const typeRaw   = getValue($, "Type")?.toLowerCase() ?? "";

    const status =
      statusRaw.toLowerCase() === "ongoing"   ? "Ongoing"   :
      statusRaw.toLowerCase() === "completed" ? "Completed" :
      statusRaw.toLowerCase() === "hiatus"    ? "Hiatus"    :
      statusRaw.toLowerCase() === "cancelled" ? "Cancelled" :
      "Unknown";

    const type =
      typeRaw.includes("manhwa") || typeRaw === "kr" ? "manhwa" :
      typeRaw.includes("manhua") || typeRaw === "cn" ? "manhua" :
      "manga";

    return {
      id: slug,
      title,
      author: author || "_",
      artist,
      synopsis,
      altTitles: [],
      status,
      type,
      isNsfw: checkNsfw(genres),
      rating: 0,
      thumbnail,
      genres: Array.from(new Set(genres)),
      score: "",
      scorePosition: opts.score,
      sourceTags,
    };
  },

  async chapters(slug: string): Promise<ChapterListResponse> {
    const res = await api.get<CfChapterResp>(`/api/comics/${slug}/chapter-list`, {
      params:  { translation_group_id: "" },
      headers: { Referer: `${BASE}/manga/${slug}` },
    });
    if (res.status >= 400) throw new Error(`ComicKFan chapters error ${res.status}`);

    const chapters = res.data?.data ?? [];

    const byChap = new Map<string, CfChapter>();
    for (const ch of chapters) {
      const key = ch.chapter ?? "0";
      if (!byChap.has(key)) byChap.set(key, ch);
    }

    return {
      items: Array.from(byChap.values()).map(ch => {
        const chapStr = ch.chapter ?? "0";
        const num     = parseFloat(chapStr) || 0;
        const numLabel = chapStr.replace(/\.0$/, "");
        let chTitle = `Chapter ${numLabel}`;
        if (ch.volume?.trim()) chTitle = `Vol.${ch.volume.trim()} ${chTitle}`;
        if (ch.title?.trim())  chTitle += `: ${ch.title.trim()}`;
        const scanlator = (ch.group_names ?? []).filter(Boolean).join(", ") || "Unknown";
        const dateStr   = ch.published_at ?? ch.created_at ?? "";
        const date      = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : 0;
        return {
          id:        encodeChapterId(slug, chapStr, ch.hash_id),
          number:    num,
          title:     chTitle,
          scanlator,
          date,
        };
      }),
    };
  },

  // ---- Pages (Fixed & Reinforced) -------------------------------------------
  async pages(chapterId: string): Promise<PageListResponse> {
    const decoded = decodeChapterId(chapterId);
    if (!decoded) throw new Error(`ComicKFan: invalid chapter ID "${chapterId}"`);
    const { slug, chapter, hashId } = decoded;

    // --- Attempt 1: JSON API variations ---
    const apiEndpoints = [
      `/api/chapters/${hashId}/`,
      `/api/chapter/${hashId}`,
    ];

    for (const endpoint of apiEndpoints) {
      try {
        const apiRes = await api.get<any>(endpoint, { 
          headers: { Referer: `${BASE}/manga/${slug}` } 
        });
        const data = apiRes.data;
        const images = data?.images ?? data?.chapter?.images ?? [];
        if (images.length > 0) {
          const pageUrls = images
            .map((img: any) => img.url ?? (img.b2_key ? `https://meo.cdncmk.com/${img.b2_key}` : ""))
            .filter(Boolean);
          if (pageUrls.length > 0) {
            return { chapterId, pages: pageUrls.map((url: string, i: number) => ({ index: i, url })) };
          }
        }
      } catch {
        // continue to next path
      }
    }

    // --- Attempt 2: Alternate API Path ---
    try {
      const apiRes2 = await api.get<{ pages?: Array<{ url?: string }> }>(
        `/api/comics/${slug}/chapters/${chapter}/pages`,
        { headers: { Referer: `${BASE}/manga/${slug}` } },
      );
      const pages = apiRes2.data?.pages ?? [];
      if (pages.length > 0) {
        const pageUrls = pages.map(p => p.url ?? "").filter(Boolean);
        if (pageUrls.length > 0) {
          return { chapterId, pages: pageUrls.map((url, i) => ({ index: i, url })) };
        }
      }
    } catch {
      // fall through
    }

    // --- Attempt 3: Enhanced HTML Reader / Script Scrape ---
    const readingUrl = `/manga/${slug}/chapter-${chapter}-${hashId}`;
    const res = await html.get(readingUrl, {
      headers: { Referer: `${BASE}/manga/${slug}` },
    });
    if (res.status >= 400) throw new Error(`ComicKFan pages error ${res.status} for ${readingUrl}`);

    const rawHtml = res.data as string;

    // 1. Direct window block parsing (Most reliable for hydrated layouts)
    const chapterDataMatch = rawHtml.match(/window\.chapter_data\s*=\s*({.+?});/);
    if (chapterDataMatch) {
      try {
        const parsedData = JSON.parse(chapterDataMatch[1]);
        const images = parsedData.images ?? parsedData.chapter?.images ?? [];
        if (images.length > 0) {
          const pageUrls = images.map((img: any) => {
            const path = img.url ?? img.b2_key ?? "";
            if (!path) return "";
            return path.startsWith("http") ? path : `https://meo.cdncmk.com/${path}`;
          }).filter(Boolean);

          if (pageUrls.length > 0) {
            return { chapterId, pages: pageUrls.map((url: string, i: number) => ({ index: i, url })) };
          }
        }
      } catch {
        // block syntax error, fallback to regex
      }
    }

    // 2. Escape-Safe Regular Expression Extraction
    // Matches patterns even when forward slashes are json-escaped (\/)
    const cdnRegex = /https?:\\?\/\\?\/meo\d*\.cdncmk\.com\\?\/[^"\s>]+?\.(?:webp|jpg|jpeg|png|avif)/gi;
    const matches = rawHtml.match(cdnRegex) ?? [];
    
    // Clean backslashes from URLs
    const allCdnUrls = [...new Set(matches.map(url => url.replace(/\\/g, "")))];

    let thumbnailUrl = "";
    const thumbMatch = rawHtml.match(/"thumbnail"\s*:\s*"([^"]+)"/);
    if (thumbMatch) thumbnailUrl = thumbMatch[1].replace(/\\/g, "");

    const pageUrls = allCdnUrls.filter(url =>
      url !== thumbnailUrl &&
      !url.includes("thumb-default") &&
      !url.includes("thumb-cover") &&
      !url.includes("logo.png")
    );

    if (pageUrls.length > 0) {
      return { chapterId, pages: pageUrls.map((url, i) => ({ index: i, url })) };
    }

    // 3. Cheerio Dom Fallback
    const $ = cheerio.load(rawHtml);
    const fallbackUrls: string[] = [];
    const seen = new Set<string>();
    const selectors = [
      "div.w-full img",
      ".reading-content img",
      "img[src*='meo']",
      "img[data-src]"
    ];
    for (const sel of selectors) {
      $(sel).each((_i, el) => {
        const src = $(el).attr("src") ?? $(el).attr("data-src") ?? "";
        if (!src || seen.has(src) || src.startsWith("data:")) return;
        seen.add(src);
        fallbackUrls.push(src.replace(/\\/g, ""));
      });
      if (fallbackUrls.length > 0) break;
    }

    return {
      chapterId,
      pages: fallbackUrls.map((url, i) => ({ index: i, url })),
    };
  },

  async tags(): Promise<SourceTag[]> {
    if (cachedTags) return cachedTags;
    const genres: Array<{ id: string; name: string; group: string }> = [
      { id: "award-winning",   name: "Award Winning",   group: "Format" },
      { id: "long-strip",      name: "Long Strip",      group: "Format" },
      { id: "official-colored",name: "Official Colored",group: "Format" },
      { id: "fan-colored",     name: "Fan Colored",     group: "Format" },
      { id: "anthology",       name: "Anthology",        group: "Format" },
      { id: "full-color",      name: "Full Color",       group: "Format" },
      { id: "4-koma",          name: "4-Koma",           group: "Format" },
      { id: "user-created",    name: "User Created",     group: "Format" },
      { id: "adaptation",      name: "Adaptation",       group: "Format" },
      { id: "web-comic",       name: "Web Comic",        group: "Format" },
      { id: "oneshot",         name: "Oneshot",          group: "Format" },
      { id: "doujinshi",       name: "Doujinshi",        group: "Format" },
      { id: "sexual-violence", name: "Sexual Violence",  group: "Content" },
      { id: "gore",            name: "Gore",             group: "Content" },
      { id: "smut",            name: "Smut",             group: "Content" },
      { id: "ecchi",           name: "Ecchi",            group: "Content" },
      { id: "ninja",           name: "Ninja",            group: "Theme" },
      { id: "virtual-reality", name: "Virtual Reality",  group: "Theme" },
      { id: "police",          name: "Police",           group: "Theme" },
      { id: "magic",           name: "Magic",            group: "Theme" },
      { id: "villainess",      name: "Villainess",       group: "Theme" },
      { id: "traditional-games",name:"Traditional Games",group: "Theme" },
      { id: "reincarnation",   name: "Reincarnation",    group: "Theme" },
      { id: "zombies",         name: "Zombies",          group: "Theme" },
      { id: "loli",            name: "Loli",             group: "Theme" },
      { id: "time-travel",     name: "Time Travel",      group: "Theme" },
      { id: "mafia",           name: "Mafia",            group: "Theme" },
      { id: "music",           name: "Music",            group: "Theme" },
      { id: "monsters",        name: "Monsters",         group: "Theme" },
      { id: "post-apocalyptic",name: "Post-Apocalyptic", group: "Theme" },
      { id: "office-workers",  name: "Office Workers",   group: "Theme" },
      { id: "monster-girls",   name: "Monster Girls",    group: "Theme" },
      { id: "cooking",         name: "Cooking",          group: "Theme" },
      { id: "video-games",     name: "Video Games",      group: "Theme" },
      { id: "reverse-harem",   name: "Reverse Harem",    group: "Theme" },
      { id: "demons",          name: "Demons",           group: "Theme" },
      { id: "harem",           name: "Harem",            group: "Theme" },
      { id: "vampires",        name: "Vampires",         group: "Theme" },
      { id: "shota",           name: "Shota",            group: "Theme" },
      { id: "incest",          name: "Incest",           group: "Theme" },
      { id: "delinquents",     name: "Delinquents",      group: "Theme" },
      { id: "gyaru",           name: "Gyaru",            group: "Theme" },
      { id: "animals",         name: "Animals",          group: "Theme" },
      { id: "military",        name: "Military",         group: "Theme" },
      { id: "aliens",          name: "Aliens",           group: "Theme" },
      { id: "survival",        name: "Survival",         group: "Theme" },
      { id: "ghosts",          name: "Ghosts",           group: "Theme" },
      { id: "crossdressing",   name: "Crossdressing",    group: "Theme" },
      { id: "school-life",     name: "School Life",      group: "Theme" },
      { id: "martial-arts",    name: "Martial Arts",     group: "Theme" },
      { id: "samurai",         name: "Samurai",          group: "Theme" },
      { id: "genderswap",      name: "Genderswap",       group: "Theme" },
      { id: "supernatural",    name: "Supernatural",     group: "Theme" },
      { id: "fantasy",         name: "Fantasy",          group: "Genre" },
      { id: "wuxia",           name: "Wuxia",            group: "Genre" },
      { id: "drama",           name: "Drama",            group: "Genre" },
      { id: "sports",          name: "Sports",           group: "Genre" },
      { id: "psychological",   name: "Psychological",    group: "Genre" },
      { id: "medical",         name: "Medical",          group: "Genre" },
      { id: "superhero",       name: "Superhero",        group: "Genre" },
      { id: "gender-bender",   name: "Gender Bender",    group: "Genre" },
      { id: "romance",         name: "Romance",          group: "Genre" },
      { id: "shoujo-ai",       name: "Shoujo Ai",        group: "Genre" },
      { id: "tragedy",         name: "Tragedy",          group: "Genre" },
      { id: "slice-of-life",   name: "Slice of Life",    group: "Genre" },
      { id: "shounen-ai",      name: "Shounen Ai",       group: "Genre" },
      { id: "isekai",          name: "Isekai",           group: "Genre" },
      { id: "mecha",           name: "Mecha",            group: "Genre" },
      { id: "adult",           name: "Adult",            group: "Genre" },
      { id: "magical-girls",   name: "Magical Girls",    group: "Genre" },
      { id: "philosophical",   name: "Philosophical",    group: "Genre" },
      { id: "sci-fi",          name: "Sci-Fi",           group: "Genre" },
      { id: "thriller",        name: "Thriller",         group: "Genre" },
      { id: "historical",      name: "Historical",       group: "Genre" },
      { id: "yaoi",            name: "Yaoi",             group: "Genre" },
      { id: "mature",          name: "Mature",           group: "Genre" },
      { id: "mystery",         name: "Mystery",          group: "Genre" },
      { id: "adventure",       name: "Adventure",        group: "Genre" },
      { id: "yuri",            name: "Yuri",             group: "Genre" },
      { id: "comedy",          name: "Comedy",           group: "Genre" },
      { id: "horror",          name: "Horror",           group: "Genre" },
      { id: "others",          name: "Others",           group: "Genre" },
      { id: "crime",           name: "Crime",            group: "Genre" },
      { id: "action",          name: "Action",           group: "Genre" },
    ];
    cachedTags = genres.map(g => ({ ...g, count: undefined }));
    return cachedTags;
  },
};
