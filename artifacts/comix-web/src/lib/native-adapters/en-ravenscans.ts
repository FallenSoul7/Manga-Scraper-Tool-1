import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://ravenscans.org";
const SOURCE_ID = "en.ravenscans";
const SOURCE_NAME = "Raven Scans";
const COVER_FALLBACK = "/public/source-icons/en.ravenscans.png";

function absoluteUrl(value: string, reference = BASE): string {
  if (!value) return "";
  try {
    return new URL(value, reference).toString();
  } catch {
    return value;
  }
}

function imageAttribute(image: Element | null): string {
  if (!image) return "";
  const values = [
    image.getAttribute("data-url"),
    image.getAttribute("data-src"),
    image.getAttribute("data-original"),
    image.getAttribute("data-lazy-src"),
    image.getAttribute("data-srcset"),
    image.getAttribute("srcset"),
    image.getAttribute("src"),
  ].filter(Boolean) as string[];
  const raw = values.find(value => !value.startsWith("data:") && !/transparent|blank|placeholder/i.test(value)) ?? "";
  const candidates = raw.split(",").map(value => value.trim().split(/\s+/)[0]).filter(Boolean);
  return candidates[0] ?? "";
}

function sourcePath(value: string): string {
  try {
    const url = new URL(value, BASE);
    return url.pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return value.replace(BASE, "").replace(/^\/+|\/+$/g, "");
  }
}

function parseStatus(text: string): string {
  const value = text.toLowerCase();
  if (value.includes("ongoing") || value.includes("publishing")) return "Ongoing";
  if (value.includes("completed") || value.includes("finished") || value.includes("end")) return "Completed";
  if (value.includes("hiatus")) return "Hiatus";
  if (value.includes("cancel") || value.includes("dropped")) return "Cancelled";
  return text.trim() || "Unknown";
}

function parseFlexibleDate(text: string): number {
  if (!text) return Date.now();
  const timestamp = Date.parse(text.trim());
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

async function fetchDocument(path: string): Promise<{ document: Document; html: string; url: string }> {
  const url = new URL(path, BASE).toString();
  try {
    const response = await clientFetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    return { document: new DOMParser().parseFromString(html, "text/html"), html, url };
  } catch {
    throw new Error("Raven Scans is temporarily unavailable or blocking requests. Please check your connection and try again.");
  }
}

function listUrl(page: number, order?: string, query?: string): string {
  const params = new URLSearchParams();
  if (order) params.set("order", order);
  if (query) params.set("title", query);
  params.set("page", String(page));
  return `/manga/?${params.toString()}`;
}

async function scrapeList(page: number, order?: string, query?: string): Promise<ClientListResponse> {
  try {
    const { document } = await fetchDocument(listUrl(page, order, query));
    const items: ClientListResponse["items"] = [];
    const seen = new Set<string>();
    document.querySelectorAll(".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx, article, .manga-item, .bsx").forEach(element => {
      const anchor = element.matches("a") ? element : element.querySelector("a[href]");
      const href = anchor?.getAttribute("href") ?? "";
      const path = sourcePath(href);
      if (!path || /^(manga|comics)\/?$/i.test(path)) return;
      const id = encodeURIComponent(path);
      if (seen.has(id)) return;
      const title = anchor?.getAttribute("title")?.trim()
        || element.querySelector(".tt, .title, h2, h3")?.textContent?.trim()
        || anchor?.textContent?.trim();
      if (!title) return;
      seen.add(id);
      const thumbnail = absoluteUrl(imageAttribute(element.querySelector("img, picture source"))) || COVER_FALLBACK;
      items.push({ id, title: title.replace(/\s+/g, " ").trim(), thumbnail, type: "Manga", isNsfw: false });
    });
    return { items, page, hasNextPage: Boolean(document.querySelector("div.pagination .next, div.hpage .r")) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Raven Scans is temporarily")) throw error;
    throw new Error("Raven Scans could not parse this page. Please try again later.");
  }
}

async function detailDocument(id: string): Promise<{ document: Document; url: string }> {
  const path = sourcePath(decodeURIComponent(id));
  if (!path) throw new Error("Raven Scans: invalid manga path");
  return fetchDocument(`/${path}/`);
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page) {
    return scrapeList(page, "popular");
  },

  latest(page) {
    return scrapeList(page, "update");
  },

  search(query, page) {
    return scrapeList(page, undefined, query);
  },

  async details(id, options): Promise<ClientMangaDetail> {
    const { document, url } = await detailDocument(id);
    const root = document.querySelector("div.bigcontent, div.animefull, div.main-info, div.postbody") ?? document;
    const title = root.querySelector("h1.entry-title")?.textContent?.trim() ?? "";
    const thumb = imageAttribute(root.querySelector(".thumb img, .ts-post-image"));
    const synopsis = root.querySelector(".desc, .entry-content[itemprop='description']")?.textContent?.trim() ?? "";
    const altElement = root.querySelector(".alternative, .seriestualt")
      ?? Array.from(root.querySelectorAll(".wd-full")).find(element => element.textContent?.toLowerCase().includes("alt"));
    const altText = altElement?.querySelector("span")?.textContent ?? altElement?.textContent ?? "";
    const altTitles = altText ? altText.split(/[,;|]/).map(value => value.trim()).filter(Boolean) : [];

    function lookup(labels: string[]): string {
      for (const label of labels) {
        let found = "";
        root.querySelectorAll(".tsinfo .imptdt, .infotable tr, .fmed").forEach(element => {
          if (found) return;
          if (!element.textContent?.toLowerCase().includes(label.toLowerCase())) return;
          const values = element.querySelectorAll("i, td:last-child, span");
          found = (values[values.length - 1]?.textContent ?? "").trim();
        });
        if (found) return found;
      }
      return "";
    }

    const genres: string[] = [];
    root.querySelectorAll(".mgen a, .seriestugenre a, .gnr a").forEach(element => {
      const value = element.textContent?.trim() ?? "";
      if (value) genres.push(value);
    });

    return {
      id,
      title: title || "Untitled",
      author: lookup(["author"]),
      artist: lookup(["artist"]),
      synopsis,
      altTitles,
      status: parseStatus(lookup(["status"])),
      type: "Manga",
      isNsfw: false,
      rating: 0,
      thumbnail: absoluteUrl(thumb, url) || COVER_FALLBACK,
      genres,
      score: "",
      scorePosition: options?.scorePosition ?? "none",
    };
  },

  async chapters(mangaId): Promise<ClientChapterResponse> {
    const { document, url } = await detailDocument(mangaId);
    const items: ClientChapterResponse["items"] = [];
    const seen = new Set<string>();
    document.querySelectorAll("#chapterlist li, div.eplister li, .clstyle li").forEach(element => {
      const anchor = element.querySelector("a");
      const href = anchor?.getAttribute("href") ?? "";
      if (!href || href === "#") return;
      const name = (element.querySelector(".chapternum")?.textContent || anchor?.textContent || "").replace(/\s+/g, " ").trim();
      if (!name) return;
      const number = Number((name.match(/chapter\s*([\d.]+)/i) || name.match(/([\d.]+)/) || [])[1]) || 0;
      const path = sourcePath(href);
      if (!path) return;
      const id = encodeURIComponent(path);
      if (seen.has(id)) return;
      seen.add(id);
      items.push({
        id,
        number,
        title: name,
        scanlator: SOURCE_NAME,
        date: parseFlexibleDate(element.querySelector(".chapterdate")?.textContent?.trim() ?? ""),
      });
    });
    void url;
    return { items };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const { document, html } = await fetchDocument(`/${decodeURIComponent(chapterId)}/`);
    const pages: ClientPageResponse["pages"] = [];
    const callIndex = html.indexOf("ts_reader.run(");
    if (callIndex >= 0) {
      const start = html.indexOf("{", callIndex);
      if (start >= 0) {
        let depth = 0;
        let end = -1;
        for (let index = start; index < html.length; index += 1) {
          if (html[index] === "{") depth += 1;
          else if (html[index] === "}") {
            depth -= 1;
            if (depth === 0) { end = index; break; }
          }
        }
        if (end > start) {
          try {
            const data = JSON.parse(html.slice(start, end + 1));
            const images: string[] = data.sources?.[0]?.images ?? [];
            images.forEach((src, index) => {
              if (src) pages.push({ index, url: absoluteUrl(src) });
            });
          } catch { /* Fall through to the DOM reader. */ }
        }
      }
    }
    if (pages.length === 0) {
      document.querySelectorAll("#readerarea img, div.reader-area img").forEach((image, index) => {
        const src = imageAttribute(image);
        if (src && !src.includes("/themes/") && !src.includes("404")) pages.push({ index, url: absoluteUrl(src) });
      });
    }
    return { chapterId, pages };
  },
};

export default adapter;
