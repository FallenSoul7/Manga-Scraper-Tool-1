import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://www.novelhall.com";
const SOURCE_ID = "en.novelhall";
const SOURCE_NAME = "NovelHall";
const COVER_FALLBACK = "/public/source-icons/en.novelhall.svg";

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function absoluteUrl(value: string, reference = BASE): string {
  if (!value) return "";
  try {
    return new URL(value, reference).toString();
  } catch {
    return value;
  }
}

function encodedId(value: string, reference = BASE): string {
  try {
    const url = new URL(value, `${reference}/`);
    return encodeURIComponent(`${url.pathname}${url.search}`.replace(/^\/+|\/+$/g, ""));
  } catch {
    return encodeURIComponent(value.replace(/^\/+|\/+$/g, ""));
  }
}

function decodedPath(id: string): string {
  let value = id;
  try {
    value = decodeURIComponent(id);
  } catch {
    // Keep malformed route input unchanged so the request remains deterministic.
  }
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function imageValue(image: Element | null): string {
  if (!image) return "";
  const raw = image.getAttribute("data-url")
    || image.getAttribute("data-src")
    || image.getAttribute("data-original")
    || image.getAttribute("data-lazy-src")
    || image.getAttribute("data-srcset")
    || image.getAttribute("srcset")
    || image.getAttribute("src")
    || "";
  return raw.split(",").map(value => value.trim().split(/\s+/)[0]).filter(value => value && !value.startsWith("data:") && !/transparent|blank|placeholder/i.test(value))[0] ?? "";
}

async function fetchDocument(path: string): Promise<{ document: Document; url: string }> {
  const url = new URL(path, BASE).toString();
  const response = await clientFetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`${SOURCE_NAME}: HTTP ${response.status}`);
  const html = await response.text();
  return { document: new DOMParser().parseFromString(html, "text/html"), url };
}

function firstNovelHref(root: Element): string {
  const selectors = [
    "h3 a", ".truyen-title a", ".novel-title a", ".title a", ".book-title a",
    ".book-info h2 a", "h2 a",
  ];
  for (const selector of selectors) {
    const href = root.querySelector(selector)?.getAttribute("href") ?? "";
    if (isNovelHref(href)) return href;
  }
  for (const anchor of Array.from(root.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") ?? "";
    if (isNovelHref(href)) return href;
  }
  return "";
}

function isNovelHref(value: string): boolean {
  if (!value || value === "#" || value.startsWith("javascript:") || value.includes("/chapter/")) return false;
  try {
    const path = new URL(value, BASE).pathname.toLowerCase();
    return !/(?:^|\/)(?:genre|genres|category|categories|tag|tags|author|authors|search|popular|latest|top|ranking)(?:\/|$)/.test(path);
  } catch {
    return false;
  }
}

function parseListing(document: Document): ClientListResponse["items"] {
  const items: ClientListResponse["items"] = [];
  const seen = new Set<string>();
  document.querySelectorAll(
    ".novel-item, .list-novel .row, .list-truyen .row, .archive .row, .row[itemtype*='Book'], .book-item, .novel-list .row, .top-item, #main .section1 li, table tr, article",
  ).forEach(root => {
    const href = firstNovelHref(root);
    const titleRoot = root.querySelector("h3, h2, .truyen-title, .novel-title, .title, .book-title, .s-title, .book-info h2");
    const title = clean(titleRoot?.textContent ?? Array.from(root.querySelectorAll("a[href]"))
      .find(anchor => {
        const value = anchor.getAttribute("href") ?? "";
        return isNovelHref(value);
      })?.textContent ?? "");
    if (!href || title.length < 2) return;
    const id = encodedId(href);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const thumbnail = absoluteUrl(imageValue(root.querySelector(".cover img, .book-img img, img"))) || COVER_FALLBACK;
    items.push({ id, title, thumbnail, type: "Novel", isNsfw: false, mediaType: "novel" });
  });
  return items.slice(0, 50);
}

async function list(page: number, query = ""): Promise<ClientListResponse> {
  const path = query
    ? `/index.php?s=so&module=book&keyword=${encodeURIComponent(query)}&page=${page}`
    : `/?page=${page}`;
  const { document } = await fetchDocument(path);
  return { items: parseListing(document), page, hasNextPage: true };
}

function numberFrom(value: string, fallback: number): number {
  return Number(value.match(/\d+(?:\.\d+)?/)?.[0] ?? fallback) || fallback;
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page) {
    return list(page);
  },

  latest(page) {
    return list(page);
  },

  search(query, page) {
    return list(page, query);
  },

  async details(id, options): Promise<ClientMangaDetail> {
    const { document, url } = await fetchDocument(decodedPath(id));
    const title = clean(document.querySelector(
      "#bookname, .desc h3.title, .novel-title, .book-title, .bookname, h1, [itemprop='name']",
    )?.textContent ?? "") || clean(document.querySelector("meta[property='og:title'], meta[name='title']")?.getAttribute("content") ?? "") || id;
    const description = document.querySelector("meta[name='description']")?.getAttribute("content")
      || document.querySelector(".intro, .summary, .description, .desc-text, .novel-detail .content, [itemprop='description']")?.textContent
      || "";
    const author = clean(document.querySelector("#author, .info a[href*='/author/'], .author, [itemprop='author']")?.textContent ?? "");
    const thumbnail = absoluteUrl(imageValue(document.querySelector(".books img, .novel-cover img, .book-cover img, .book-img img, img[itemprop='image'], .cover img"))
      || document.querySelector("meta[property='og:image'], meta[name='image']")?.getAttribute("content") || COVER_FALLBACK, url);
    const genres = Array.from(document.querySelectorAll(".genres a, .genre a, .categories a, a[href*='genre']"))
      .map(element => clean(element.textContent ?? "")).filter(Boolean);
    return {
      id,
      title,
      author,
      artist: "",
      synopsis: clean(description),
      altTitles: [],
      status: clean(document.querySelector(".status, [itemprop='status']")?.textContent ?? "") || "Unknown",
      type: "Novel",
      isNsfw: false,
      rating: 0,
      thumbnail,
      genres,
      score: "",
      scorePosition: options?.scorePosition ?? "none",
      mediaType: "novel",
      sourceTags: genres.map(name => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name, group: "Genre" })),
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const { document } = await fetchDocument(decodedPath(id));
    const items: ClientChapterResponse["items"] = [];
    const seen = new Set<string>();
    document.querySelectorAll("#list-chapter a, .list-chapter a, .chapter-list a, .chapters a, ul.chapter-list li a, .row-chapter a, li.post a[href$='.html'], a.chapter").forEach(anchor => {
      const href = anchor.getAttribute("href") ?? "";
      const title = clean(anchor.textContent ?? "");
      if (!href || !title) return;
      const chapterId = encodedId(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);
      items.push({ id: chapterId, number: numberFrom(title, items.length + 1), title, scanlator: SOURCE_NAME, date: 0 });
    });
    return { items };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const { document } = await fetchDocument(decodedPath(chapterId));
    document.querySelectorAll("iframe, script, style, .ads, .ad, .advertisement, [id*='ad-'], [id*='ads'], [class*='ad-'], [class*='ads-']").forEach(element => element.remove());
    document.querySelectorAll("a[href*='freegames'], a[href*='ads'], a[rel*='sponsored'], [title*='Advertisement'], [aria-label*='Advertisement']").forEach(element => element.closest("div")?.remove());
    const title = clean(document.querySelector("h1, .chapter-title, .chapter-name")?.textContent ?? "") || "Chapter";
    const candidates = Array.from(document.querySelectorAll(".chapter-content, .chapter-inner, .reading-content, #chapter-content, #htmlContent, .entry-content, .chapter-c, .chr-c, .chapter-detail, .read-content, .content-inner, .content"));
    const root = candidates.find(element => clean(element.textContent ?? "").length > 40) ?? candidates[0];
    if (!root) throw new Error(`${SOURCE_NAME}: chapter content was not found`);
    root.querySelectorAll("script, style, iframe, .ads, .ad, .advertisement, .chapter-footer, .social-share, [id*='ad-'], [id*='ads'], [class*='ad-'], [class*='ads-'], [class*='advert']").forEach(element => element.remove());
    root.querySelectorAll("a[href*='freegames'], a[href*='ads'], a[rel*='sponsored'], [title*='Advertisement'], [aria-label*='Advertisement']").forEach(element => element.closest("div")?.remove());
    root.querySelectorAll("div[style*='300px'][style*='250px'], div[style*='iframe']").forEach(element => element.remove());
    const text = root.innerHTML.trim() || clean(root.textContent ?? "");
    if (!text) throw new Error(`${SOURCE_NAME}: chapter text was empty`);
    return { chapterId, pages: [{ index: 0, url: "", text, title }] };
  },
};

export default adapter;
