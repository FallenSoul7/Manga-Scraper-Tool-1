import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientMangaSummary,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const API = "https://pawchive.pw/api/v1";
const FILES = "https://file.pawchive.pw/data";
const THUMBNAILS = "https://img.pawchive.pw/thumbnail/data";
const SOURCE_ICON = "/public/source-icons/all.pawchive.svg";
const PAGE_SIZE = 24;
const CACHE_TTL = 5 * 60 * 1000;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)$/i;
const STATIC_IMAGE_EXT = /\.(jpe?g|png)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|mkv|avi|m4v)$/i;

type Creator = {
  id: string | number;
  name?: string;
  service?: string;
  indexed?: number;
  updated?: number;
  favorited?: number;
};

type MediaFile = {
  name?: string;
  path?: string;
  preview_only?: boolean;
};

type Post = {
  id: string | number;
  user?: string | number;
  service?: string;
  title?: string;
  published?: string;
  added?: string;
  file?: MediaFile;
  attachments?: MediaFile[];
};

type Cached<T> = { value: T; expiresAt: number };

let creatorsCache: Cached<Creator[]> | null = null;
let creatorsInFlight: Promise<Creator[]> | null = null;
const postsCache = new Map<string, Cached<Post[]>>();
const postsInFlight = new Map<string, Promise<Post[]>>();

function unavailableError(): Error {
  return new Error("Pawchive is temporarily unavailable or blocking requests. Please check your connection and try again later.");
}

async function request<T>(path: string): Promise<T> {
  try {
    const response = await clientFetch(`${API}${path}`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } catch {
    throw unavailableError();
  }
}

function encodeId(value: Record<string, string>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeId(value: string): Record<string, unknown> {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]*$/.test(base64)) throw new Error("Invalid Base64URL value");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid identifier payload");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Invalid Pawchive identifier");
  }
}

function requiredIdField(value: Record<string, unknown>, field: string, error: string): string {
  const fieldValue = value[field];
  const normalized = typeof fieldValue === "string" || typeof fieldValue === "number" ? String(fieldValue) : "";
  if (!normalized) throw new Error(error);
  return normalized;
}

function creatorId(service: string, user: string | number): string {
  return encodeId({ service, user: String(user) });
}

function decodeCreatorId(id: string): { service: string; user: string } {
  const value = decodeId(id);
  return {
    service: requiredIdField(value, "service", "Invalid Pawchive creator ID"),
    user: requiredIdField(value, "user", "Invalid Pawchive creator ID"),
  };
}

function postId(post: Post): string {
  return encodeId({
    service: String(post.service ?? ""),
    user: String(post.user ?? ""),
    post: String(post.id),
  });
}

function decodePostId(id: string): { service: string; user: string; post: string } {
  const value = decodeId(id);
  return {
    service: requiredIdField(value, "service", "Invalid Pawchive post ID"),
    user: requiredIdField(value, "user", "Invalid Pawchive post ID"),
    post: requiredIdField(value, "post", "Invalid Pawchive post ID"),
  };
}

function thumbnailUrl(file: MediaFile | undefined): string {
  if (!file?.path) return SOURCE_ICON;
  if (/^https?:\/\//i.test(file.path)) return file.path;
  return `${THUMBNAILS}${file.path}`;
}

function fileUrl(file: MediaFile | undefined): string | null {
  if (!file?.path) return null;
  if (/^https?:\/\//i.test(file.path)) return file.path;
  if (file.preview_only && IMAGE_EXT.test(file.name ?? file.path)) return thumbnailUrl(file);
  return `${FILES}${file.path}${file.name ? `?f=${encodeURIComponent(file.name)}` : ""}`;
}

function isSupportedMediaFile(file: MediaFile | undefined): file is MediaFile {
  return Boolean(file?.path) && MEDIA_EXT.test(file?.name ?? file?.path ?? "");
}

function isImageFile(file: MediaFile | undefined): file is MediaFile {
  return Boolean(file?.path) && IMAGE_EXT.test(file?.name ?? file?.path ?? "");
}

function postFiles(post: Post): MediaFile[] {
  return [post.file, ...(post.attachments ?? [])]
    .filter(isSupportedMediaFile);
}

function postHasVideo(files: MediaFile[]): boolean {
  return files.some(file => VIDEO_EXT.test(file.name ?? file.path ?? ""));
}

function postThumbnail(post: Post): string {
  const files = postFiles(post);
  const hasVideo = postHasVideo(files);
  const images = files.filter(file => IMAGE_EXT.test(file.name ?? file.path ?? ""));
  const thumbnail = hasVideo
    ? images.find(file => STATIC_IMAGE_EXT.test(file.name ?? file.path ?? ""))
      ?? images.find(file => /\.gif$/i.test(file.name ?? file.path ?? ""))
    : images[0];
  if (hasVideo && !thumbnail) return "";
  return thumbnailUrl(thumbnail);
}

function postDate(post: Post): number {
  const raw = post.published ?? post.added;
  const timestamp = raw ? Date.parse(raw) : 0;
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

async function creators(): Promise<Creator[]> {
  if (creatorsCache && creatorsCache.expiresAt > Date.now()) return creatorsCache.value;
  if (creatorsInFlight) return creatorsInFlight;

  const pending = request<Creator[]>("/creators").then(data => {
    const value = Array.isArray(data) ? data : [];
    creatorsCache = { value, expiresAt: Date.now() + CACHE_TTL };
    return value;
  });
  creatorsInFlight = pending;
  try {
    return await pending;
  } finally {
    if (creatorsInFlight === pending) creatorsInFlight = null;
  }
}

async function creatorPosts(service: string, user: string): Promise<Post[]> {
  const key = `${service}/${user}`;
  const cached = postsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const inFlight = postsInFlight.get(key);
  if (inFlight) return inFlight;

  const pending = request<Post[]>(`/${encodeURIComponent(service)}/user/${encodeURIComponent(user)}`)
    .then(data => {
      const value = Array.isArray(data) ? data : [];
      if (postsCache.size >= 256 && !postsCache.has(key)) {
        const oldestKey = postsCache.keys().next().value;
        if (oldestKey) postsCache.delete(oldestKey);
      }
      postsCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL });
      return value;
    })
    .finally(() => postsInFlight.delete(key));
  postsInFlight.set(key, pending);
  return pending;
}

function creatorSummary(creator: Creator, thumbnail = SOURCE_ICON): ClientMangaSummary {
  const service = String(creator.service ?? "unknown");
  const user = String(creator.id);
  return {
    id: creatorId(service, user),
    title: String(creator.name ?? `${service} creator ${user}`),
    thumbnail,
    type: `Creator · ${service}`,
    isNsfw: false,
  };
}

async function creatorSummaries(items: Creator[]): Promise<ClientMangaSummary[]> {
  return Promise.all(items.map(async creator => {
    const service = String(creator.service ?? "unknown");
    const user = String(creator.id);
    try {
      const posts = await creatorPosts(service, user);
      const firstImage = posts
        .flatMap(post => [post.file, ...(post.attachments ?? [])])
        .find(isImageFile);
      return creatorSummary(creator, thumbnailUrl(firstImage));
    } catch {
      return creatorSummary(creator);
    }
  }));
}

function pageFor(page: number): number {
  return Math.max(1, Math.trunc(page) || 1);
}

async function creatorList(
  page: number,
  compare: (left: Creator, right: Creator) => number,
  query?: string,
): Promise<ClientListResponse> {
  const selectedPage = pageFor(page);
  const needle = query?.trim().toLowerCase() ?? "";
  const items = (await creators())
    .filter(creator => !needle || `${creator.name ?? ""} ${creator.service ?? ""} ${creator.id}`.toLowerCase().includes(needle))
    .sort(compare);
  const start = (selectedPage - 1) * PAGE_SIZE;
  return {
    items: await creatorSummaries(items.slice(start, start + PAGE_SIZE)),
    page: selectedPage,
    hasNextPage: start + PAGE_SIZE < items.length,
  };
}

async function pawchiveDetails(id: string, options?: { scorePosition?: "top" | "bottom" | "none" }): Promise<ClientMangaDetail> {
  const { service, user } = decodeCreatorId(id);
  const [profile, posts] = await Promise.all([
    request<Creator>(`/${encodeURIComponent(service)}/user/${encodeURIComponent(user)}/profile`),
    creatorPosts(service, user),
  ]);
  const firstImage = posts
    .flatMap(post => [post.file, ...(post.attachments ?? [])])
    .find(isImageFile);

  return {
    id,
    title: String(profile?.name ?? posts[0]?.user ?? user),
    author: `Pawchive · ${service}`,
    artist: "",
    synopsis: "Creator archive on Pawchive. Posts may contain images, GIFs, videos, and other attachments.",
    altTitles: [],
    status: "Ongoing",
    type: "Creator gallery",
    isNsfw: false,
    rating: 0,
    thumbnail: thumbnailUrl(firstImage),
    genres: [],
    score: "",
    scorePosition: options?.scorePosition ?? "none",
  };
}

async function pawchiveChapters(creatorKey: string): Promise<ClientChapterResponse> {
  const { service, user } = decodeCreatorId(creatorKey);
  const posts = await creatorPosts(service, user);
  return {
    items: posts.map((post, index) => {
      const files = postFiles(post);
      const hasImage = files.some(file => IMAGE_EXT.test(file.name ?? file.path ?? ""));
      const hasVideo = postHasVideo(files);
      return {
        id: postId({ ...post, service, user }),
        number: posts.length - index,
        title: String(post.title ?? `Post ${posts.length - index}`),
        scanlator: service,
        date: postDate(post),
        thumbnail: postThumbnail(post),
        thumbnailIsStatic: hasVideo,
        mediaType: hasImage && hasVideo ? "mixed" : hasVideo ? "video" : "image",
        attachmentCount: files.length,
      };
    }),
  };
}

async function pawchivePages(chapterKey: string): Promise<ClientPageResponse> {
  const { service, user, post } = decodePostId(chapterKey);
  const data = await request<Post>(`/${encodeURIComponent(service)}/user/${encodeURIComponent(user)}/post/${encodeURIComponent(post)}`);
  return {
    chapterId: chapterKey,
    pages: [data.file, ...(data.attachments ?? [])]
      .filter(isSupportedMediaFile)
      .map((file, index) => ({ index, url: fileUrl(file) ?? "" }))
      .filter(page => Boolean(page.url)),
  };
}

export const pawchiveAdapter: ClientSourceAdapter = {
  sourceId: "all.pawchive",
  mode: "client",
  popular: page => creatorList(page, (left, right) => Number(right.favorited ?? 0) - Number(left.favorited ?? 0)),
  latest: page => creatorList(page, (left, right) => Number(right.updated ?? 0) - Number(left.updated ?? 0)),
  search: (query, page) => creatorList(page, () => 0, query),
  details: pawchiveDetails,
  chapters: pawchiveChapters,
  pages: pawchivePages,
};
