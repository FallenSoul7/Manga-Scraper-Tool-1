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
// Helpers & Sanitization
// ---------------------------------------------------------------------------
const NSFW_GENRES = new Set(["adult","mature","hentai","18+","ecchi","smut","doujinshi","yaoi","yuri","gore","sexual violence"]);
function checkNsfw(genres: string[]): boolean {
  return genres.some(g => NSFW_GENRES.has(g.toLowerCase()));
}

function sanitizeImageUrl(url: string): string {
  if (!url) return "";
  let cleanUrl = url.replace(/\\/g, "").trim();
  
  // Skip processing inline base64 image placeholders completely
  if (cleanUrl.startsWith("data:")) return cleanUrl;
  
  if (cleanUrl.startsWith("//")) {
    cleanUrl = "https:" + cleanUrl;
  } else if (cleanUrl.startsWith("/")) {
    cleanUrl = `${BASE}${cleanUrl}`;
  } else if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    cleanUrl = "https://" + cleanUrl;
  }
  
  if (cleanUrl.startsWith("http://")) {
    cleanUrl = cleanUrl.replace("http://", "https://");
  }
  return cleanUrl;
}

// ---------------------------------------------------------------------------
// Grid & Value Parsers
// ---------------------------------------------------------------------------
function parseGrid($: ReturnType<typeof cheerio.load>): MangaSummary[] {
  const items: MangaSummary[] = [];
  const seen  = new Set<string>();

  const cards = $("div:has(> form) + div.grid > a");

  cards.each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const mangaMatch = href.match(/\/manga\/([a-z0-9][a-z0-9_-]*)(?:[/?#]|$)/);
    const slug = mangaMatch?.[1] ?? "";
    if (!slug || seen.has(slug)) return;

    const img   = $(el).find("img").first();
    const title = (img.attr("alt") ?? img.attr("title") ?? "").trim();
    const thumbnail = sanitizeImageUrl(img.attr("src") ?? "");

    if (!title || !thumbnail || thumbnail.includes("logo.png") || thumbnail.startsWith("data:")) return;

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
// Chapter ID Processing
// ---------------------------------------------------------------------------
interface CfChapter {
  hash_id:      string;
  chapter:      string;
  title?:       string | null;
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
// Source Core Implementation
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
    const params: Record<string, string | number> = {
      page: opts.page,
      sort: opts.sort ?? "rating",
      genres: included.join("_")
    };
    const res = await html.get("/advanced-search", { params });
    if (res.status >= 400) throw new Error(`ComicKFan popular error ${res.status}`);
    const $ = cheerio.load(res.data as string);
    return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($) };
  },

  async latest(opts: ListOptions): Promise<MangaListResponse> {
    const included = (opts.tagIds ?? []).filter(t => !t.startsWith("-"));
    const params: Record<string, string | number> = {
      page: opts.page,
      sort: "latest",
      genres: included.join("_")
    };
    const res = await html.get("/advanced-search", { params });
    if (res.status >= 400) throw new Error(`ComicKFan latest error ${res.status}`);
    const $ = cheerio.load(res.data as string);
    return { items: parseGrid($), page: opts.page, hasNextPage: hasNext($) };
  },

  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    const included = (opts.tagIds ?? []).filter(t => !t.startsWith("-"));
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
    const description = $("div.comic-content.desk").first().text().trim();

    const thumbnail = sanitizeImageUrl(
      $("div.thumb-cover img").first().attr("src") ??
      $("meta[property='og:image']").attr("content") ?? ""
    );

    const genres: string[] = [];
    const sourceTags: Array<{ id: string; name: string; group: string }> = [];
    $("div.font-medium:contains(Genres) + div a").each((_i, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr("href") ?? "";
      const genreSlug = (href.split("/manga-list/")[1] ?? "").replace(/[/?#].*$/, "");
      if (name && genreSlug) {
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
      synopsis: description,
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

    // 🚀 METHOD 1: Primary Next.js State Core Mining (__NEXT_DATA__)
    const nextDataScript = $("#__NEXT_DATA__").html();
    if (nextDataScript) {
      try {
        const parsedJson = JSON.parse(nextDataScript);
        const pageProps = parsedJson.props?.pageProps;
        if (pageProps) {
          const targetNode = pageProps.chapter ?? pageProps.data;
          const rawImages = targetNode?.images ?? pageProps.images ?? targetNode?.body?.images;
          
          if (Array.isArray(rawImages)) {
            for (const img of rawImages) {
              const path = typeof img === "string" ? img : (img.url ?? img.path ?? img.src);
              const formatted = sanitizeImageUrl(path);
              if (formatted && !formatted.startsWith("data:") && !pageUrls.includes(formatted)) {
                pageUrls.push(formatted);
              }
            }
          }
        }
      } catch {
        // Drop down to fallback DOM execution if script node parsing fails
      }
    }

    // 🛠️ METHOD 2: Secondary DOM Fallback (Scans src, data-src, and multi-resolution srcsets)
    if (pageUrls.length === 0) {
      $("div.w-full img, main img, article img").each((_i, el) => {
        const targetAttr = $(el).attr("data-src") ?? $(el).attr("src") ?? $(el).attr("srcset") ?? "";
        if (!targetAttr) return;

        let selectedUrl = targetAttr;
        if (selectedUrl.includes(" ")) {
          const segments = selectedUrl.split(",");
          const ultimateSegment = segments[segments.length - 1].trim();
          selectedUrl = ultimateSegment.split(" ")[0];
        }

        const formattedUrl = sanitizeImageUrl(selectedUrl);
        if (
          formattedUrl && 
          !formattedUrl.startsWith("data:") && 
          !formattedUrl.includes("logo.png") && 
          !formattedUrl.includes("avatar") &&
          !pageUrls.includes(formattedUrl)
        ) {
          pageUrls.push(formattedUrl);
        }
      });
    }

    if (pageUrls.length > 0) {
      return {
        chapterId,
        pages: pageUrls.map((url, i) => ({ index: i, url })),
      };
    }

    throw new Error("ComicKFan: No reader pages could be found in the document shell.");
  },

  async tags(): Promise<SourceTag[]> {
    if (cachedTags) return cachedTags;
    
    const tags: SourceTag[] = [];
    const seen = new Set<string>();

    try {
      const res = await html.get("/advanced-search");
      if (res.status < 400) {
        const $ = cheerio.load(res.data as string);
        
        $("a[href*='/manga-list/'], form input[type='checkbox']").each((_i, el) => {
          let id = "";
          let name = "";
          
          if ($(el).is("input")) {
            id = $(el).attr("value") ?? "";
            name = $(el).attr("id") ?? $(el).parent().text().trim();
          } else {
            const href = $(el).attr("href") ?? "";
            id = (href.split("/manga-list/")[1] ?? "").replace(/[/?#].*$/, "").trim();
            name = $(el).text().trim();
          }
          
          if (name && id && !seen.has(id) && id !== "all" && id !== "list" && id.length > 1) {
            seen.add(id);
            
            let group = "Genre";
            if (["long-strip", "full-color", "official-colored", "fan-colored", "oneshot", "doujinshi", "4-koma", "adaptation", "anthology", "user-created", "web-comic"].includes(id)) {
              group = "Format";
            } else if (["gore", "sexual-violence", "smut", "ecchi"].includes(id)) {
              group = "Content";
            } else if (["ninja", "magic", "vampires", "school-life", "military", "reincarnation", "time-travel", "mafia", "zombies", "harem", "reverse-harem", "crossdressing", "martial-arts"].includes(id)) {
              group = "Theme";
            }
            
            tags.push({ id, name, group });
          }
        });
      }
    } catch {
      // Recovery Block
    }

    if (tags.length === 0) {
      const fallbackList = [
        { id: "action", name: "Action", group: "Genre" },
        { id: "adventure", name: "Adventure", group: "Genre" },
        { id: "comedy", name: "Comedy", group: "Genre" },
        { id: "drama", name: "Drama", group: "Genre" },
        { id: "fantasy", name: "Fantasy", group: "Genre" },
        { id: "romance", name: "Romance", group: "Genre" },
        { id: "isekai", name: "Isekai", group: "Genre" },
        { id: "full-color", name: "Full Color", group: "Format" },
        { id: "long-strip", name: "Long Strip", group: "Format" },
      ];
      fallbackList.forEach(t => tags.push(t));
    }

    cachedTags = tags.map(t => ({ ...t, count: undefined }));
    return cachedTags;
  },
};
