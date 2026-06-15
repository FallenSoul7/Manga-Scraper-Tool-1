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
//
// Actual HTML (from server-rendered /manga-list/{genre}):
//   <div> <form>…</form> </div>
//   <div class="grid grid-cols-3 md:grid-cols-5 …">
//     <a href="https://comickfan.com/manga/the-outlaws-0">
//       <div …> <div …> <div class="… thumb-cover">
//         <span data-state="Ongoing">Ongoing</span>
//         <img src="https://meo.cdncmk.com/…" alt="The Outlaws 0" …>
//       </div> </div> </div>
//     </a>
//     …
//   </div>
// ---------------------------------------------------------------------------
function parseGrid($: ReturnType<typeof cheerio.load>): MangaSummary[] {
  const items: MangaSummary[] = [];
  const seen  = new Set<string>();

  // Primary: grid that immediately follows the filter-form wrapper
  // Fallback: any grid-child anchor linking to /manga/ (covers edge layouts)
  const cards = $("div:has(> form) + div.grid > a, div.grid > a[href*='comickfan.com/manga/']");

  cards.each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    // Accepts both relative (/manga/slug) and absolute (https://comickfan.com/manga/slug)
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

// hasNextPage — official Kotlin source checks for a:has(img[alt=Next])
function hasNext($: ReturnType<typeof cheerio.load>): boolean {
  return $("a:has(img[alt='Next']), a:has(img[alt=Next])").length > 0;
}

// ---------------------------------------------------------------------------
// getValue helper — mirrors the Kotlin source's Element.getValue(label)
//
// Row structure (searched document-wide, not inside a specific root, because
// div.bg-card-section matches both the breadcrumb nav and the info panel and
// we can't rely on it being unique):
//   <div class="… flex-row … gap-4 …">
//     <div class="… text-sm …">Label</div>
//     <div class="… text-sm …">Value</div>
//   </div>
// ---------------------------------------------------------------------------
function getValue($: ReturnType<typeof cheerio.load>, label: string): string | null {
  let result: string | null = null;
  $("div.flex-row.gap-4").each((_i, row): false | void => {
    const cells = $(row).find("> div");
    const labelText = cells.eq(0).text().trim();
    if (labelText === label) {
      const val = cells.eq(1).text().trim();
      if (val && val !== "-" && val !== "_") result = val;
      return false; // break .each
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

  // ---- Sorts ---------------------------------------------------------------
  popularSorts: [
    { value: "rating",  label: "Top Rated"    },
    { value: "latest",  label: "Last Updated" },
    { value: "bookmark",label: "Most Bookmarked" },
    { value: "",        label: "Default"      },
  ],

  // ---- Popular -------------------------------------------------------------
  // The official source uses /advanced-search?sort=rating which is JS-rendered,
  // so we use /manga-list/{genre} (server-rendered) when a genre tag is selected.
  // Without a genre, we fall back to advanced-search (will return empty for us
  // since results are JS-rendered, but won't crash).
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
    // No genre selected — advanced-search is JS-rendered, returns empty grid
    const res = await html.get("/advanced-search", {
      params: { page: opts.page, sort: opts.sort ?? "rating" },
    });
    if (res.status >= 400) throw new Error(`ComicKFan popular error ${res.status}`);
    const $ = cheerio.load(res.data as string);
    return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($) };
  },

  // ---- Latest --------------------------------------------------------------
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

  // ---- Search --------------------------------------------------------------
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
    // Text search via advanced-search (JS-rendered, will likely be empty)
    const params: Record<string, string | number> = { page: opts.page };
    if (query)    params.name = query;
    if (opts.sort) params.sort = opts.sort;
    if (included.length > 0) params.genres = included.join("_");
    const res = await html.get("/advanced-search", { params });
    if (res.status >= 400) throw new Error(`ComicKFan search error ${res.status}`);
    const $ = cheerio.load(res.data as string);
    return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($) };
  },

  // ---- Details -------------------------------------------------------------
  // Mirrors the official Kotlin source's mangaDetailsParse exactly.
  async details(slug: string, opts: DetailOptions): Promise<MangaDetail> {
    const res = await html.get(`/manga/${slug}`);
    if (res.status >= 400) throw new Error(`ComicKFan detail error ${res.status} for ${slug}`);
    const $ = cheerio.load(res.data as string);

    // Title
    const title = $("h1").first().text().trim() || slug;

    // Synopsis — div.comic-content.desk contains: "Read [Type] [Title] [/ AltTitle][Synopsis]"
    // We strip the leading boilerplate step-by-step.
    let synopsis = $("div.comic-content.desk").first().text().trim();
    // 1. Strip "Read [Type] " e.g. "Read Manhwa "
    synopsis = synopsis.replace(/^Read\s+\S+\s+/, "");
    // 2. Strip the main title if it appears at start
    if (title && synopsis.startsWith(title)) synopsis = synopsis.slice(title.length);
    // 3. Strip optional " / " alt-title separator
    synopsis = synopsis.replace(/^\s*\/\s*/, "");
    // 4. Strip any remaining non-ASCII + digit run before the first uppercase English letter
    //    (handles Korean alt-title like "범죄도시0" glued directly to "He sweeps…")
    synopsis = synopsis.replace(/^[^A-Za-z.!?'"(]+(?=[A-Z])/, "");
    synopsis = synopsis.trim();

    // Thumbnail — div.thumb-cover img (globally), fallback to og:image
    const thumbnail =
      $("div.thumb-cover img").first().attr("src") ??
      $("meta[property='og:image']").attr("content") ??
      "";

    // Genres — absolute links to /manga-list/
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

    // Author / Artist / Status / Type — searched document-wide via getValue
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

  // ---- Chapters ------------------------------------------------------------
  // Official: GET /api/comics/${slug}/chapter-list?translation_group_id=
  // Returns per_page=2000 by default — all chapters in one request.
  async chapters(slug: string): Promise<ChapterListResponse> {
    const res = await api.get<CfChapterResp>(`/api/comics/${slug}/chapter-list`, {
      params:  { translation_group_id: "" },
      headers: { Referer: `${BASE}/manga/${slug}` },
    });
    if (res.status >= 400) throw new Error(`ComicKFan chapters error ${res.status}`);

    const chapters = res.data?.data ?? [];

    // Deduplicate: keep one entry per chapter number (highest hash_id length ≈ most recent)
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

  // ---- Pages ---------------------------------------------------------------
  // Official: div.w-full > img[loading=lazy]
  async pages(chapterId: string): Promise<PageListResponse> {
    const decoded = decodeChapterId(chapterId);
    if (!decoded) throw new Error(`ComicKFan: invalid chapter ID "${chapterId}"`);
    const { slug, chapter, hashId } = decoded;

    const readingUrl = `/manga/${slug}/chapter-${chapter}-${hashId}`;
    const res = await html.get(readingUrl, {
      headers: { Referer: `${BASE}/manga/${slug}` },
    });
    if (res.status >= 400) throw new Error(`ComicKFan pages error ${res.status} for ${readingUrl}`);

    const $ = cheerio.load(res.data as string);
    const pageUrls: string[] = [];
    const seen = new Set<string>();

    // Try the primary selector first; fall back to broader selectors if the
    // site structure has changed.
    const selectors = [
      "div.w-full > img[loading=lazy]",
      ".reading-content img",
      ".chapter-content img",
      "img[loading=lazy][src*='cdn']",
      "img[loading=lazy]",
    ];
    for (const sel of selectors) {
      $(sel).each((_i, el) => {
        const src = $(el).attr("src") ?? $(el).attr("data-src") ?? "";
        if (!src || seen.has(src)) return;
        if (src.startsWith("data:")) return; // skip inline placeholders
        seen.add(src);
        pageUrls.push(src);
      });
      if (pageUrls.length > 0) break;
    }

    return {
      chapterId,
      pages: pageUrls.map((url, i) => ({ index: i, url })),
    };
  },

  // ---- Tags ----------------------------------------------------------------
  // Genre list hardcoded from official ComicKFanFilters.kt (avoids extra HTTP round-trip)
  async tags(): Promise<SourceTag[]> {
    if (cachedTags) return cachedTags;
    const genres: Array<{ id: string; name: string; group: string }> = [
      // Format
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
      // Content
      { id: "sexual-violence", name: "Sexual Violence",  group: "Content" },
      { id: "gore",            name: "Gore",             group: "Content" },
      { id: "smut",            name: "Smut",             group: "Content" },
      { id: "ecchi",           name: "Ecchi",            group: "Content" },
      // Theme
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
      // Genre
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
