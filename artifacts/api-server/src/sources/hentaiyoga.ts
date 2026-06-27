import type {
  MangaSource,
  ListOptions,
  MangaListResponse,
  MangaDetail,
  DetailOptions,
  ChapterListResponse,
  PageListResponse,
  MangaSummary,
} from "./types";
import { makeHttp, fetchHtml } from "./scraper-utils";

const BASE = "https://hentai.yoga";
const CDN  = "https://cdn.hentai.yoga";

const http = makeHttp(BASE, {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
});

// ── Slug helpers ──────────────────────────────────────────────────────────────
function thumbUrl(slug: string): string {
  return `${CDN}/images/${slug}.jpg`;
}
function videoUrl(slug: string): string {
  return `${CDN}/videos/${slug}.mp4`;
}

/** "rouge-blowjob-and-throated" → "Rouge Blowjob and Throated" */
function slugToTitle(slug: string): string {
  const stops = new Set(["and","or","the","a","an","in","of","to","by","for","on","at","with","from"]);
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w+/g, (w, i) =>
      i === 0 || !stops.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w
    );
}

// ── Parse a listing page into MangaSummary[] ─────────────────────────────────
async function parseListing(path: string): Promise<{ items: MangaSummary[]; hasNextPage: boolean }> {
  let $: ReturnType<typeof import("cheerio").load>;
  try {
    ({ $ } = await fetchHtml(http, path));
  } catch {
    return { items: [], hasNextPage: false };
  }

  const items: MangaSummary[] = [];

  // Two card types on the site: .video-item (grid) and .episode-card-mini (row)
  const seen = new Set<string>();

  $("a[href*='/watch/']").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const match = href.match(/\/watch\/([a-z0-9][a-z0-9-]+[a-z0-9])/);
    if (!match) return;
    const slug = match[1];
    if (seen.has(slug)) return;
    seen.add(slug);

    // Try to grab title from title attr, fallback to slug
    const rawTitle =
      $(el).attr("title")?.replace(/^Watch\s+/i, "").replace(/[-–]\s*hentai\s*porn$/i, "").trim() ||
      slugToTitle(slug);

    // Thumbnail: prefer <img> inside the link, fallback to CDN pattern
    const img =
      $(el).find("img").attr("src") ||
      $(el).find("img").attr("data-src") ||
      thumbUrl(slug);

    items.push({
      id:        slug,
      title:     rawTitle,
      thumbnail: img.startsWith("http") ? img : thumbUrl(slug),
      type:      "Anime",
      isNsfw:    true,
    });
  });

  // Detect next page: look for a "next" pagination link
  const hasNextPage = $("a[href*='page=']").length > 0 && items.length >= 20;

  return { items, hasNextPage };
}

// ── Source implementation ─────────────────────────────────────────────────────
export const HentaiYogaSource: MangaSource = {
  id:     "video.hentaiyoga",
  name:   "Hentai Yoga",
  lang:   "en",
  isNsfw: true,

  popularSorts: [
    { value: "newest",  label: "Newest"   },
    { value: "popular", label: "Most Viewed" },
  ],

  async popular(o: ListOptions): Promise<MangaListResponse> {
    const sort = o.sort === "popular" ? "most-viewed" : "newest";
    const { items, hasNextPage } = await parseListing(`/anime/?sort=${sort}&page=${o.page}`);
    if (items.length === 0) {
      // Fallback: try the plain listing
      const fallback = await parseListing(`/anime/?page=${o.page}`);
      return { items: fallback.items, page: o.page, hasNextPage: fallback.hasNextPage };
    }
    return { items, page: o.page, hasNextPage };
  },

  async latest(o: ListOptions): Promise<MangaListResponse> {
    const { items, hasNextPage } = await parseListing(`/anime/?page=${o.page}`);
    return { items, page: o.page, hasNextPage };
  },

  async search(query: string, o: ListOptions): Promise<MangaListResponse> {
    if (!query.trim()) return this.latest(o);
    const q = encodeURIComponent(query.trim());
    const { items, hasNextPage } = await parseListing(`/?s=${q}&page=${o.page}`);
    return { items, page: o.page, hasNextPage };
  },

  async details(slug: string, _opts: DetailOptions): Promise<MangaDetail> {
    // Scrape the embed page — it is not Cloudflare-protected
    let title = slugToTitle(slug);
    let synopsis = "";
    const genres: string[] = [];

    try {
      const { $ } = await fetchHtml(http, `/embed/${slug}`);
      const ogTitle = $('meta[property="og:title"]').attr("content") ?? "";
      if (ogTitle) {
        title = ogTitle.replace(/\s*[-–|]\s*Hentai\.Yoga$/i, "").trim();
      }
      const ogDesc = $('meta[property="og:description"]').attr("content") ?? "";
      if (ogDesc) synopsis = ogDesc;
      // Keywords as genres
      const kw = $('meta[name="keywords"]').attr("content") ?? "";
      kw.split(",").map(k => k.trim()).filter(k => k && !["hentai","uncensored hentai","hentai porn","free hentai","hentai videos"].includes(k.toLowerCase())).forEach(k => genres.push(k));
    } catch {
      // Use derived values if embed fails
    }

    return {
      id:            slug,
      title,
      author:        "",
      artist:        "",
      synopsis,
      altTitles:     [],
      status:        "Completed",
      type:          "Anime",
      isNsfw:        true,
      rating:        0,
      thumbnail:     thumbUrl(slug),
      genres,
      score:         "",
      scorePosition: "none",
    };
  },

  async chapters(slug: string): Promise<ChapterListResponse> {
    return {
      items: [
        {
          id:         slug,
          number:     1,
          title:      "Full Video",
          scanlator:  "Hentai Yoga",
          date:       Math.floor(Date.now() / 1000),
        },
      ],
    };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    return {
      chapterId,
      pages: [{ index: 0, url: videoUrl(chapterId) }],
    };
  },
};
