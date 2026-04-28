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

export interface MangaThemesiaOptions {
  id: string;
  name: string;
  baseUrl: string;
  lang?: string;
  isNsfw?: boolean;
  /** default "/manga" */
  mangaUrlDirectory?: string;
}

function parseStatus(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("ongoing") || t.includes("publishing")) return "Ongoing";
  if (t.includes("completed") || t.includes("finished") || t.includes("end")) return "Completed";
  if (t.includes("hiatus")) return "Hiatus";
  if (t.includes("cancel") || t.includes("dropped")) return "Cancelled";
  return text.trim() || "Unknown";
}

function parseFlexibleDate(text: string): number {
  if (!text) return Date.now();
  const t = text.trim();
  const ts = Date.parse(t);
  if (!Number.isNaN(ts)) return ts;
  return Date.now();
}

export function createMangaThemesiaSource(opts: MangaThemesiaOptions): MangaSource {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const dir = (opts.mangaUrlDirectory || "/manga").replace(/^\/?/, "/");
  const http = makeHttp(baseUrl);

  function listSelector($: cheerio.CheerioAPI) {
    // Match the kotlin selector: ".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx"
    return $(".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx");
  }

  function buildSummary($: cheerio.CheerioAPI, el: any): MangaSummary | null {
    const $el = $(el);
    const a = $el.find("a").first();
    const href = a.attr("href");
    if (!href) return null;
    const title = a.attr("title") || $el.find(".tt").text().trim() || a.text().trim();
    const thumb = imgAttr($el.find("img").first());
    const id = encodeURIComponent(href.replace(baseUrl, "").replace(/^\/+|\/+$/g, ""));
    return {
      id,
      title: (title || "Untitled").trim(),
      thumbnail: absUrl(baseUrl, thumb),
      type: "Manga",
      isNsfw: !!opts.isNsfw,
    };
  }

  async function fetchList(qs: Record<string, string>, page: number): Promise<MangaListResponse> {
    const url = `${baseUrl}${dir}/?${new URLSearchParams({ ...qs, page: String(page) }).toString()}`;
    const { $ } = await fetchHtml(http, url);
    const items: MangaSummary[] = [];
    listSelector($).each((_i, el) => {
      const s = buildSummary($, el);
      if (s) items.push(s);
    });
    const hasNext = $("div.pagination .next, div.hpage .r").length > 0;
    return { items, page, hasNextPage: hasNext };
  }

  return {
    id: opts.id,
    name: opts.name,
    lang: opts.lang ?? "en",
    isNsfw: !!opts.isNsfw,
    imageReferer: `${baseUrl}/`,

    async popular(o: ListOptions) {
      return fetchList({ order: "popular" }, o.page);
    },
    async latest(o: ListOptions) {
      return fetchList({ order: "update" }, o.page);
    },
    async search(query: string, o: ListOptions) {
      return fetchList({ title: query }, o.page);
    },

    async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
      const path = decodeURIComponent(id);
      const url = `${baseUrl}/${path}/`;
      const { $ } = await fetchHtml(http, url);
      const root = $("div.bigcontent, div.animefull, div.main-info, div.postbody").first();
      const title = root.find("h1.entry-title").first().text().trim();
      const thumb = imgAttr(root.find(".thumb img, .ts-post-image").first());
      const description = root.find(".desc, .entry-content[itemprop='description']").first().text().trim();
      const altText = root.find(".alternative, .seriestualt, .wd-full:contains(alt) span").first().text();
      const altTitles = altText ? altText.split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [];

      function lookup(labels: string[]): string {
        for (const l of labels) {
          const ll = l.toLowerCase();
          let found = "";
          root.find(".tsinfo .imptdt, .infotable tr, .fmed").each((_i, el) => {
            const $el = $(el);
            const text = $el.text().toLowerCase();
            if (text.includes(ll)) {
              const v = $el.find("i, td:last-child, span").last().text().trim();
              if (v) {
                found = v;
                return false;
              }
            }
            return undefined;
          });
          if (found) return found;
        }
        return "";
      }

      const author = lookup(["author"]);
      const artist = lookup(["artist"]);
      const status = parseStatus(lookup(["status"]));
      const genres: string[] = [];
      root.find(".mgen a, .seriestugenre a, .gnr a").each((_i, el) => {
        const t = $(el).text().trim();
        if (t) genres.push(t);
      });

      return {
        id,
        title: title || "Untitled",
        author,
        artist,
        synopsis: description,
        altTitles,
        status,
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
      const url = `${baseUrl}/${path}/`;
      const { $ } = await fetchHtml(http, url);
      const items: ChapterSummary[] = [];
      const seen = new Set<string>();
      $("#chapterlist li, div.eplister li, .clstyle li").each((_i, el) => {
        const $el = $(el);
        const a = $el.find("a").first();
        const href = a.attr("href");
        if (!href || href === "#") return;
        const name = (
          $el.find(".chapternum").text() || a.text()
        )
          .replace(/\s+/g, " ")
          .trim();
        if (!name) return;
        const num = Number((name.match(/chapter\s*([\d.]+)/i) || name.match(/([\d.]+)/) || [])[1]) || 0;
        const dateText = $el.find(".chapterdate").text().trim();
        const id = encodeURIComponent(href.replace(baseUrl, "").replace(/^\/+|\/+$/g, ""));
        if (seen.has(id)) return;
        seen.add(id);
        items.push({
          id,
          number: num,
          title: name,
          scanlator: opts.name,
          date: parseFlexibleDate(dateText),
        });
      });
      return { items };
    },

    async pages(chapterId: string): Promise<PageListResponse> {
      const path = decodeURIComponent(chapterId);
      const url = `${baseUrl}/${path}/`;
      const { $, html } = await fetchHtml(http, url);

      const pages: PageInfo[] = [];

      // Mangathemesia stores the page list inside `ts_reader.run({...})` JSON
      const m = html.match(/ts_reader\.run\((\{[\s\S]+?\})\)/);
      if (m) {
        try {
          const data = JSON.parse(m[1]!);
          const sources = (data.sources as Array<{ images: string[] }>) || [];
          const imgs = sources[0]?.images || [];
          imgs.forEach((src, i) => {
            if (src) pages.push({ index: i, url: absUrl(baseUrl, src) });
          });
        } catch {
          /* fall through */
        }
      }
      if (pages.length === 0) {
        $("#readerarea img, div.reader-area img").each((i, el) => {
          const src = imgAttr($(el));
          if (src) pages.push({ index: i, url: absUrl(baseUrl, src) });
        });
      }
      return { chapterId, pages };
    },
  };
}
