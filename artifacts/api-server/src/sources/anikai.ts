import axios from "axios";
import * as cheerio from "cheerio";
import type {
  ChapterListResponse,
  DetailOptions,
  ListOptions,
  MangaDetail,
  MangaListResponse,
  MangaSource,
  PageListResponse,
  SourceTag,
} from "./types";
import { absUrl } from "./scraper-utils";

const BASE_URL = "https://anikai.to";
const SEARCH_URL = `${BASE_URL}/ajax/anime/search`;
const EPISODES_URL = `${BASE_URL}/ajax/episodes/list`;
const SERVERS_URL = `${BASE_URL}/ajax/links/list`;
const LINKS_URL = `${BASE_URL}/ajax/links/view`;
const ENCODE_URL = "https://enc-dec.app/api/enc-kai";
const DECODE_KAI_URL = "https://enc-dec.app/api/dec-kai";
const DECODE_MEGA_URL = "https://enc-dec.app/api/dec-mega";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

const http = axios.create({
  timeout: 25000,
  headers: {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${BASE_URL}/`,
  },
  validateStatus: status => status >= 200 && status < 500,
});

function requireOk(response: { status: number }, label: string) {
  if (response.status >= 400) throw new Error(`Anime Kai ${label} returned HTTP ${response.status}`);
}

async function encodeToken(text: string): Promise<string> {
  const response = await http.get<{ status?: number; result?: string }>(ENCODE_URL, { params: { text } });
  requireOk(response, "token encoder");
  if (response.data.status !== 200 || !response.data.result) throw new Error("Anime Kai token encryption failed");
  return response.data.result;
}

async function decodeKai(text: string): Promise<{ url?: string; skip?: Record<string, unknown> }> {
  const response = await http.post<{ status?: number; result?: { url?: string; skip?: Record<string, unknown> } }>(DECODE_KAI_URL, { text });
  requireOk(response, "embed decoder");
  if (response.data.status !== 200 || !response.data.result) throw new Error("Anime Kai embed decryption failed");
  return response.data.result;
}

async function decodeMega(text: string): Promise<{ sources?: Array<{ file?: string; url?: string; type?: string }>; tracks?: unknown[] }> {
  const response = await http.post<{ status?: number; result?: { sources?: Array<{ file?: string; url?: string; type?: string }>; tracks?: unknown[] } }>(DECODE_MEGA_URL, {
    text,
    agent: USER_AGENT,
  });
  requireOk(response, "media decoder");
  if (response.data.status !== 200 || !response.data.result) throw new Error("Anime Kai media decryption failed");
  return response.data.result;
}

function parseEpisodeId(value: string): { slug: string; token: string; number: number } {
  const decoded = decodeURIComponent(value);
  const [slug, token, numberText] = decoded.split("::");
  if (!slug || !token) throw new Error("Invalid Anime Kai episode ID");
  return { slug, token, number: Number(numberText) || 0 };
}

function parseSearchResults(html: string) {
  const $ = cheerio.load(html);
  return $("a.aitem").toArray().flatMap(item => {
    const node = $(item);
    const titleNode = node.find("h6.title").first();
    const title = titleNode.text().trim();
    const href = node.attr("href") ?? "";
    if (!title || !href) return [];
    const poster = node.find(".poster img").first();
    const thumbnail = poster.attr("src") || poster.attr("data-src") || "";
    return [{
      id: href.replace(/^\/watch\//, "").replace(/\/$/, ""),
      title,
      thumbnail: absUrl(BASE_URL, thumbnail),
      type: "Anime",
      isNsfw: false,
      mediaType: "anime" as const,
    }];
  });
}

async function search(query: string, page: number): Promise<MangaListResponse> {
  if (!query.trim()) return { items: [], page, hasNextPage: false };
  const response = await http.get<{ result?: { html?: string } }>(SEARCH_URL, {
    params: { keyword: query },
    headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
  });
  requireOk(response, "search");
  const items = parseSearchResults(response.data.result?.html ?? "");
  const pageItems = items.slice((page - 1) * 20, page * 20);
  return { items: pageItems, page, hasNextPage: pageItems.length === 20 && items.length > page * 20 };
}

async function animeDetails(slug: string): Promise<{ detail: MangaDetail; aniId: string }> {
  const response = await http.get<string>(`${BASE_URL}/watch/${encodeURIComponent(slug)}`, { responseType: "text" });
  requireOk(response, "details");
  const $ = cheerio.load(response.data);
  let aniId = "";
  const syncData = $("script#syncData").html();
  if (syncData) {
    try { aniId = String(JSON.parse(syncData).anime_id ?? ""); } catch { /* page can omit sync data */ }
  }
  const info = $(".main-entity .info");
  const rating = info.find(".rating").first().text().trim();
  const title = $("h1.title").first().text().trim() || slug;
  const altTitle = $("h1.title").first().attr("data-jp") || "";
  const description = $(".desc").first().text().trim();
  const poster = $(".poster img[itemprop='image']").first().attr("src") || $(".poster img").first().attr("src") || "";
  const type = info.find("span").filter((_i, el) => $(el).find("b").length > 0).first().text().trim() || "Anime";
  const genres = $(".detail a").toArray().map(el => $(el).text().trim()).filter(Boolean);
  return {
    aniId,
    detail: {
      id: slug,
      title,
      author: "",
      artist: "",
      synopsis: description,
      altTitles: altTitle ? [altTitle] : [],
      status: "Unknown",
      type,
      isNsfw: false,
      rating: Number.parseFloat(rating) || 0,
      thumbnail: absUrl(BASE_URL, poster),
      genres: [...new Set(genres)],
      score: rating,
      scorePosition: "none",
      mediaType: "anime",
    },
  };
}

async function episodeList(aniId: string, slug: string): Promise<ChapterListResponse> {
  const encoded = await encodeToken(aniId);
  const response = await http.get<{ result?: string }>(EPISODES_URL, {
    params: { ani_id: aniId, _: encoded },
    headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
  });
  requireOk(response, "episodes");
  const $ = cheerio.load(response.data.result ?? "");
  const items = $(".eplist a").toArray().flatMap((el, index) => {
    const node = $(el);
    const token = node.attr("token") ?? "";
    if (!token) return [];
    const number = Number(node.attr("num")) || index + 1;
    return [{
      id: `${slug}::${token}::${number}`,
      number,
      title: node.find("span").first().text().trim() || `Episode ${number}`,
      scanlator: "Anime Kai",
      date: 0,
      isOfficial: true,
      mediaType: "video" as const,
    }];
  });
  return { items: items.sort((a, b) => b.number - a.number) };
}

async function resolveEpisode(token: string): Promise<string> {
  const encoded = await encodeToken(token);
  const serversResponse = await http.get<{ result?: string }>(SERVERS_URL, {
    params: { token, _: encoded },
    headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
  });
  requireOk(serversResponse, "servers");
  const $ = cheerio.load(serversResponse.data.result ?? "");
  const linkId = $(".server").first().attr("data-lid");
  if (!linkId) throw new Error("Anime Kai has no playable servers for this episode");

  const linkToken = await encodeToken(linkId);
  const linksResponse = await http.get<{ result?: string }>(LINKS_URL, {
    params: { id: linkId, _: linkToken },
    headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
  });
  requireOk(linksResponse, "link resolver");
  const embedData = await decodeKai(linksResponse.data.result ?? "");
  if (!embedData.url) throw new Error("Anime Kai returned no embed URL");
  const videoId = embedData.url.replace(/\/$/, "").split("/").pop() ?? "";
  const embedBase = embedData.url.includes("/e/") ? embedData.url.split("/e/")[0] : embedData.url.replace(/\/[^/]+\/?$/, "");
  const mediaResponse = await http.get<{ result?: string }>(`${embedBase}/media/${videoId}`, { headers: { Referer: embedData.url } });
  requireOk(mediaResponse, "media source");
  const media = await decodeMega(mediaResponse.data.result ?? "");
  const source = media.sources?.find(item => item.file || item.url);
  const url = source?.file || source?.url;
  if (!url) throw new Error("Anime Kai returned no video source");
  return url;
}

const AnimeKaiSource: MangaSource = {
  id: "en.anikai",
  name: "Anime Kai",
  lang: "en",
  isNsfw: false,
  popular: opts => search("", opts.page),
  latest: opts => search("", opts.page),
  search: (query, opts) => search(query, opts.page),
  async details(id: string, _opts: DetailOptions) {
    return (await animeDetails(decodeURIComponent(id))).detail;
  },
  async chapters(mangaId: string) {
    const slug = decodeURIComponent(mangaId);
    const { aniId } = await animeDetails(slug);
    if (!aniId) throw new Error("Anime Kai did not expose an anime ID");
    return episodeList(aniId, slug);
  },
  async pages(chapterId: string): Promise<PageListResponse> {
    const { token } = parseEpisodeId(chapterId);
    const url = await resolveEpisode(token);
    return { chapterId, pages: [{ index: 0, url }] };
  },
  async tags(): Promise<SourceTag[]> {
    return [{ id: "anime", name: "Anime", group: "Media" }];
  },
};

export { AnimeKaiSource };
export default AnimeKaiSource;
