import type {
  MangaSource,
  ListOptions,
  DetailOptions,
  MangaListResponse,
  MangaDetail,
  ChapterListResponse,
  PageListResponse,
  MangaSummary,
  ChapterSummary,
  PageInfo,
} from "./types";
import { absUrl, fetchHtml, imgAttr, makeHttp } from "./scraper-utils";
import * as cheerio from "cheerio";

export interface MadaraOptions {
  id: string;
  name: string;
  baseUrl: string;
  lang?: string;
  isNsfw?: boolean;
  /** path segment for manga listings, default "manga" */
  mangaSubString?: string;
  /** Use POST /wp-admin/admin-ajax.php "manga_get_chapters" for chapter list */
  useAjaxChapters?: boolean;
  /** path used when search returns nothing on the load-more endpoint */
  filterNonMangaItems?: boolean;
}

const DATE_FMT_RE = /(\d{1,2})[ -](\w+)[ -](\d{4})/;
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseMadaraDate(text: string): number {
  if (!text) return Date.now();
  const t = text.trim();
  // "X days ago" / "X hours ago"
  const rel = t.toLowerCase().match(/(\d+)\s+(day|hour|minute|second|week|month|year)s?\s+ago/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!;
    const ms =
      unit === "second" ? 1000 :
      unit === "minute" ? 60_000 :
      unit === "hour" ? 3_600_000 :
      unit === "day" ? 86_400_000 :
      unit === "week" ? 7 * 86_400_000 :
      unit === "month" ? 30 * 86_400_000 :
      365 * 86_400_000;
    return Date.now() - n * ms;
  }
  const m = t.match(DATE_FMT_RE);
  if (m) {
    const day = Number(m[1]);
    const mon = MONTHS[m[2]!.slice(0, 3).toLowerCase()] ?? 0;
    const year = Number(m[3]);
    return Date.UTC(year, mon, day);
  }
  const ts = Date.parse(t);
  if (!Number.isNaN(ts)) return ts;
  return Date.now();
}

export function createMadaraSource(opts: MadaraOptions): MangaSource {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const mangaSubString = opts.mangaSubString || "manga";
  const http = makeHttp(baseUrl);

  function buildSummary($: cheerio.CheerioAPI, el: any): MangaSummary | null {
    const $el = $(el);
    const link = $el.find("a").first();
    const href = link.attr("href") || "";
    if (!href) return null;
    const id = encodeURIComponent(href.replace(baseUrl, "").replace(/^\/+|\/+$/g, ""));
    const title = (
      link.attr("title") ||
      $el.find(".post-title h3, .post-title h5, h3.h5, h3.h4, h3 a, .h5 a").text() ||
      link.text()
    ).trim();
    const thumb = imgAttr($el.find("img").first());
    return {
      id,
      title: title || "Untitled",
      thumbnail: absUrl(baseUrl, thumb),
      type: "Manga",
      isNsfw: !!opts.isNsfw,
    };
  }

  async function listFromPage(path: string, page: number): Promise<MangaListResponse> {
    // Madara load-more uses POST. We use the standard paginated page URLs which work for most themes.
    const url = `${baseUrl}/${mangaSubString}/${page > 1 ? `page/${page}/` : ""}${path}`;
    const { $ } = await fetchHtml(http, url);
    const sel =
      "div.page-item-detail, .manga__item, .c-tabs-item__content";
    const items: MangaSummary[] = [];
    $(sel).each((_i, el) => {
      const s = buildSummary($, el);
      if (s) items.push(s);
    });
    const hasNext = $(".nav-previous, .wp-pagenavi a.nextpostslink, a.next.page-numbers").length > 0;
    return { items, page, hasNextPage: hasNext };
  }

  async function popularLatest(page: number, kind: "views" | "latest"): Promise<MangaListResponse> {
    return listFromPage(`?m_orderby=${kind}`, page);
  }

  return {
    id: opts.id,
    name: opts.name,
    lang: opts.lang ?? "en",
    isNsfw: !!opts.isNsfw,
    imageReferer: `${baseUrl}/`,

    async popular(o: ListOptions): Promise<MangaListResponse> {
      return popularLatest(o.page, "views");
    },

    async latest(o: ListOptions): Promise<MangaListResponse> {
      return popularLatest(o.page, "latest");
    },

    async search(query: string, o: ListOptions): Promise<MangaListResponse> {
      const url = `${baseUrl}/${o.page > 1 ? `page/${o.page}/` : ""}?s=${encodeURIComponent(query)}&post_type=wp-manga`;
      const { $ } = await fetchHtml(http, url);
      const items: MangaSummary[] = [];
      $("div.c-tabs-item__content, .manga__item, div.row.c-tabs-item__content").each((_i, el) => {
        const s = buildSummary($, el);
        if (s) items.push(s);
      });
      // Fallback: some sites just render listing rows
      if (items.length === 0) {
        $(".tab-thumb a, .tab-summary a").each((_i, el) => {
          const $el = $(el);
          const href = $el.attr("href");
          if (!href) return;
          const id = encodeURIComponent(href.replace(baseUrl, "").replace(/^\/+|\/+$/g, ""));
          items.push({
            id,
            title: ($el.attr("title") || $el.text()).trim(),
            thumbnail: "",
            type: "Manga",
            isNsfw: !!opts.isNsfw,
          });
        });
      }
      const hasNext = $("a.next.page-numbers, .wp-pagenavi a.nextpostslink").length > 0;
      return { items, page: o.page, hasNextPage: hasNext };
    },

    async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
      const path = decodeURIComponent(id);
      const url = `${baseUrl}/${path}/`;
      const { $ } = await fetchHtml(http, url);
      const summary = $(".summary_content, .post-content_item, .tab-summary");
      const title = ($("div.post-title h1, .manga-title h1, h1.entry-title").first().text() || "").trim();
      const thumb = imgAttr($(".summary_image img, .tab-summary .summary_image img").first());

      let author = "";
      let artist = "";
      let status = "";
      const genres: string[] = [];
      const altTitles: string[] = [];

      summary.find(".post-content_item, .summary-heading + .summary-content").each((_i, el) => {
        const $el = $(el);
        const heading = $el.find(".summary-heading h5, .summary-heading h4").text().trim().toLowerCase();
        const content = $el.find(".summary-content").text().trim();
        if (!heading) return;
        if (heading.includes("author")) author = content;
        else if (heading.includes("artist")) artist = content;
        else if (heading.includes("status")) status = content;
        else if (heading.includes("genre")) {
          $el.find(".summary-content a").each((_j, a) => {
            const t = $(a).text().trim();
            if (t) genres.push(t);
          });
        } else if (heading.includes("alt") || heading.includes("alternative")) {
          content.split(/[,;|]/).forEach((t) => {
            const v = t.trim();
            if (v) altTitles.push(v);
          });
        }
      });

      const description =
        $(".description-summary .summary__content, .summary__content, .manga-excerpt, #editdescription")
          .first()
          .text()
          .trim() ||
        $('div[itemprop="description"]').first().text().trim();

      return {
        id,
        title: title || "Untitled",
        author,
        artist,
        synopsis: description,
        altTitles,
        status: status || "Unknown",
        type: "Manga",
        isNsfw: !!opts.isNsfw,
        rating: 0,
        thumbnail: absUrl(baseUrl, thumb),
        genres,
        score: "",
        scorePosition: "none",
      };
    },

    async chapters(mangaId: string, _dedupe: boolean): Promise<ChapterListResponse> {
      const path = decodeURIComponent(mangaId);
      let $: cheerio.CheerioAPI;
      const useAjax = async () => {
        const ajaxUrl = `${baseUrl}/${path}/ajax/chapters/`;
        const res = await http.post(ajaxUrl, "", {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          responseType: "text",
        });
        const body = String(res.data || "");
        if (res.status >= 400 || !body.includes("wp-manga-chapter")) {
          return null;
        }
        return cheerio.load(body);
      };
      try {
        const ajax$ = await useAjax();
        if (ajax$) {
          $ = ajax$;
        } else {
          const r = await fetchHtml(http, `${baseUrl}/${path}/`);
          $ = r.$;
        }
      } catch {
        const r = await fetchHtml(http, `${baseUrl}/${path}/`);
        $ = r.$;
      }

      const items: ChapterSummary[] = [];
      const seen = new Set<string>();
      $("li.wp-manga-chapter").each((_i, el) => {
        const $el = $(el);
        // Find the real chapter anchor — skip overlay/style anchors with href="#"
        let a = $el.find("a").filter((_j, ae) => {
          const h = $(ae).attr("href") || "";
          return !!h && h !== "#" && !h.startsWith("javascript:");
        }).first();
        if (a.length === 0) return;
        const href = a.attr("href") || "";
        if (!/^https?:\/\//.test(href) && !href.startsWith("/")) return;
        const name = (
          $el.find(".li__text, .chapternum").text() || a.text()
        )
          .replace(/\s+/g, " ")
          .trim();
        if (!name) return;
        const numMatch = name.match(/chapter\s*([\d.]+)/i) || name.match(/([\d.]+)/);
        const num = numMatch ? Number(numMatch[1]) : 0;
        const dateText = $el.find(".chapter-release-date, .chapter-date, i").last().text().trim();
        const id = encodeURIComponent(href.replace(baseUrl, "").replace(/^\/+|\/+$/g, ""));
        if (seen.has(id)) return;
        seen.add(id);
        items.push({
          id,
          number: Number.isFinite(num) ? num : 0,
          title: name,
          scanlator: opts.name,
          date: parseMadaraDate(dateText),
        });
      });
      // Already typically sorted newest-first in Madara
      return { items };
    },

    async pages(chapterId: string): Promise<PageListResponse> {
      const path = decodeURIComponent(chapterId);
      const url = `${baseUrl}/${path}/?style=list`;
      const { $ } = await fetchHtml(http, url);
      const pages: PageInfo[] = [];
      const sel = [
        ".reading-content img",
        ".page-break img",
        "li.blocks-gallery-item img",
        ".wp-manga-chapter-img",
        "#chapter_imgs img",
        ".chapter-image img",
        ".read-content img",
        "img.chapter-img",
        ".chapter-single img",
        ".chapter_imgs img",
        "#chapter-imgs img",
        ".comic-page img",
        ".wp-block-image img",
      ].join(", ");
      $(sel).each((i, el) => {
        const src = imgAttr($(el));
        if (src) pages.push({ index: i, url: absUrl(baseUrl, src) });
      });
      return { chapterId, pages };
    },
  };
}
