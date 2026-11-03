import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE = "https://www.animegg.org";
const SOURCE_ID = "en.animegg";
const ANIMEGG_ICON = "/public/source-icons/en.animegg.svg";
const BROWSE_FALLBACK = [
  ["one-piece", "One Piece"],
  ["naruto-shippuden", "Naruto Shippuden"],
  ["detectiveconan", "Detective Conan"],
  ["bleach", "Bleach"],
] as const;
const HTML_REQUEST_TIMEOUT_MS = 40_000;
const ANIME_GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi",
  "Sports", "Thriller", "Supernatural", "Historical", "School", "Shounen", "Shoujo", "Music",
  "Military", "Psychological",
];

function absolute(value: string, reference = BASE): string {
  if (!value) return "";
  try { return new URL(value, reference).toString(); }
  catch { return value; }
}

function slugFromId(id: string): string {
  try { return decodeURIComponent(id).replace(/^\/series\//, "").replace(/\/$/, ""); }
  catch { return id.replace(/^\/series\//, "").replace(/\/$/, ""); }
}

function imageUrl(...candidates: Array<string | null | undefined>): string {
  const candidate = candidates
    .map(value => value?.trim() ?? "")
    .find(value => value && !/^data:/i.test(value) && !/(?:transparent|placeholder|blank|spacer)/i.test(value));
  return candidate ? absolute(candidate) : absolute(ANIMEGG_ICON);
}

async function fetchDocument(path: string): Promise<{ document: Document; url: string }> {
  const url = absolute(path);
  try {
    const response = await clientFetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(HTML_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const head = html.slice(0, 20_000).toLowerCase();
    if (/just a moment|cf-chl-|challenge-platform|attention required|enable javascript and cookies|cloudflare ray id/.test(head)) {
      throw new Error("AnimeGG returned a protection page");
    }
    return { document: new DOMParser().parseFromString(html, "text/html"), url };
  } catch {
    throw new Error("AnimeGG is temporarily unavailable or blocking requests. Please check your connection and try again later.");
  }
}

function toSummary(root: Element): ClientListResponse["items"][number] | null {
  const link = root.querySelector("a[href^='/series/']") ?? root.closest("a[href^='/series/']");
  const href = link?.getAttribute("href") ?? "";
  const title = root.querySelector(".rightpop a[href^='/series/'], .releaseLink, h2")?.textContent?.trim() || link?.textContent?.trim() || "";
  if (!href || !title) return null;
  const image = root.querySelector("img");
  return {
    id: slugFromId(href),
    title,
    thumbnail: imageUrl(
      image?.getAttribute("data-src"),
      image?.getAttribute("data-original"),
      image?.getAttribute("data-lazy-src"),
      image?.getAttribute("src"),
    ),
    type: "Anime",
    isNsfw: false,
    mediaType: "anime",
  };
}

function parseListing(document: Document, page: number): ClientListResponse {
  const seen = new Set<string>();
  const items: ClientListResponse["items"] = [];
  document.querySelectorAll("li.fea").forEach(element => {
    const item = toSummary(element);
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  });
  return {
    items,
    page,
    hasNextPage: Array.from(document.querySelectorAll("ul.pagination a")).some(el => el.textContent?.trim().toLowerCase() === "next"),
  };
}

function fallbackListing(page: number): ClientListResponse {
  return {
    page,
    hasNextPage: false,
    items: BROWSE_FALLBACK.map(([id, title]) => ({ id, title, thumbnail: absolute(ANIMEGG_ICON), type: "Anime", isNsfw: false, mediaType: "anime" })),
  };
}

function fallbackDetail(slug: string, scorePosition: "top" | "bottom" | "none" = "none"): ClientMangaDetail {
  const title = slug.split("-").map(word => word ? word[0].toUpperCase() + word.slice(1) : word).join(" ");
  return {
    id: slug,
    title,
    author: "",
    artist: "",
    synopsis: "AnimeGG is temporarily unavailable while its upstream server is protected by Cloudflare. Try again shortly.",
    altTitles: [],
    status: "Unknown",
    type: "Anime",
    isNsfw: false,
    rating: 0,
    thumbnail: absolute(ANIMEGG_ICON),
    genres: [],
    score: "",
    scorePosition,
    mediaType: "anime",
  };
}

async function listing(path: string, page: number): Promise<ClientListResponse> {
  const separator = path.includes("?") ? "&" : "?";
  const { document } = await fetchDocument(`${path}${separator}limit=25&start=${(page - 1) * 25}`);
  return parseListing(document, page);
}

function genrePath(query: string): string | null {
  return query ? `/genre/${encodeURIComponent(query.toLowerCase())}` : null;
}

async function animeGgTags(): Promise<NonNullable<ClientMangaDetail["sourceTags"]>> {
  const { document } = await fetchDocument("/popular-series");
  const seen = new Set<string>();
  const tags: NonNullable<ClientMangaDetail["sourceTags"]> = [];
  document.querySelectorAll("a[href^='/genre/']").forEach(anchor => {
    const href = anchor.getAttribute("href") || "";
    const id = decodeURIComponent(href.slice("/genre/".length)).trim().toLowerCase();
    const name = anchor.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    tags.push({ id, name, group: "Genre" });
  });
  return tags;
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",
  fallbackToServer: false,
  tags: animeGgTags,

  popular(page, tagIds) {
    const tag = tagIds?.find(value => !value.startsWith("-"));
    return listing(tag ? genrePath(tag) || "/popular-series" : "/popular-series", page).catch(() => fallbackListing(page));
  },

  latest(page, tagIds) {
    const tag = tagIds?.find(value => !value.startsWith("-"));
    return listing(tag ? genrePath(tag) || "/releases" : "/releases", page).catch(() => fallbackListing(page));
  },

  async search(query, page) {
    const trimmed = query.trim();
    if (!trimmed) return this.popular(page);
    const genre = genrePath(trimmed);
    if (genre) {
      try { return await listing(genre, page); }
      catch { return fallbackListing(page); }
    }
    const path = `/search/?q=${encodeURIComponent(trimmed)}&limit=25&start=${(page - 1) * 25}`;
    const { document } = await fetchDocument(path);
    const seen = new Set<string>();
    const items: ClientListResponse["items"] = [];
    document.querySelectorAll(".media.searchre").forEach(element => {
      const item = toSummary(element);
      if (!item || seen.has(item.id)) return;
      seen.add(item.id);
      items.push(item);
    });
    return { items, page, hasNextPage: items.length > 0 };
  },

  async details(id, options) {
    const slug = slugFromId(id);
    const scorePosition = options?.scorePosition ?? "none";
    let document: Document;
    try {
      ({ document } = await fetchDocument(`/series/${encodeURIComponent(slug)}`));
    } catch {
      return fallbackDetail(slug, scorePosition);
    }
    const title = document.querySelector("h1")?.textContent?.trim()
      || document.querySelector("title")?.textContent?.replace(/^Watch\s+|\s+Episodes.*$/gi, "").trim()
      || slug;
    const info = Array.from(document.querySelectorAll(".infoami")).map(el => el.textContent?.trim() ?? "").join(" ");
    const status = /completed|finished/i.test(info) ? "Completed" : "Ongoing";
    const poster = document.querySelector(".media-object");
    const thumbnail = imageUrl(
      poster?.getAttribute("data-src"),
      poster?.getAttribute("data-original"),
      poster?.getAttribute("src"),
      document.querySelector("meta[property='og:image']")?.getAttribute("content"),
    );
    const synopsis = document.querySelector(".ptext")?.textContent?.trim() ?? "";
    const alternate = Array.from(document.querySelectorAll(".infoami"))
      .find(el => /Alternate Titles/i.test(el.textContent ?? ""))?.textContent?.replace(/^Alternate Titles:\s*/i, "")
      .split(",").map(value => value.trim()).filter(Boolean) ?? [];
    const genres = Array.from(document.querySelectorAll(".tagscat a")).map(el => el.textContent?.trim() ?? "").filter(Boolean);
    return {
      id: slug,
      title,
      author: "",
      artist: "",
      synopsis,
      altTitles: alternate,
      status,
      type: "Anime",
      isNsfw: false,
      rating: 0,
      thumbnail,
      genres,
      score: "",
      scorePosition,
      sourceTags: genres.map(name => ({ id: name.toLowerCase(), name, group: "Genre" })),
      mediaType: "anime",
    };
  },

  async chapters(id): Promise<ClientChapterResponse> {
    const slug = slugFromId(id);
    let document: Document;
    try {
      ({ document } = await fetchDocument(`/series/${encodeURIComponent(slug)}`));
    } catch {
      return { items: [] };
    }
    const items: ClientChapterResponse["items"] = [];
    document.querySelectorAll("ul.newmanga li").forEach(element => {
      const link = element.querySelector("a.anm_det_pop");
      const href = link?.getAttribute("href") ?? "";
      const number = Number(href.match(/episode-(\d+)/i)?.[1] || link?.textContent?.match(/(\d+)/)?.[1] || 0);
      if (!href || !number) return;
      items.push({
        id: absolute(href),
        number,
        title: element.querySelector("i.anititle")?.textContent?.trim() || `Episode ${number}`,
        scanlator: "AnimeGG",
        date: 0,
        isOfficial: true,
        mediaType: "video",
      });
    });
    return { items: items.sort((a, b) => b.number - a.number) };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const episodeUrl = absolute(decodeURIComponent(String(chapterId)));
    const { document } = await fetchDocument(episodeUrl);
    const tracks: string[] = [];
    document.querySelectorAll("#videos a[data-toggle='tab']").forEach(tab => {
      const version = (tab.getAttribute("data-version") || "").toLowerCase();
      const href = tab.getAttribute("href") || "";
      const iframe = document.querySelector(`.tab-pane${href} iframe.video`)?.getAttribute("src") || "";
      if (iframe && version) tracks.push(absolute(iframe));
    });
    if (!tracks.length) {
      const iframe = document.querySelector("iframe.video")?.getAttribute("src") || "";
      if (iframe) tracks.push(absolute(iframe));
    }
    if (!tracks.length) throw new Error(`AnimeGG has no playable embed for ${episodeUrl}`);
    return { chapterId, pages: [{ index: 0, url: tracks[0] }] };
  },
};

export default adapter;
