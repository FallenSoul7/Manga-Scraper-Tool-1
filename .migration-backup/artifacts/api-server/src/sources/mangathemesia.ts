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

  // Cache scraped tags so we don't hit the site on every filter request.
  let cachedTags: SourceTag[] | null = null;

  function listSelector($: cheerio.CheerioAPI) {
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

  /** Build the URL params for a listing, including genre filters.
   *  Only positive tag IDs are sent (IDs starting with "-" are exclusions
   *  but MangaThemesia doesn't support genre exclusion natively, so skip them). */
  function genreParams(tagIds?: string[]): Record<string, string | string[]> {
    if (!tagIds || tagIds.length === 0) return {};
    const positive = tagIds.filter(id => !id.startsWith("-"));
    if (positive.length === 0) return {};
    return { "genre[]": positive };
  }

  async function fetchList(
    qs: Record<string, string | string[]>,
    page: number,
  ): Promise<MangaListResponse> {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(qs)) {
      if (Array.isArray(v)) { for (const item of v) sp.append(k, item); }
      else sp.set(k, v);
    }
    sp.set("page", String(page));
    const url = `${baseUrl}${dir}/?${sp.toString()}`;
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
      return fetchList({ order: "popular", ...genreParams(o.tagIds) }, o.page);
    },
    async latest(o: ListOptions) {
      return fetchList({ order: "update", ...genreParams(o.tagIds) }, o.page);
    },
    async search(query: string, o: ListOptions) {
      return fetchList({ title: query, ...genreParams(o.tagIds) }, o.page);
    },

    /** Scrape the genre filter list from the directory page. Results are
     *  cached in memory for the lifetime of the process. */
    async tags(): Promise<SourceTag[]> {
      if (cachedTags) return cachedTags;

      try {
        const { $ } = await fetchHtml(http, `${baseUrl}${dir}/`);
        const tags: SourceTag[] = [];
        const seen = new Set<string>();

        // Strategy 1: checkbox inputs inside a genre filter form.
        $('input[name="genre[]"], input[type="checkbox"][value]').each((_i, el) => {
          const $el = $(el);
          const value = $el.attr("value")?.trim();
          if (!value || seen.has(value)) return;
          const label = $el.closest("label").text().trim()
            || $(`label[for="${$el.attr("id")}"]`).text().trim()
            || $el.closest(".genre-item, .checkbox_group").find("label").text().trim()
            || value;
          seen.add(value);
          tags.push({ id: value, name: label || value, group: "Genre" });
        });

        // Strategy 2: genre links in a sidebar / filter section.
        if (tags.length === 0) {
          $("a[href]").each((_i, el) => {
            const $el = $(el);
            const href = $el.attr("href") || "";
            const m = href.match(/[?&]genre(?:\[\])?=([^&]+)/);
            if (!m) return;
            const value = decodeURIComponent(m[1]).trim();
            if (!value || seen.has(value)) return;
            const name = $el.text().trim();
            if (!name || name.length > 40) return;
            seen.add(value);
            tags.push({ id: value, name, group: "Genre" });
          });
        }

        // Strategy 3: dedicated genres/tags page (/genre/, /tags/).
        if (tags.length === 0) {
          for (const path of ["/genre/", "/tags/", "/genres/"]) {
            try {
              const { $ } = await fetchHtml(http, `${baseUrl}${path}`);
              $("a[href]").each((_i, el) => {
                const $el = $(el);
                const href = $el.attr("href") || "";
                if (!href.includes(path.replace(/\//g, ""))) return;
                const m = href.match(new RegExp(`${path}([^/]+)/?$`));
                if (!m) return;
                const value = m[1].trim();
                if (!value || seen.has(value)) return;
                const name = $el.text().trim();
                if (!name || name.length > 40) return;
                seen.add(value);
                tags.push({ id: value, name, group: "Genre" });
              });
              if (tags.length > 0) break;
            } catch {
              // ignore
            }
          }
        }

        cachedTags = tags;
        return tags;
      } catch {
        return [];
      }
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
              if (v) { found = v; return false; }
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
        const name = ($el.find(".chapternum").text() || a.text()).replace(/\s+/g, " ").trim();
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

      // Strategy 1: parse ts_reader.run({...}) with brace-counting so nested
      // objects don't confuse the match (the lazy-regex approach stops at the
      // first inner `}` and JSON.parse always fails).
      const callIdx = html.indexOf("ts_reader.run(");
      if (callIdx >= 0) {
        const start = html.indexOf("{", callIdx);
        if (start >= 0) {
          let depth = 0;
          let end = -1;
          for (let i = start; i < html.length; i++) {
            if (html[i] === "{") depth++;
            else if (html[i] === "}") {
              depth--;
              if (depth === 0) { end = i; break; }
            }
          }
          if (end > start) {
            try {
              const data = JSON.parse(html.slice(start, end + 1));
              const sources: Array<{ images: string[] }> = data.sources ?? [];
              const imgs: string[] = sources[0]?.images ?? [];
              imgs.forEach((src, i) => {
                if (src) pages.push({ index: i, url: absUrl(baseUrl, src) });
              });
            } catch { /* fall through to DOM strategy */ }
          }
        }
      }

      // Strategy 2: images directly in #readerarea DOM (e.g. non-JS themes)
      if (pages.length === 0) {
        $("#readerarea img, div.reader-area img").each((i, el) => {
          const src = imgAttr($(el));
          if (src && !src.includes("/themes/") && !src.includes("404")) {
            pages.push({ index: i, url: absUrl(baseUrl, src) });
          }
        });
      }

      return { chapterId, pages };
    },
  };
}
