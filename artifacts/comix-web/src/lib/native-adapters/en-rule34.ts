import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE_URL = "https://rule34.paheal.net";
const SOURCE_ID = "en.rule34";
const PAGE_SIZE = 20;

const META_TAGS = new Set([
  "ai-generated", "animated", "sound", "video", "tagme", "edit", "3d",
  "rule34", "audio", "loop", "fakes", "comic", "crossover", "absurdres",
  "highres", "lowres", "sketch", "monochrome", "censored", "uncensored",
  "english_text", "speech_bubble", "text", "watermark", "signature",
  "artist_request", "character_request", "series_request",
]);

function routeSafePostId(value: string): string {
  const id = value.trim();
  if (!/^\d+$/.test(id)) throw new Error(`Rule34: invalid post ID ${value}`);
  return id;
}

function pickTitle(rawTags: string, id: string): string {
  const meaningful = rawTags.split(/\s+/).find(tag => tag && !META_TAGS.has(tag.toLowerCase()));
  return meaningful ? meaningful.replace(/_/g, " ") : `Post #${id}`;
}

function parseXml(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Rule34: invalid XML response");
  return document;
}

async function fetchXml(path: string): Promise<Document> {
  const url = new URL(path, BASE_URL).toString();
  const response = await clientFetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "text/xml,application/xml,*/*;q=0.8" },
  });
  if (!response.ok) throw new Error(`Rule34: HTTP ${response.status}`);
  return parseXml(await response.text());
}

function postElements(document: Document): Element[] {
  return Array.from(document.querySelectorAll("posts > tag"));
}

function postSummary(element: Element): ClientListResponse["items"][number] {
  const id = routeSafePostId(element.getAttribute("id") ?? "");
  const rawTags = element.getAttribute("tags")?.trim() ?? "";
  return {
    id,
    title: pickTitle(rawTags, id),
    thumbnail: element.getAttribute("preview_url") ?? "",
    type: "Artwork",
    isNsfw: true,
  };
}

async function fetchPosts(tags: string, page: number): Promise<ClientListResponse> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
  if (tags.trim()) params.set("tags", tags.trim());
  const document = await fetchXml(`/api/danbooru/find_posts?${params.toString()}`);
  const items = postElements(document).map(postSummary);
  const total = Number.parseInt(document.documentElement.getAttribute("count") ?? "0", 10) || 0;
  return { items, page, hasNextPage: (page - 1) * PAGE_SIZE + items.length < total };
}

function buildTags(query = "", tagIds: string[] = []): string {
  return [query.trim(), ...tagIds].flatMap(value => value.split(/\s+/)).filter(Boolean).join(" ");
}

async function rule34Tags(): Promise<NonNullable<ClientMangaDetail["sourceTags"]>> {
  const document = await fetchXml("/tags/map?mincount=1");
  const seen = new Set<string>();
  const tags: NonNullable<ClientMangaDetail["sourceTags"]> = [];
  document.querySelectorAll("a[href^='/post/list/']").forEach(anchor => {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(/^\/post\/list\/([^/]+)\/\d+/);
    const name = anchor.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!match || !name || seen.has(match[1])) return;
    seen.add(match[1]);
    tags.push({ id: match[1], name, group: "Tag" });
  });
  return tags;
}

async function fetchPost(id: string): Promise<Element> {
  const safeId = routeSafePostId(id);
  const document = await fetchXml(`/api/danbooru/find_posts?limit=1&tags=${encodeURIComponent(`id=${safeId}`)}`);
  const element = postElements(document)[0];
  if (!element) throw new Error(`Rule34: post ${safeId} not found`);
  return element;
}

function isVideo(fileName: string, fileUrl: string): boolean {
  return /\.(mp4|webm|mov|avi|mkv|flv)$/i.test(fileName || fileUrl);
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page, tagIds): Promise<ClientListResponse> {
    return fetchPosts(buildTags("", tagIds), page);
  },

  latest(page, tagIds): Promise<ClientListResponse> {
    return fetchPosts(buildTags("", tagIds), page);
  },

  search(query, page, tagIds): Promise<ClientListResponse> {
    return fetchPosts(buildTags(query, tagIds), page);
  },

  tags: rule34Tags,

  async details(id, options): Promise<ClientMangaDetail> {
    const element = await fetchPost(id);
    const safeId = routeSafePostId(id);
    const rawTags = element.getAttribute("tags")?.trim() ?? "";
    const tagList = rawTags.split(/\s+/).filter(Boolean);
    const score = Number.parseInt(element.getAttribute("score") ?? "0", 10) || 0;
    return {
      id: safeId,
      title: pickTitle(rawTags, safeId),
      author: element.getAttribute("author") ?? "",
      artist: element.getAttribute("source") ?? "",
      synopsis: "",
      altTitles: [],
      status: "Completed",
      type: "Artwork",
      isNsfw: true,
      rating: 0,
      thumbnail: element.getAttribute("preview_url") ?? "",
      genres: tagList.map(tag => tag.replace(/_/g, " ")),
      score: score > 0 ? String(score) : "",
      scorePosition: options?.scorePosition ?? "none",
      sourceTags: tagList.map(tag => ({ id: tag, name: tag.replace(/_/g, " "), group: "Tag" })),
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const safeId = routeSafePostId(id);
    return {
      items: [{
        id: safeId,
        number: 1,
        title: `Post #${safeId}`,
        scanlator: "Rule34",
        date: Math.floor(Date.now() / 1000),
      }],
    };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const safeId = routeSafePostId(String(chapterId));
    const element = await fetchPost(safeId);
    const fileName = element.getAttribute("file_name") ?? "";
    const fileUrl = element.getAttribute("file_url") ?? "";
    const previewUrl = element.getAttribute("preview_url") ?? "";
    const url = isVideo(fileName, fileUrl) ? previewUrl : (fileUrl || previewUrl);
    if (!url) throw new Error(`Rule34: no image URL for post ${safeId}`);
    return { chapterId: safeId, pages: [{ index: 0, url }] };
  },
};

export default adapter;
