import axios from "axios";
import * as cheerio from "cheerio";
import type { ChapterListResponse, DetailOptions, ListOptions, MangaDetail, MangaListResponse, MangaSource, PageListResponse } from "./types";

const BASE = "https://www.animegg.org";
const http = axios.create({ timeout: 25000, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", Accept: "text/html,application/json;q=0.9,*/*;q=0.8", Referer: `${BASE}/` } });

function absolute(value: string): string {
  if (value.startsWith("//")) return `https:${value}`;
  return value.startsWith("http") ? value : `${BASE}${value.startsWith("/") ? "" : "/"}${value}`;
}
function slugFromId(id: string): string { return decodeURIComponent(id).replace(/^\/series\//, "").replace(/\/$/, ""); }

async function search(query: string, opts: ListOptions): Promise<MangaListResponse> {
  if (!query.trim()) return { items: [], page: opts.page, hasNextPage: false };
  const response = await http.get<Array<{ id: number; name: string; url: string; thumbnailUrl?: string }>>(`${BASE}/search/auto/`, { params: { q: query } });
  const all = response.data ?? [];
  const pageItems = all.slice((opts.page - 1) * 20, opts.page * 20).map(item => ({ id: slugFromId(item.url), title: item.name, thumbnail: item.thumbnailUrl ? absolute(item.thumbnailUrl) : "", type: "Anime", isNsfw: false, mediaType: "anime" as const }));
  return { items: pageItems, page: opts.page, hasNextPage: all.length > opts.page * 20 };
}

async function details(id: string): Promise<MangaDetail> {
  const slug = slugFromId(id);
  const response = await http.get<string>(`${BASE}/series/${encodeURIComponent(slug)}`);
  const $ = cheerio.load(response.data);
  const title = $("h1").first().text().trim() || $("title").text().replace(/^Watch\s+|\s+Episodes.*$/gi, "").trim() || slug;
  const info = $(".infoami").map((_i, el) => $(el).text().trim()).get().join(" ");
  const status = /completed|finished/i.test(info) ? "Completed" : "Ongoing";
  const thumbnail = $(".media-object").first().attr("src") || $("meta[property='og:image']").attr("content") || "";
  const synopsis = $(".ptext").first().text().trim();
  const alt = $(".infoami").filter((_i, el) => /Alternate Titles/i.test($(el).text())).text().replace(/^Alternate Titles:\s*/i, "").split(",").map(s => s.trim()).filter(Boolean);
  const genres = $(".tagscat a").map((_i, el) => $(el).text().trim()).get().filter(Boolean);
  return { id: slug, title, author: "", artist: "", synopsis, altTitles: alt, status, type: "Anime", isNsfw: false, rating: 0, thumbnail: absolute(thumbnail), genres, score: "", scorePosition: "none", mediaType: "anime" };
}

async function chapters(id: string): Promise<ChapterListResponse> {
  const slug = slugFromId(id);
  const response = await http.get<string>(`${BASE}/series/${encodeURIComponent(slug)}`);
  const $ = cheerio.load(response.data);
  const items = $("ul.newmanga li").toArray().flatMap((el) => {
    const link = $(el).find("a.anm_det_pop").first();
    const href = link.attr("href") || "";
    const number = Number((href.match(/episode-(\d+)/i) || [])[1] || link.text().match(/(\d+)/)?.[1] || 0);
    if (!href || !number) return [];
    const title = $(el).find("i.anititle").first().text().trim() || `Episode ${number}`;
    return [{ id: absolute(href), number, title, scanlator: "AnimeGG", date: 0, isOfficial: true, mediaType: "video" as const }];
  });
  return { items: items.sort((a, b) => b.number - a.number) };
}

async function pages(chapterId: string): Promise<PageListResponse> {
  const episodeUrl = absolute(decodeURIComponent(chapterId));
  const response = await http.get<string>(episodeUrl);
  const $ = cheerio.load(response.data);
  const iframe = $("iframe.video").filter((_i, el) => /subbed/i.test($(el).closest(".tab-pane").attr("id") || "")).first().attr("src") || $("iframe.video").first().attr("src");
  if (!iframe) throw new Error(`AnimeGG has no playable embed for ${episodeUrl}`);
  return { chapterId, pages: [{ index: 0, url: absolute(iframe) }] };
}

const AnimeGGSource: MangaSource = {
  id: "en.animegg", name: "AnimeGG", lang: "en", isNsfw: false,
  popular: opts => search("", opts), latest: opts => search("", opts), search,
  details: (id, _opts: DetailOptions) => details(id),
  chapters: id => chapters(id),
  pages,
  tags: async () => [{ id: "anime", name: "Anime", group: "Media" }],
};

export { AnimeGGSource };
export default AnimeGGSource;
