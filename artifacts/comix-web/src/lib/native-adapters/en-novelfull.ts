import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://novelfull.com";
const SOURCE_ID = "en.novelfull";
const SOURCE_NAME = "NovelFull";
const COVER_FALLBACK = "/public/source-icons/en.novelfull.svg";

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function numberFrom(value: string, fallback: number): number {
  const match = value.match(/\d+(?:\.\d+)?/);
  return Number(match?.[0] ?? fallback) || fallback;
}

function absoluteUrl(value: string, reference: string): string {
  if (!value) return "";
  try {
    return new URL(value, reference).toString();
  } catch {
    return value;
  }
}

function sourcePath(value: string): string {
  try {
    const url = new URL(value, `${BASE}/`);
    return `${url.pathname}${url.search}`.replace(/^\/+|\/+$/g, "");
  } catch {
    return value.replace(BASE, "").replace(/^\/+|\/+$/g, "");
  }
}

function novelPath(id: string): string {
  return `/${decodeURIComponent(id).replace(/^\/+|\/+$/g, "")}`;
}

function imageValue(image: Element | null): string {
  if (!image) return "";
  const raw = image.getAttribute("data-lazy-src")
    || image.getAttribute("data-original")
    || image.getAttribute("data-src")
    || image.getAttribute("data-srcset")
    || image.getAttribute("srcset")
    || image.getAttribute("src")
    || "";
  return raw.split(",").map(value => value.trim().split(/\s+/)[0]).filter(value => value && !value.startsWith("data:") && !/transparent|blank|placeholder/i.test(value))[0] ?? "";
}

function cardImageValue(root: Element): string {
  for (const image of Array.from(root.querySelectorAll("img, picture source"))) {
    const value = imageValue(image);
    if (value) return value;
  }
  return "";
}

function isNovelHref(value: string): boolean {
  if (!value || value === "#" || value.startsWith("javascript:") || value.includes("/chapter/")) return false;
  try {
    const path = new URL(value, BASE).pathname.toLowerCase();
    return !/(?:^|\/)(?:genre|genres|category|categories|tag|tags|author|authors|search|popular|latest|top|ranking)(?:\/|$)/.test(path);
  } catch { return false; }
}

function firstHref(root: Element): string {
  const selectors = [
    "h3 a", ".truyen-title a", ".novel-title a", ".title a", ".book-title a",
    ".book-info h2 a", "h2 a",
  ];
  for (const selector of selectors) {
    const href = root.querySelector(selector)?.getAttribute("href");
    if (href && isNovelHref(href)) return href;
  }
  for (const anchor of Array.from(root.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") || "";
    if (isNovelHref(href)) return href;
  }
  return "";
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

function parseListing(document: Document, page: number): ClientListResponse {
  const items: ClientListResponse["items"] = [];
  const seen = new Set<string>();
  const selector = ".novel-item, .list-novel .row, .list-truyen .row, .archive .row, .row[itemtype*='Book'], .book-item, .novel-list .row, #main .section1 li, table tr, article";
  document.querySelectorAll(selector).forEach(root => {
    if (root.classList.contains("top-item") || root.closest(".list-side")) return;
    const href = firstHref(root);
    const titleElement = root.querySelector("h3, h2, .truyen-title, .novel-title, .title, .book-title, .s-title, .book-info h2");
    const title = clean(titleElement?.textContent || Array.from(root.querySelectorAll("a[href]"))
      .find(anchor => {
        const value = anchor.getAttribute("href") || "";
        return isNovelHref(value);
      })?.textContent || "");
    if (!href || title.length < 2 || /^(action|adventure|action adventure|fantasy|romance|genres?|categories?)$/i.test(title)) return;
    const id = sourcePath(href);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const thumbnail = cardImageValue(root);
    items.push({
      id: encodeURIComponent(id),
      title,
      thumbnail: absoluteUrl(thumbnail, BASE) || COVER_FALLBACK,
      type: "Novel",
      isNsfw: false,
      mediaType: "novel",
    });
  });
  return { items: items.slice(0, 50), page, hasNextPage: true };
}

async function list(path: string, page: number): Promise<ClientListResponse> {
  const { document } = await fetchDocument(path);
  return parseListing(document, page);
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page) {
    return list(`/popular-novel?page=${page}`, page);
  },

  latest(page) {
    return list(`/latest-release-novel?page=${page}`, page);
  },

  search(query, page) {
    return list(`/search?keyword=${encodeURIComponent(query)}&page=${page}`, page);
  },

  async details(id, options): Promise<ClientMangaDetail> {
    const { document, url } = await fetchDocument(novelPath(id));
    const title = clean(document.querySelector("#bookname, .desc h3.title, .novel-title, .book-title, .bookname, h1, [itemprop='name']")?.textContent || "")
      || clean(document.querySelector("meta[property='og:title'], meta[name='title']")?.getAttribute("content") || "")
      || id;
    const descriptionElement = document.querySelector(".intro, .summary, .description, .desc-text, .novel-detail .content, [itemprop='description'], meta[name='description']");
    const synopsis = clean(descriptionElement?.getAttribute("content") || descriptionElement?.textContent || "");
    const author = clean(document.querySelector("#author, .info a[href*='/author/'], .author, [itemprop='author']")?.textContent || "");
    const cover = document.querySelector(".books img, .novel-cover img, .book-cover img, .book-img img, img[itemprop='image'], .cover img");
    const thumbnail = imageValue(cover) || document.querySelector("meta[property='og:image'], meta[name='image']")?.getAttribute("content") || "";
    const genres = Array.from(document.querySelectorAll(".genres a, .genre a, .categories a, a[href*='genre']"))
      .map(element => clean(element.textContent || "")).filter(Boolean);
    const status = clean(document.querySelector(".status, [itemprop='status']")?.textContent || "") || "Unknown";
    return {
      id,
      title,
      author,
      artist: "",
      synopsis,
      altTitles: [],
      status,
      type: "Novel",
      isNsfw: false,
      rating: 0,
      thumbnail: absoluteUrl(thumbnail, url),
      genres,
      score: "",
      scorePosition: options?.scorePosition ?? "none",
      sourceTags: ["Action", "Adventure", "Fantasy", "Romance", "Fan-fic", "System", "Reincarnation", "Game", "Naruto", "Anime", "Movies"]
        .map(name => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name, group: "Genre" })),
      mediaType: "novel",
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const { document } = await fetchDocument(novelPath(id));
    const items: ClientChapterResponse["items"] = [];
    const seen = new Set<string>();
    document.querySelectorAll("#list-chapter a, .list-chapter a, .chapter-list a, .chapters a, ul.chapter-list li a, .row-chapter a, li.post a[href$='.html'], a.chapter")
      .forEach(anchor => {
        const href = anchor.getAttribute("href") || "";
        const title = clean(anchor.textContent || "");
        if (!href || !title) return;
        const chapterId = sourcePath(href);
        if (!chapterId || seen.has(chapterId)) return;
        seen.add(chapterId);
        items.push({ id: encodeURIComponent(chapterId), number: numberFrom(title, items.length + 1), title, scanlator: SOURCE_NAME, date: 0 });
      });
    return { items };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const { document } = await fetchDocument(novelPath(chapterId));
    document.querySelectorAll("iframe, script, style, .ads, .ad, .advertisement, [id*='ad-'], [id*='ads'], [class*='ad-'], [class*='ads-']").forEach(element => element.remove());
    document.querySelectorAll("a[href*='freegames'], a[href*='ads'], a[rel*='sponsored'], [title*='Advertisement'], [aria-label*='Advertisement']")
      .forEach(element => element.closest("div")?.remove());
    const title = clean(document.querySelector("h1, .chapter-title, .chapter-name")?.textContent || "") || "Chapter";
    const candidates = Array.from(document.querySelectorAll(".chapter-content, .chapter-inner, .reading-content, #chapter-content, #htmlContent, .entry-content, .chapter-c, .chr-c, .chapter-detail, .read-content, .content-inner, .content"));
    const root = candidates.find(element => clean(element.textContent || "").length > 40) || candidates[0];
    if (!root) throw new Error(`${SOURCE_NAME}: chapter content was not found`);
    root.querySelectorAll("script, style, iframe, .ads, .ad, .advertisement, .chapter-footer, .social-share, [id*='ad-'], [id*='ads'], [class*='ad-'], [class*='ads-'], [class*='advert']").forEach(element => element.remove());
    root.querySelectorAll("a[href*='freegames'], a[href*='ads'], a[rel*='sponsored'], [title*='Advertisement'], [aria-label*='Advertisement']")
      .forEach(element => element.closest("div")?.remove());
    root.querySelectorAll("div[style*='300px'][style*='250px'], div[style*='iframe']").forEach(element => element.remove());
    root.querySelectorAll("p, div").forEach(element => {
      const text = clean(element.textContent || "");
      if (/ads?\s*(popup|redirect)|advertisement|freegames\.click|report chapter/i.test(text) && !element.querySelector("p")) element.remove();
    });
    const text = root.innerHTML.trim() || clean(root.textContent || "");
    if (!text) throw new Error(`${SOURCE_NAME}: chapter text was empty`);
    return { chapterId, pages: [{ index: 0, url: "", text, title }] };
  },
};

export default adapter;
