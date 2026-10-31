import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://www.resetscans.net";
const LANGUAGE_ROOT = "/en";
const SOURCE_ID = "en.resetscans";
const FALLBACK_THUMBNAIL = `${BASE}/wp-content/uploads/manganex_wallpaper.jpg`;

type FetchDocumentResult = { document: Document; html: string; url: string };

function absoluteUrl(value: string, reference = BASE): string {
  if (!value) return "";
  try {
    return new URL(value, reference).toString();
  } catch {
    return value;
  }
}

function parseDate(text: string): number {
  const timestamp = Date.parse(text.trim());
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function numberFrom(text: string): number {
  const match = text.match(/chapter\s*([\d.]+)/i) ?? text.match(/([\d.]+)/);
  return match ? Number(match[1]) || 0 : 0;
}

function imageAttribute(element: Element | null): string {
  if (!element) return "";
  const values = [
    element.getAttribute("data-url"),
    element.getAttribute("data-src"),
    element.getAttribute("data-original"),
    element.getAttribute("data-lazy-src"),
    element.getAttribute("data-srcset"),
    element.getAttribute("srcset"),
    element.getAttribute("src"),
  ].filter(Boolean) as string[];
  const raw = values.find(value => !value.startsWith("data:") && !/transparent|blank|placeholder/i.test(value)) || "";
  return raw.split(",")[0].trim().split(/\s+/)[0] || "";
}

function backgroundImage(element: Element | null): string {
  if (!element) return "";
  const values = [
    element.getAttribute("data-background-image"),
    element.getAttribute("data-bg"),
    element.getAttribute("data-bg-image"),
    element.getAttribute("data-thumb"),
    element.getAttribute("style"),
  ].filter(Boolean) as string[];

  for (const value of values) {
    const match = value.match(/(?:background-image|background)\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i)
      ?? value.match(/^https?:\/\/.+$/i);
    if (match?.[1] ?? match?.[0]) return (match?.[1] ?? match?.[0]).trim();
  }

  const nested = element.querySelector("[style*='background'], [data-background-image], [data-bg], [data-bg-image], [data-thumb]");
  return nested ? backgroundImage(nested) : "";
}

async function fetchDocument(path: string, init?: RequestInit): Promise<FetchDocumentResult> {
  const url = new URL(path, BASE).toString();
  const response = await clientFetch(url, {
    ...init,
    credentials: "omit",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
  const html = await response.text();
  return { document: new DOMParser().parseFromString(html, "text/html"), html, url };
}

function parseCards(document: Document): ClientListResponse["items"] {
  const items: ClientListResponse["items"] = [];
  const seen = new Set<string>();

  document.querySelectorAll(".series-card, .manga-item, .page-item-detail").forEach(root => {
    const link = root.querySelector("a.series-card-link, a[href*='/manga/']");
    const href = link?.getAttribute("href") ?? "";
    if (!href || !href.includes("/manga/")) return;
    const id = href.replace(BASE, "");
    if (seen.has(id)) return;
    seen.add(id);

    const title = (
      root.querySelector(".series-card-title, .post-title, .item-summary h3, .item-summary h4")?.textContent
      || link?.getAttribute("title")
      || link?.textContent
      || ""
    ).replace(/\s+/g, " ").trim();
    const thumbRoot = root.querySelector(".series-card-thumb, .manga-thumb, .thumb, .series-card-image");
    const thumbnail = absoluteUrl(backgroundImage(thumbRoot) || backgroundImage(root) || imageAttribute(root.querySelector("img")) || FALLBACK_THUMBNAIL);

    items.push({ id, title: title || "Untitled", thumbnail, type: "Manga", isNsfw: false });
  });
  return items;
}

function pageHasLoadMore(document: Document, kind: "series_grid" | "search"): boolean {
  return document.querySelector(kind === "search" ? "#load-more-search" : "#load-more-series-grid") !== null;
}

function getLoadMoreNonce(html: string): string {
  const match = html.match(/var\s+mangaverse_ajax\s*=\s*(\{.*?\});/s);
  if (!match) throw new Error("Reset Scans load-more configuration is missing");
  try {
    const config = JSON.parse(match[1]) as { nonce?: string };
    if (!config.nonce) throw new Error("Reset Scans load-more nonce is missing");
    return config.nonce;
  } catch {
    throw new Error("Reset Scans load-more configuration is invalid");
  }
}

async function postAjax(body: URLSearchParams, referer: string): Promise<{ html: string; hasMore: boolean }> {
  const response = await clientFetch(`${BASE}/wp-admin/admin-ajax.php`, {
    method: "POST",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: referer,
    },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json() as { success?: boolean; data?: { html?: string; has_more?: boolean } };
  if (!result.success || !result.data?.html) throw new Error("Reset Scans load-more request failed");
  return { html: result.data.html, hasMore: result.data.has_more === true };
}

async function fetchSeriesPage(page: number, kind: "series_grid" | "search", query?: string): Promise<ClientListResponse> {
  const path = query ? `${LANGUAGE_ROOT}/?s=${encodeURIComponent(query)}` : `${LANGUAGE_ROOT}/`;
  const firstPage = await fetchDocument(path);
  if (page === 1) return { items: parseCards(firstPage.document), page, hasNextPage: pageHasLoadMore(firstPage.document, kind) };

  const body = new URLSearchParams({
    action: "mangaverse_load_more",
    nonce: getLoadMoreNonce(firstPage.html),
    page: String(page),
    type: kind,
    lang: "en",
    ...(query ? { search_query: query } : {}),
  });
  const result = await postAjax(body, `${BASE}${LANGUAGE_ROOT}/`);
  return { items: parseCards(new DOMParser().parseFromString(result.html, "text/html")), page, hasNextPage: result.hasMore };
}

function chapterPathFromId(id: string): string {
  return id.startsWith("http") ? id : absoluteUrl(id);
}

function parseChapterItems(document: Document, items: ClientListResponse extends never ? never : Array<{ id: number | string; number: number; title: string; scanlator: string; date: number }>, seen: Set<string>): void {
  document.querySelectorAll(".chapters-list .chapter-item, .chapter-list .chapter-item, .wp-manga-chapter, .listing-chapters_wrap li, .chapter-list li, .chapters-list li").forEach(root => {
    const link = root.querySelector("a.chapter-link, a[href*='/chapter/'], a[href]");
    const href = link?.getAttribute("href") ?? "";
    if (!href || (!/chapter/i.test(href) && !/chapter/i.test(link?.textContent ?? ""))) return;
    const id = href.replace(BASE, "");
    if (seen.has(id)) return;
    seen.add(id);
    const title = (root.querySelector(".chapter-title")?.textContent || link?.textContent || "").replace(/\s+/g, " ").trim();
    if (!title) return;
    items.push({ id, number: numberFrom(title), title, scanlator: "Reset Scans", date: parseDate(root.querySelector("time, .chapter-date, .chapter-release-date")?.getAttribute("datetime") || "") });
  });
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page) { return fetchSeriesPage(page, "series_grid"); },
  latest(page) { return fetchSeriesPage(page, "series_grid"); },
  search(query, page) { return fetchSeriesPage(page, "search", query); },

  async details(id, options): Promise<ClientMangaDetail> {
    const { document } = await fetchDocument(id);
    const title = document.querySelector(".series-title, h1.entry-title")?.textContent?.trim() || "Untitled";
    const synopsis = (document.querySelector(".series-description, .entry-content")?.textContent || "").replace(/\s+/g, " ").trim();
    const header = document.querySelector(".series-header-thumbnail, .manga-hero-header, .series-header, .manga-hero, .profile-manga");
    const thumbnail = imageAttribute(document.querySelector(".series-header-thumbnail img, .manga-hero-header img, .profile-manga img")) || backgroundImage(header);
    const genres = Array.from(document.querySelectorAll(".manga-genres a, .genres a, .cat-links a")).map(el => el.textContent?.trim() || "").filter(Boolean);
    return { id, title, author: "", artist: "", synopsis, altTitles: [], status: "Ongoing", type: "Manga", isNsfw: false, rating: 0, thumbnail: absoluteUrl(thumbnail), genres, score: "", scorePosition: options?.scorePosition ?? "none" };
  },

  async chapters(mangaId): Promise<ClientChapterResponse> {
    let firstPage: FetchDocumentResult;
    try {
      firstPage = await fetchDocument(mangaId);
      if (!(firstPage.document.querySelector(".series-title, h1.entry-title")?.textContent?.trim())) firstPage = await fetchDocument(mangaId);
    } catch {
      firstPage = await fetchDocument(mangaId);
    }

    const items: ClientChapterResponse["items"] = [];
    const seen = new Set<string>();
    parseChapterItems(firstPage.document, items, seen);
    const categoryId = firstPage.document.querySelector(".chapters-list")?.getAttribute("data-category")
      || firstPage.html.match(/class=["'][^"']*chapters-list[^"']*["'][^>]*data-category=["']([^"']+)/i)?.[1]
      || firstPage.html.match(/data-category=["']([^"']+)["']/i)?.[1];
    const hasMoreMarker = firstPage.document.querySelector("#load-more-series") !== null || /load-more-series|load_more_chapters/i.test(firstPage.html);
    if (categoryId && (hasMoreMarker || items.length >= 10)) {
      const nonce = getLoadMoreNonce(firstPage.html);
      const order = firstPage.document.querySelector(".series-chapter-order .sort-trigger.active")?.getAttribute("data-sort") || "desc";
      for (let page = 2, hasMore = true; page <= 50 && hasMore; page++) {
        const result = await postAjax(new URLSearchParams({ action: "mangaverse_load_more", nonce, page: String(page), type: "series", category_id: categoryId, order, lang: "en" }), chapterPathFromId(mangaId));
        parseChapterItems(new DOMParser().parseFromString(result.html, "text/html"), items, seen);
        hasMore = result.hasMore;
      }
    }
    return { items };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const { document } = await fetchDocument(chapterPathFromId(chapterId));
    const pages: ClientPageResponse["pages"] = [];
    const seen = new Set<string>();
    document.querySelectorAll(".entry-content img, .chapter-content img, .reading-content img, .wp-block-image img, .page-break img, .chapter-images img").forEach(image => {
      const url = absoluteUrl(imageAttribute(image));
      if (!url || seen.has(url) || url.startsWith("data:")) return;
      seen.add(url);
      pages.push({ index: pages.length, url });
    });
    return { chapterId, pages };
  },
};

export default adapter;
