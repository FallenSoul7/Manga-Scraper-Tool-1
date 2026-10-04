import type {
  ChapterListResponse,
  DetailOptions,
  ListOptions,
  MangaDetail,
  MangaListResponse,
  MangaSource,
  MangaSummary,
  PageListResponse,
  SourceTag,
} from "./types";

export const UNIVERSAL_SOURCE_ID = "builtin.universal";
const UNIVERSAL_ICON = "/public/source-icons/universal.svg";
type MediaType = NonNullable<MangaSummary["mediaType"]>;
type SourceEntry = { sourceId: string; mangaId: string; title: string; thumbnail: string; mediaType?: MediaType };
type UniversalGroup = { entries: SourceEntry[] };

// Keep blocked/catalog-only handlers out of Universal. A single dead source
// must not make every browse request wait for the full timeout.
const UNIVERSAL_SOURCE_IDS = new Set([
  "all.mangadex", "en.asurascans", "all.webtoons", "all.atsu",
  "en.resetscans", "all.thunderscans", "en.novelfull",
  "en.animegg", "en.mangafreak",
]);
const REQUEST_TIMEOUT_MS = 7_000;
const UNIVERSAL_PAGE_SIZE = 20;
const SOURCE_REQUEST_TIMEOUTS: Record<string, number> = {
  // AnimeGG can take 23–30 seconds to return a valid Cloudflare-protected
  // HTML page. Keep the short timeout for every other Universal source.
  "en.animegg": 40_000,
};
const TAG_TIMEOUT_MS = 4_000;
const PROXIED_MEDIA_SOURCES = new Set([
  "all.webtoons", "all.atsu", "en.resetscans", "en.novelfull", "all.mangadex", "en.animegg",
]);

function encodeTuple(parts: [string, string]): string {
  return `universal:${Buffer.from(JSON.stringify(parts), "utf8").toString("base64url")}`;
}
function decodeTuple(value: string): [string, string] {
  const encoded = value.startsWith("universal:") ? value.slice("universal:".length) : value;
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("Universal chapter ID is invalid");
  return [String(parsed[0]), String(parsed[1])];
}
function encodeGroup(group: UniversalGroup): string {
  return `universal-group:${Buffer.from(JSON.stringify(group), "utf8").toString("base64url")}`;
}
function decodeGroup(value: string): UniversalGroup {
  const encoded = value.startsWith("universal-group:") ? value.slice("universal-group:".length) : value;
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as UniversalGroup;
  if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.length === 0) throw new Error("Universal series ID is invalid");
  return parsed;
}
function normalizedTitle(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(chapter|chapters|vol|volume|season|part)\b/g, " ").replace(/\s+/g, " ").trim();
}
function groupKey(item: MangaSummary): string {
  return normalizedTitle(item.title);
}
function isAnime(item: MangaSummary): boolean {
  return item.mediaType === "anime" || /anime/i.test(item.type);
}
function preferredEntry(group: UniversalGroup): SourceEntry {
  // In the All view, a title such as One Piece can exist in both manga and
  // anime sources. Prefer the anime entry so Universal keeps its media type,
  // icon, chapters, and video-player route instead of becoming a manga card.
  return group.entries.find(entry => entry.mediaType === "anime") ?? group.entries[0];
}
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("source timeout")), ms))]);
}
function sourceTimeout(sourceId: string): number {
  return SOURCE_REQUEST_TIMEOUTS[sourceId] ?? REQUEST_TIMEOUT_MS;
}
function proxyMedia(sourceId: string, url: string): string {
  // AnimeGG episode pages are HTML player embeds, not image media. Keep the
  // original URL so its popup/player bootstrap can run in the iframe.
  const isAnimeEmbed = sourceId === "en.animegg" && /\/embed\//i.test(url);
  return !isAnimeEmbed && PROXIED_MEDIA_SOURCES.has(sourceId) && /^https:\/\//i.test(url)
    ? `/api/source-media?source=${encodeURIComponent(sourceId)}&url=${encodeURIComponent(url)}`
    : url;
}

/** Universal is a virtual source: it discovers titles across working sources,
 * groups matching series into one card, and routes every selected item back to
 * its original source. */
export function createUniversalSource(getSources: () => MangaSource[]): MangaSource {
  const workingSources = () => getSources().filter(source => UNIVERSAL_SOURCE_IDS.has(source.id));
  const sourceOpts = (source: MangaSource, opts: ListOptions): ListOptions => {
    const tagIds = (opts.tagIds ?? []).flatMap(id => {
      try {
        const [sourceId, rawTag] = decodeTuple(id);
        return sourceId === source.id ? [rawTag] : [];
      } catch { return []; }
    });
    return { ...opts, tagIds };
  };

  async function aggregate(loader: (source: MangaSource, opts: ListOptions) => Promise<MangaListResponse>, opts: ListOptions): Promise<MangaListResponse> {
    const sources = workingSources().filter(source => opts.media === "anime" || source.id !== "en.animegg");
    const results = await Promise.allSettled(sources.map(source => withTimeout(loader(source, sourceOpts(source, opts)), sourceTimeout(source.id))));
    const groups = new Map<string, UniversalGroup>();
    const sourceItems = results.map(result => result.status === "fulfilled" ? result.value.items : []);
    const maxItems = Math.max(0, ...sourceItems.map(items => items.length));
    // Round-robin the source result windows. This keeps Universal visually
    // mixed (MangaDex, AnimeGG, novels, manhwa, etc.) rather than showing a
    // full block of four rows from one extension before the next extension.
    for (let row = 0; row < maxItems; row += 1) {
      for (let index = 0; index < sourceItems.length; index += 1) {
        const item = sourceItems[index][row];
        if (!item) continue;
        if (!opts.nsfw && item.isNsfw) continue;
        // The default Universal view is the manga/all section. Anime is a
        // separate tab and must not be mixed into the manga detail flow.
        // Only an explicit media=anime request may include anime entries.
        if (opts.media === "anime" ? !isAnime(item) : isAnime(item)) continue;
        const key = groupKey(item);
        if (!key) continue;
        const entry: SourceEntry = { sourceId: sources[index].id, mangaId: item.id, title: item.title, thumbnail: item.thumbnail, mediaType: item.mediaType };
        const group = groups.get(key) ?? { entries: [] };
        if (!group.entries.some(existing => existing.sourceId === entry.sourceId && existing.mangaId === entry.mangaId)) group.entries.push(entry);
        groups.set(key, group);
      }
    }
    const items = Array.from(groups.values()).map(group => {
      const representative = preferredEntry(group);
      const thumbnail = representative.thumbnail || (representative.mediaType === "anime" ? UNIVERSAL_ICON : "");
      return { id: encodeGroup(group), title: representative.title, thumbnail: proxyMedia(representative.sourceId, thumbnail), type: representative.mediaType === "anime" ? "Anime" : "Manga", isNsfw: false, mediaType: representative.mediaType } satisfies MangaSummary;
    });
    // Each source returns its own page window. The aggregate must expose a
    // single bounded window too; otherwise page 1 expands to every source's
    // page (often 200+ cards) and the frontend never gets a chance to load
    // incrementally as the user scrolls.
    return {
      items: items.slice(0, UNIVERSAL_PAGE_SIZE),
      page: opts.page,
      hasNextPage: items.length > UNIVERSAL_PAGE_SIZE || results.some(result => result.status === "fulfilled" && result.value.hasNextPage),
    };
  }

  return {
    id: UNIVERSAL_SOURCE_ID,
    name: "Universal",
    lang: "all",
    isNsfw: false,
    popular: opts => aggregate((source, nextOpts) => source.popular(nextOpts), opts),
    latest: opts => aggregate((source, nextOpts) => source.latest(nextOpts), opts),
    search: (query, opts) => aggregate((source, nextOpts) => source.search(query, nextOpts), opts),
    tags: async (): Promise<SourceTag[]> => {
      const sources = workingSources();
      const results = await Promise.allSettled(sources.filter(source => source.tags).map(async source => ({ source, tags: await withTimeout(source.tags!(), TAG_TIMEOUT_MS) })));
      const tags: SourceTag[] = [];
      const seen = new Set<string>();
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const tag of result.value.tags) {
          const key = `${result.value.source.id}|${tag.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          tags.push({ id: encodeTuple([result.value.source.id, tag.id]), name: `${tag.name} · ${result.value.source.name}`, group: tag.group || result.value.source.name, count: tag.count });
        }
      }
      return tags;
    },
    details: async (id, opts: DetailOptions): Promise<MangaDetail> => {
      const group = decodeGroup(id);
      const sources = workingSources();
      const availableEntries = group.entries.filter(item => sources.some(source => source.id === item.sourceId));
      if (availableEntries.length === 0) throw new Error("Universal source is unavailable");
      const entry = preferredEntry({ entries: availableEntries });
      const source = sources.find(item => item.id === entry.sourceId)!;
       const detail = await withTimeout(source.details(entry.mangaId, opts), sourceTimeout(source.id));
      const thumbnail = detail.thumbnail || entry.thumbnail || (entry.mediaType === "anime" ? UNIVERSAL_ICON : "");
      return { ...detail, id: encodeGroup(group), title: detail.title || entry.title, thumbnail: proxyMedia(entry.sourceId, thumbnail) };
    },
    chapters: async (mangaId, dedupe): Promise<ChapterListResponse> => {
      const group = decodeGroup(mangaId);
      const sources = workingSources();
      const results = await Promise.allSettled(group.entries.map(async entry => {
        const source = sources.find(item => item.id === entry.sourceId);
        if (!source) throw new Error("source unavailable");
        // Universal must receive every translation; source-level dedupe often
        // intentionally keeps only one chapter number.
         const response = await withTimeout(source.chapters(entry.mangaId, false), sourceTimeout(source.id));
        return { entry, source, chapters: response.items };
      }));
      const seen = new Set<string>();
      const items = results.flatMap(result => {
        if (result.status !== "fulfilled") return [];
        return result.value.chapters.map(chapter => {
          const lang = chapter.lang || result.value.source.lang || "all";
          const scanlator = chapter.scanlator?.trim() || result.value.source.name;
          // Keep translations distinct. Only an exact duplicate from the same
          // source/language/scanlator is collapsed.
          const key = `${result.value.entry.sourceId}|${lang}|${scanlator}|${chapter.number}|${chapter.title}`;
          if (seen.has(key)) return null;
          seen.add(key);
          return {
            ...chapter,
            id: encodeTuple([result.value.entry.sourceId, String(chapter.id)]),
            lang,
            scanlator,
          };
        }).filter(Boolean);
      });
      return { items: items as NonNullable<(typeof items)[number]>[] };
    },
    pages: async (chapterId): Promise<PageListResponse> => {
      const [sourceId, sourceChapterId] = decodeTuple(chapterId);
      const source = workingSources().find(item => item.id === sourceId);
      if (!source) throw new Error(`Universal source ${sourceId} is unavailable`);
       const response = await withTimeout(source.pages(sourceChapterId), sourceTimeout(source.id));
      return { ...response, chapterId, pages: response.pages.map(page => ({ ...page, url: proxyMedia(sourceId, page.url) })) };
    },
  };
}
