import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://mihentai.com";
const SOURCE_ID = "all.mihentai";
const MANGA_DIR = "/manga";

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
  const candidates = [
    image.getAttribute("data-url"),
    image.getAttribute("data-src"),
    image.getAttribute("data-original"),
    image.getAttribute("data-lazy-src"),
    image.getAttribute("data-srcset"),
    image.getAttribute("srcset"),
    image.getAttribute("src"),
  ].filter(Boolean) as string[];
  const raw = candidates.find(value => !value.startsWith("data:") && !/transparent|blank|placeholder/i.test(value)) || "";
  return raw.split(",")[0].trim().split(/\s+/)[0] || "";
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
    throw new Error("Mihentai is temporarily unavailable or blocking requests. Please check your connection and try again later.");
  }
}

function genreParams(tagIds?: string[]): string {
  if (!tagIds?.length) return "";
  const params = new URLSearchParams();
  for (const id of tagIds.filter(value => !value.startsWith("-"))) params.append("genre[]", id);
  return params.toString();
}

function listSelector(document: Document): Element[] {
  return Array.from(document.querySelectorAll(".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx"));
}

async function fetchList(page: number, query: Record<string, string | string[]>): Promise<ClientListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach(item => params.append(key, item));
    else params.set(key, value);
  }
  params.set("page", String(page));
  const { document } = await fetchDocument(`${MANGA_DIR}/?${params.toString()}`);
  const items: ClientListResponse["items"] = [];
  for (const element of listSelector(document)) {
    const anchor = element.matches("a") ? element : element.querySelector("a");
    const href = anchor?.getAttribute("href") ?? "";
    if (!href) continue;
    const title = anchor?.getAttribute("title") || element.querySelector(".tt")?.textContent?.trim() || anchor?.textContent?.trim() || "Untitled";
    const thumbnail = absoluteUrl(imageAttribute(element.querySelector("img")), BASE);
    const id = encodeURIComponent(href.replace(BASE, "").replace(/^\/+|\/+$/g, ""));
    items.push({ id, title: title.trim(), thumbnail, type: "Manga", isNsfw: true });
  }
  return {
    items,
    page,
    hasNextPage: Boolean(document.querySelector("div.pagination .next, div.hpage .r")),
  };
}

function detailPath(id: string): string {
  return `/${decodeURIComponent(id).replace(/^\/+|\/+$/g, "")}/`;
}

async function loadDetail(id: string): Promise<{ document: Document; html: string; url: string; root: Element }> {
  const result = await fetchDocument(detailPath(id));
  const root = result.document.querySelector("div.bigcontent, div.animefull, div.main-info, div.postbody") || result.document.body;
  return { ...result, root };
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page): Promise<ClientListResponse> {
    return fetchList(page, { order: "popular" });
  },

  latest(page): Promise<ClientListResponse> {
    return fetchList(page, { order: "update" });
  },

  search(query, page): Promise<ClientListResponse> {
    const params: Record<string, string | string[]> = { title: query };
    const genres = genreParams();
    if (genres) params.genre = genres;
    return fetchList(page, params);
  },

  async details(id, options): Promise<ClientMangaDetail> {
    const { root, url } = await loadDetail(id);
    const lookup = (labels: string[]): string => {
      for (const label of labels) {
        let found = "";
        root.querySelectorAll(".tsinfo .imptdt, .infotable tr, .fmed").forEach(element => {
          if (found || !element.textContent?.toLowerCase().includes(label.toLowerCase())) return;
          const value = element.querySelector("i, td:last-child, span")?.textContent?.trim() || "";
          if (value) found = value;
        });
        if (found) return found;
      }
      return "";
    };

    const altText = root.querySelector(".alternative, .seriestualt, .wd-full:has(*)")?.textContent || "";
    const genres = Array.from(root.querySelectorAll(".mgen a, .seriestugenre a, .gnr a"))
      .map(element => element.textContent?.trim() || "").filter(Boolean);
    return {
      id,
      title: root.querySelector("h1.entry-title")?.textContent?.trim() || "Untitled",
      author: lookup(["author"]),
      artist: lookup(["artist"]),
      synopsis: root.querySelector(".desc, .entry-content[itemprop='description']")?.textContent?.trim() || "",
      altTitles: altText.split(/[,;|]/).map(value => value.trim()).filter(Boolean),
      status: parseStatus(lookup(["status"])),
      type: "Manga",
      isNsfw: true,
      rating: 0,
      thumbnail: absoluteUrl(imageAttribute(root.querySelector(".thumb img, .ts-post-image")), url),
      genres,
      score: "",
      scorePosition: options?.scorePosition ?? "none",
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const { root } = await loadDetail(id);
    const items: ClientChapterResponse["items"] = [];
    const seen = new Set<string>();
    root.querySelectorAll("#chapterlist li, div.eplister li, .clstyle li").forEach(element => {
      const anchor = element.querySelector("a");
      const href = anchor?.getAttribute("href") || "";
      if (!href || href === "#") return;
      const name = (element.querySelector(".chapternum")?.textContent || anchor?.textContent || "").replace(/\s+/g, " ").trim();
      if (!name) return;
      const match = name.match(/chapter\s*([\d.]+)/i) || name.match(/([\d.]+)/);
      const number = Number(match?.[1]) || 0;
      const chapterId = encodeURIComponent(href.replace(BASE, "").replace(/^\/+|\/+$/g, ""));
      if (seen.has(chapterId)) return;
      seen.add(chapterId);
      items.push({
        id: chapterId,
        number,
        title: name,
        scanlator: "Mihentai",
        date: parseFlexibleDate(element.querySelector(".chapterdate")?.textContent?.trim() || ""),
      });
    });
    return { items };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const { document, html } = await fetchDocument(detailPath(chapterId));
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
            const data = JSON.parse(html.slice(start, end + 1)) as { sources?: Array<{ images?: string[] }> };
            (data.sources?.[0]?.images || []).forEach((src, index) => {
              if (src) pages.push({ index, url: absoluteUrl(src) });
            });
          } catch { /* Fall through to the reader DOM. */ }
        }
      }
    }
    if (!pages.length) {
      document.querySelectorAll("#readerarea img, div.reader-area img").forEach((image, index) => {
        const src = imageAttribute(image);
        if (src && !src.includes("/themes/") && !src.includes("404")) pages.push({ index, url: absoluteUrl(src) });
      });
    }
    return { chapterId, pages };
  },
};

export default adapter;
