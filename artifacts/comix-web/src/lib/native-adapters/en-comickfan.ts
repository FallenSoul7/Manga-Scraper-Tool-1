import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://comickfan.com";
const SOURCE_ID = "en.comickfan";

function absoluteUrl(value: string, reference = BASE): string {
  if (!value) return "";
  let cleaned = value.replace(/\\/g, "").trim();
  if (!cleaned || cleaned.startsWith("data:")) return "";
  try {
    const url = new URL(cleaned, reference);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

async function fetchDocument(path: string): Promise<{ document: Document; url: string }> {
  const url = new URL(path, BASE).toString();
  const response = await clientFetch(url, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new Error(`ComicKFan HTML request failed: HTTP ${response.status}`);
  const html = await response.text();
  return { document: new DOMParser().parseFromString(html, "text/html"), url };
}

async function fetchJson<T>(path: string, refererPath?: string): Promise<T> {
  const url = new URL(path, BASE).toString();
  const response = await clientFetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(refererPath ? { Referer: new URL(refererPath, BASE).toString() } : {}),
    },
  });
  if (!response.ok) throw new Error(`ComicKFan JSON request failed: HTTP ${response.status}`);
  return await response.json() as T;
}

function imageUrl(image: Element | null, reference: string): string {
  if (!image) return "";
  const raw = ["src", "data-src", "data-original", "data-lazy-src", "srcset"]
    .map(attribute => image.getAttribute(attribute) ?? "")
    .find(value => value && !value.startsWith("data:") && !/logo\.png|placeholder|transparent|blank/i.test(value)) ?? "";
  const selected = raw.includes(",") ? raw.split(",").at(-1)?.trim().split(/\s+/)[0] ?? "" : raw.split(/\s+/)[0];
  return absoluteUrl(selected, reference);
}

function parseGrid(document: Document, reference: string): ClientListResponse["items"] {
  const items: ClientListResponse["items"] = [];
  const seen = new Set<string>();
  document.querySelectorAll("div:has(> form) + div.grid > a").forEach(anchor => {
    const href = anchor.getAttribute("href") ?? "";
    const match = href.match(/\/manga\/([a-z0-9][a-z0-9_-]*)(?:[/?#]|$)/i);
    const id = match?.[1] ?? "";
    const img = anchor.querySelector("img");
    const title = (img?.getAttribute("alt") || img?.getAttribute("title") || "").trim();
    const thumbnail = imageUrl(img, reference);
    if (!id || seen.has(id) || !title || !thumbnail) return;
    seen.add(id);
    items.push({ id, title, thumbnail, type: "manga", isNsfw: false });
  });
  return items;
}

function hasNext(document: Document): boolean {
  return Boolean(document.querySelector("a:has(img[alt='Next']), a:has(img[alt=Next])"));
}

async function list(kind: "popular" | "latest" | "search", page: number, query = ""): Promise<ClientListResponse> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (kind === "latest") params.set("sort", "latest");
  else if (kind === "popular") params.set("sort", "rating");
  if (kind === "search" && query) params.set("name", query);
  const { document, url } = await fetchDocument(`/advanced-search?${params.toString()}`);
  return { items: parseGrid(document, url), page, hasNextPage: hasNext(document) };
}

function getValue(document: Document, label: string): string {
  for (const row of Array.from(document.querySelectorAll("div.flex-row.gap-4"))) {
    const cells = row.querySelectorAll(":scope > div");
    if (cells[0]?.textContent?.trim() === label) {
      const value = cells[1]?.textContent?.trim() ?? "";
      return value !== "-" && value !== "_" ? value : "";
    }
  }
  return "";
}

function encodeChapterId(slug: string, chapter: string, hashId: string): string {
  return [slug, chapter, hashId].map(encodeURIComponent).join("~");
}

function decodeChapterId(id: string): { slug: string; chapter: string; hashId: string } | null {
  const parts = id.split("~");
  if (parts.length !== 3) return null;
  try {
    const [slug, chapter, hashId] = parts.map(decodeURIComponent);
    return slug && chapter && hashId ? { slug, chapter, hashId } : null;
  } catch {
    return null;
  }
}

interface CfChapter { hash_id: string; chapter: string; title?: string | null; group_names?: string[]; published_at?: string | null; created_at?: string | null }

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page) { return list("popular", page); },
  latest(page) { return list("latest", page); },
  search(query, page) { return list("search", page, query); },

  async details(id, options): Promise<ClientMangaDetail> {
    const { document, url } = await fetchDocument(`/manga/${encodeURIComponent(id)}`);
    const title = document.querySelector("h1")?.textContent?.trim() || id;
    const synopsis = document.querySelector("div.comic-content.desk")?.textContent?.trim() || "";
    const thumbnail = absoluteUrl(
      document.querySelector("div.thumb-cover img")?.getAttribute("src") ||
      document.querySelector("meta[property='og:image']")?.getAttribute("content") || "",
      url,
    );
    const sourceTags: Array<{ id: string; name: string; group: string }> = [];
    document.querySelectorAll("div.font-medium").forEach(label => {
      if (label.textContent?.trim() !== "Genres") return;
      label.nextElementSibling?.querySelectorAll("a").forEach(anchor => {
        const name = anchor.textContent?.trim() ?? "";
        const href = anchor.getAttribute("href") ?? "";
        const tagId = (href.split("/manga-list/")[1] ?? "").replace(/[/?#].*$/, "");
        if (name && tagId) sourceTags.push({ id: tagId, name, group: "Genre" });
      });
    });
    const genres = Array.from(new Set(sourceTags.map(tag => tag.name)));
    const statusRaw = getValue(document, "Status").toLowerCase();
    const typeRaw = getValue(document, "Type").toLowerCase();
    return {
      id, title, author: getValue(document, "Author") || "_", artist: getValue(document, "Artist"), synopsis,
      altTitles: [], status: statusRaw === "ongoing" ? "Ongoing" : statusRaw === "completed" ? "Completed" : statusRaw === "hiatus" ? "Hiatus" : "Unknown",
      type: typeRaw.includes("manhwa") || typeRaw === "kr" ? "manhwa" : typeRaw.includes("manhua") || typeRaw === "cn" ? "manhua" : "manga",
      isNsfw: false, rating: 0, thumbnail, genres, score: "", scorePosition: options?.scorePosition ?? "none", sourceTags,
    };
  },

  async chapters(slug): Promise<ClientChapterResponse> {
    const data = await fetchJson<{ data?: CfChapter[] }>(`/api/comics/${encodeURIComponent(slug)}/chapter-list?translation_group_id=`, `/manga/${slug}`);
    const byChapter = new Map<string, CfChapter>();
    for (const chapter of data.data ?? []) if (!byChapter.has(chapter.chapter ?? "0")) byChapter.set(chapter.chapter ?? "0", chapter);
    return { items: Array.from(byChapter.values()).map(chapter => {
      const chapterNumber = chapter.chapter ?? "0";
      const dateValue = chapter.published_at ?? chapter.created_at ?? "";
      return { id: encodeChapterId(slug, chapterNumber, chapter.hash_id), number: Number.parseFloat(chapterNumber) || 0, title: `Chapter ${chapterNumber.replace(/\.0$/, "")}${chapter.title?.trim() ? `: ${chapter.title.trim()}` : ""}`, scanlator: chapter.group_names?.filter(Boolean).join(", ") || "Unknown", date: dateValue ? Math.floor(new Date(dateValue).getTime() / 1000) : 0 };
    }) };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const decoded = decodeChapterId(String(chapterId));
    if (!decoded) throw new Error(`ComicKFan: invalid chapter ID "${chapterId}"`);
    const { slug, chapter, hashId } = decoded;
    const { document, url } = await fetchDocument(`/manga/${encodeURIComponent(slug)}/chapter-${encodeURIComponent(chapter)}-${encodeURIComponent(hashId)}`);
    const pageUrls: string[] = [];
    const nextData = document.querySelector("#__NEXT_DATA__")?.textContent;
    if (nextData) {
      try {
        const parsed = JSON.parse(nextData);
        const target = parsed.props?.pageProps?.chapter ?? parsed.props?.pageProps?.data;
        const images = target?.images ?? parsed.props?.pageProps?.images ?? target?.body?.images;
        if (Array.isArray(images)) for (const image of images) {
          const value = typeof image === "string" ? image : image?.url ?? image?.path ?? image?.src ?? "";
          const direct = absoluteUrl(value, url);
          if (direct && !pageUrls.includes(direct)) pageUrls.push(direct);
        }
      } catch { /* Fall back to image elements. */ }
    }
    if (!pageUrls.length) document.querySelectorAll("div.w-full img, main img, article img, picture img").forEach(image => {
      const raw = image.getAttribute("data-src") || image.getAttribute("src") || image.getAttribute("srcset") || "";
      const selected = raw.includes(",") ? raw.split(",").at(-1)?.trim().split(/\s+/)[0] ?? "" : raw.split(/\s+/)[0];
      const direct = absoluteUrl(selected, url);
      if (direct && !/logo\.png|avatar|thumb-default|thumb-loading/i.test(direct) && !pageUrls.includes(direct)) pageUrls.push(direct);
    });
    if (!pageUrls.length) throw new Error(`ComicKFan: no pages found for ${chapterId}`);
    return { chapterId, pages: pageUrls.map((url, index) => ({ index, url })) };
  },
};

export default adapter;
