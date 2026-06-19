import * as cheerio from "cheerio";
import type {
  MangaSource, ListOptions, MangaListResponse, MangaDetail,
  DetailOptions, ChapterListResponse, PageListResponse, MangaSummary, SourceTag,
} from "./types";
import { makeHttp } from "./scraper-utils";

const BASE   = "https://www.webtoons.com";
const MOBILE = "https://m.webtoons.com";
const CDN    = "https://webtoon-phinf.pstatic.net";

const web    = makeHttp(BASE,   { Referer: `${BASE}/` });
const mobile = makeHttp(MOBILE, { Referer: `${MOBILE}/` });

// ── ID encoding ────────────────────────────────────────────────────────────
// Manga ID: "/en/action/corporate-punch/list?title_no=10337"  (the URL path)
// Chapter ID: "/en/action/corporate-punch/episode-1/viewer?title_no=10337&episode_no=1"

function titleNoFrom(id: string): string | null {
  return new URLSearchParams(id.split("?")[1] ?? "").get("title_no");
}

function typeFrom(id: string): string {
  const segs = id.split("/").filter(Boolean);
  // "/en/canvas/..." → canvas, else webtoon
  return segs[1] === "canvas" ? "canvas" : "webtoon";
}

// ── Helpers ────────────────────────────────────────────────────────────────
function parseComicCards($: ReturnType<typeof cheerio.load>): MangaSummary[] {
  const items: MangaSummary[] = [];
  const seen = new Set<string>();

  $(".webtoon_list li a, ul.lst_type1 li a, ul.list_type1 li a").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href.includes("title_no=")) return;
    const id = href.replace(BASE, "");
    if (seen.has(id)) return;
    seen.add(id);

    const title = ($(el).find(".title, .subj").first().text().trim()) || "";
    if (!title) return;
    const img = $(el).find("img").first();
    const thumbnail = img.attr("src") ?? img.attr("data-src") ?? "";

    items.push({ id, title, thumbnail, type: "manga", isNsfw: false });
  });
  return items;
}

const DAY_MAP: Record<number, string> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

let cachedTags: SourceTag[] | null = null;

// ── Source ─────────────────────────────────────────────────────────────────
export const WebtoonsSource: MangaSource = {
  id:           "all.webtoons",
  name:         "Webtoons",
  lang:         "en",
  isNsfw:       false,
  imageReferer: `${BASE}/`,

  async popular(opts: ListOptions): Promise<MangaListResponse> {
    // Webtoons has 4 ranking pages; cycle through them as "pages"
    const rankings = ["trending", "popular", "originals", "canvas"];
    const rankIdx  = ((opts.page - 1) % rankings.length);
    const ranking  = rankings[rankIdx];
    const res = await web.get(`/en/ranking/${ranking}`, {
      headers: { Cookie: "ageGatePass=true; locale=en; needGDPR=false" },
    });
    const $ = cheerio.load(res.data as string);
    const items = parseComicCards($);
    return { items, page: opts.page, hasNextPage: opts.page < 4 };
  },

  async latest(opts: ListOptions): Promise<MangaListResponse> {
    const day = DAY_MAP[new Date().getDay()];
    const res = await web.get(`/en/originals/${day}`, {
      params:  { sortOrder: "UPDATE" },
      headers: { Cookie: "ageGatePass=true; locale=en; needGDPR=false" },
    });
    const $ = cheerio.load(res.data as string);
    const items = parseComicCards($);
    return { items, page: 1, hasNextPage: false };
  },

  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    const res = await web.get(`/en/search/webtoon`, {
      params:  { keyword: query, page: opts.page },
      headers: { Cookie: "ageGatePass=true; locale=en; needGDPR=false" },
    });
    const $ = cheerio.load(res.data as string);
    const items = parseComicCards($);
    const hasNextPage = $("a.pagination[aria-current=true] + a").length > 0
      || $(".paginate .btn_next").length > 0;
    return { items, page: opts.page, hasNextPage };
  },

  async details(mangaId: string, opts: DetailOptions): Promise<MangaDetail> {
    const url = mangaId.startsWith("http") ? mangaId : `${BASE}${mangaId}`;
    const res = await web.get(url, {
      headers: { Cookie: "ageGatePass=true; locale=en; needGDPR=false" },
    });
    const $ = cheerio.load(res.data as string);

    const title    = $("h1.subj, .detail_header h1").first().text().trim() || mangaId;
    const synopsis = $("p.summary, .detail_header .summary").first().text().trim();
    const thumbnail =
      $("head meta[property='og:image']").attr("content") ??
      $(".detail_header .thmb img").attr("src") ?? "";
    const author  = $(".author_area .author:first-of-type").text().trim() ||
                    $(".author_area").text().replace(/,.*/, "").trim();
    const genres  = $(".genre").map((_i, el) => $(el).text().trim()).get();
    const statusTxt = $(".day_info").text();
    const status  = statusTxt.includes("END") || statusTxt.includes("COMPLETED")
                  ? "Completed" : "Ongoing";
    const type    = typeFrom(mangaId) === "canvas" ? "canvas" : "manga";

    return {
      id:            mangaId,
      title,
      author,
      artist:        author,
      synopsis,
      altTitles:     [],
      status,
      type,
      isNsfw:        false,
      rating:        0,
      thumbnail,
      genres,
      score:         "",
      scorePosition: opts.score,
      sourceTags:    genres.map(g => ({ id: g.toLowerCase().replace(/\s+/g, "-"), name: g, group: "Genre" })),
    };
  },

  async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const titleNo = titleNoFrom(mangaId);
    if (!titleNo) throw new Error(`Webtoons: cannot parse title_no from "${mangaId}"`);

    const type = typeFrom(mangaId);
    const res = await mobile.get(`/api/v1/${type}/${titleNo}/episodes`, {
      params:  { pageSize: 99999 },
      headers: { Cookie: "ageGatePass=true; locale=en; needGDPR=false", Referer: `${MOBILE}/` },
    });

    const episodes: Array<{
      episodeNo: number;
      episodeTitle: string;
      viewerLink: string;
      exposureDateMillis: number;
      thumbnail: string;
    }> = res.data?.result?.episodeList ?? [];

    return {
      items: episodes.map((ep, idx) => ({
        id:        ep.viewerLink,
        number:    ep.episodeNo,
        title:     ep.episodeTitle,
        scanlator: "",
        date:      Math.floor((ep.exposureDateMillis ?? 0) / 1000),
      })).reverse(),  // oldest first
    };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    // chapterId is the viewerLink path
    const viewerUrl = chapterId.startsWith("http") ? chapterId : `${BASE}${chapterId}`;
    const res = await web.get(viewerUrl, {
      headers: {
        Cookie:  "ageGatePass=true; locale=en; needGDPR=false",
        Referer: `${BASE}/`,
      },
    });
    const $ = cheerio.load(res.data as string);

    const urls: string[] = [];

    // Primary: direct children of div#_imageList (matches Kotlin Tachiyomi source).
    // Thumbnails/navigation images are nested inside child divs, not direct children.
    // Also filter out images with "thumb_" in path as those are episode nav thumbnails.
    $("#_imageList > img[data-url]").each((_i, el) => {
      const u = $(el).attr("data-url") ?? "";
      if (!u) return;
      // Skip episode navigation thumbnails
      if (u.includes("/thumb_")) return;
      if (!urls.includes(u)) urls.push(u);
    });

    // Fallback: any non-thumb img[data-url] anywhere on the page
    if (urls.length === 0) {
      $("img[data-url]").each((_i, el) => {
        const u = $(el).attr("data-url") ?? "";
        if (!u || u.includes("/thumb_")) return;
        if (u.includes("pstatic.net") && !urls.includes(u)) urls.push(u);
      });
    }

    if (urls.length === 0) {
      throw new Error(`Webtoons: no pages found in viewer for ${chapterId}`);
    }

    return {
      chapterId,
      pages: urls.map((url, i) => ({
        index: i,
        url: `/api/image-proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(BASE + "/")}`,
      })),
    };
  },

  async tags(): Promise<SourceTag[]> {
    if (cachedTags) return cachedTags;
    cachedTags = [
      { id: "romance",      name: "Romance",       group: "Genre" },
      { id: "fantasy",      name: "Fantasy",       group: "Genre" },
      { id: "action",       name: "Action",        group: "Genre" },
      { id: "drama",        name: "Drama",         group: "Genre" },
      { id: "comedy",       name: "Comedy",        group: "Genre" },
      { id: "thriller",     name: "Thriller",      group: "Genre" },
      { id: "horror",       name: "Horror",        group: "Genre" },
      { id: "sf",           name: "Sci-Fi",        group: "Genre" },
      { id: "slice-of-life",name: "Slice of Life", group: "Genre" },
      { id: "supernatural", name: "Supernatural",  group: "Genre" },
    ];
    return cachedTags;
  },
};
