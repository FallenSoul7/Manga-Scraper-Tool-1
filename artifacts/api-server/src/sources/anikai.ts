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

const BASE_URL = "https://animekai.be";
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

function parseEpisodeId(value: string): { slug: string; number: number } {
  const decoded = decodeURIComponent(value);
  const [slug, numberText] = decoded.split("::");
  if (!slug || !numberText) throw new Error("Invalid Anime Kai episode ID");
  return { slug, number: Number(numberText) || 0 };
}

function parseSearchResults(html: string) {
  const $ = cheerio.load(html);
  return $(".aitem").toArray().flatMap(item => {
    const node = $(item);
    const titleNode = node.find("a.title").first();
    const title = titleNode.text().trim();
    const href = titleNode.attr("href") || node.find("a.poster").first().attr("href") || "";
    if (!title || !href) return [];
    const poster = node.find(".poster img").first();
    const thumbnail = poster.attr("src") || poster.attr("data-src") || "";
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    return [{
      id: path.replace(/^\/watch\//, "").replace(/\/$/, ""),
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
  const response = await http.get<string>(`${BASE_URL}/browse`, {
    params: { keyword: query },
    responseType: "text",
  });
  requireOk(response, "search");
  const items = parseSearchResults(response.data);
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

async function episodeList(slug: string): Promise<ChapterListResponse> {
  const response = await http.get<string>(`${BASE_URL}/watch/${encodeURIComponent(slug)}`, { responseType: "text" });
  requireOk(response, "episodes");
  const $ = cheerio.load(response.data);
  const items = $(".eplist a").toArray().flatMap((el, index) => {
    const node = $(el);
    const number = Number(node.attr("num")) || index + 1;
    return [{
      id: `${slug}::${number}`,
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

async function resolveEpisode(slug: string, number: number): Promise<string> {
  const response = await http.get<{ sources?: Record<string, Array<{ source_url?: string }>> }>(
    `${BASE_URL}/watch/${encodeURIComponent(slug)}/ep/${number}/sources`,
    { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } },
  );
  requireOk(response, "episode sources");
  const groups = Object.values(response.data.sources ?? {});
  const source = groups.flat().find(item => item.source_url);
  if (!source?.source_url) throw new Error("Anime Kai has no playable servers for this episode");
  return source.source_url;
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
    return episodeList(slug);
  },
  async pages(chapterId: string): Promise<PageListResponse> {
    const { slug, number } = parseEpisodeId(chapterId);
    const url = await resolveEpisode(slug, number);
    return { chapterId, pages: [{ index: 0, url }] };
  },
  async tags(): Promise<SourceTag[]> {
    return [{ id: "anime", name: "Anime", group: "Media" }];
  },
};

export { AnimeKaiSource };
export default AnimeKaiSource;
