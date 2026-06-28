import axios from "axios";
import type {
  MangaSource,
  ListOptions,
  MangaListResponse,
  MangaDetail,
  DetailOptions,
  ChapterListResponse,
  PageListResponse,
} from "./types";

const BASE = "https://onlythebesthentai.com";
const WP_API = `${BASE}/wp-json/wp/v2`;

const client = axios.create({
  baseURL: WP_API,
  timeout: 20000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    Accept: "application/json",
  },
});

interface WpPost {
  id: number;
  slug: string;
  date: string;
  title: { rendered: string };
  content: { rendered: string };
  featured_media: number;
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractImages(html: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const re = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|gif)/gi;
  for (const m of html.matchAll(re)) {
    const orig = m[0].replace(/-\d+x\d+(\.[a-zA-Z]+)$/, "$1");
    if (!seen.has(orig)) {
      seen.add(orig);
      result.push(orig);
    }
  }
  return result;
}

const FIELDS = "id,slug,title,content,date,featured_media";

async function fetchPosts(params: Record<string, unknown>): Promise<WpPost[]> {
  const res = await client.get<WpPost[]>("/posts", {
    params: { _fields: FIELDS, ...params },
  });
  return res.data;
}

function proxyUrl(url: string): string {
  if (!url) return "";
  return `/api/image-proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(BASE + "/")}`;
}

function toSummary(post: WpPost) {
  const imgs = extractImages(post.content.rendered);
  return {
    id: String(post.id),
    title: decodeHtml(post.title.rendered),
    thumbnail: imgs[0] ? proxyUrl(imgs[0]) : "",
    type: "manga" as const,
    isNsfw: true,
  };
}

export const OnlyTheBestHentaiSource: MangaSource = {
  id: "en.onlythebesthentai",
  name: "OnlyTheBestHentai",
  lang: "en",
  isNsfw: true,
  imageReferer: `${BASE}/`,

  async popular(opts: ListOptions): Promise<MangaListResponse> {
    const posts = await fetchPosts({ per_page: 24, page: opts.page, orderby: "date", order: "desc" });
    return { items: posts.map(toSummary), page: opts.page, hasNextPage: posts.length === 24 };
  },

  async latest(opts: ListOptions): Promise<MangaListResponse> {
    const posts = await fetchPosts({ per_page: 24, page: opts.page, orderby: "date", order: "desc" });
    return { items: posts.map(toSummary), page: opts.page, hasNextPage: posts.length === 24 };
  },

  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    const posts = await fetchPosts({ per_page: 24, page: opts.page, search: query });
    return { items: posts.map(toSummary), page: opts.page, hasNextPage: posts.length === 24 };
  },

  async details(id: string, opts: DetailOptions): Promise<MangaDetail> {
    const res = await client.get<WpPost>(`/posts/${id}`, {
      params: { _fields: FIELDS },
    });
    const post = res.data;
    const imgs = extractImages(post.content.rendered);
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
      thumbnail: imgs[0] ? proxyUrl(imgs[0]) : "",
      genres: ["Hentai"],
      score: "",
      scorePosition: opts.score,
    };
  },

  async chapters(mangaId: string): Promise<ChapterListResponse> {
    const res = await client.get<WpPost>(`/posts/${mangaId}`, {
      params: { _fields: "id,title,date" },
    });
    const post = res.data;
    return {
      items: [
        {
          id: String(post.id),
          number: 1,
          title: decodeHtml(post.title.rendered),
          scanlator: "",
          date: Math.floor(new Date(post.date).getTime() / 1000),
        },
      ],
    };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const res = await client.get<WpPost>(`/posts/${chapterId}`, {
      params: { _fields: "id,content" },
    });
    const imgs = extractImages(res.data.content.rendered);
    return {
      chapterId,
      pages: imgs.map((url, i) => ({ index: i, url: proxyUrl(url) })),
    };
  },
};
