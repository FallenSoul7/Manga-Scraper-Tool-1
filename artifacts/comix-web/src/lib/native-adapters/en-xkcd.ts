import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "../client-sources";
import { clientFetch } from "../client-fetch";

const BASE_URL = "https://xkcd.com";
const SOURCE_ID = "en.xkcd";
const MANGA_ID = "xkcd-main";
const LOGO_URL = "https://xkcd.com/s/0b7742.png";

function absoluteUrl(value: string, reference: string): string {
  if (!value) return "";
  try {
    return new URL(value, reference).toString();
  } catch {
    return value;
  }
}

function parseXkcdDate(dateString: string): number {
  if (!dateString) return Math.floor(Date.now() / 1000);
  const normalized = dateString
    .split("-")
    .map((part, index) => (index === 1 || index === 2 ? part.padStart(2, "0") : part))
    .join("-");
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? 0 : Math.floor(timestamp / 1000);
}

async function fetchDocument(path: string): Promise<{ document: Document; url: string }> {
  const url = new URL(path, BASE_URL).toString();
  const response = await clientFetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`xkcd: HTTP ${response.status}`);
  const html = await response.text();
  return { document: new DOMParser().parseFromString(html, "text/html"), url };
}

function summary(): ClientListResponse["items"][number] {
  return {
    id: MANGA_ID,
    title: "xkcd",
    thumbnail: LOGO_URL,
    type: "Comic",
    isNsfw: false,
  };
}

function parseChapterNumber(chapterId: string): number {
  const match = String(chapterId).match(/^xkcd-(\d+)$/);
  if (!match) throw new Error(`xkcd: invalid chapter ID ${chapterId}`);
  const number = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(number)) throw new Error(`xkcd: invalid chapter ID ${chapterId}`);
  return number;
}

const adapter: ClientSourceAdapter = {
  sourceId: SOURCE_ID,
  mode: "client",

  async popular(page): Promise<ClientListResponse> {
    return { items: [summary()], page, hasNextPage: false };
  },

  async latest(page): Promise<ClientListResponse> {
    return { items: [summary()], page, hasNextPage: false };
  },

  async search(_query, page): Promise<ClientListResponse> {
    return { items: [], page, hasNextPage: false };
  },

  async details(_id, options): Promise<ClientMangaDetail> {
    return {
      id: MANGA_ID,
      title: "xkcd",
      author: "Randall Munroe",
      artist: "Randall Munroe",
      synopsis: "A webcomic of romance, sarcasm, math and language.",
      altTitles: [],
      status: "Ongoing",
      type: "Comic",
      isNsfw: false,
      rating: 0,
      thumbnail: LOGO_URL,
      genres: [],
      score: "",
      scorePosition: options?.scorePosition ?? "none",
    };
  },

  async chapters(_id): Promise<ClientChapterResponse> {
    const { document } = await fetchDocument("/archive/");
    const chapters: ClientChapterResponse["items"] = [];

    document.querySelectorAll("#middleContainer > a").forEach(anchor => {
      const href = anchor.getAttribute("href") ?? "";
      const match = href.match(/^\/(\d+)\/?$/);
      if (!match) return;
      const number = Number.parseInt(match[1], 10);
      if (!Number.isSafeInteger(number)) return;
      const title = anchor.textContent?.trim() ?? "";
      chapters.push({
        id: `xkcd-${number}`,
        number,
        title: `${number}: ${title}`,
        scanlator: "xkcd",
        date: parseXkcdDate(anchor.getAttribute("title") ?? ""),
      });
    });

    chapters.reverse();
    return { items: chapters };
  },

  async pages(chapterId): Promise<ClientPageResponse> {
    const number = parseChapterNumber(String(chapterId));
    const comicUrl = `${BASE_URL}/${number}/`;
    const { document, url } = await fetchDocument(`/${number}/`);
    const image = document.querySelector("#comic > img");
    if (!(image instanceof HTMLImageElement)) {
      throw new Error("xkcd: image not found; comic may be interactive or unavailable");
    }

    let imageUrl = "";
    const srcset = image.getAttribute("srcset");
    if (srcset) {
      imageUrl = absoluteUrl(srcset.split(",")[0].trim().split(/\s+/)[0], comicUrl);
    }
    if (!imageUrl) imageUrl = absoluteUrl(image.getAttribute("src") ?? "", url);
    if (!imageUrl) throw new Error(`xkcd: image not found for ${chapterId}`);
    return { chapterId, pages: [{ index: 0, url: imageUrl }] };
  },
};

export default adapter;
