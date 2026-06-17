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
  SourceTag,
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
  
  // Cache tags per-source instantiation to prevent constant refetching
  let tagCache: SourceTag[] | null = null;

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
    const url = `${baseUrl}/${mangaSubString}/${page > 1 ? `page/${page}/` : ""}${path}`;
    const { $ } = await fetchHtml(http, url);
    const sel = "div.page-item-detail, .manga__item, .c-tabs-item__content, article.rs-manga-library__card";
    const items: MangaSummary[] = [];
    $(sel).each((_i, el) => {
      const s = buildSummary($, el);
      if (s) items.push(s);
    });
    const hasNext = $(
      ".nav-previous, .wp-pagenavi a.nextpostslink, a.next.page-numbers, " +
      "a.rs-manga-library__pagination-next, .rs-manga-library__pagination a[rel='next'], " +
      ".rs-pagination a.next"
    ).length > 0;
    return { items, page, hasNextPage: hasNext };
  }

  // Master fetcher that builds advanced search URLs with search terms, sorting parameters, and tags
  async function fetchAdvancedList(page: number, query: string, sort: string, tagIds?: string[]): Promise<MangaListResponse> {
    const params = new URLSearchParams();
    params.append("s", query);
    params.append("post_type", "wp-manga");
    
    if (sort) {
      params.append("m_orderby", sort);
    }
    
    if (tagIds && tagIds.length > 0) {
      for (const tag of tagIds) {
        // Strip out any accidental prefix if your UI passes them with groups
        const cleanTag = tag.includes(":") ? tag.split(":")[1] : tag;
        params.append("genre[]", cleanTag!);
      }
      params.append("op", "and"); // Ensures results match ALL selected tags
    }

    // WordPress handles queries perfectly using either the 'paged' query param or clean route matching
    const pagePath = page > 1 ? `page/${page}/` : "";
    const url = `${baseUrl}/${pagePath}?${params.toString()}`;
    
    const { $ } = await fetchHtml(http, url);
    const items: MangaSummary[] = [];
    
    const sel = "div.page-item-detail, .manga__item, .c-tabs-item__content, article.rs-manga-library__card, div.row.c-tabs-item__content";
    $(sel).each((_i, el) => {
      const s = buildSummary($, el);
      if (s) items.push(s);
    });
    
    // Fallback parser if standard blocks aren't matching on search layouts
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
    
    const hasNext = $(
      ".nav-previous, .wp-pagenavi a.nextpostslink, a.next.page-numbers, " +
      "a.rs-manga-library__pagination-next, .rs-manga-library__pagination a[rel='next'], " +
      ".rs-pagination a.next"
    ).length > 0;
    
    return { items, page, hasNextPage: hasNext };
  }

  return {
    id: opts.id,
    name: opts.name,
    lang: opts.lang ?? "en",
    isNsfw: !!opts.isNsfw,
    imageReferer: `${baseUrl}/`,

    // Expose standard Madara engine sorting options to your user interface
    popularSorts: [
      { value: "views", label: "Most Viewed" },
      { value: "latest", label: "Latest Update" },
      { value: "alphabet", label: "Alphabetical" },
      { value: "rating", label: "Highest Rated" },
      { value: "trending", label: "Trending" },
      { value: "new-manga", label: "New Additions" },
    ],

    async popular(o: ListOptions): Promise<MangaListResponse> {
      // If advanced filters or a custom sort is picked, route through advanced engine
      if ((o.tagIds && o.tagIds.length > 0) || (o.sort && o.sort !== "views")) {
        return fetchAdvancedList(o.page, "", o.sort || "views", o.tagIds);
      }
      return listFromPage("?m_orderby=views", o.page);
    },

    async latest(o: ListOptions): Promise<MangaListResponse> {
      if ((o.tagIds && o.tagIds.length > 0) || (o.sort && o.sort !== "latest")) {
        return fetchAdvancedList(o.page, "", o.sort || "latest", o.tagIds);
      }
      return listFromPage("?m_orderby=latest", o.page);
    },

    async search(query: string, o: ListOptions): Promise<MangaListResponse> {
      return fetchAdvancedList(o.page, query || "", o.sort || "views", o.tagIds);
    },

    // Dynamic tag scanner: Scrapes genres directly from the site's advanced filter page
    async tags(): Promise<SourceTag[]> {
      if (tagCache) return tagCache;
      
      try {
        const { $ } = await fetchHtml(http, `${baseUrl}/?s=&post_type=wp-manga`);
        const foundTags: SourceTag[] = [];
        const seen = new Set<string>();

        // Target standard Madara advanced form checkboxes
        $("input[name='genre[]']").each((_i, el) => {
          const $el = $(el);
          const id = $el.val() as string;
          if (!id || seen.has(id)) return;
          
          let name = $el.next("label").text().trim();
          if (!name) name = $el.parent().text().trim();
          if (!name) name = id;

          seen.add(id);
          foundTags.push({ id: `genre:${id}`, name, group: "Genre" });
        });

        // Fallback: Parse sidebars or list-widgets if advanced search forms are hidden
        if (foundTags.length === 0) {
          $(".genres__list a, .manga-genres-list a, .wp-manga-genre a, .manga-genre-item a").each((_i, el) => {
            const $el = $(el);
            const href = $el.attr("href") || "";
            const match = href.match(/\/manga-genre\/([^/]+)/);
            const id = match ? match[1] : $el.text().trim().toLowerCase().replace(/\s+/g, "-");
            const name = $el.text().trim();
            
            if (id && name && !seen.has(id)) {
              seen.add(id);
              foundTags.push({ id: `genre:${id}`, name, group: "Genre" });
            }
          });
        }

        tagCache = foundTags.sort((a, b) => a.name.localeCompare(b.name));
        return tagCache;
      } catch (err) {
        console.error(`[${opts.name}] Failed parsing search parameters:`, err);
        return [];
      }
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
      return { items };
    },

    async pages(chapterId: string): Promise<PageListResponse> {
      const path = decodeURIComponent(chapterId);
      const url = `${baseUrl}/${path}/?style=list`;
      const { $, html } = await fetchHtml(http, url);
      const pages: PageInfo[] = [];

      const isPlaceholder = (src: string) =>
        !src ||
        src.includes("/themes/") ||
        src.includes("404") ||
        src.includes("placeholder") ||
        src.includes("loading");

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
        if (src && !isPlaceholder(src)) pages.push({ index: i, url: absUrl(baseUrl, src) });
      });

      if (pages.length === 0) {
        const seen = new Set<string>();
        const imgRe = /https?:\/\/[^\s"'\\]+\.(?:jpe?g|png|webp)(?:[?#][^\s"'\\]*)?/gi;
        let m: RegExpExecArray | null;
        while ((m = imgRe.exec(html)) !== null) {
          const u = m[0];
          if (!isPlaceholder(u) && !seen.has(u)) {
            seen.add(u);
            pages.push({ index: pages.length, url: u });
          }
        }
      }

      return { chapterId, pages };
    },
  };
}
