import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://www.royalroad.com";
const SOURCE_ID = "en.royalroad";

function absoluteUrl(value: string, reference: string): string {
  if (!value) return "";
  try {
    return new URL(value, reference).toString();
  } catch {
    return value;
  }
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function parseNumber(value: string, fallback: number): number {
  const match = value.match(/\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : fallback;
  return Number.isFinite(number) ? number : fallback;
}

function fictionId(id: string): string {
  const decoded = id.startsWith("fiction:") ? decodeURIComponent(id.slice("fiction:".length)) : id;
  const match = decoded.match(/^(\d+)(?::.*)?$/);
  if (!match) throw new Error(`Royal Road: invalid fiction ID ${id}`);
  return match[1];
}

function fictionPath(id: string): string {
  const decoded = id.startsWith("fiction:") ? decodeURIComponent(id.slice("fiction:".length)) : id;
  const [number, slug] = decoded.split(":", 2);
  if (!/^\d+$/.test(number)) throw new Error(`Royal Road: invalid fiction ID ${id}`);
  return slug ? `/fiction/${encodeURIComponent(number)}/${encodeURIComponent(slug)}` : `/fiction/${encodeURIComponent(number)}`;
}

function chapterPath(id: string): string {
  if (!id.startsWith("chapter:")) throw new Error(`Royal Road: invalid chapter ID ${id}`);
  return decodeURIComponent(id.slice("chapter:".length));
}

async function fetchDocument(pathOrUrl: string): Promise<{ document: Document; url: string }> {
  const url = new URL(pathOrUrl, BASE).toString();
  const response = await clientFetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new Error(`Royal Road: HTTP ${response.status}`);
  const html = await response.text();
  return { document: new DOMParser().parseFromString(html, "text/html"), url };
}

function parseListing(document: Document, page: number): ClientListResponse {
  const seen = new Set<string>();
  const items: ClientListResponse["items"] = [];
  document.querySelectorAll("a[href^='/fiction/']").forEach(anchor => {
    const href = anchor.getAttribute("href") ?? "";
    if (!/^\/fiction\/\d+\/[^/?#]+(?:\?|$)/.test(href) || /\/chapter\//.test(href)) return;
    const match = href.match(/^\/fiction\/(\d+)\/([^/?#]+)/);
    const title = clean(anchor.textContent);
    if (!match || title.length < 2 || seen.has(match[1])) return;
    seen.add(match[1]);
    const card = anchor.closest(".fiction-list-item, .row, article, .fiction-card");
    const image = card?.querySelector("img");
    const thumbnail = image?.getAttribute("src") ?? "";
    items.push({
      id: `fiction:${encodeURIComponent(`${match[1]}:${match[2]}`)}`,
      title,
      thumbnail: absoluteUrl(thumbnail, BASE),
      type: "Novel",
      isNsfw: false,
      mediaType: "novel",
    });
  });
  return { items: items.slice(0, 30), page, hasNextPage: true };
}

async function listing(path: string, page: number): Promise<ClientListResponse> {
  const { document } = await fetchDocument(path);
  return parseListing(document, page);
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page) {
    return listing(`/fictions/best-rated?page=${Math.max(1, page)}`, page);
  },

  latest(page) {
    return listing(`/fictions/latest-updates?page=${Math.max(1, page)}`, page);
  },

  search(query, page) {
    return listing(`/fictions/search?title=${encodeURIComponent(query.trim())}&page=${Math.max(1, page)}`, page);
  },

  async details(id, options): Promise<ClientMangaDetail> {
    const { document, url } = await fetchDocument(fictionPath(id));
    const genres = Array.from(document.querySelectorAll("a[href*='tagsAdd='], a[href*='genre=']"))
      .map(element => clean(element.textContent)).filter(Boolean);
    return {
      id,
      title: clean(document.querySelector("h1")?.textContent) || id,
      author: clean(document.querySelector(".fiction-title a[href^='/profile/'], a[href^='/profile/']")?.textContent),
      artist: "",
      synopsis: clean(document.querySelector(".description")?.textContent),
      altTitles: [],
      status: clean(document.querySelector(".fiction-status")?.textContent),
      type: "Novel",
      isNsfw: false,
      rating: 0,
      thumbnail: absoluteUrl(document.querySelector("img.thumbnail[data-type='cover'], img.thumbnail")?.getAttribute("src") ?? "", url),
      genres,
      score: "",
      scorePosition: options?.scorePosition ?? "none",
      sourceTags: genres.map(name => ({ id: name.toLowerCase(), name, group: "Genre" })),
      mediaType: "novel",
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const { document } = await fetchDocument(fictionPath(id));
    const items: ClientChapterResponse["items"] = [];
    document.querySelectorAll("tr.chapter-row").forEach(row => {
      const href = row.getAttribute("data-url") ?? row.querySelector("a")?.getAttribute("href") ?? "";
      const title = clean(row.querySelector("td")?.textContent);
      if (!href) return;
      const chapterId = `chapter:${encodeURIComponent(href)}`;
      items.push({
        id: chapterId,
        number: parseNumber(title, items.length + 1),
        title: title || `Chapter ${items.length + 1}`,
        scanlator: "Royal Road",
        date: 0,
      });
    });
    return { items };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const { document } = await fetchDocument(chapterPath(chapterId));
    const title = clean(document.querySelector("h1")?.textContent) || "Chapter";
    const root = document.querySelector(".chapter-inner, .chapter-content, .chapter-content-container");
    if (!root) throw new Error("Royal Road: chapter content was not found");
    const content = root.cloneNode(true) as Element;
    content.querySelectorAll("script, style, .ad, .ads, .chapter-footer").forEach(element => element.remove());
    const text = content.innerHTML.trim();
    if (!text) throw new Error("Royal Road: chapter content was not found");
    return { chapterId, pages: [{ index: 0, url: "", text, title }] };
  },
};

export default adapter;
