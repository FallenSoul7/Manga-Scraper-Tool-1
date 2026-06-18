import { makeHttp, fetchHtml, imgAttr, absUrl, proxifyImage } from "./scraper-utils";
import type {
  MangaSource,
  ListOptions,
  DetailOptions,
  MangaListResponse,
  MangaDetail,
  ChapterListResponse,
  PageListResponse,
  SourceTag,
  MangaSummary,
} from "./types";

const BASE_URL = "https://asurascans.com";   // ← Current main domain
const http = makeHttp(BASE_URL);

export const AsuraSource: MangaSource = {
  id: "en.asura",
  name: "Asura Scans",
  lang: "en",
  isNsfw: false,
  imageReferer: `${BASE_URL}/`,

  async popular(o: ListOptions) {
    return this.list("/series", o.page);   // adjust path if needed
  },

  async latest(o: ListOptions) {
    return this.list("/series?sort=latest", o.page);
  },

  async search(query: string, o: ListOptions) {
    const { $ } = await fetchHtml(http, `/search?keyword=${encodeURIComponent(query)}&page=${o.page}`);
    return this.parseList($);
  },

  private async list(path: string, page: number) {
    const { $ } = await fetchHtml(http, `${path}?page=${page}`);
    return this.parseList($);
  },

  private parseList($: any): MangaListResponse {
    const items: MangaSummary[] = [];
    $(".manga-item, .series-item, article, .grid > div").each((_: any, el: any) => {
      const $el = $(el);
      const link = $el.find("a").first().attr("href") || "";
      const id = link.split("/").filter(Boolean).pop() || "";
      const title = $el.find("h3, .title, .font-semibold, .manga-title").text().trim();
      let thumb = imgAttr($el.find("img"));
      thumb = absUrl(BASE_URL, thumb);

      if (id && title) {
        items.push({
          id,
          title,
          thumbnail: proxifyImage(thumb, BASE_URL, true),
          type: "Manhwa",
          isNsfw: false,
        });
      }
    });

    const hasNextPage = $(".pagination .next").length > 0 || items.length >= 20;
    return { items, page: 1, hasNextPage };
  },

  // ... (details, chapters, pages functions stay the same as previous message)

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const { $ } = await fetchHtml(http, `/comics/${id}`);  // adjust if path is /series/${id}
    const title = $("h1").first().text().trim();
    let thumbnail = imgAttr($("img.cover, .manga-cover img, .series-cover img"));
    thumbnail = absUrl(BASE_URL, thumbnail);

    const genres: string[] = [];
    $(".genres a, .tags a, .genre").each((_, el) => genres.push($(el).text().trim()));

    return {
      id,
      title: title || "Unknown",
      thumbnail: proxifyImage(thumbnail, BASE_URL, true),
      author: $(".author, .artist").text().trim(),
      artist: "",
      synopsis: $(".description, .summary, .synopsis").text().trim(),
      altTitles: [],
      status: "Ongoing",
      type: "Manhwa",
      isNsfw: false,
      rating: 0,
      genres,
      score: "",
      scorePosition: "none",
    };
  },

  async chapters(mangaId: string): Promise<ChapterListResponse> {
    const { $ } = await fetchHtml(http, `/comics/${mangaId}`);
    const items: any[] = [];

    $("a[href*='chapter'], .chapter-item a, .episode-list a").each((_, el) => {
      const $el = $(el);
      const href = absUrl(BASE_URL, $el.attr("href") || "");
      const text = $el.text().trim();
      const number = parseFloat(text.match(/[\d.]+/)?.[0] || "0");

      if (href) {
        items.push({
          id: href,
          number,
          title: text,
          scanlator: "Asura Scans",
          date: Math.floor(Date.now() / 1000),
        });
      }
    });

    return { items: items.reverse() };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const { $ } = await fetchHtml(http, chapterId);
    const pages: any[] = [];

    $(".reader-area img, .chapter-image img, img[loading='lazy'], .wp-manga-chapter-img").each((_, el) => {
      let url = imgAttr($(el));
      if (url) {
        url = absUrl(BASE_URL, url);
        pages.push({
          index: pages.length,
          url: proxifyImage(url, BASE_URL, true),
        });
      }
    });

    return { chapterId, pages };
  },

  async tags() { return []; },
};
