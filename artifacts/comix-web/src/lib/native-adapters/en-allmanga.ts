import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const API_URL = "https://api.allanime.day/api";
const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";
const VIDEO_HOSTS = [
  "https://aln.youtube-anime.com",
  "https://agendao.youtube-anime.com",
  "https://aimgf.youtube-anime.com",
];
const PAGE_SIZE = 20;
const SOURCE_ID = "en.allmanga";

type GraphQlResponse<T> = { data?: T; errors?: Array<{ message?: string }> };
type Kind = "manga" | "anime";

interface MediaEdge {
  _id: string;
  name: string;
  thumbnail?: string | null;
  englishName?: string | null;
  type?: string | null;
  status?: string | null;
}
interface MangaSearchData { mangas: { edges: MediaEdge[] }; }
interface ShowSearchData { shows: { edges: MediaEdge[] }; }
interface MangaData {
  manga: {
    _id: string; name: string; thumbnail?: string | null; description?: string | null;
    authors?: string[] | null; genres?: string[] | null; tags?: string[] | null;
    status?: string | null; altNames?: string[] | null; englishName?: string | null;
    availableChaptersDetail?: { sub?: number[]; dub?: number[] } | null;
  } | null;
}
interface VideoInfo { vidPath?: string | null; vidResolution?: number | null; vidDuration?: number | null; }
interface ShowData {
  show: {
    _id: string; name: string; thumbnail?: string | null; description?: string | null;
    genres?: string[] | null; tags?: string[] | null; status?: string | null;
    altNames?: string[] | null; englishName?: string | null;
  } | null;
  episodeInfos: Array<{
    episodeIdNum: number | string; notes?: string | null; uploadDates?: { sub?: string; dub?: string } | null;
    vidInforssub?: VideoInfo | null; vidInforsdub?: VideoInfo | null; vidInforsraw?: VideoInfo | null;
    thumbnails?: string[] | null;
  }>;
}
interface PageData {
  chapterPages: { edges: Array<{ pictureUrlHead?: string | null; pictureUrls?: Array<{ url?: string | null } | string> | null }> } | null;
}

const MANGA_SEARCH_QUERY = `query ($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeMangaEnumType, $countryOrigin: VaildCountryOriginEnumType) { mangas(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) { edges { _id name thumbnail englishName type status } } }`;
const SHOW_SEARCH_QUERY = `query ($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeEnumType, $countryOrigin: VaildCountryOriginEnumType) { shows(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) { edges { _id name thumbnail englishName type status } } }`;
const MANGA_DETAILS_QUERY = `query ($id: String!, $showId: String!) { manga(_id: $id) { _id name thumbnail description authors genres tags status altNames englishName availableChaptersDetail } }`;
const SHOW_DETAILS_QUERY = `query ($id: String!) { show(_id: $id) { _id name thumbnail description genres tags status altNames englishName } episodeInfos { episodeIdNum notes uploadDates vidInforssub { vidPath vidResolution vidDuration } vidInforsdub { vidPath vidResolution vidDuration } vidInforsraw { vidPath vidResolution vidDuration } thumbnails } }`;
const PAGE_QUERY = `query ($mangaId: String!, $chapterString: String!, $translationType: VaildTranslationTypeMangaEnumType!) { chapterPages(mangaId: $mangaId, chapterString: $chapterString, translationType: $translationType) { edges { pictureUrlHead pictureUrls { url } } } }`;

async function graphQl<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await clientFetch(API_URL, {
    method: "POST",
    credentials: "omit",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({})) as GraphQlResponse<T>;
  if (!response.ok) throw new Error(`AllManga API returned HTTP ${response.status}`);
  if (payload.errors?.length) throw new Error(`AllManga API: ${payload.errors[0]?.message ?? "request failed"}`);
  if (!payload.data) throw new Error("AllManga API returned no data");
  return payload.data;
}

function thumbnailUrl(value: string | null | undefined): string {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `${THUMBNAIL_CDN}${value}?w=250`;
}
function parseDate(value: unknown): number {
  if (typeof value === "number") return value > 10_000_000_000 ? value : value * 1000;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}
function idFor(kind: Kind, raw: string): string { return `${kind}:${encodeURIComponent(raw)}`; }
function parseId(value: string, fallback: Kind = "manga"): { kind: Kind; id: string } {
  const decoded = decodeURIComponent(value);
  const match = decoded.match(/^(manga|anime):(.*)$/);
  return { kind: (match?.[1] as Kind) ?? fallback, id: decodeURIComponent(match?.[2] ?? decoded) };
}
function mediaFilter(media?: string): "all" | Kind { return media === "manga" || media === "anime" ? media : "all"; }
function cleanDescription(value: string | null | undefined): string { return (value ?? "").replace(/<br\s*\/?>(\n)?/gi, "\n").replace(/<[^>]+>/g, ""); }
function toSummary(item: MediaEdge, kind: Kind): ClientListResponse["items"][number] {
  return { id: idFor(kind, item._id), title: item.englishName || item.name || "Untitled", thumbnail: thumbnailUrl(item.thumbnail), type: kind === "anime" ? "Anime" : "Manga", mediaType: kind, isNsfw: false };
}
function toDetail(id: string, item: ShowData["show"] | MangaData["manga"], kind: Kind): ClientMangaDetail {
  if (!item) throw new Error(`AllManga ${kind} was not found`);
  const manga = item as MangaData["manga"];
  const title = item.englishName || item.name || "Untitled";
  const status = item.status?.toLowerCase().includes("releas") ? "Ongoing" : item.status ?? "Unknown";
  return {
    id, title, author: kind === "manga" ? (manga?.authors?.join(", ") ?? "") : "", artist: kind === "manga" ? (manga?.authors?.join(", ") ?? "") : "",
    synopsis: cleanDescription(item.description), altTitles: item.altNames ?? [], status, type: kind === "anime" ? "Anime" : "Manga", mediaType: kind,
    isNsfw: false, rating: 0, thumbnail: thumbnailUrl(item.thumbnail), genres: [...(item.genres ?? []), ...(item.tags ?? [])], score: "", scorePosition: "none",
  };
}
function videoUrl(info?: VideoInfo | null): string | null {
  if (!info?.vidPath) return null;
  if (/^https?:\/\//i.test(info.vidPath)) return info.vidPath;
  return `${VIDEO_HOSTS[0]}${info.vidPath.startsWith("/") ? "" : "/"}${info.vidPath}`;
}

async function listKind(query: string, page: number, sort: "Name_ASC" | "Latest", kind: Kind): Promise<ClientListResponse> {
  const variables = { search: { query: query.trim() || null, allowAdult: true, allowUnknown: true, sortBy: sort }, size: PAGE_SIZE, page, translationType: "sub", countryOrigin: "ALL" };
  const edges = kind === "manga"
    ? (await graphQl<MangaSearchData>(MANGA_SEARCH_QUERY, variables)).mangas?.edges
    : (await graphQl<ShowSearchData>(SHOW_SEARCH_QUERY, variables)).shows?.edges;
  const items = (edges ?? []).map(item => toSummary(item, kind));
  return { items, page, hasNextPage: items.length === PAGE_SIZE };
}
async function listAll(query: string, page: number, sort: "Name_ASC" | "Latest", media?: string): Promise<ClientListResponse> {
  const selected = mediaFilter(media);
  if (selected !== "all") return listKind(query, page, sort, selected);
  const [manga, anime] = await Promise.all([listKind(query, page, sort, "manga").catch(() => ({ items: [], page, hasNextPage: false })), listKind(query, page, sort, "anime").catch(() => ({ items: [], page, hasNextPage: false }))]);
  return { items: [...manga.items, ...anime.items], page, hasNextPage: manga.hasNextPage || anime.hasNextPage };
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",
  popular: page => listAll("", page, "Name_ASC"),
  latest: page => listAll("", page, "Latest"),
  search: (query, page) => listAll(query, page, "Name_ASC"),
  async details(id, options) {
    const parsed = parseId(id);
    const detail = parsed.kind === "anime"
      ? toDetail(id, (await graphQl<ShowData>(SHOW_DETAILS_QUERY, { id: parsed.id })).show, "anime")
      : toDetail(id, (await graphQl<MangaData>(MANGA_DETAILS_QUERY, { id: parsed.id, showId: parsed.id })).manga, "manga");
    return { ...detail, scorePosition: options?.scorePosition ?? "none" };
  },
  async chapters(id): Promise<ClientChapterResponse> {
    const parsed = parseId(id);
    if (parsed.kind === "anime") {
      const data = await graphQl<ShowData>(SHOW_DETAILS_QUERY, { id: parsed.id });
      return { items: (data.episodeInfos ?? []).filter(ep => ep.vidInforssub || ep.vidInforsdub || ep.vidInforsraw).map(ep => ({ id: `${id}:${encodeURIComponent(String(ep.episodeIdNum))}`, number: Number(ep.episodeIdNum) || 0, title: ep.notes || `Episode ${ep.episodeIdNum}`, date: parseDate(ep.uploadDates?.sub), scanlator: "", isOfficial: true, mediaType: "video" as const, thumbnail: ep.thumbnails?.[0] || "" })).sort((a, b) => b.number - a.number) };
    }
    const data = await graphQl<MangaData>(MANGA_DETAILS_QUERY, { id: parsed.id, showId: parsed.id });
    return { items: (data.manga?.availableChaptersDetail?.sub ?? []).map(number => ({ id: `${id}:${encodeURIComponent(String(number))}`, number, title: `Chapter ${number}`, date: 0, scanlator: "", isOfficial: true, mediaType: "image" as const })).sort((a, b) => b.number - a.number) };
  },
  async pages(chapterId): Promise<ClientPageResponse> {
    const decoded = decodeURIComponent(chapterId);
    const separator = decoded.lastIndexOf(":");
    if (separator <= 0) throw new Error("Invalid AllManga chapter ID");
    const parent = decoded.slice(0, separator);
    const chapter = decoded.slice(separator + 1);
    const parsed = parseId(parent);
    if (parsed.kind === "anime") {
      const data = await graphQl<ShowData>(SHOW_DETAILS_QUERY, { id: parsed.id });
      const episode = data.episodeInfos.find(item => String(item.episodeIdNum) === chapter);
      const url = videoUrl(episode?.vidInforssub) ?? videoUrl(episode?.vidInforsdub) ?? videoUrl(episode?.vidInforsraw);
      if (!url) throw new Error(`AllManga episode ${chapter} has no playable video`);
      return { chapterId, pages: [{ index: 0, url }] };
    }
    const data = await graphQl<PageData>(PAGE_QUERY, { mangaId: parsed.id, chapterString: chapter, translationType: "sub", limit: 10, offset: 0 });
    const edge = data.chapterPages?.edges.find(item => item.pictureUrls?.length) ?? data.chapterPages?.edges[0];
    if (!edge) throw new Error("AllManga returned no pages for this chapter");
    const rawHead = edge.pictureUrlHead?.trim() || "https://ytimgf.youtube-anime.com/";
    const head = (/^https?:\/\//i.test(rawHead) ? rawHead : `https://${rawHead.replace(/^\/+/, "")}`).replace(/\/?$/, "/");
    const pages = (edge.pictureUrls ?? []).flatMap((item, index) => { const value = (typeof item === "string" ? item : item.url)?.trim(); return value ? [{ index, url: /^https?:\/\//i.test(value) ? value : `${head}${value.replace(/^\/+/, "")}` }] : []; });
    if (!pages.length) throw new Error("AllManga returned an empty page list for this chapter");
    return { chapterId, pages };
  },
};

export default adapter;
