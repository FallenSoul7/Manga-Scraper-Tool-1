import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://ww2.mangafreak.me";
const SOURCE_ID = "en.mangafreak";

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
  return (
    image.getAttribute("data-src") ||
    image.getAttribute("data-original") ||
    image.getAttribute("src") ||
    ""
  );
}

function routeId(href: string): string {
  return encodeURIComponent(
    href.replace(/^https?:\/\/[^/]+/, "").replace(/^\/+|\/+$/g, ""),
  );
}

function pathFromId(id: string): string {
  return decodeURIComponent(id).replace(/^\/+|\/+$/g, "");
}

async function fetchDocument(pathOrUrl: string): Promise<{ document: Document; url: string }> {
  const url = new URL(pathOrUrl, BASE).toString();
  const response = await clientFetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`MangaFreak: HTTP ${response.status}`);
  const html = await response.text();
  return { document: new DOMParser().parseFromString(html, "text/html"), url };
}

function listItem(
  anchor: Element,
  thumbnail: string,
): ClientListResponse["items"][number] | null {
  const href = anchor.getAttribute("href") || "";
  if (!href) return null;
  return {
    id: routeId(href),
    title: anchor.textContent?.trim() || "Untitled",
    thumbnail: absoluteUrl(thumbnail),
    type: "Manga",
    isNsfw: false,
  };
}

async function popular(page: number, tagIds: string[] = []): Promise<ClientListResponse> {
  const genre = tagIds.find(value => !value.startsWith("-")) || "All";
  const { document } = await fetchDocument(`/Genre/${encodeURIComponent(genre)}/${page}`);
  const items: ClientListResponse["items"] = [];
  document.querySelectorAll("div.ranking_item").forEach(container => {
    const anchor = container.querySelector("a");
    if (!anchor) return;
    const item = listItem(anchor, imageAttribute(container.querySelector("img")));
    if (item) items.push(item);
  });
  return { items, page, hasNextPage: Boolean(document.querySelector("a.next_p")) };
}

async function latest(page: number, tagIds: string[] = []): Promise<ClientListResponse> {
  const genre = tagIds.find(value => !value.startsWith("-"));
  const path = genre ? `/Genre/${encodeURIComponent(genre)}/${page}` : page === 1 ? BASE : `/Latest_Releases/${page}`;
  const { document } = await fetchDocument(path);
  const items: ClientListResponse["items"] = [];
  document.querySelectorAll("div.latest_item, div.latest_releases_item").forEach(container => {
    const isLatestItem = container.classList.contains("latest_item");
    const anchor = container.querySelector(isLatestItem ? "a.name" : "a");
    if (!anchor) return;
    const item = listItem(anchor, imageAttribute(container.querySelector("img")));
    if (!item) return;
    let thumbnail = item.thumbnail;
    try {
      const imageUrl = new URL(thumbnail);
      const segments = imageUrl.pathname.split("/").filter(Boolean);
      if (segments[0] === "mini_images" && segments.length >= 2) {
        thumbnail = `${imageUrl.origin}/manga_images/${segments[1]}.jpg`;
      }
    } catch {
      // Keep the original thumbnail when it is not an absolute URL.
    }
    item.thumbnail = thumbnail;
    items.push(item);
  });
  return { items, page, hasNextPage: Boolean(document.querySelector("a.next_p")) };
}

async function search(query: string, page: number): Promise<ClientListResponse> {
  // The source implementation intentionally does not include page in its search URL.
  const { document } = await fetchDocument(`/Find/${encodeURIComponent(query)}`);
  const items: ClientListResponse["items"] = [];
  document.querySelectorAll("div.manga_search_item, div.mangaka_search_item").forEach(container => {
    const anchor = container.querySelector("h3 a, h5 a");
    if (!anchor) return;
    const item = listItem(anchor, imageAttribute(container.querySelector("img")));
    if (item) items.push(item);
  });
  return { items, page, hasNextPage: false };
}

async function mangafreakTags(): Promise<NonNullable<ClientMangaDetail["sourceTags"]>> {
  const { document } = await fetchDocument("/Genre/All/1");
  const tags: NonNullable<ClientMangaDetail["sourceTags"]> = [];
  const seen = new Set<string>();
  document.querySelectorAll("a[href]").forEach(anchor => {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(/\/Genre\/([^/?#]+)(?:\/|$)/i);
    const name = anchor.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!match || !name || /^all$/i.test(match[1]) || seen.has(match[1])) return;
    seen.add(match[1]);
    tags.push({ id: decodeURIComponent(match[1]), name, group: "Genre" });
  });
  return tags;
}

async function details(
  id: string,
  options?: { scorePosition?: "top" | "bottom" | "none" },
): Promise<ClientMangaDetail> {
  const { document, url } = await fetchDocument(`/${pathFromId(id)}`);
  const data = document.querySelector("div.manga_series_data");
  const title = data?.querySelector("h1, h5")?.textContent?.trim() || "Untitled";
  const thumbnail = imageAttribute(document.querySelector("div.manga_series_image img"));
  let statusRaw = "";
  let author = "";
  let artist = "";
  data?.querySelectorAll(":scope > div").forEach(element => {
    const text = element.textContent?.replace(/\s+/g, " ").trim() || "";
    if (/this is .+ series/i.test(text)) statusRaw = text;
    else if (/^Written By:/i.test(text)) author = text.replace(/^Written By:\s*/i, "");
    else if (/^Illustrated By:/i.test(text)) artist = text.replace(/^Illustrated By:\s*/i, "");
  });
  const status = /on-going|ongoing/i.test(statusRaw)
    ? "Ongoing"
    : /completed/i.test(statusRaw)
      ? "Completed"
      : "Unknown";
  const genres = Array.from(document.querySelectorAll("div.series_sub_genre_list a"))
    .map(element => element.textContent?.trim() || "")
    .filter(Boolean);
  return {
    id,
    title,
    author,
    artist,
    synopsis: document.querySelector("div.manga_series_description p")?.textContent?.trim() || "",
    // Preserve the source's current response mapping, which leaves this field empty.
    altTitles: [],
    status,
    type: "Manga",
    isNsfw: false,
    rating: 0,
    thumbnail: absoluteUrl(thumbnail, url),
    genres,
    score: "",
    scorePosition: options?.scorePosition ?? "none",
    sourceTags: genres.map(name => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name, group: "Genre" })),
  };
}

async function chapters(id: string): Promise<ClientChapterResponse> {
  const { document } = await fetchDocument(`/${pathFromId(id)}`);
  const items: ClientChapterResponse["items"] = [];
  document.querySelectorAll("div.manga_series_list tr").forEach(row => {
    if (!row.querySelector("a")) return;
    const anchor = row.querySelector("a");
    const href = anchor?.getAttribute("href") || "";
    if (!href) return;
    const name = row.querySelector("td:nth-of-type(1)")?.textContent?.trim() || "";
    const numberMatch = name.match(/(\d+(?:\.\d+)?)/);
    const number = numberMatch ? Number(numberMatch[1]) : 0;
    const dateText = row.querySelector("td:nth-of-type(2)")?.textContent?.trim() || "";
    const timestamp = Date.parse(dateText);
    items.push({
      id: routeId(href),
      number,
      title: name,
      scanlator: "Mangafreak",
      date: Number.isNaN(timestamp) ? Date.now() : timestamp,
    });
  });
  return { items: items.reverse() };
}

async function pages(chapterId: string): Promise<ClientPageResponse> {
  const { document } = await fetchDocument(`/${pathFromId(chapterId)}`);
  const pages: ClientPageResponse["pages"] = [];
  document.querySelectorAll("img#gohere[src], img#gohere").forEach(image => {
    const src = imageAttribute(image);
    if (src) pages.push({ index: pages.length, url: absoluteUrl(src) });
  });
  return { chapterId, pages };
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",
  popular,
  latest,
  search,
  tags: mangafreakTags,
  details,
  chapters,
  pages,
};

export default adapter;
