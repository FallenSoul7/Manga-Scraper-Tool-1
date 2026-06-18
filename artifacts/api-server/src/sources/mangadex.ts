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

const BASE_URL = "https://asurascans.com";
const http = makeHttp(BASE_URL);

async function parseList($: any, page: number): Promise<MangaListResponse> {
  const items: MangaSummary[] = [];
  $(".manga-item, .series-item, article, .grid > div, .card").each((_: any, el: any) => {
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

  const hasNextPage = $(".pagination .next, .next-page").length > 0 || items.length >= 20;
  return { items, page, hasNextPage };
}

export const MangaDexSource: MangaSource = {   // ← Kept the name so registry works
  id: "en.asura",
  name: "Asura Scans",
  lang: "en",
  isNsfw: false,
  imageReferer: `${BASE_URL}/`,

  async popular(o: ListOptions) {
    const { $ } = await fetchHtml(http, `/series?page=${o.page}`);
    return parseList($, o.page);
  },

  async latest(o: ListOptions) {
    const { $ } = await fetchHtml(http, `/series?sort=latest&page=${o.page}`);
    return parseList($, o.page);
  },

  async search(query: string, o: ListOptions) {
    const { $ } = await fetchHtml(http, `/search?keyword=${encodeURIComponent(query)}&page=${o.page}`);
    return parseList($, o.page);
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const { $ } = await fetchHtml(http, `/comics/${id}`);
    const title = $("h1").first().text().trim() || "Unknown";
    let thumbnail = imgAttr($("img.cover, .manga-cover img, .series-cover img"));
    thumbnail = absUrl(BASE_URL, thumbnail);

    const genres: string[] = [];
    $(".genres a, .tags a, .genre").each((_, el) => genres.push($(el).text().trim()));

    return {
      id,
      title,
      thumbnail: proxifyImage(thumbnail, BASE_URL, true),
      author: $(".author").text().trim(),
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
      const number = parseFloat(text.match(/[\d.]+/)?.[0] || "0") || 0;

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

  async tags(): Promise<SourceTag[]> {
    return [];
  },
};
