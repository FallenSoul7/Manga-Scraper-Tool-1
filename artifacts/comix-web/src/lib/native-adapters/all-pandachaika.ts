import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://panda.chaika.moe";
const SOURCE_ID = "all.pandachaika";

interface LongArchive {
  id: number;
  title: string;
  title_jpn?: string;
  thumbnail: string;
  tags: string[];
  category: string;
  rating: string;
  posted: number;
  filecount: number;
  url: string;
}

interface SearchResponse {
  archives: LongArchive[];
  hasNext: boolean;
}

interface ArchiveDetail {
  title: string;
  title_jpn?: string;
  tags: string[];
  category: string;
  rating: number;
  posted: number;
  filecount: number;
  download: string;
  uploader?: string;
}

const API_SELF = (
  typeof process !== "undefined"
    ? process.env?.["RENDER_EXTERNAL_URL"] || process.env?.["API_BASE_URL"]
    : ""
) || (typeof location !== "undefined" ? location.origin : "http://localhost:8080");

function pageProxyUrl(archiveId: number, index: number): string {
  return `${API_SELF.replace(/\/+$/, "")}/api/pandachaika-page?archive=${archiveId}&index=${index}`;
}

async function clientJson<T>(url: string): Promise<T> {
  const response = await clientFetch(new URL(url, BASE).toString(), {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Panda Chaika: HTTP ${response.status}`);
  return await response.json() as T;
}

async function clientHtml(url: string): Promise<Document> {
  const response = await clientFetch(new URL(url, BASE).toString(), {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
  });
  if (!response.ok) throw new Error(`Panda Chaika: HTTP ${response.status}`);
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

function archiveToSummary(a: LongArchive): ClientListResponse["items"][number] {
  const title = a.title?.trim() || a.title_jpn?.trim() || `Archive ${a.id}`;
  return { id: String(a.id), title, thumbnail: a.thumbnail, type: a.category || "Doujinshi", isNsfw: true };
}

function parseTags(tags: string[]): string[] {
  return tags
    .filter(tag => !tag.startsWith("artist:") && !tag.startsWith("group:") && !tag.startsWith("language:"))
    .map(tag => {
      const colon = tag.indexOf(":");
      return colon >= 0 ? tag.slice(colon + 1).replace(/_/g, " ") : tag;
    });
}

function parseArtist(tags: string[]): string {
  const artist = tags.find(tag => tag.startsWith("artist:"));
  return artist ? artist.slice(7).replace(/_/g, " ") : "";
}

function tagGroup(tag: string): string {
  const scope = tag.split(":", 1)[0] || "other";
  return scope[0].toUpperCase() + scope.slice(1);
}

function sourceTags(tags: string[]): NonNullable<ClientMangaDetail["sourceTags"]> {
  return tags
    .map(raw => raw.trim())
    .filter(Boolean)
    .map(raw => {
      const colon = raw.indexOf(":");
      const name = (colon >= 0 ? raw.slice(colon + 1) : raw).replace(/_/g, " ");
      return { id: raw, name, group: tagGroup(raw) };
    });
}

function searchUrl(params: Record<string, string>): string {
  return `/search/?${new URLSearchParams({ apply: "", json: "", ...params })}`;
}

const TAG_SCOPES = ["language", "artist", "group", "parody", "female", "male", "mixed", "other"];
const TAG_QUERY_CHARS = "abc123".split("");
let cachedTags: NonNullable<ClientMangaDetail["sourceTags"]> | null = null;

function tagParams(tagIds?: string[]): Record<string, string> {
  return tagIds?.length ? { tags: tagIds.join(",") } : {};
}

async function list(path: string, page: number): Promise<ClientListResponse> {
  const data = await clientJson<SearchResponse>(path);
  return { items: data.archives.map(archiveToSummary), page, hasNextPage: data.hasNext };
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  popular(page) {
    return list(searchUrl({ sort: "rating", page: String(page) }), page);
  },

  latest(page) {
    return list(searchUrl({ sort: "public_date", page: String(page) }), page);
  },

  search(query, page) {
    return list(searchUrl({ title: query.trim(), sort: "rating", page: String(page) }), page);
  },

  async details(id, options): Promise<ClientMangaDetail> {
    const d = await clientJson<ArchiveDetail>(`/api?archive=${encodeURIComponent(id)}`);
    return {
      id,
      title: d.title,
      author: parseArtist(d.tags),
      artist: parseArtist(d.tags),
      synopsis: d.uploader ? `Uploaded by ${d.uploader}` : "",
      altTitles: d.title_jpn ? [d.title_jpn] : [],
      status: "Completed",
      type: d.category || "Doujinshi",
      isNsfw: true,
      rating: 0,
      thumbnail: `https://static.chaika.moe/media/images/thumbs/archive_${id}/thumb2.jpg`,
      genres: parseTags(d.tags),
      score: d.rating ? String(d.rating) : "",
      scorePosition: options?.scorePosition ?? "none",
      sourceTags: sourceTags(d.tags),
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const d = await clientJson<ArchiveDetail>(`/api?archive=${encodeURIComponent(id)}`);
    return { items: [{ id, number: 1, title: `${d.filecount} pages`, scanlator: d.uploader || "Panda Chaika", date: d.posted }] };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const archiveId = Number.parseInt(chapterId, 10);
    const d = await clientJson<ArchiveDetail>(`/api?archive=${archiveId}`);
    return {
      chapterId,
      pages: Array.from({ length: d.filecount }, (_, index) => ({ index, url: pageProxyUrl(archiveId, index) })),
    };
  },
};

export default adapter;

export async function pandaChaikaTags(): Promise<NonNullable<ClientMangaDetail["sourceTags"]>> {
  if (cachedTags) return cachedTags;
  const groups = await Promise.all(TAG_SCOPES.map(async scope => {
    const group = scope[0].toUpperCase() + scope.slice(1);
    const queries = [scope, ...TAG_QUERY_CHARS.map(char => `${scope}:${char}`)];
    const responses = await Promise.all(queries.map(async query => {
      try { return await clientHtml(`/tag-autocomplete/?q=${encodeURIComponent(query)}`); }
      catch { return null; }
    }));
    const tags: NonNullable<ClientMangaDetail["sourceTags"]> = [];
    for (const document of responses) {
      document?.querySelectorAll("a.choice[data-value]").forEach(element => {
        const value = element.getAttribute("data-value")?.trim();
        if (!value || !value.startsWith(`${scope}:`)) return;
        tags.push({ id: value, name: value.slice(scope.length + 1).replace(/_/g, " "), group });
      });
    }
    return tags;
  }));
  const seen = new Set<string>();
  cachedTags = groups.flat().filter(tag => !seen.has(tag.id) && seen.add(tag.id));
  return cachedTags;
}
