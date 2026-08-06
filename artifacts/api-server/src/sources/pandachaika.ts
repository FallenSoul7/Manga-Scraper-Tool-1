import type {
  MangaSource,
  ListOptions,
  MangaListResponse,
  MangaDetail,
  DetailOptions,
  ChapterListResponse,
  PageListResponse,
  MangaSummary,
} from "./types";
import { makeHttp, fetchJson } from "./scraper-utils";

const BASE = "https://panda.chaika.moe";

const http = makeHttp(BASE, {
  Accept: "application/json, text/html,*/*;q=0.8",
});

// ── API shapes ────────────────────────────────────────────────────────────────
interface LongArchive {
  id:         number;
  title:      string;
  title_jpn?: string;
  thumbnail:  string;
  tags:       string[];
  category:   string;
  rating:     string;
  posted:     number;
  filecount:  number;
  url:        string;
}
interface SearchResponse {
  archives:  LongArchive[];
  hasNext:   boolean;
}
interface ArchiveDetail {
  title:       string;
  title_jpn?:  string;
  tags:        string[];
  category:    string;
  rating:      number;
  posted:      number;
  filecount:   number;
  download:    string;
  uploader?:   string;
}

// ── Page proxy base URL (absolute, so the browser can fetch directly) ─────────
const API_SELF = (
  process.env["RENDER_EXTERNAL_URL"] ||
  process.env["API_BASE_URL"]        ||
  "http://localhost:8080"
).replace(/\/+$/, "");

function pageProxyUrl(archiveId: number, index: number): string {
  return `${API_SELF}/api/pandachaika-page?archive=${archiveId}&index=${index}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function archiveToSummary(a: LongArchive): MangaSummary {
  return {
    id:        String(a.id),
    title:     a.title,
    thumbnail: a.thumbnail,
    type:      a.category || "Doujinshi",
    isNsfw:    true,
  };
}

function parseTags(tags: string[]): string[] {
  return tags
    .filter(t => !t.startsWith("artist:") && !t.startsWith("group:") && !t.startsWith("language:"))
    .map(t => {
      const colon = t.indexOf(":");
      return colon >= 0 ? t.slice(colon + 1).replace(/_/g, " ") : t;
    });
}

function parseArtist(tags: string[]): string {
  const a = tags.find(t => t.startsWith("artist:"));
  return a ? a.slice(7).replace(/_/g, " ") : "";
}

function searchUrl(params: Record<string, string>): string {
  const q = new URLSearchParams({ apply: "", json: "", ...params });
  return `/search/?${q}`;
}

// ── Source ────────────────────────────────────────────────────────────────────
export const PandaChaikaSource: MangaSource = {
  id:     "en.pandachaika",
  name:   "Panda Chaika",
  lang:   "en",
  isNsfw: true,

  popularSorts: [
    { value: "rating",      label: "Top Rated"  },
    { value: "public_date", label: "Newest"      },
    { value: "filecount",   label: "Most Pages"  },
  ],

  async popular(o: ListOptions): Promise<MangaListResponse> {
    const sort = o.sort || "rating";
    const data = await fetchJson<SearchResponse>(http, searchUrl({ sort, page: String(o.page) }));
    return { items: data.archives.map(archiveToSummary), page: o.page, hasNextPage: data.hasNext };
  },

  async latest(o: ListOptions): Promise<MangaListResponse> {
    const data = await fetchJson<SearchResponse>(http, searchUrl({ sort: "public_date", page: String(o.page) }));
    return { items: data.archives.map(archiveToSummary), page: o.page, hasNextPage: data.hasNext };
  },

  async search(query: string, o: ListOptions): Promise<MangaListResponse> {
    const data = await fetchJson<SearchResponse>(
      http,
      searchUrl({ title: query.trim(), sort: "rating", page: String(o.page) }),
    );
    return { items: data.archives.map(archiveToSummary), page: o.page, hasNextPage: data.hasNext };
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const d = await fetchJson<ArchiveDetail>(http, `/api?archive=${id}`);
    return {
      id,
      title:         d.title,
      author:        parseArtist(d.tags),
      artist:        parseArtist(d.tags),
      synopsis:      d.uploader ? `Uploaded by ${d.uploader}` : "",
      altTitles:     d.title_jpn ? [d.title_jpn] : [],
      status:        "Completed",
      type:          d.category || "Doujinshi",
      isNsfw:        true,
      rating:        0,
      thumbnail:     `https://static.chaika.moe/media/images/thumbs/archive_${id}/thumb2.jpg`,
      genres:        parseTags(d.tags),
      score:         d.rating ? String(d.rating) : "",
      scorePosition: "top",
    };
  },

  async chapters(id: string): Promise<ChapterListResponse> {
    const d = await fetchJson<ArchiveDetail>(http, `/api?archive=${id}`);
    return {
      items: [
        {
          id,
          number:    1,
          title:     `${d.filecount} pages`,
          scanlator: d.uploader || "Panda Chaika",
          date:      d.posted,
        },
      ],
    };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const archiveId = parseInt(chapterId, 10);
    const d = await fetchJson<ArchiveDetail>(http, `/api?archive=${archiveId}`);
    const pages = Array.from({ length: d.filecount }, (_, i) => ({
      index: i,
      url:   pageProxyUrl(archiveId, i),
    }));
    return { chapterId, pages };
  },
};
