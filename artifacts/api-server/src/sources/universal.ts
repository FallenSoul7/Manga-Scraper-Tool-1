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
type SourceEntry = { sourceId: string; mangaId: string; title: string; thumbnail: string; mediaType?: "manga" | "anime" };
type UniversalGroup = { entries: SourceEntry[] };

// Keep blocked/catalog-only handlers out of Universal. A single dead source
// must not make every browse request wait for the full timeout.
const UNIVERSAL_SOURCE_IDS = new Set([
  "all.mangadex", "en.asurascans", "all.webtoons", "all.atsu",
  "en.resetscans", "all.thunderscans", "en.novelfull", "en.novelhall",
  "en.animegg", "en.mangafreak", "en.comickfan",
]);
const REQUEST_TIMEOUT_MS = 7_000;
const TAG_TIMEOUT_MS = 4_000;
const PROXIED_MEDIA_SOURCES = new Set(["all.webtoons", "all.atsu", "en.resetscans"]);

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
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("source timeout")), ms))]);
}
function proxyMedia(sourceId: string, url: string): string {
  return PROXIED_MEDIA_SOURCES.has(sourceId) && /^https:\/\//i.test(url)
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
    const sources = workingSources();
    const results = await Promise.allSettled(sources.map(source => withTimeout(loader(source, sourceOpts(source, opts)), REQUEST_TIMEOUT_MS)));
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
        if (opts.media === "anime" && !isAnime(item)) continue;
        if (opts.media === "manga" && isAnime(item)) continue;
        const key = groupKey(item);
        if (!key) continue;
        const entry: SourceEntry = { sourceId: sources[index].id, mangaId: item.id, title: item.title, thumbnail: item.thumbnail, mediaType: item.mediaType };
        const group = groups.get(key) ?? { entries: [] };
        if (!group.entries.some(existing => existing.sourceId === entry.sourceId && existing.mangaId === entry.mangaId)) group.entries.push(entry);
        groups.set(key, group);
      }
    }
    const items = Array.from(groups.values()).map(group => {
      // Source order is the popularity/priority order supplied by the working registry.
      // The first source title and cover are the representative card for the merged group.
      const representative = group.entries[0];
      return { id: encodeGroup(group), title: representative.title, thumbnail: proxyMedia(representative.sourceId, representative.thumbnail), type: representative.mediaType === "anime" ? "Anime" : "Manga", isNsfw: false, mediaType: representative.mediaType } satisfies MangaSummary;
    });
    return { items, page: opts.page, hasNextPage: results.some(result => result.status === "fulfilled" && result.value.hasNextPage) };
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
      const entry = group.entries.find(item => sources.some(source => source.id === item.sourceId));
      if (!entry) throw new Error("Universal source is unavailable");
      const source = sources.find(item => item.id === entry.sourceId)!;
      const detail = await withTimeout(source.details(entry.mangaId, opts), REQUEST_TIMEOUT_MS);
      return { ...detail, id: encodeGroup(group), title: detail.title || entry.title, thumbnail: proxyMedia(entry.sourceId, detail.thumbnail) };
    },
    chapters: async (mangaId, dedupe): Promise<ChapterListResponse> => {
      const group = decodeGroup(mangaId);
      const sources = workingSources();
      const results = await Promise.allSettled(group.entries.map(async entry => {
        const source = sources.find(item => item.id === entry.sourceId);
        if (!source) throw new Error("source unavailable");
        // Universal must receive every translation; source-level dedupe often
        // intentionally keeps only one chapter number.
        const response = await withTimeout(source.chapters(entry.mangaId, false), REQUEST_TIMEOUT_MS);
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
      const response = await withTimeout(source.pages(sourceChapterId), REQUEST_TIMEOUT_MS);
      return { ...response, chapterId, pages: response.pages.map(page => ({ ...page, url: proxyMedia(sourceId, page.url) })) };
    },
  };
}
