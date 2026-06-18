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
  ChapterSummary,
  PageInfo,
  SourceTag,
} from "./types";
import { makeHttp, fetchHtml, absUrl, imgAttr } from "./scraper-utils";

const BASE_URL = "https://xkcd.com";
const http = makeHttp(BASE_URL);

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse date strings like "2026-1-9" into a Unix timestamp */
function parseXkcdDate(dateStr: string): number {
  if (!dateStr) return Math.floor(Date.now() / 1000);
  const normalized = dateStr.split("-").map((p, i) => (i === 1 || i === 2) ? p.padStart(2, "0") : p).join("-");
  const ts = Date.parse(normalized);
  return isNaN(ts) ? 0 : Math.floor(ts / 1000);
}

// ── Source definition ──────────────────────────────────────────────────────

export const XkcdSource: MangaSource = {
  id: "en.xkcd",
  name: "xkcd",
  lang: "en",
  isNsfw: false,
  imageReferer: `${BASE_URL}/`,

  // ── Browse methods (xkcd is a single "manga") ─────────────────────────
  async popular(_o: ListOptions): Promise<MangaListResponse> {
    // Return a single "manga" entry for the entire xkcd archive
    const summary: MangaSummary = {
      id: "xkcd-main",
      title: "xkcd",
      thumbnail: "https://xkcd.com/s/0b7742.png",  // official xkcd logo
      type: "Comic",
      isNsfw: false,
    };
    return { items: [summary], page: 1, hasNextPage: false };
  },

  async latest(_o: ListOptions): Promise<MangaListResponse> {
    return this.popular(_o);
  },

  async search(_query: string, _o: ListOptions): Promise<MangaListResponse> {
    // xkcd has no search – return empty
    return { items: [], page: 1, hasNextPage: false };
  },

  // ── Tags (none) ─────────────────────────────────────────────────────────
  async tags(): Promise<SourceTag[]> {
    return [];
  },

  // ── Manga details (static) ──────────────────────────────────────────────
  async details(_id: string, _opts: DetailOptions): Promise<MangaDetail> {
    return {
      id: "xkcd-main",
      title: "xkcd",
      author: "Randall Munroe",
      artist: "Randall Munroe",
      synopsis: "A webcomic of romance, sarcasm, math and language.",
      altTitles: [],
      status: "Ongoing",
      type: "Comic",
      isNsfw: false,
      rating: 0,
      thumbnail: "https://xkcd.com/s/0b7742.png",
      genres: [],
      score: "",
      scorePosition: "none",
    };
  },

  // ── Chapters (all comics, newest first) ──────────────────────────────────
  async chapters(_mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const { $ } = await fetchHtml(http, `${BASE_URL}/archive/`);

    const chapters: ChapterSummary[] = [];

    $("#middleContainer > a").each((_i, el) => {
      const $a = $(el);
      const href = $a.attr("href") || "";
      const comicNumber = parseInt(href.replace(/\//g, ""), 10);
      if (isNaN(comicNumber)) return;

      const title = $a.text().trim();
      const dateAttr = $a.attr("title") || "";
      const date = parseXkcdDate(dateAttr);

      chapters.push({
        id: `xkcd-${comicNumber}`,               // clean ID, e.g. "xkcd-295"
        number: comicNumber,
        title: `${comicNumber}: ${title}`,
        scanlator: "xkcd",
        date,
      });
    });

    // Newest first (original order on page is oldest first)
    chapters.reverse();

    return { items: chapters };
  },

  // ── Pages (single image per comic) ──────────────────────────────────────
  async pages(chapterId: string): Promise<PageListResponse> {
    // chapterId is "xkcd-XXXX"
    const comicNumber = chapterId.replace("xkcd-", "");
    const comicUrl = `${BASE_URL}/${comicNumber}/`;

    const { $ } = await fetchHtml(http, comicUrl);

    const $img = $("#comic > img");
    if ($img.length === 0) {
      throw new Error("Image not found – comic may be interactive or unavailable");
    }

    // Prefer HD image from srcset, otherwise use src
    let imageUrl = "";
    const srcset = $img.attr("srcset");
    if (srcset) {
      // Take the first candidate (largest usually)
      imageUrl = absUrl(BASE_URL, srcset.split(",")[0].trim().split(" ")[0]);
    }
    if (!imageUrl) {
      imageUrl = absUrl(BASE_URL, imgAttr($img));
    }

    // Alt text (tooltip) – can be returned as an extra page, but here we'll just include it in a custom field
    // (the reader currently only uses `url`, so we ignore title for now)
    return {
      chapterId,
      pages: [{ index: 0, url: imageUrl }],
    };
  },
};
