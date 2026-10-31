import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://onlythebesthentai.com";
const WP_API = `${BASE}/wp-json/wp/v2`;
const SOURCE_ID = "en.onlythebesthentai";
const FIELDS = "id,slug,title,content,date,featured_media";

type WpPost = {
  id: number;
  slug: string;
  date: string;
  title: { rendered: string };
  content: { rendered: string };
  featured_media: number;
};

type WpPostListFields = Pick<WpPost, "id" | "slug" | "title" | "content" | "date" | "featured_media">;

type WpChapterPost = Pick<WpPost, "id" | "title" | "date">;
type WpPagePost = Pick<WpPost, "id" | "content">;

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractImages(html: string): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  const pattern = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|gif)/gi;
  for (const match of html.matchAll(pattern)) {
    const original = match[0].replace(/-\d+x\d+(\.[a-zA-Z]+)$/, "$1");
    if (!seen.has(original)) {
      seen.add(original);
      images.push(original);
    }
  }
  return images;
}

function mediaUrl(url: string): string {
  return url;
}

async function fetchJson<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(path, WP_API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await clientFetch(url.toString(), {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`OnlyTheBestHentai: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchPosts(params: Record<string, string | number>): Promise<WpPostListFields[]> {
  return fetchJson<WpPostListFields[]>("/posts", { _fields: FIELDS, ...params });
}

function toSummary(post: WpPostListFields): ClientListResponse["items"][number] {
  const images = extractImages(post.content.rendered);
  return {
    id: String(post.id),
    title: decodeHtml(post.title.rendered),
    thumbnail: images[0] ? mediaUrl(images[0]) : "",
    type: "manga",
    isNsfw: true,
  };
}

async function listPosts(page: number, params: Record<string, string | number> = {}): Promise<ClientListResponse> {
  const posts = await fetchPosts({ per_page: 12, page, ...params });
  return { items: posts.map(toSummary), page, hasNextPage: posts.length === 12 };
}

function postId(value: string): string {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`OnlyTheBestHentai: invalid post ID ${value}`);
  return String(id);
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page) {
    return listPosts(page, { orderby: "date", order: "desc" });
  },

  latest(page) {
    return listPosts(page, { orderby: "date", order: "desc" });
  },

  search(query, page) {
    return listPosts(page, { search: query });
  },

  async details(id, options): Promise<ClientMangaDetail> {
    const post = await fetchJson<WpPost>(`/posts/${postId(id)}`, { _fields: FIELDS });
    const images = extractImages(post.content.rendered);
    return {
      id: String(post.id),
      title: decodeHtml(post.title.rendered),
      author: "",
      artist: "",
      synopsis: "",
      altTitles: [],
      status: "Completed",
      type: "manga",
      isNsfw: true,
      rating: 0,
      thumbnail: images[0] ? mediaUrl(images[0]) : "",
      genres: ["Hentai"],
      score: "",
      scorePosition: options?.scorePosition ?? "none",
    };
  },

  async chapters(mangaId): Promise<ClientChapterResponse> {
    const post = await fetchJson<WpChapterPost>(`/posts/${postId(mangaId)}`, { _fields: "id,title,date" });
    return {
      items: [{
        id: String(post.id),
        number: 1,
        title: decodeHtml(post.title.rendered),
        scanlator: "",
        date: Math.floor(new Date(post.date).getTime() / 1000),
      }],
    };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const post = await fetchJson<WpPagePost>(`/posts/${postId(chapterId)}`, { _fields: "id,content" });
    const images = extractImages(post.content.rendered);
    return { chapterId, pages: images.map((url, index) => ({ index, url: mediaUrl(url) })) };
  },
};

export default adapter;
