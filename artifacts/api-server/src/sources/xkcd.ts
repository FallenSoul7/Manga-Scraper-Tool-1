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
import { absUrl, fetchHtml, imgAttr, makeHttp } from "./scraper-utils";

const BASE_URL = "https://xkcd.com";
const http = makeHttp(BASE_URL);

// ── Helpers ────────────────────────────────────────────────────────────────

// Convert scraper chapter object to ChapterSummary
function scraperChapterToSummary(ch: any): any {
  return {
    id: ch.url,   // use the absolute URL as unique ID
    number: ch.chapter_number,
    title: ch.name,
    scanlator: "xkcd",
    date: ch.date_upload ? new Date(ch.date_upload).getTime() / 1000 : 0,
  };
}

// ── Source definition ──────────────────────────────────────────────────────

export const XkcdSource: MangaSource = {
  id: "en.xkcd",
  name: "xkcd",
  lang: "en",
  isNsfw: false,
  imageReferer: `${BASE_URL}/`,

  // ── Browse methods (minimal — xkcd doesn’t have popular/latest/search) ──
  async popular(o: ListOptions): Promise<MangaListResponse> {
    // Return a static single “manga” entry for xkcd
    const summary: MangaSummary = {
      id: "xkcd-main",
      title: "xkcd",
      thumbnail: "https://xkcd.com/s/0b7742.png",
      type: "Comic",
      isNsfw: false,
    };
    return { items: [summary], page: 1, hasNextPage: false };
  },

  async latest(o: ListOptions): Promise<MangaListResponse> {
    return this.popular(o);   // same as popular
  },

  async search(query: string, o: ListOptions): Promise<MangaListResponse> {
    // xkcd has no search; return empty
    return { items: [], page: 1, hasNextPage: false };
  },

  // ── Tags ─────────────────────────────────────────────────────────────
  async tags(): Promise<SourceTag[]> {
    return [];   // no tags
  },

  // ── Details ───────────────────────────────────────────────────────────
  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    // Since there's only one xkcd, ignore the ID and return static details
    return {
      id: "xkcd-main",
      title: "xkcd",
      author: "Randall Munroe",
      artist: "",
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

  // ── Chapters ─────────────────────────────────────────────────────────
  async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
    const { $ } = await fetchHtml(http, `${BASE_URL}/archive/`);
    const chapters: any[] = [];

    $("#middleContainer > a").each((_, element) => {
      const $el = $(element);
      const relativeUrl = $el.attr("href") || "";
      const comicNumber = parseInt(relativeUrl.replace(/\//g, ""), 10);
      const title = $el.text().trim();
      const date = $el.attr("title") || "";

      if (!isNaN(comicNumber)) {
        chapters.push({
          chapter_number: comicNumber,
          name: `${comicNumber}: ${title}`,
          url: absUrl(BASE_URL, relativeUrl),
          date_upload: date,
        });
      }
    });

    // Newest first (most recent comic first)
    chapters.reverse();

    const items = chapters.map(scraperChapterToSummary);

    return { items };
  },

  // ── Pages ─────────────────────────────────────────────────────────────
  async pages(chapterId: string): Promise<PageListResponse> {
    // chapterId is the comic URL
    const { $ } = await fetchHtml(http, chapterId);
    const $img = $("#comic > img");

    if ($img.length === 0) {
      throw new Error("Image asset not found.");
    }

    const imageUrl = absUrl(BASE_URL, imgAttr($img));
    const altText = $img.attr("title") || "";

    return {
      chapterId,
      pages: [{ index: 0, url: imageUrl, ...(altText ? { title: altText } : {}) }],
    };
  },
};
